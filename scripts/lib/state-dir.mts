// scripts/lib/state-dir.mts — shared agent state-dir derivation (TASK-092: the
// port of scripts/lib/state-dir.sh). A CLI, one subcommand per old function:
//
//   bp-state-root                       was bp_state_root
//   agent-state-dir                     was agent_state_dir
//   agent-state-dir-for <dir>           was agent_state_dir_for
//   agent-signal-file                   was agent_signal_file
//   agent-signal-file-for <dir>         was agent_signal_file_for
//   agent-signal-journal                was agent_signal_journal
//   agent-signal-journal-for <dir>      was agent_signal_journal_for
//
// Exit 0 with one path on stdout; 2 for a usage error (wrong arity); 9 when
// resolution fails (BP_CODE_ROOT unset, or the walk found no terminator). The
// stderr diagnostics are the shell's, byte for byte, function names included.
// Callers carry unexported shell locals into the child with an env prefix
// (BP_CODE_ROOT, BP_STATE_ROOT, AGENT_STATE_HOME, AGENT_SIGNAL_FILE,
// BP_STATE_ROOT_CEILING); an EMPTY value counts as unset for all five, as it
// did in the shell (`-z` / `-n` / `:-`).
//
// A-09: the activity feed and the Codex/Gemini dispatchers rendezvous through a
// per-project state dir — the dispatchers APPEND run logs there, the feed READS
// them and streams `[CODEX]` / `[GEMINI]` lines. For that to be a rendezvous and
// not a collision, both sides must compute the SAME directory from the SAME rule.
//
// They did not. The feed derived `~/.<repo-basename>` at runtime; the dispatchers
// hardcoded a literal, never-substituted bootstrap placeholder as their state dir
// (this repo is the template AND a working copy, so it stayed literal), so EVERY
// blueprint-derived checkout's dispatcher wrote into one shared directory and any
// feed pointed there saw every other project's Codex output interleaved. A
// verdict from the peer stream surfaced live in this project's feed — that is the
// whole defect in one line. The fix is one mechanism, used by every caller —
// never two implementations that agree only when a substitution lines up.
//
// BUG-020 — the state dir lives INSIDE the project now. The test adopted
// 2026-08-03 is "would being inside a git tree break this?" — not "is it
// temporary?". For append-only run logs the answer is no: logs/ is already
// gitignored. Deleting the project now deletes its state (it did not before, and
// a project bootstrapped at the same path later INHERITED the old records — the
// same "stale record survives deletion" trap the peer stream hit with workspace
// trust), and nothing needs to reach $HOME to find agent state. AGENT_STATE_HOME
// still overrides, unchanged: an operator who points several checkouts at one
// state dir keeps that.
//
// TASK-021 Stage A — the CODE root and the STATE root are two different things.
// A script's physical location answers "where is my CODE", never "where is my
// STATE". Resolving state from it produces a SECOND baton under
// scaffolding/logs/state/ that no dispatcher watches, a feed split in two, and a
// roster that falls through to the shipped example — all at exit 0.
//
// bp-state-root walks UP from the code root to the enclosing project root.
// WHY A FILESYSTEM TEST AND NOT `git rev-parse --show-toplevel`: that command
// answers about the CALLER's exported GIT_DIR, which git sets for every hook, and
// the gate runs the suites from a pre-push hook (BUG-014, which A-09 reopens). An
// existence test consults no command and no environment variable, so a hostile
// GIT_DIR cannot move it. tests/forbidden-idiom forbids the git command (BUG-077).
//
// WHY THE TERMINATOR IS THREE THINGS AND NOT ONE:
//   .blueprint-root    this repo (tracked, export-ignore'd)
//   .blueprint-source  every bootstrapped project (written by new-project.sh)
//   .git               every project-shaped tree, including test fixtures
// `.git` is tested with exists semantics and not as a directory: a submodule and
// a linked `git worktree` carry `.git` as a FILE.
//
// BP_CODE_ROOT IS REQUIRED. There is deliberately no cwd fallback: a wake command
// executed later by `sh -c` would resolve to whatever directory the dispatch ran
// from — in a fixture, the REAL checkout — and write into live state, silently.
// An unset BP_CODE_ROOT is a programming error and says so. Callers that
// legitimately mean "the directory git handed me" (the pre-push hook) set it
// explicitly to the current directory.
//
// BP_STATE_ROOT_CEILING — OPTIONAL, and the contract is exact:
//   unset  the walk runs to `/`. Production never sets it.
//   set    a PHYSICAL directory, no trailing slash, that the walk examines LAST.
//          If no terminator is found at or below it, the walk fails loudly
//          instead of climbing past it. (Unlike GIT_CEILING_DIRECTORIES, the
//          ceiling itself IS examined.) A ceiling that is not an ancestor of
//          BP_CODE_ROOT is never reached and so has no effect.
// It exists for the test harness (BUG-110): without it a marker ABOVE the
// workspace is where a markerless fixture resolves. Ported from PR #68
// (linkedin-watcher-agent).
//
// Callers resolve ONCE per script, at initialisation, guarded on the same line,
// so no later use ever holds "" and derives `/gemini-runs.log` at the root:
//
//   BP_STATE_ROOT="$(<env> node scripts/lib/state-dir.mts bp-state-root)" || exit 9
//
// agent-state-dir takes NO arguments: the positional root was REMOVED rather than
// defaulted, so a stale call site fails instead of resolving somewhere
// plausible. agent-state-dir-for <dir> is the named seam for tests and explicit
// overrides.
//
// BUG-019 — the LIVE coordination baton. AGENT_SIGNAL.md was a TRACKED file
// holding LIVE runtime state, so `git switch`, `git checkout <file>`, `git stash`
// and `git rebase` rewrote it mid-dispatch. The split: live mic state lives in
// the state dir, untracked (logs/ is gitignored), while AGENT_SIGNAL.md keeps the
// protocol prose. agent-signal-file honours $AGENT_SIGNAL_FILE, else
// `<state dir>/signal.md`.
//
// agent-signal-journal is the append-only record of every flip. NOTHING TRUNCATES
// OR ROTATES IT, and the whole replay design rests on that: session-resume.sh
// READS it to decide what to replay, and its `--mark` APPENDS the window markers
// in ONE append, because two appends leave a gap a concurrent flip can land in.
// A failed append is not swallowed (BUG-023). It is derived from the BATON's
// directory, not independently from the repo root, so it follows
// $AGENT_SIGNAL_FILE wherever that points: a record that follows its subject
// cannot drift from it, and two independent derivations of one location is the
// A-09 defect again.

import { existsSync, realpathSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

interface Result {
  code: number
  out: string
  err: string
}

const ok = (path: string): Result => ({ code: 0, out: `${path}\n`, err: '' })
const fail = (code: number, ...lines: string[]): Result => ({
  code,
  out: '',
  err: lines.map((l) => `${l}\n`).join(''),
})

// The shell's `${VAR:-}`: unset and empty are the same.
const env = (name: string): string => process.env[name] ?? ''

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    // a missing or unreadable marker is simply not a marker.
    return false
  }
}

export function bpStateRoot(): Result {
  const codeRoot = env('BP_CODE_ROOT')
  if (codeRoot === '') {
    return fail(
      9,
      "bp_state_root: BP_CODE_ROOT is unset. Set it from this script's own",
      '  physical location (the block every consumer carries), or to $(pwd)',
      '  if git invoked you and guarantees cwd is the work-tree root.',
    )
  }
  const ceiling = env('BP_STATE_ROOT_CEILING')
  let d = codeRoot
  while (!isFile(`${d}/.blueprint-root`) && !isFile(`${d}/.blueprint-source`) && !existsSync(`${d}/.git`)) {
    if (d === '/' || d === ceiling) {
      const c = ceiling !== '' ? ` up to the ceiling BP_STATE_ROOT_CEILING='${ceiling}'` : ''
      return fail(
        9,
        `FATAL: no .git, .blueprint-root or .blueprint-source at or above '${codeRoot}'${c} — cannot locate the project root`,
      )
    }
    try {
      // .native is realpath(3): `<symlink>/..` is the symlink target's parent, as
      // `cd -P` has it. The JS implementation folds the `..` away lexically.
      d = realpathSync.native(`${d}/..`)
    } catch {
      // the shell's `cd -P` failed silently here and the function returned 9.
      return { code: 9, out: '', err: '' }
    }
  }
  return ok(d)
}

export function agentStateDir(args: string[]): Result {
  if (args.length !== 0) {
    return fail(
      2,
      `agent_state_dir: takes no arguments (got ${args.length}: '${args.join(' ')}'). The state root is`,
      '  derived, not passed — a script\'s location is its CODE root, not its',
      '  state root. For an explicit root use agent_state_dir_for <dir>.',
    )
  }
  if (env('AGENT_STATE_HOME') !== '') return ok(env('AGENT_STATE_HOME'))
  if (env('BP_STATE_ROOT') === '') {
    return fail(
      9,
      'agent_state_dir: BP_STATE_ROOT is unset or empty. Resolve it ONCE at',
      '  script initialisation, right after sourcing this file:',
      '    BP_STATE_ROOT="$(bp_state_root)" || exit 9',
    )
  }
  return ok(`${env('BP_STATE_ROOT')}/logs/state`)
}

export function agentStateDirFor(args: string[]): Result {
  if (args.length !== 1) return fail(2, 'agent_state_dir_for: needs exactly one root')
  const root = args[0] ?? ''
  if (root === '') return fail(2, 'agent_state_dir_for: root is empty')
  return ok(env('AGENT_STATE_HOME') !== '' ? env('AGENT_STATE_HOME') : `${root}/logs/state`)
}

// A failed inner derivation keeps its diagnostic (the shell let the inner
// function's stderr through) and the outer function's own exit code.
const via = (inner: Result, code: number, next: (path: string) => string): Result =>
  inner.code !== 0 ? { code, out: '', err: inner.err } : ok(next(inner.out.slice(0, -1)))

export function agentSignalFile(args: string[]): Result {
  if (args.length !== 0) {
    return fail(2, `agent_signal_file: takes no arguments (got ${args.length}: '${args.join(' ')}') — use agent_signal_file_for <dir>`)
  }
  if (env('AGENT_SIGNAL_FILE') !== '') return ok(env('AGENT_SIGNAL_FILE'))
  return via(agentStateDir([]), 9, (d) => `${d}/signal.md`)
}

export function agentSignalFileFor(args: string[]): Result {
  if (args.length !== 1) return fail(2, 'agent_signal_file_for: needs exactly one root')
  return via(agentStateDirFor(args), 2, (d) => (env('AGENT_SIGNAL_FILE') !== '' ? env('AGENT_SIGNAL_FILE') : `${d}/signal.md`))
}

export function agentSignalJournal(args: string[]): Result {
  if (args.length !== 0) {
    return fail(2, `agent_signal_journal: takes no arguments (got ${args.length}: '${args.join(' ')}') — use agent_signal_journal_for <dir>`)
  }
  return via(agentSignalFile([]), 9, (f) => `${dirname(f)}/signal-history.log`)
}

export function agentSignalJournalFor(args: string[]): Result {
  if (args.length !== 1) return fail(2, 'agent_signal_journal_for: needs exactly one root')
  return via(agentSignalFileFor(args), 2, (f) => `${dirname(f)}/signal-history.log`)
}

function main(argv: string[]): number {
  const [sub, ...args] = argv
  let r: Result
  switch (sub) {
    case 'bp-state-root':
      r = bpStateRoot()
      break
    case 'agent-state-dir':
      r = agentStateDir(args)
      break
    case 'agent-state-dir-for':
      r = agentStateDirFor(args)
      break
    case 'agent-signal-file':
      r = agentSignalFile(args)
      break
    case 'agent-signal-file-for':
      r = agentSignalFileFor(args)
      break
    case 'agent-signal-journal':
      r = agentSignalJournal(args)
      break
    case 'agent-signal-journal-for':
      r = agentSignalJournalFor(args)
      break
    default:
      r = fail(
        2,
        `state-dir: unknown subcommand '${sub ?? ''}' (bp-state-root | agent-state-dir | agent-state-dir-for <dir> | agent-signal-file | agent-signal-file-for <dir> | agent-signal-journal | agent-signal-journal-for <dir>)`,
      )
  }
  process.stderr.write(r.err)
  process.stdout.write(r.out)
  return r.code
}

// Entry-point guard: importable from a test without running main().
const isEntryPoint =
  process.argv[1] !== undefined &&
  (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) ||
    process.argv[1].endsWith('/state-dir.mts'))

if (isEntryPoint) process.exitCode = main(process.argv.slice(2))
