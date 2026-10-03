#!/usr/bin/env bash
# scripts/no-chain-guard.sh — PreToolUse hook: refuse chained Bash commands.
#
# Enforces AGENTS.md §"Running commands — one per call, chains only when
# dependent". Blocks `&&`, `||` and `;`. **Pipes are permitted** — a pipeline is
# one operation whose filter cannot run without its producer, which is the
# dependency test that section states.
#
# WHY A HOOK AND NOT THE RULE ALONE
#
# The rule has been in CLAUDE.md for weeks. Across one long session on
# 2026-08-02 the agent broke it repeatedly while believing it was complying,
# and the founder had to correct it three separate times. A rule that must be
# remembered at the moment the author is busy is the wrong shape of fix — the
# same conclusion BUG-004 reached about "flip the mic last", and BUG-014 about
# fixture isolation. Prose describes; a hook enforces.
#
# Ported from the peer stream (`rdc-agenticcoding-blueprint`
# `scripts/no-chain-guard.sh`, landed 2026-07-30, founder-accepted), where it
# reports blocking a dozen-plus calls per session. Not re-derived — room Rule 1.
#
# THE REASON THE RULE EXISTS is permission granularity, not style. The allowlist
# matches one command *pattern* at a time. A compound string is matched as a
# single unit, so a permissive early pattern silently carries everything joined
# to it: `cd x && rm -rf y` is reviewed as a `cd`. That collapses one decision
# per command into one decision per blob, and it defeats the `deny` list by the
# same mechanism.
#
# TWO KNOWN LIMITS, both from the peer stream's live use — stated because a
# guard whose failure modes are undocumented gets worked around instead of used:
#
#   1. It matches operators inside QUOTED CONTENT. A commit message whose prose
#      contains `;` or `||` trips it. The workaround is better practice anyway:
#      write the body with the Write tool into `.scratch/`, then
#      `git commit -F .scratch/<file>` — reviewable, and immune to the matcher.
#      This repo already has the same class of false positive in its deny list:
#      `Bash(* --no-verify*)` blocked a task string that merely *discussed*
#      `--no-verify`.
#   2. It is INERT until workspace trust is accepted, because it lives in
#      `.claude/settings.json` — as does the allowlist. An untrusted project has
#      no guard AND prompts on everything, and those two compound.
#
# Contract: read the tool payload on stdin, exit 0 to allow, exit 2 to block
# with the reason on stderr.
#
# FAILS CLOSED (Codex F4). The first version said "never fail open on a parse
# problem" and then did exactly that three times: missing `jq` exited 0, and
# both `jq` calls discarded their errors into empty strings that also exited 0.
# Verified: `printf '{bad json' | bash scripts/no-chain-guard.sh` returned 0,
# and so did a valid chained payload under `PATH=/nonexistent`.
#
# That is not degraded logging. This hook exists because a compound command can
# inherit an early allowlist match and defeat the deny list; silently disabling
# it recreates the exact condition it was added to prevent, and does so in the
# circumstances where something is already wrong. A tool call refused with an
# actionable message costs one retry; a guard that evaporates costs the control.
#
# A NON-BASH tool is still allowed — but only after its identity was parsed
# successfully. "I could not tell what tool this is" is not "this is not Bash".

set -uo pipefail

die_closed() {
  printf 'BLOCKED (no-chain-guard): %s\n' "$1" >&2
  printf 'This hook fails closed. Fix the cause rather than removing the guard;\n' >&2
  printf 'it is what keeps a compound command from inheriting an allowlist match.\n' >&2
  exit 2
}

payload="$(cat 2>/dev/null || true)"
[ -n "$payload" ] || die_closed "empty tool payload on stdin"

command -v jq >/dev/null 2>&1 \
  || die_closed "jq is not on PATH, so the payload cannot be parsed"

# TYPES are validated, not merely presence (Codex R2-F3). `jq -r` renders a JSON
# number as text, so `{"tool_name":7}` and `{"tool_input":{"command":7}}` both
# produced plausible strings and reached exit 0 — a schema-invalid payload
# walking straight through an enforcement boundary. Syntactically valid JSON is
# not a valid payload, and this is the place that distinction has to be made.
tool="$(printf '%s' "$payload" \
  | jq -r 'if (.tool_name|type) == "string" then .tool_name else empty end' 2>/dev/null)" \
  || die_closed "payload is not valid JSON"
[ -n "$tool" ] || die_closed "payload has no string .tool_name"

# Identity parsed AND well-typed. Anything that is not Bash is out of scope.
[ "$tool" = "Bash" ] || exit 0

cmd="$(printf '%s' "$payload" \
  | jq -r 'if (.tool_input.command|type) == "string" then .tool_input.command else empty end' 2>/dev/null)" \
  || die_closed "Bash payload is not valid JSON"
[ -n "$cmd" ] || die_closed "Bash payload has no string .tool_input.command"

# `&&`, `||`, or `;` anywhere in the command string. Deliberately naive: the
# peer stream's experience is that a cleverer parser is not worth it, because
# the false positives have a workaround that is an improvement in its own right.
case "$cmd" in
  *'&&'*|*'||'*|*';'*) ;;
  *) exit 0 ;;
esac

cat >&2 <<'MSG'
BLOCKED: chained command (&& || ;). Run one command per tool call.

  - Independent commands  → separate tool calls. They dispatch in parallel in
    one turn, so nothing is lost by splitting them.
  - Another repo/dir      → use the tool's own flag: `git -C <dir> …`.
    Do NOT `cd <dir> && git …`.
  - A pipe (a | b)        → allowed. Re-send it unchanged.
  - A fixed recipe        → put it behind a script with its own allowlist entry
    (scripts/sonar-api.sh is the worked example), rather than chaining ad hoc.
  - Commit message prose  → this guard also matches ; and || inside quoted text
    and heredocs. Write the body to .scratch/ with the Write tool, then
    `git commit -F .scratch/<file>`.

Why: the permission allowlist matches one command PATTERN at a time. A compound
string is matched as one unit, so an early permissive pattern silently carries
everything joined to it — and that also defeats the deny list.
AGENTS.md §"Running commands — one per call, chains only when dependent".
MSG
exit 2
