#!/usr/bin/env node
// scripts/start-kimi-signal-watch.mts — TASK-083 port of the shell
// start-kimi-signal-watch.mts, which TASK-088 deleted; this file is the launcher.
//
// Launcher for the AGENT_SIGNAL.md ↔ Kimi CLI orchestrator.
//
// Mirror of start-gemini-signal-watch.mts, but for Kimi. Watches AGENT_SIGNAL.md
// (via the shared scripts/signal-watch.mts polling engine) and, every time
// the mic flips to `OVER_TO_KIMI`, invokes the real Kimi CLI in non-interactive
// (-p) mode with the current `Task` field as the prompt — `-p` alone runs
// unattended (kimi 2.0.2 refuses to combine `-p` with `--auto`/`--yolo`, and
// doesn't need either: there is nobody to ask in prompt mode). Kimi's file
// edits + signal flip land directly in the repo; its final message + run log are
// captured to the project's state dir (see scripts/lib/state-dir.sh —
// `<repo>/logs/state/kimi-last-message.md` and `<repo>/logs/state/kimi-runs.log`
// by default).
//
// Usage:
//   node scripts/start-kimi-signal-watch.mts
//
// The Kimi CLI is `~/.kimi-code/bin/kimi` or whatever `KIMI_BIN` points at. (a2bp-allow: Kimi CLI's own install dir, not per-project state.)
// Auth reuses ~/.kimi-code/ (device-code login). (a2bp-allow: same — Kimi's own auth dir, not per-project state.)
//
// NOTE: the shared poller (signal-watch.mts) executes the wake script via its
// AGENT_WAKE_COMMAND env hook (TASK-063; renamed from codex-signal-watch.sh /
// CODEX_WAKE_COMMAND — the poller is provider-agnostic). The trigger STATE is
// passed as --state OVER_TO_KIMI so this never collides with the Codex/Gemini
// watchers.

import { spawn } from 'node:child_process'
import { realpathSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findOnPath, isExecutable } from './lib/find-bin.mts'
import { scratchTmpDir } from './lib/scratch-tmpdir.mts'

// --- physical script root (A-09 / BUG-020, ported) ---
const _bpRoot = dirname(dirname(realpathSync(fileURLToPath(import.meta.url))))
// --- end physical script root ---
const ROOT = _bpRoot

function fail(message: string): never {
  writeSync(process.stderr.fd, `${message}\n`)
  process.exit(1)
}

// Discover the Kimi binary.
// Kimi's own default install dir — not per-project state, so it is not
// derived via scripts/lib/state-dir.sh (see the header comment above).
const KIMI_HOME_DISPLAY = '~/.kimi-code' // a2bp-allow: Kimi CLI's own default install dir, not per-project state

function findKimiBin(): string {
  const override = process.env.KIMI_BIN
  if (override) return override
  const onPath = findOnPath('kimi')
  if (onPath) return onPath
  const home = process.env.HOME ?? ''
  const fixed = join(home, '.kimi-code', 'bin', 'kimi')
  return isExecutable(fixed) ? fixed : ''
}

const KIMI_BIN = findKimiBin()
if (!KIMI_BIN || !isExecutable(KIMI_BIN)) {
  fail(`Kimi CLI not found.

Tried:
  1. $KIMI_BIN (${process.env.KIMI_BIN ?? ''})
  2. \`kimi\` on PATH
  3. ${KIMI_HOME_DISPLAY}/bin/kimi

Install per https://moonshotai.github.io/kimi-code/ (then authenticate once
with \`kimi login\`), or point KIMI_BIN at a kimi binary you trust, then
re-run.`)
}

// State dir derived the SAME way the activity feed derives it (A-09) — so the
// feed reads exactly the run log THIS project writes, never another project's.
// The state dir is derived INSIDE the wake command (below), not here — see
// start-codex-signal-watch.mts for why exporting a resolved path freezes it for
// the watcher's whole life.

// TASK-083: every dispatched agent's temporary files land under
// <repo>/.scratch/tmp, never /tmp. Kimi 2.0 has no sandbox/path-deny option
// (measured against `kimi --help`), so TMPDIR is the whole mechanism here —
// most tools (mktemp, os.tmpdir()) read it before falling back to /tmp.
const TMPDIR = scratchTmpDir(ROOT)

// Runs every time State = OVER_TO_KIMI fires. AGENT_SIGNAL_TASK is the current
// Task field, exported by the poller. We hand Kimi the radio-over preamble +
// Task and let it edit files / flip the signal in never-ask mode.
const AGENT_WAKE_COMMAND = `
set -u
# Resolved HERE, on every dispatch — not baked in when the watcher started.
# A watcher lives for days; the derivation can change under it, and a frozen
# path fails silently (BUG-020, Codex review round 2 finding 3).
BP_CODE_ROOT="$ROOT"
. "$ROOT/scripts/lib/state-dir.sh"
BP_STATE_ROOT="$(bp_state_root)" || exit 9
STATE_DIR="$(agent_state_dir)"
mkdir -p "$STATE_DIR"
RUN_LOG="$STATE_DIR/kimi-runs.log"
OUTPUT_LAST="$STATE_DIR/kimi-last-message.md"

# BUG-142: THE DISPATCHED CLI IS THE HOLDER PERSONA, not the Orchestrator.
# agent-activity.sh --whoami resolves the Orchestrator row unless AGENT_PERSONA
# overrides it, and nothing set that override here — so a dispatched agent
# asking who it is got the Orchestrator name (seen live twice: baton
# Holder=Florian, a dispatched Kimi --whoami answered Eto). The poller exports
# the dispatch persona as AGENT_SIGNAL_HOLDER; bridge it to the override
# resolve_identity already honours, at the only point where both are in scope.
# Deliberately NOT a second identity path inside --whoami — that is the
# BUG-010/BUG-021 two-copies-of-one-rule shape. Guarded so a wake run with no
# holder in scope leaves any ambient AGENT_PERSONA untouched.
[ -n "\${AGENT_SIGNAL_HOLDER:-}" ] && export AGENT_PERSONA="$AGENT_SIGNAL_HOLDER"
# THE MODEL, from the Model cell of the holder persona (TASK-059/TASK-063).
# A Kimi persona passes \`-m <slug>\`. A cell that does not resolve REFUSES the
# dispatch, visibly: running the wrong model quietly is the failure this exists
# to stop. A holder that is not a Kimi persona with a Model cell dispatches on
# the default_model kimi has configured, and says so.
#
# NOTE FOR EDITORS: this whole block is inside a single-quoted string, so an
# apostrophe here ends it and breaks the script (\`bash -n\` catches it). The
# wording below avoids possessives on purpose — keep it that way rather than
# re-introducing \`'"'"'\` escapes.
#
# EFFORT IS LOGGED, NOT APPLIED. Unlike the Codex \`-c model_reasoning_effort=\`
# flag, kimi 2.0.2 has no per-invocation effort flag — effort lives only in the
# \`[thinking] effort\` / \`default_effort\` keys of config.toml, a shared, global
# setting. Applying it per dispatch would mean staging a private
# \`KIMI_CODE_HOME\` with its own config.toml per persona, which means copying
# credentials into a generated config — not done casually (founder call,
# TASK-063). So the resolved effort is REQUESTED and LOGGED, and left
# unapplied on purpose — never silently dropped as if it had taken effect.
# The roster lib is sourced ONCE, here, before anything asks it a question.
# Both blocks below call into it, and an earlier revision resolved the
# Orchestrator ABOVE this line: \`command -v\` was false, so it fell back to the
# literal Orchestrator and the preamble named a holder signal-set.sh refuses.
# The run log said so plainly and the dispatch still completed, because the
# model reasoned its way to the right name — which is exactly how this stays
# invisible. Keep the source first.
if [ -r "$ROOT/scripts/lib/roster.sh" ]; then
  . "$ROOT/scripts/lib/roster.sh"
fi

# THE APPLIED EFFORT (cross-provider review finding 3, TASK-063). The roster
# Model cell carries a REQUESTED effort, but kimi 2.0.2 never applies one
# per-invocation (see the block above) — the effort that actually governs this
# run is the \`effort\` key of the \`[thinking]\` section in the kimi config.toml.
# VERIFIED ON THE WIRE, not inferred: a dispatched session records
# \`"thinkingEffort":"high"\` in its own
# \`~/.kimi-code/sessions/<wd>/<session>/agents/main/wire.jsonl\` (a2bp-allow: Kimi's own session-log path, not per-project state), matching
# \`[thinking] effort\` in that file. Do not add a \`default_effort\` fallback here:
# that key exists, but it is a PER-MODEL key inside \`[models."<alias>"]\`, not a
# \`[thinking]\` one, and whether it overrides \`[thinking]\` for a \`-p\` run has not
# been established. Guessing the precedence would re-create the very defect this
# block fixes, one level up. Read failure is likewise NOT papered over with the
# roster requested effort (F-002: a value standing in for something it does not
# imply) — the effort is left empty and the reason goes to the run log.
KIMI_CFG="\${KIMI_CODE_HOME:-$HOME/.kimi-code}/config.toml"  # a2bp-allow: Kimi CLI's own config dir default, not per-project state
APPLIED_EFFORT=""
APPLIED_EFFORT_REASON=""
if [ -r "$KIMI_CFG" ]; then
  APPLIED_EFFORT="$(awk "
/^\\[thinking\\]/ { insec = 1; next }
/^\\[/ { insec = 0; next }
insec && /^effort[[:space:]]*=/ {
  line = \\$0
  sub(/^[^=]*=[[:space:]]*/, \\"\\", line)
  gsub(/[\\" \\t]/, \\"\\", line)
  print line
  exit
}
" "$KIMI_CFG" 2>/dev/null)"
  [ -n "$APPLIED_EFFORT" ] || APPLIED_EFFORT_REASON="no [thinking] effort key in $KIMI_CFG"
else
  APPLIED_EFFORT_REASON="$KIMI_CFG is not readable"
fi

# THE FEED LABEL, built here and nowhere else (BUG-021) — same rule as the
# Codex launcher, same function, so the two cannot drift into different
# formats. There is deliberately NO kimi-runs.log pump in agent-activity.sh any
# more: a persona-resolved label at the point of dispatch is the only labeller,
# exactly as BUG-021 established for Codex. A raw pump also re-emitted every
# growing partial line as kimi streamed without a trailing newline, so removing
# it fixes the duplicate-line defect at the same time as the missing label —
# one cause, one fix, verified with a real dispatch (TASK-063).
#
# The 4th argument overrides the effort shown to the APPLIED one above, not
# the roster requested one — a plain 2-arg call would print the roster cell
# effort as if kimi had honoured it, which is exactly F-002. The sentinel "-"
# tells bp_roster_label to print no effort at all (added for this case, see
# scripts/lib/roster.sh) rather than fall back to the roster value, for when
# the applied effort could not be read.
FEED_LABEL="Kimi"
if command -v bp_roster_label >/dev/null 2>&1; then
  if [ -n "$APPLIED_EFFORT" ]; then
    __label="$(bp_roster_label "$BP_STATE_ROOT" "\${AGENT_SIGNAL_HOLDER:-Kimi}" "" "$APPLIED_EFFORT" 2>/dev/null)"
  else
    __label="$(bp_roster_label "$BP_STATE_ROOT" "\${AGENT_SIGNAL_HOLDER:-Kimi}" "" "-" 2>/dev/null)"
  fi
  [ -n "$__label" ] && FEED_LABEL="$__label"
fi
if [ -r "$ROOT/scripts/lib/feed.sh" ]; then
  . "$ROOT/scripts/lib/feed.sh"
else
  feed_append(){ :; }
fi
if [ -n "$APPLIED_EFFORT" ]; then
  printf "[roster] applied effort=%s (from %s)\\n" "$APPLIED_EFFORT" "$KIMI_CFG" | tee -a "$RUN_LOG"
else
  printf "[roster] applied effort: unknown (%s) — feed label omits effort rather than showing the roster request\\n" "$APPLIED_EFFORT_REASON" | tee -a "$RUN_LOG" >&2
fi

# WHO TO HAND BACK TO (TASK-061, re-broken and re-fixed under TASK-063). This
# preamble used to name a hardcoded \`Holder=Claude Code\`, but Holder is a
# PERSONA NAME and the Orchestrator name varies by roster. Worse, signal-set.sh
# now REFUSES a non-roster Holder (BUG-140), so the hardcoded form does not
# merely read oddly — it fails, and the dispatch only completes if the model is
# sharp enough to work out the right name unaided. Observed on the first live
# roll call: Kimi hit the refusal, reasoned its way to the Orchestrator row and
# recovered. That recovery is not something to depend on.
ORCHESTRATOR_NAME=""
if command -v bp_roster_name_for_role >/dev/null 2>&1; then
  ORCHESTRATOR_NAME="$(bp_roster_name_for_role "$BP_STATE_ROOT" Orchestrator 2>/dev/null)"
fi
if [ -z "$ORCHESTRATOR_NAME" ]; then
  ORCHESTRATOR_NAME="Orchestrator"
  printf "[roster] no Orchestrator row resolved — hand-back preamble falls back to the literal Orchestrator\\n" | tee -a "$RUN_LOG" >&2
fi

set --
REQUESTED_MODEL="" REQUESTED_EFFORT=""
if command -v bp_roster_model_for_name >/dev/null 2>&1; then
  __m="$(bp_roster_model_for_name "$BP_STATE_ROOT" "\${AGENT_SIGNAL_HOLDER:-}" 2>&1)"
  case $? in
    0) case "$__m" in
         Kimi*) REQUESTED_MODEL="$(printf "%s" "$__m" | cut -f2)"
                REQUESTED_EFFORT="$(printf "%s" "$__m" | cut -f3)"
                set -- -m "$REQUESTED_MODEL" ;;
         *) __m="[roster] \${AGENT_SIGNAL_HOLDER:-}: not a Kimi persona" ;;
       esac ;;
    1) printf "%s — dispatch refused\\n" "$__m" | tee -a "$RUN_LOG" >&2
       feed_append "[$FEED_LABEL] dispatch refused: $__m"
       exit 8 ;;
  esac
  [ "$#" -eq 0 ] && printf "%s — kimi runs its configured default_model\\n" "$__m" | tee -a "$RUN_LOG"
fi

now="$(date -u "+%Y-%m-%dT%H:%M:%SZ")"
if [ -n "$REQUESTED_MODEL" ]; then
  printf "[roster] requested model=%s effort=%s — effort not applicable per-invocation on kimi 2.0.2, see config.toml [thinking]\\n" "$REQUESTED_MODEL" "$REQUESTED_EFFORT" | tee -a "$RUN_LOG"
else
  printf "[roster] requested model=<kimi default>\\n" | tee -a "$RUN_LOG"
fi
echo "[$now] dispatching kimi -p ..." | tee -a "$RUN_LOG"
echo "  Task: $AGENT_SIGNAL_TASK" | tee -a "$RUN_LOG"
feed_append "[$FEED_LABEL] dispatched — $AGENT_SIGNAL_TASK"
cd "$ROOT"
# --prompt mode has nobody to ask, so it already never interrupts — measured:
# \`kimi --auto --prompt ...\` and \`kimi --yolo --prompt ...\` both refuse to start
# ("Cannot combine --prompt with --auto/--yolo", kimi 2.0.2), and \`-p\` alone
# writes files with no approval step. Passing --auto/--yolo here would not
# soften that, it would make the dispatch fail outright.
#
# Read LINE BY LINE rather than piped straight into \`tee ... >> RUN_LOG\` (the
# previous shape): \`read\` only returns a line once it sees the trailing
# newline, so a still-growing unterminated line is never re-emitted mid-write —
# which a raw log pump elsewhere could not tell apart from three genuinely new
# lines (TASK-063 finding). Each complete line gets exactly one feed_append.
# \`|| [ -n "$__line" ]\` on the loop condition flushes the FINAL fragment too:
# \`read\` returns non-zero at EOF even when it captured a trailing partial line
# (kimi exiting without a final newline), and without this the last line was
# silently dropped from both the run log and the feed (cross-provider review
# finding 2). It flushes at most once per run, at real EOF, so it cannot
# reintroduce the duplicate-line defect the line-by-line read was written to
# fix in the first place.
#
# THE EXIT STATUS (cross-provider review finding 1). This whole pipeline runs
# under dash (\`sh -c\`, no PIPESTATUS, no \`set -o pipefail\`), so \`$?\` after the
# pipe is the status of the last stage — the \`while read\` loop, which always
# exits 0. Capturing the real status needs the classic pipefail-free trick: the
# command group below writes the KIMI BIN exit status to KIMI_STATUS_FILE right
# after it finishes, which happens before its stdout (feeding tee) closes, so
# the file is always fully written by the time the downstream stages see EOF
# and this script reads it back. A failed dispatch (proven live with a probe
# exiting non-zero, TASK-063 cross-provider review) must never read as one
# that finished cleanly — that is what the run log and the feed line below
# now say.
KIMI_STATUS_FILE="$(mktemp "$STATE_DIR/.kimi-exit-status.XXXXXX" 2>/dev/null)" || KIMI_STATUS_FILE="$STATE_DIR/.kimi-exit-status.$$"
{
  "$KIMI_BIN" "$@" --prompt "You are running in the stash2flow radio-over coordination protocol with Claude Code. The protocol is documented in AGENT_SIGNAL.md; the LIVE baton is at logs/state/signal.md and is written ONLY via scripts/signal-set.sh. Claude has just flipped the mic to you. Current Task field: $AGENT_SIGNAL_TASK. Read AGENT_SIGNAL.md and any docs it references, do the work, then hand the mic back by RUNNING scripts/signal-set.sh with --holder set to $ORCHESTRATOR_NAME, --state set to OVER_TO_CLAUDE, and --task set to a one-line summary of what you produced. Do NOT hand-edit any baton file. You may run git add and git commit for your work if appropriate. Do NOT run git push; only Claude pushes." \\
    2>&1
  printf "%s" "$?" >"$KIMI_STATUS_FILE"
} \\
  | tee "$OUTPUT_LAST" \\
  | while IFS= read -r __line || [ -n "$__line" ]; do
      printf "%s\\n" "$__line" >>"$RUN_LOG"
      [ -n "$__line" ] && feed_append "[$FEED_LABEL] $__line"
    done
KIMI_STATUS="$(cat "$KIMI_STATUS_FILE" 2>/dev/null)"
rm -f "$KIMI_STATUS_FILE"
end="$(date -u "+%Y-%m-%dT%H:%M:%SZ")"
if [ "\${KIMI_STATUS:-1}" = "0" ]; then
  echo "[$end] kimi finished — see $OUTPUT_LAST for the last message" | tee -a "$RUN_LOG"
  feed_append "[$FEED_LABEL] finished — last message in $OUTPUT_LAST"
else
  echo "[$end] kimi FAILED (exit \${KIMI_STATUS:-unknown}) — see $OUTPUT_LAST for the last message" | tee -a "$RUN_LOG"
  feed_append "[$FEED_LABEL] FAILED (exit \${KIMI_STATUS:-unknown}) — see $OUTPUT_LAST"
fi
`

const env = { ...process.env, KIMI_BIN, ROOT, AGENT_WAKE_COMMAND, TMPDIR }
const signalWatch = join(ROOT, 'scripts', 'signal-watch.mts')
const child = spawn(process.execPath, [signalWatch, '--state', 'OVER_TO_KIMI', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
})
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(sig, () => child.kill(sig))
}
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
  } else {
    process.exit(code ?? 0)
  }
})
child.on('error', (err) => {
  writeSync(process.stderr.fd, `${String(err)}\n`)
  process.exit(1)
})
