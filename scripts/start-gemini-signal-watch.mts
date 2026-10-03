#!/usr/bin/env node
// scripts/start-gemini-signal-watch.mts — TASK-083 port of the shell
// start-gemini-signal-watch.mts, which TASK-088 deleted; this file is the launcher.
//
// Launcher for the AGENT_SIGNAL.md ↔ Gemini CLI orchestrator.
//
// Mirror of start-codex-signal-watch.mts, but for Gemini. Watches
// AGENT_SIGNAL.md (via the shared scripts/signal-watch.mts polling
// engine) and, every time the mic flips to `OVER_TO_GEMINI`, invokes the
// real Gemini CLI in non-interactive (-p) YOLO mode with the current `Task`
// field as the prompt. Gemini's file edits + signal flip land directly in
// the repo; its final message + run log are captured to the project's state dir
// (see scripts/lib/state-dir.sh — `<repo>/logs/state/gemini-last-message.md`
// and `<repo>/logs/state/gemini-runs.log` by default).
//
// Usage:
//   node scripts/start-gemini-signal-watch.mts
//
// The Gemini CLI is `@google/gemini-cli` (npm global) or whatever
// `GEMINI_BIN` points at. Auth reuses ~/.gemini/oauth_creds.json (the
// Gemini Code Assist extension login).
//
// NOTE: the shared poller (signal-watch.mts) executes the wake script via its
// AGENT_WAKE_COMMAND env hook (TASK-063; the poller is provider-agnostic, was
// renamed from codex-signal-watch.sh/CODEX_WAKE_COMMAND). The trigger STATE is
// passed as --state OVER_TO_GEMINI so this never collides with the Codex/Kimi
// watchers.

import { spawn } from 'node:child_process'
import { realpathSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findOnPath, findLatestUnderTree, isExecutable } from './lib/find-bin.mts'
import { scratchTmpDir } from './lib/scratch-tmpdir.mts'

// --- physical script root (A-09 / BUG-020, ported) ---
const _bpRoot = dirname(dirname(realpathSync(fileURLToPath(import.meta.url))))
// --- end physical script root ---
const ROOT = _bpRoot

function fail(message: string): never {
  writeSync(process.stderr.fd, `${message}\n`)
  process.exit(1)
}

// Discover the Gemini binary.
function findGeminiBin(): string {
  const override = process.env.GEMINI_BIN
  if (override) return override
  const onPath = findOnPath('gemini')
  if (onPath) return onPath
  const home = process.env.HOME ?? ''
  return findLatestUnderTree(join(home, '.nvm', 'versions', 'node'), 'gemini', 'bin') ?? ''
}

const GEMINI_BIN = findGeminiBin()
if (!GEMINI_BIN || !isExecutable(GEMINI_BIN)) {
  fail(`Gemini CLI not found.

Tried:
  1. $GEMINI_BIN (${process.env.GEMINI_BIN ?? ''})
  2. \`gemini\` on PATH
  3. ~/.nvm/versions/node/*/bin/gemini

Install with: npm install -g @google/gemini-cli  (then authenticate once),
or point GEMINI_BIN at a gemini binary you trust, then re-run.`)
}

// State dir derived the SAME way the activity feed derives it (A-09) — so the
// feed reads exactly the run log THIS project writes, never another project's.
// The state dir is derived INSIDE the wake command (below), not here — see
// start-codex-signal-watch.mts for why exporting a resolved path freezes it for
// the watcher's whole life. The `--log` argument that used to be built from a
// copy here is gone too: the poller derives signal.log from its own script root,
// which is this same tree, so passing it was a second derivation that could only
// ever disagree by being stale.

// TASK-083: every dispatched agent's temporary files land under
// <repo>/.scratch/tmp, never /tmp. Set here so the AGENT_WAKE_COMMAND child
// (and the policy file wired in below) both see it.
const TMPDIR = scratchTmpDir(ROOT)

// escapeRegex — for embedding ROOT literally inside a TOML `argsPattern`
// regex below. A repo path is not itself a regex, so every metacharacter in
// it (a `.` is the only one remotely plausible in a real checkout path, but
// the rest are cheap to cover) has to be escaped or the pattern could match
// more than the literal path.
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// TASK-083 — Gemini has no native "restrict tool writes to this path" policy
// rule (checked against `gemini --help`'s `--policy` flag and the bundled
// policy-engine docs, `docs/reference/policy-engine.md` in the gemini-cli
// package: a rule matches on tool name, a regex against the tool's JSON
// arguments, or (for run_shell_command) a command prefix/regex — no
// dedicated path condition). What IS expressible, and is exactly the TASK-083
// gap: `argsPattern` is tested against the tool call's JSON arguments, so a
// negative-lookahead regex on `write_file`/`replace`'s `file_path` denies any
// write whose path does not start with the workspace root. This is a real
// deny rule, evaluated by the engine itself — not a prompt instruction Gemini
// could talk itself out of. It does NOT cover every way `run_shell_command`
// could write outside the workspace (`cp`, `python -c`, a relative path that
// resolves outside via `..`, …) — the engine has no notion of what a shell
// command's target path resolves to, only what its own tool calls' JSON
// arguments say — so a second rule denies any shell command that MENTIONS
// `/tmp` or `$TMPDIR` literally, which is the concrete problem TASK-083
// responds to, stated as the partial mitigation it is rather than dressed up
// as complete sandboxing.
const GEMINI_POLICY_FILE = join(TMPDIR, 'gemini-policy-task083.toml')
const rootPattern = escapeRegex(ROOT)
writeFileSync(
  GEMINI_POLICY_FILE,
  `# TASK-083 — generated by start-gemini-signal-watch.mts on every launcher
# start, from the resolved workspace root. See the .mts source for what this
# can and cannot express.

[[rule]]
toolName = ["write_file", "replace"]
argsPattern = '"file_path":"(?!${rootPattern}/)'
decision = "deny"
denyMessage = "TASK-083: writes outside the workspace root are refused."
priority = 999

[[rule]]
toolName = "run_shell_command"
commandRegex = '(^|[^A-Za-z0-9_./-])(/tmp(/|[^A-Za-z0-9_./-]|$)|\\$\\{?TMPDIR\\}?)'
decision = "deny"
denyMessage = "TASK-083: shell commands naming /tmp or $TMPDIR are refused; TMPDIR already points at .scratch/tmp inside the workspace — use that."
priority = 999
`,
  'utf8',
)

// Runs every time State = OVER_TO_GEMINI fires. AGENT_SIGNAL_TASK is the
// current Task field, exported by the poller. We hand Gemini the radio-over
// preamble + Task and let it edit files / flip the signal in YOLO mode.
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
RUN_LOG="$STATE_DIR/gemini-runs.log"
OUTPUT_LAST="$STATE_DIR/gemini-last-message.md"

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
# The roster has to be available before either the feed label or hand-back
# target is resolved. A Holder is a persona, never the backing-agent name.
if [ -r "$ROOT/scripts/lib/roster.sh" ]; then
  . "$ROOT/scripts/lib/roster.sh"
fi

# Label Gemini output at the point of dispatch. The activity supervisor cannot
# recover this attribution later: it outlives several mic holders. Keeping the
# raw run log out of its pump also prevents a growing unterminated CLI line from
# being emitted again on every polling tick.
FEED_LABEL="Gemini"
if command -v bp_roster_label >/dev/null 2>&1; then
  __label="$(bp_roster_label "$BP_STATE_ROOT" "\${AGENT_SIGNAL_HOLDER:-Gemini}" 2>/dev/null)"
  [ -n "$__label" ] && FEED_LABEL="$__label"
fi
if [ -r "$ROOT/scripts/lib/feed.sh" ]; then
  . "$ROOT/scripts/lib/feed.sh"
else
  feed_append(){ :; }
fi

# Resolve the receiving persona from the roster. \`signal-set.sh\` rejects the
# former literal backing-agent value (Claude Code) because it is not a Holder.
ORCHESTRATOR_NAME=""
if command -v bp_roster_name_for_role >/dev/null 2>&1; then
  ORCHESTRATOR_NAME="$(bp_roster_name_for_role "$BP_STATE_ROOT" Orchestrator 2>/dev/null)"
fi
if [ -z "$ORCHESTRATOR_NAME" ]; then
  ORCHESTRATOR_NAME="Orchestrator"
  printf "[roster] no Orchestrator row resolved — hand-back preamble falls back to the literal Orchestrator\\n" | tee -a "$RUN_LOG" >&2
fi

now="$(date -u "+%Y-%m-%dT%H:%M:%SZ")"
echo "[$now] dispatching gemini -p (yolo) ..." | tee -a "$RUN_LOG"
echo "  Task: $AGENT_SIGNAL_TASK" | tee -a "$RUN_LOG"
feed_append "[$FEED_LABEL] dispatched — $AGENT_SIGNAL_TASK"
cd "$ROOT"
# GOOGLE_GENAI_USE_GCA=true selects the Gemini Code Assist OAuth creds
# (~/.gemini/oauth_creds.json from the extension login); --skip-trust trusts
# this workspace for the run so --yolo can auto-approve file writes.
GEMINI_STATUS_FILE="$(mktemp "$STATE_DIR/.gemini-exit-status.XXXXXX" 2>/dev/null)" || GEMINI_STATUS_FILE="$STATE_DIR/.gemini-exit-status.$$"
# TASK-083: --policy loads the workspace-restriction rules generated above
# (denies write_file/replace outside $ROOT, denies a shell command naming
# /tmp or $TMPDIR) on top of --yolo's own default "allow everything" rule —
# a --policy rule outranks it regardless of priority number, since the tier
# a rule loads at (Default for --yolo's built-in policy, User or above for an
# externally supplied file) dominates the priority within a tier.
{
  GOOGLE_GENAI_USE_GCA=true "$GEMINI_BIN" --skip-trust --yolo --policy "$GEMINI_POLICY_FILE" --prompt "You are running in the stash2flow radio-over coordination protocol with Claude Code. The protocol is documented in AGENT_SIGNAL.md; the LIVE baton is at logs/state/signal.md and is written ONLY via scripts/signal-set.sh. Claude has just flipped the mic to you. Current Task field: $AGENT_SIGNAL_TASK. Read AGENT_SIGNAL.md and any docs it references, do the work, then hand the mic back by RUNNING scripts/signal-set.sh with --holder set to $ORCHESTRATOR_NAME, --state set to OVER_TO_CLAUDE, and --task set to a one-line summary of what you produced. Do NOT hand-edit any baton file. You may run git add and git commit for your work if appropriate. Do NOT run git push; only Claude pushes." \\
    2>&1
  printf "%s" "$?" >"$GEMINI_STATUS_FILE"
} \\
  | tee "$OUTPUT_LAST" \\
  | while IFS= read -r __line || [ -n "$__line" ]; do
      printf "%s\\n" "$__line" >>"$RUN_LOG"
      [ -n "$__line" ] && feed_append "[$FEED_LABEL] $__line"
    done
GEMINI_STATUS="$(cat "$GEMINI_STATUS_FILE" 2>/dev/null)"
rm -f "$GEMINI_STATUS_FILE"
end="$(date -u "+%Y-%m-%dT%H:%M:%SZ")"
if [ "\${GEMINI_STATUS:-1}" = "0" ]; then
  echo "[$end] gemini finished — see $OUTPUT_LAST for the last message" | tee -a "$RUN_LOG"
  feed_append "[$FEED_LABEL] finished — last message in $OUTPUT_LAST"
else
  echo "[$end] gemini FAILED (exit \${GEMINI_STATUS:-unknown}) — see $OUTPUT_LAST for the last message" | tee -a "$RUN_LOG"
  feed_append "[$FEED_LABEL] FAILED (exit \${GEMINI_STATUS:-unknown}) — see $OUTPUT_LAST"
fi
`

const env = { ...process.env, GEMINI_BIN, ROOT, AGENT_WAKE_COMMAND, TMPDIR, GEMINI_POLICY_FILE }
const signalWatch = join(ROOT, 'scripts', 'signal-watch.mts')
const child = spawn(process.execPath, [signalWatch, '--state', 'OVER_TO_GEMINI', ...process.argv.slice(2)], {
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
