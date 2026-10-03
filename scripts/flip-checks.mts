// scripts/flip-checks.mts — TASK-075 (TASK-062-06/-13/-14): three
// flip-time OBSERVATIONS, warning-only. Audit rows D092, D116, C029, D098.
//
// WHAT THIS IS NOT. It is not a port of scripts/signal-set.sh (legacy shell,
// 302 lines). The founder ruled these three checks warning-only first
// (PLAN-TASK-062.md §"Founder decisions" #4): "They print at mic
// flip and block nothing, so signal-set.sh is not ported now. Port it later
// only if a warning is shown to be ignored." A file that only prints and
// never blocks has no reason to live inside the script that performs the
// flip, and every existing consumer of signal-set.sh (AGENTS.md's dispatch
// protocol, every persona) keeps calling it exactly as before.
//
// WHERE THIS RUNS, AND WHY THAT IS NOT A LEGACY-SHELL EDIT. Wired as a
// SECOND PreToolUse hook entry in .claude/settings.json, beside the existing
// no-chain-guard.sh one. settings.json is JSON, not shell, and this file is
// a new .mts, not an edit to any tracked shell file — so
// scripts/shell-inventory-check.mts's rule ("a legacy row HEAD changes is
// refused unless it becomes the exact shim") never engages: no legacy row
// is touched at all. Claude Code hands every Bash tool call's payload to
// every registered PreToolUse hook on stdin (the same contract
// no-chain-guard.sh already uses), so this script sees the same calls
// no-chain-guard.sh does and is free to be selective about which ones it
// reacts to — see shouldRunHook() below. No other backing agent (Codex,
// Gemini, Kimi, Copilot) has Claude Code hooks, so this is Claude-only,
// exactly as the audit's BINDS column records for every other HOOK-enforced
// row (e.g. C001, D097).
//
// WHAT EACH CHECK OBSERVES, NEVER GUESSES:
//   D092 — runs scripts/session-resume.sh (unmodified; its own header
//     explains why it derives instead of storing a claim) and surfaces its
//     warnings. This WIRES the existing marker check by calling it, not by
//     editing it. Still explicitly partial, exactly as the backlog row
//     says: a marker match proves the journal and HANDOVER.md agree on
//     WHICH window is live, never that the window's PROSE holds only WIP,
//     ephemeral state and hazards — that stays judgement.
//   D116 — `git status --short`, verbatim. A non-empty result is not a
//     verdict by itself (§7F only requires a clean tree when a review is
//     required), so this prints the fact and leaves the judgement call to
//     the flipping agent.
//   C029/D098 — `gh run list --commit <FULL sha>` for HEAD (HANDOVER.md §0:
//     a short sha returns nothing and a wait loop never ends). No `gh`, no
//     auth, or no matching run is printed as "CI status unknown" — a guess
//     standing in for a fact is exactly findings.md's F-002 shape, which
//     this task exists not to repeat.
//
// Usage:
//   node scripts/flip-checks.mts            report unconditionally (stdout)
//   node scripts/flip-checks.mts --hook      PreToolUse hook contract:
//                                             read the tool payload on
//                                             stdin, react only to a
//                                             signal-set.sh flip to
//                                             OVER_TO_USER, ALWAYS exit 0
//                                             (warning-only: never blocks).
//
// Exit: 0 always in --hook mode (warning-only). In direct mode, 0 once the
// three checks have run (their content, not their exit code, is the point).

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

interface CaptureResult {
  code: number
  stdout: string
  stderr: string
}

function runCapture(cmd: string, args: string[]): CaptureResult {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stdout, stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: unknown; stderr?: unknown; message?: string }
    return {
      code: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout ? String(e.stdout) : '',
      stderr: e.stderr ? String(e.stderr) : String(e.message ?? err),
    }
  }
}

// --- D092: wire the existing session-resume.sh marker check, unmodified ---
function checkSessionMarker(): string[] {
  const r = runCapture('bash', [join(ROOT, 'scripts', 'session-resume.sh')])
  const warnings = r.stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('⚠'))

  if (r.code === 0 && warnings.length === 0) {
    return ['D092 session-marker: trusted — the journal and HANDOVER.md agree on the live window.']
  }
  if (warnings.length > 0) {
    return [
      `D092 session-marker: INCOMPLETE (${warnings.length} warning(s) from session-resume.sh):`,
      ...warnings.map((w) => `  ${w}`),
    ]
  }
  return [
    `D092 session-marker: could not be observed — session-resume.sh exited ${r.code}: ` +
      r.stderr.trim().slice(0, 300),
  ]
}

// --- D116: git status --short is the fact; DoD §7F applies the judgement ---
function checkCleanTree(): string[] {
  const r = runCapture('git', ['-C', ROOT, 'status', '--porcelain'])
  if (r.code !== 0) {
    return [`D116 tree: unknown — git status failed: ${r.stderr.trim().slice(0, 300)}`]
  }
  const entries = r.stdout.split('\n').filter((l) => l.length > 0)
  if (entries.length === 0) {
    return ['D116 tree: clean.']
  }
  return [
    `D116 tree: ${entries.length} in-scope entr${entries.length === 1 ? 'y' : 'ies'} ` +
      '(untracked included) — §7F: commit them or narrow the reviewed scope so it does not overlap:',
    ...entries.map((e) => `  ${e}`),
  ]
}

// --- C029/D098: CI status for HEAD, printed or explicitly unknown ---
function checkCiStatus(): string[] {
  const head = runCapture('git', ['-C', ROOT, 'rev-parse', 'HEAD'])
  const sha = head.stdout.trim()
  if (head.code !== 0 || !sha) {
    return ['C029/D098 CI: unknown — could not resolve HEAD.']
  }

  const ghVersion = runCapture('gh', ['--version'])
  if (ghVersion.code !== 0) {
    return [`C029/D098 CI: unknown — gh CLI not available (${sha.slice(0, 12)}).`]
  }

  // HANDOVER.md §0: gh run list --commit needs the FULL sha, never a short
  // one — a short sha returns nothing and a wait loop never ends.
  const r = runCapture('gh', [
    'run',
    'list',
    '--commit',
    sha,
    '--limit',
    '5',
    '--json',
    'status,conclusion,name',
  ])
  if (r.code !== 0) {
    return [`C029/D098 CI: unknown — gh run list failed: ${r.stderr.trim().slice(0, 300)}`]
  }

  let runs: Array<{ status?: string; conclusion?: string | null; name?: string }>
  try {
    runs = JSON.parse(r.stdout)
  } catch {
    // Swallowed deliberately: unparsable gh output IS the observation, and the
    // line returned below reports it as unknown rather than guessing a status.
    return ['C029/D098 CI: unknown — gh returned output that did not parse as JSON.']
  }

  if (runs.length === 0) {
    return [`C029/D098 CI: no runs found for ${sha.slice(0, 12)} — not pushed yet, or CI has not started.`]
  }
  return runs.map(
    (run) =>
      `C029/D098 CI: ${run.name ?? '(unnamed run)'} — status=${run.status ?? 'unknown'} ` +
      `conclusion=${run.conclusion ?? '(pending)'}`,
  )
}

function runAllChecks(): string[] {
  return [...checkSessionMarker(), ...checkCleanTree(), ...checkCiStatus()]
}

// The hook only reacts to the moment the mic is handed to the founder — a
// signal-set.sh invocation naming --state OVER_TO_USER. Every other Bash
// call (including every OTHER signal-set.sh flip) is silently ignored, so
// this hook is quiet on the overwhelming majority of calls and does not
// duplicate D116/C029's own scope (they apply "at the moment the mic is
// handed back", per the backlog row, not on every intermediate flip).
function shouldRunHook(command: string): boolean {
  return command.includes('signal-set.sh') && command.includes('OVER_TO_USER')
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    // Swallowed deliberately: a hook with no readable stdin has nothing to judge,
    // and warning-only means it must never turn its own read failure into a block.
    return ''
  }
}

function hookMain(): number {
  const payload = readStdin()
  if (!payload) return 0 // fail open by design: warning-only, never blocks a tool call

  let parsed: { tool_name?: unknown; tool_input?: { command?: unknown } }
  try {
    parsed = JSON.parse(payload)
  } catch {
    // Swallowed deliberately: a payload this hook cannot parse is not its call to
    // adjudicate — exit 0 and let the tool call proceed, as warning-only requires.
    return 0
  }
  if (parsed.tool_name !== 'Bash') return 0
  const command = parsed.tool_input?.command
  if (typeof command !== 'string') return 0
  if (!shouldRunHook(command)) return 0

  const lines = runAllChecks()
  console.error('--- flip-checks (TASK-075, warning-only — nothing above blocks the flip) ---')
  for (const line of lines) console.error(line)
  console.error('--- end flip-checks ---')
  return 0 // ALWAYS 0 — the founder's ruling is warning-only, not a gate.
}

function directMain(): number {
  for (const line of runAllChecks()) console.log(line)
  return 0
}

const mode = process.argv[2]
process.exit(mode === '--hook' ? hookMain() : directMain())
