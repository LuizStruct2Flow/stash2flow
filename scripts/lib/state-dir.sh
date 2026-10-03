#!/bin/sh
# scripts/lib/state-dir.sh — shared agent state-dir derivation. Sourced, not executed.
#
# A-09: the activity feed and the Codex/Gemini dispatchers rendezvous through a
# per-project state dir — the dispatchers APPEND run logs there, the feed READS
# them and streams `[CODEX]` / `[GEMINI]` lines. For that to be a rendezvous and
# not a collision, both sides must compute the SAME directory from the SAME rule.
#
# They did not. The feed derived `~/.<repo-basename>` at runtime; the dispatchers
# hardcoded a literal, never-substituted bootstrap placeholder as their state dir
# (this repo is the template AND a working copy, so it stayed literal). The path
# they baked in was `~/.stash2flow/`.  a2bp-allow: the defective path is
# quoted here deliberately as the incident record; it is prose, not a code path.
# Result: EVERY blueprint-derived checkout's dispatcher wrote into that one
# shared directory, and any feed pointed there saw every other project's Codex
# output interleaved. A redcare acceptance verdict surfaced live in this
# project's feed — that is the whole defect in one line.
#
# The fix is one mechanism, sourced by every caller — never two implementations
# that agree only when a substitution happens to line up (cf. scripts/lib/gate.mts).
#
# BUG-020 — the state dir lives INSIDE the project now.
#
# A-09 made the feed and the dispatchers agree on a path. It did not ask whether
# that path should be outside the project, and `~/.<repo-basename>` left this
# repo with two kinds of agent log in opposite places: logs/agent-activity.log
# inside, codex-runs.log outside.
#
# The test adopted 2026-08-03 is "would being inside a git tree break this?" —
# not "is it temporary?". For append-only run logs the answer is no: logs/ is
# already gitignored and the feed writes there happily. (Contrast a2bp's scratch
# CLONE, which genuinely must be outside any git tree and is created with
# mktemp -d by the code that owns it.)
#
# Two things this fixes beyond tidiness:
#   * Deleting the project now deletes its state. It did not before, and a
#     project bootstrapped at the same path later INHERITED the old records —
#     the same "stale record survives deletion" trap the peer stream hit with
#     workspace trust.
#   * Nothing needs to reach $HOME to find agent state, so out-of-project
#     directory grants stop being required for ordinary operation.
#
# AGENT_STATE_HOME still overrides, unchanged: an operator who deliberately
# points several checkouts at one state dir keeps that. A-09's guarantee is
# untouched, because this is still the SINGLE derivation every side sources —
# moving it moves all of them together, which is the whole point of the file.
#
# TASK-021 Stage A — the CODE root and the STATE root are two different things.
#
# Today they are the same directory, so nothing below changes any resolved path.
# That is the point of landing it now: the mechanism is a provable no-op in the
# flat tree, so it can be proven here rather than debugged during the move.
#
# After the scaffolding/ split they diverge. Scripts live at
# <repo>/scaffolding/scripts/, while the live roster, baton, logs and lifecycle
# docs stay at <repo>/ — because that is where a DERIVED project's equivalents
# live, and this repo runs on its own scaffolding.
#
# So a script's physical location answers "where is my CODE", never "where is my
# STATE". Resolving state from it produces a SECOND baton under
# scaffolding/logs/state/ that no dispatcher watches, a feed split in two, and a
# roster that falls through to the shipped example — all at exit 0.
#
# ---------------------------------------------------------------------------
# bp_state_root — walk UP from the code root to the enclosing project root.
#
# WHY A FILESYSTEM TEST AND NOT `git rev-parse --show-toplevel`.
# That command answers about the CALLER's exported GIT_DIR, which git sets for
# every hook, and the gate runs the suites from a pre-push hook — that is
# BUG-014's mechanism and A-09 is what it reopens. `[ -e "$d/.git" ]` consults
# no command and no environment variable, so a hostile GIT_DIR cannot move it.
# Verified: under a decoy GIT_DIR, `rev-parse` answered `<repo>/scripts` while
# this walk was unmoved.
#
# **The guard must match the COMMAND, not the substring "git"**, or it will
# reject this safe expression. That guard is `tests/forbidden-idiom` — it began
# as `tests/state-dir` #6c, scoped to state-dir consumers, and BUG-077 widened
# it to the HAZARD: nothing under `scripts/` or `.githooks/` resolves a path
# from `git rev-parse --show-toplevel`, because that command answers about the
# caller's git environment rather than about either root.
#
# WHY THE TERMINATOR IS THREE THINGS AND NOT ONE.
#   .blueprint-root    this repo (tracked, export-ignore'd)
#   .blueprint-source  every bootstrapped project (written by new-project.sh)
#   .git               every project-shaped tree, including test fixtures
#
# The two markers are complete for real CHECKOUTS and NOT for FIXTURES. `.git`
# covers the fixtures that run `git init` — most of them — with nobody having to
# think about it, which is the default-correctness that makes it worth having.
#
# It is NOT sufficient on its own, and that was measured rather than assumed:
# three suites build project-shaped fixtures that never `git init`
# (tests/state-dir's `sd_tmpdir work`, tests/watcher-liveness's `e2e_repo dead`,
# tests/agent-activity-bound's temp repos). They resolve nothing and fail. So a
# spec enumerates every project-shaped fixture constructor and fails when one
# produces no terminator — belt and braces, the same doubling this repo already
# applies to .blueprint-root (export-ignore AND subtracted from the managed set) and
# .scratch/ (gitignored AND export-ignored).
#
# `-e` and not `-d`: a submodule and a linked `git worktree` carry `.git` as a
# FILE. Verified against both, plus a nested repo and a vendored derived project.
#
# BP_CODE_ROOT IS REQUIRED. There is deliberately no `$PWD` fallback, and that
# is not caution — it is a bug this change already caused and caught.
#
# start-codex-signal-watch.mts builds its wake command as a single-quoted string
# executed LATER by `sh -c`, where only EXPORTED variables survive. With a $PWD
# fallback, `bp_state_root` there resolved to whatever directory the dispatch
# happened to run from — which in tests/state-dir's fixture was the REAL
# blueprint checkout, so a fixture dispatch wrote codex-last-message.md into
# live state. Silently, and while the suite that exists to prevent exactly that
# was watching a different file.
#
# So an unset BP_CODE_ROOT is a programming error and says so. Callers that
# legitimately mean "the directory git handed me" — the pre-push hook and the
# libs it sources — set it explicitly to `$(pwd)`, which is a claim about git's
# hook contract rather than an accident of where someone was standing.
#
# BP_STATE_ROOT_CEILING — OPTIONAL, and the contract is exact:
#   unset  the walk runs to `/`. Production never sets it; behaviour is unchanged.
#   set    a PHYSICAL directory, no trailing slash, that the walk examines LAST.
#          If no terminator is found at or below it, the walk fails loudly
#          instead of climbing past it. (Unlike GIT_CEILING_DIRECTORIES, the
#          ceiling itself IS examined.) A ceiling that is not an ancestor of
#          BP_CODE_ROOT is never reached and so has no effect.
#
# It exists for the test harness, which sets it to every scenario's workspace
# root (BUG-110). Without it a marker ABOVE the workspace — the empty `/tmp/.git`
# a Codex workspace-write sandbox provides, measured — is where a markerless
# fixture resolves, and the case asserting "a markerless tree fails loudly"
# inverts. The bound comes from where the fixture path comes from, rather than
# being something each fixture must remember. Ported from PR #68
# (linkedin-watcher-agent).
bp_state_root() {
  if [ -z "${BP_CODE_ROOT:-}" ]; then
    echo "bp_state_root: BP_CODE_ROOT is unset. Set it from this script's own" >&2
    echo "  physical location (the block every consumer carries), or to \$(pwd)" >&2
    echo "  if git invoked you and guarantees cwd is the work-tree root." >&2
    return 9
  fi
  _bsr_d="$BP_CODE_ROOT"
  while [ ! -f "$_bsr_d/.blueprint-root" ] &&
        [ ! -f "$_bsr_d/.blueprint-source" ] &&
        [ ! -e "$_bsr_d/.git" ]; do
    if [ "$_bsr_d" = "/" ] || [ "$_bsr_d" = "${BP_STATE_ROOT_CEILING:-}" ]; then
      _bsr_c=""
      if [ -n "${BP_STATE_ROOT_CEILING:-}" ]; then
        _bsr_c=" up to the ceiling BP_STATE_ROOT_CEILING='$BP_STATE_ROOT_CEILING'"
      fi
      echo "FATAL: no .git, .blueprint-root or .blueprint-source at or above '$BP_CODE_ROOT'$_bsr_c — cannot locate the project root" >&2
      return 9
    fi
    _bsr_d="$(cd -P "$_bsr_d/.." 2>/dev/null && pwd)" || return 9
  done
  printf '%s\n' "$_bsr_d"
}

# ---------------------------------------------------------------------------
# RESOLVE ONCE PER SCRIPT, AT INITIALISATION. Every consumer does, beside the
# other init and with the guard on the same line:
#
#   . "$_bp_root/scripts/lib/state-dir.sh"
#   BP_STATE_ROOT="$(bp_state_root)" || exit 9
#
# A simple assignment's status IS the command substitution's status, so that
# `|| exit 9` works — the problem was never the idiom, it was doing it at 36
# call sites instead of one. Every later use reads an already-validated
# variable, so there is no window in which a consumer holds "" and derives
# `/gemini-runs.log` at the filesystem root. That empty-root path is the
# concrete harm and tests/state-root asserts it is unreachable.
#
# agent_state_dir            — TAKES NO ARGUMENTS.
# agent_state_dir_for <dir>  — the named seam, for tests and explicit overrides.
#
# The positional root was REMOVED rather than defaulted. A `${1:-...}` that
# defaults correctly is opt-in: every existing caller already held the wrong
# post-move value (its own script location), so a tolerant signature would let
# all of them keep selecting scaffolding/logs/state. Rejecting the argument is
# what makes a stale call site fail instead of resolving somewhere plausible.
#
# The seam exists because tests/state-dir #1/#2/#3 pass synthetic roots to prove
# two projects derive DIFFERENT state dirs — the assertion A-09 exists to
# protect. It is named differently so the call-site sweep can forbid it in
# production without also forbidding the ordinary API.
# shellcheck disable=SC2120 # reads "$#" only to refuse any argument, so no caller passes one (tests/state-root #C1)
agent_state_dir() {
  if [ "$#" -ne 0 ]; then
    echo "agent_state_dir: takes no arguments (got $#: '$*'). The state root is" >&2
    echo "  derived, not passed — a script's location is its CODE root, not its" >&2
    echo "  state root. For an explicit root use agent_state_dir_for <dir>." >&2
    return 2
  fi
  if [ -n "${AGENT_STATE_HOME:-}" ]; then printf '%s\n' "$AGENT_STATE_HOME"; return 0; fi
  if [ -z "${BP_STATE_ROOT:-}" ]; then
    echo "agent_state_dir: BP_STATE_ROOT is unset or empty. Resolve it ONCE at" >&2
    echo "  script initialisation, right after sourcing this file:" >&2
    echo "    BP_STATE_ROOT=\"\$(bp_state_root)\" || exit 9" >&2
    return 9
  fi
  printf '%s\n' "$BP_STATE_ROOT/logs/state"
}

agent_state_dir_for() {
  [ "$#" -eq 1 ] || { echo "agent_state_dir_for: needs exactly one root" >&2; return 2; }
  [ -n "$1" ] || { echo "agent_state_dir_for: root is empty" >&2; return 2; }
  printf '%s\n' "${AGENT_STATE_HOME:-$1/logs/state}"
}

# BUG-019 — the LIVE coordination baton.
#
# `AGENT_SIGNAL.md` was a TRACKED file holding LIVE runtime state. Each property
# is fine alone and a defect together: git owns tracked files in the working
# tree, so `git switch`, `git checkout <file>`, `git stash` and `git rebase`
# rewrite the baton — correctly, by their own contract — INCLUDING while an
# agent is mid-dispatch. Reproduced live: a checkout reverted the baton and the
# dispatched agent refused to proceed, silently. Nothing failed; the watcher
# simply had nothing left to claim.
#
# It was rare until every fix became a branch. The mechanism never changed; the
# frequency changed by an order of magnitude.
#
# The split: live mic state lives here, untracked (logs/ is gitignored), while
# AGENT_SIGNAL.md keeps the protocol prose. That is exactly the shape already
# used for AGENT_ROSTER.md / AGENT_ROSTER.example.md, which is per-engineer live
# state with a tracked template — the precedent, not a new idea.
#
# What it costs, stated because it was the crux of the decision: `git log -p
# AGENT_SIGNAL.md` stops being the hand-off history. Agreed with Codex that mic
# flips are LOCAL OPERATIONAL EVENTS while durable decisions belong in tracked
# plan and review documents — and that the append-only journal beside this file
# is in one way MORE accurate, because it records flips that were never
# committed, which git could never show.
#
# agent_signal_file [repo_root]
#   Honors $AGENT_SIGNAL_FILE if set, else `<state dir>/signal.md`.
# shellcheck disable=SC2120 # reads "$#" only to refuse any argument, so no caller passes one (tests/state-root #C1)
agent_signal_file() {
  [ "$#" -eq 0 ] || { echo "agent_signal_file: takes no arguments (got $#: '$*') — use agent_signal_file_for <dir>" >&2; return 2; }
  if [ -n "${AGENT_SIGNAL_FILE:-}" ]; then printf '%s\n' "$AGENT_SIGNAL_FILE"; return 0; fi
  _asf_d="$(agent_state_dir)" || return 9
  printf '%s\n' "$_asf_d/signal.md"
}

agent_signal_file_for() {
  [ "$#" -eq 1 ] || { echo "agent_signal_file_for: needs exactly one root" >&2; return 2; }
  _asff_d="$(agent_state_dir_for "$1")" || return 2
  printf '%s\n' "${AGENT_SIGNAL_FILE:-$_asff_d/signal.md}"
}

# agent_signal_journal [repo_root]
#   Append-only record of every flip.
#
#   THIS IS NO LONGER A BACKSTOP (FEATURE-003). It used to say "only
#   signal-set.sh appends, and nothing reads it to decide anything", and all
#   three clauses are now false: `session-resume.sh` READS it to decide what to
#   replay since the last handoff, and its `--mark` APPENDS the window markers.
#
#   Two consequences, both of which were bugs before they were documented:
#     * a failed append is no longer swallowed — signal-set.sh exits 8 rather
#       than losing an event the next replay would silently omit (BUG-023);
#     * `--mark` rolls the window in ONE append, because two appends leave a gap
#       a concurrent flip can land in, belonging to no replay window. That is
#       A-09's "two writers agreeing by coincidence" one level up, and this file
#       is where the warning about it lived while it came true next door.
#
#   NOTHING TRUNCATES OR ROTATES IT, and the whole replay design rests on that.
#   If you are about to add rotation here, the marker positions in
#   session-resume.sh stop meaning anything — fix that first.
#
#   Derived from the BATON's directory, not independently from the repo root, so
#   it follows $AGENT_SIGNAL_FILE wherever that points. The first version
#   resolved it from the root alone, and tests/signal-set/ — which overrides the
#   baton to a fixture — appended eleven fixture rows to the REAL journal on its
#   first run. A record that follows its subject cannot drift from it; two
#   independent derivations of one location is the A-09 defect, and I had just
#   reintroduced it in the file that documents it.
agent_signal_journal() {
  [ "$#" -eq 0 ] || { echo "agent_signal_journal: takes no arguments (got $#: '$*') — use agent_signal_journal_for <dir>" >&2; return 2; }
  _asj_f="$(agent_signal_file)" || return 9
  printf '%s\n' "$(dirname "$_asj_f")/signal-history.log"
}

agent_signal_journal_for() {
  [ "$#" -eq 1 ] || { echo "agent_signal_journal_for: needs exactly one root" >&2; return 2; }
  _asjf_f="$(agent_signal_file_for "$1")" || return 2
  printf '%s\n' "$(dirname "$_asjf_f")/signal-history.log"
}
