// scripts/blueprint.mts — TASK-081 whole-file port of scripts/blueprint (the
// struct2flow sync CLI), grown one slice at a time on branch task081-port.
// docs/doing/PLAN-TASK-081-blueprint-port.md is the plan; AGENTS.md
// "Shell to TypeScript, organically" is the migration rule this follows.
//
// scripts/blueprint (the shell CLI) is UNTOUCHED until slice 5 squashes this
// branch into the port commit that turns it into the two-line shim — every
// suite on this branch still runs the shell CLI, and this file is not wired
// to anything yet. Differential rows in tests/blueprint-port compare the two
// directly, subcommand family by subcommand family, as each slice lands.
//
// SLICE 1 — the skeleton: dispatch, `help`, `files`, colours,
// `die`, `run()` with the errexit-context rule, `unchecked`/`capture`,
// command-not-found 127/126 mapping, the shell-lib bridge, logical `PWD`, and
// the general signal machinery (record, defer to a child's exit, `shield`,
// the interruptible-wait `freeze`, and serialisation of repeated signals).
//
// SLICE 2 — the read path, `drift` complete: config
// (request-config.sh bridge), the P1 fetch (address-mode git, the cache, the
// BUG-120 gate), history, the staleness report (staleness.sh bridge), the
// managed set (slice 1's, reused), marker structure and the marker-aware
// merge (BUG-034/BUG-112), the P3 one-prospective-result and the P4 settings
// layer, `_bp_is_blueprint_itself` / `_bp_project_root` (state-dir.sh
// bridge) and gate arming (gate.mts, stdout inherited so the
// lib's own echo lines are the bytes this process emits — no re-formatting
// seam to drift from them).
//
// SLICE 3 (this commit) — `pull` complete: selection (BUG-113/BUG-016), the
// CLI-libs closure with shim-follow (plan §7 — `bpCliLibs` scans the pulled
// CLI, and its `.mts` sibling too once that CLI IS the exact shim), prompts
// (BUG-018/BUG-054), `pullFile`, the P2 shielded write (`shieldedWrite` —
// bytes, exec bit and rename finish together under a signal), bootstrap_sha
// (BUG-016/BUG-122) and retirement (TASK-021 §4.2). `a2bp` and `prs` remain
// placeholders.
//
// THE PLACEHOLDER HOLE (plan §9 D, decided: Option 1). `bp_should_substitute`
// (scripts/lib/placeholders.sh) exempts `*scripts/blueprint.mts` from
// project-name substitution (it named the deleted shell file until TASK-088;
// a pull before that substituted this file like any managed one). THIS FILE
// STILL NEVER SPELLS THE TOKEN, in code or comment, so substituting it is the
// identity either way. Anywhere the shell said the literal
// token, this file says "the project-name placeholder" instead.
// tests/blueprint-port pins this with a grep case.

import { spawn } from 'node:child_process'
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { constants as osConstants } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AsyncLocalStorage } from 'node:async_hooks'

// --- help text ---------------------------------------------------------
//
// Ported from the shell's header comment (scripts/blueprint:2-40) verbatim,
// stripped of its `#` comment leaders exactly as cmd_help's own
// `sed 's/^# //; s/^#//'` would. A CONSTANT, not read from `$0` — the shim is
// two lines and carries none of this text (plan §2 rule 6).
const HELP_LINES: readonly string[] = [
  '',
  'blueprint — sync CLI for struct2flow projects.',
  '',
  'Subcommands:',
  '  blueprint drift             Show which blueprint-managed files in this project',
  "                              have drifted from the blueprint HEAD, and what's",
  '                              changed in the blueprint since this project was',
  '                              last synced.',
  '  blueprint pull [FILE...]    Pull blueprint-managed files forward into this',
  '                              project. Interactive per file unless --yes.',
  "                              With no FILE, pulls every file that's drifted.",
  '  blueprint a2bp FILE [...]   Apply-to-blueprint: file a REQUEST that this',
  "                              project's version of FILE(s) be adopted upstream",
  '                              — a branch plus a pull request against the',
  "                              blueprint's remote. It writes into no working",
  '                              tree and cannot land anything. The blueprint',
  '                              owner implements it: merging as-is, adapting, or',
  '                              rewriting. FILE may be one the blueprint does not',
  '                              ship, or a new one; the request says so. Add',
  '                              --dry-run to see the diff without filing.',
  '  blueprint prs               List open a2bp requests, plus pushed branches',
  '                              with no PR.',
  '  blueprint files             List the blueprint-managed files (source of truth).',
  '  blueprint help              This message.',
  '',
  '`drift` and `pull` read the blueprint by its ADDRESS — blueprint_remote and',
  'blueprint_branch in .blueprint-source (config_version 2). Every run refreshes a',
  'per-machine cache of that remote and compares against the tip it just fetched,',
  'so a report never describes whatever a local folder happens to hold',
  '(TASK-025). An unreachable remote exits 5, never with a report. To compare',
  'against a local checkout instead — offline, or to preview an unpushed',
  'blueprint change — export BLUEPRINT_ROOT=<checkout>, and the report says so.',
  '`a2bp` and `prs` talk to the same remote. All commands except `files` and',
  '`help` must run from inside a struct2flow project.',
  '',
  'The per-machine `blueprint` command runs the CLI of the project you stand in.',
  'The toolchain installer writes it, once per machine:',
  '  bash scripts/install-toolchain.sh',
  'It names no checkout, so moving the blueprint cannot break it (TASK-025).',
]
export const HELP_TEXT: string = `${HELP_LINES.join('\n')}\n`

// --- colours: [ -t 1 ] becomes isatty(1) --------------------------------
const isTTY = process.stdout.isTTY === true
function colour(code: string): string {
  return isTTY ? `\x1b[${code}m` : ''
}
export const C_RED = colour('31')
export const C_GREEN = colour('32')
export const C_YELLOW = colour('33')
export const C_BLUE = colour('34')
export const C_BOLD = colour('1')
export const C_DIM = colour('2')
export const C_RESET = colour('0')

class ExitStatusError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`exit ${status}`)
    this.status = status
  }
}

// --- die ------------------------------------------------------------------
// `echo "${C_RED}error:${C_RESET} $*" >&2; exit 1`, verbatim — plus, since
// SLICE 2, the cleanup bash's EXIT trap would have run first (`_bp_sync_
// cleanup`, defined below with the P1 fetch). `bpSyncCleanup` no-ops when
// nothing was ever fetched (every field it reads starts empty), so this is
// exactly as harmless on every pre-fetch die() call as bash's own EXIT trap
// firing on an exit before it had anything to clean up.
export async function die(message: string): Promise<never> {
  process.stderr.write(`${C_RED}error:${C_RESET} ${message}\n`)
  await bpSyncCleanup()
  throw new ExitStatusError(1)
}

// --- TEMPLATE_FILES, verbatim from scripts/blueprint:104-124 ---------------
export const TEMPLATE_FILES: readonly string[] = [
  'project_config_overview.md',
  'project_config_paths.md',
  'project_config_dod.md',
  'project_config_security.md',
  'project_config_infra.md',
  'sonar-project.properties',
  'docs/doing/HANDOVER.md',
  'docs/backlog/BACKLOG.md',
  'docs/backlog/BUGS.md',
  'AGENT_ROSTER.md',
  'README.md',
  '.gitignore',
  '.gitattributes',
]

// --- logical PWD and the CLI's own directory (plan §2 rule 6) --------------
//
// Bash's $PWD is a LOGICAL path — it survives a `cd` through a symlink
// unmangled, unlike `process.cwd()`, which Node always resolves physically.
// A shell exports its own $PWD to the node it runs, so this reads that value —
// but, as bash itself does at startup, only when it names the current
// directory. A node spawned by a non-shell parent inherits whatever PWD that
// parent had (TASK-088 deleted the bash shim that used to reset it).
export function logicalPwd(): string {
  const pwd = process.env.PWD
  try {
    if (pwd !== undefined && realpathSync(pwd) === realpathSync(process.cwd())) return pwd
  } catch {
    // An unreadable or stale PWD names nothing, so the physical cwd stands.
  }
  return process.cwd()
}

// The CLI's own directory, resolved against logicalPwd() — never
// `import.meta.dirname`, which realpaths. Mirrors
// `cd "$(dirname "${BASH_SOURCE[0]}")" && pwd` under the shim's `exec`, where
// argv[1] is exactly the shim's own path (relative or absolute, as invoked).
export function cliDir(): string {
  const argv1 = process.argv[1] ?? join(logicalPwd(), 'scripts', 'blueprint.mts')
  const abs = argv1.startsWith('/') ? argv1 : resolve(logicalPwd(), argv1)
  return dirname(abs)
}

export function libDir(): string {
  return join(cliDir(), 'lib')
}

// cliName — process.argv[1] without its .mts suffix, matching bash's $0 for
// the shim (the shim always execs with argv[1] = "<its own dirname>/blueprint.mts").
function cliName(): string {
  const argv1 = process.argv[1] ?? 'scripts/blueprint'
  return argv1.endsWith('.mts') ? argv1.slice(0, -4) : argv1
}

// --- errexit context: `set -euo pipefail` becomes a call-context property --
//
// Plan §2 rule 4. Bash's `-e` is not a global switch in practice: it is
// ignored inside a condition (`if f`, `f && …`, `! f`) and, without
// `inherit_errexit` (never set here), inside every `$( )`. `run()` below
// rejects on a non-zero status only while this context reads "on"; a site
// that calls a PORTED FUNCTION the way bash calls it inside one of those
// contexts wraps the call in `unchecked()` or `capture()` instead of calling
// it bare.
interface ErrexitFrame {
  readonly enabled: boolean
}
const errexitStorage = new AsyncLocalStorage<ErrexitFrame>()

export function errexitEnabled(): boolean {
  return errexitStorage.getStore()?.enabled ?? true
}

// unchecked(fn) — run `fn` with errexit off for its whole dynamic extent
// (bash: `if fn`, `fn && …`, `! fn`). `fn`'s own `run()` calls see a non-zero
// status as data, never as a rejection.
export function unchecked<T>(fn: () => Promise<T> | T): Promise<T> {
  return errexitStorage.run({ enabled: false }, async () => fn())
}

function stripTrailingNewlines(s: string): string {
  return s.replace(/\n+$/, '')
}

// capture(fn) — the same errexit-off context as unchecked(), for a site that
// calls a function the way bash calls one inside `$( )`: the RESULT also has
// every trailing newline stripped, exactly as command substitution does.
export async function capture(fn: () => Promise<string> | string): Promise<string> {
  const out = await unchecked(fn)
  return stripTrailingNewlines(out)
}

// --- signal machinery (plan §2 rule 7, §3 P1/P2) ----------------------------
//
// Bash only checks a trap BETWEEN commands — a signal that arrives while a
// foreground child runs waits for that child. This is the general rule; P1's
// fetch-wait `freeze` is the one deliberate exception (the single
// interruptible `wait`), and P2's `shield` is a caller-declared critical
// section standing in for bash's subshell that ignores INT/TERM. All three
// share ONE state: the first recorded signal decides, a signal recorded
// while the handler is already running is dropped, and the handler runs
// exactly once before the process dies of that first signal.
export type Signal = 'SIGINT' | 'SIGTERM' | 'SIGHUP'
export type TerminatingHandler = () => Promise<void> | void
type KillFn = (pid: number, signal: NodeJS.Signals) => void

interface SignalState {
  pending: Signal | null
  handlerStarted: boolean
  handlerDone: boolean
  shielded: boolean
  childInFlight: boolean
  handler: TerminatingHandler | null
  resume: boolean
  kill: KillFn
}

const signalState: SignalState = {
  pending: null,
  handlerStarted: false,
  handlerDone: false,
  shielded: false,
  childInFlight: false,
  handler: null,
  resume: false,
  kill: process.kill.bind(process),
}

// installSignals — wires the OS-level listeners. `kill` is a seam
// (scripts/lib/spawn-bounded.mts's own `killFn` pattern): production never
// passes it, so `process.kill` is exactly what always runs; a test injects a
// stub so exercising "the process dies of the signal" does not kill the test
// runner.
export function installSignals(handler: TerminatingHandler, kill: KillFn = process.kill.bind(process)): void {
  signalState.handler = handler
  signalState.kill = kill
  signalState.resume = false
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => recordSignal(sig))
  }
}

// setTerminatingHandler — swaps WHICH handler `maybeRunHandler` runs, without
// re-registering the OS-level listeners `installSignals` already wired (once,
// at the entry point). `a2bp`'s own trap (`cmd_a2bp`'s `trap _a2bp_cleanup EXIT
// INT TERM`, scripts/blueprint:1886) replaces the process-wide handler for the
// duration of that one command, same as bash: the last `trap` call for a
// signal wins, there is no stacking. `resume` is BUG-116, kept on purpose
// (plan §3 P5 "Kept exactly, although it is wrong"): `_a2bp_cleanup` never
// calls `exit`, so bash's default behaviour for a trap that returns normally
// is to CONTINUE the script rather than die of the signal — cmd_a2bp is
// therefore not actually interruptible. Reproduced here rather than fixed.
export function setTerminatingHandler(handler: TerminatingHandler, resume = false): void {
  signalState.handler = handler
  signalState.resume = resume
}

// recordSignal — the OS-level listener's ENTIRE job: remember the signal,
// never act on it here. Serialisation: the first one recorded decides: a
// later signal, while one is already pending, changes nothing.
export function recordSignal(sig: Signal): void {
  if (signalState.pending === null) signalState.pending = sig
  if (!signalState.childInFlight && !signalState.shielded) {
    // No child in flight and no shield open: this is bash's "between
    // commands" for an otherwise-idle flow, which for an idle event loop is
    // the next turn.
    setImmediate(() => {
      void maybeRunHandler()
    })
  }
}

// isTerminating — true from the instant a signal is recorded, whether or not
// the handler has actually started running yet. This is what `freeze` reads.
export function isTerminating(): boolean {
  return signalState.pending !== null
}

// maybeRunHandler — bash's "check the trap between commands". Called by
// run() after every child exits, by shield() when it closes, and scheduled
// directly by recordSignal() when neither applies. A signal recorded while
// shielded or while a child is in flight waits here for the matching call.
export async function maybeRunHandler(): Promise<void> {
  if (signalState.pending === null) return
  if (signalState.handlerStarted) return
  if (signalState.shielded || signalState.childInFlight) return
  signalState.handlerStarted = true
  const handler = signalState.handler
  const resume = signalState.resume
  const sig = signalState.pending
  if (handler) await handler()
  signalState.handlerDone = true
  if (resume) {
    // BUG-116 (kept): re-arm exactly as bash's un-exited trap does, so a
    // SECOND signal during the same a2bp run is handled again too.
    signalState.pending = null
    signalState.handlerStarted = false
    signalState.handlerDone = false
    return
  }
  dieOfSignal(sig)
}

// dieOfSignal — remove the listeners, then send the recorded signal to
// ourselves. POSIX delivers an unblocked self-signal before `kill()` returns,
// so nothing after this call runs UNDER THE REAL process.kill. A test's
// stub kill does not terminate the process, which is the point: it lets the
// assertions after this call run.
function dieOfSignal(sig: Signal): void {
  process.removeAllListeners('SIGINT')
  process.removeAllListeners('SIGTERM')
  process.removeAllListeners('SIGHUP')
  signalState.kill(process.pid, sig)
}

// beginChild / endChild — run() calls these around every spawn. Exported
// too, so a unit test can simulate "a child is in flight" without actually
// spawning one.
export function beginChild(): void {
  signalState.childInFlight = true
}
export async function endChild(): Promise<void> {
  signalState.childInFlight = false
  await maybeRunHandler()
}

// shield — a critical section: bash's subshell that ignores INT/TERM for the
// P2 write (§3 P2). While `fn` runs, a recorded signal only waits; the
// moment it closes, a recorded signal takes the terminating path — the same
// check run() performs after a child exits.
export async function shield<T>(fn: () => Promise<T>): Promise<T> {
  signalState.shielded = true
  try {
    return await fn()
  } finally {
    signalState.shielded = false
    await maybeRunHandler()
  }
}

// freeze — the one interruptible wait (§3 P1's fetch). If a signal has been
// recorded by the time `p` settles, the result must never reach the caller:
// the terminating handler is about to run (or already has) and the process
// is about to die of that signal, so this returns a promise that stays
// pending forever instead of resolving to a value nobody should act on.
export async function freeze<T>(p: Promise<T>): Promise<T> {
  const result = await p
  if (isTerminating()) return new Promise<T>(() => {})
  return result
}

// Test-only reset. Never called from main().
export function _resetSignalStateForTests(): void {
  signalState.pending = null
  signalState.handlerStarted = false
  signalState.handlerDone = false
  signalState.shielded = false
  signalState.childInFlight = false
  signalState.handler = null
  signalState.resume = false
  signalState.kill = process.kill.bind(process)
  process.removeAllListeners('SIGINT')
  process.removeAllListeners('SIGTERM')
  process.removeAllListeners('SIGHUP')
}

// --- run(): the one spawn helper (plan §2 rule 4) ---------------------------
export type StdioTarget = 'inherit' | 'ignore' | 'capture' | { readonly file: string }

export interface RunOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly stdin?: 'inherit' | 'ignore' | string
  readonly stdout?: StdioTarget
  readonly stderr?: StdioTarget
}

export interface RunResult {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

export class CommandFailedError extends Error {
  readonly result: RunResult
  constructor(cmd: string, result: RunResult) {
    super(`${cmd} exited ${result.status}`)
    this.result = result
  }
}

function signalNumber(sig: NodeJS.Signals): number {
  const table = osConstants.signals as Record<string, number>
  return table[sig] ?? 0
}

// Resolves one child's low-level stdio slot, plus the fd this call opened
// (if any) so run() can close it once the child is done with it — Node never
// closes a caller-supplied fd itself.
function openStdioTarget(target: StdioTarget | undefined, fallback: 'inherit' | 'ignore'): {
  readonly stdio: 'inherit' | 'ignore' | 'pipe' | number
  readonly openedFd?: number
} {
  const t = target ?? fallback
  if (t === 'capture') return { stdio: 'pipe' }
  if (typeof t === 'object') {
    const fd = openSync(t.file, 'w')
    return { stdio: fd, openedFd: fd }
  }
  return { stdio: t }
}

// run() — the one place `set -euo pipefail` becomes real. Rejects on a
// non-zero status only while errexit is on (rule 4); maps a missing or
// non-executable command to 127/126 the way bash does, message included,
// in every stderr mode (rule 4's "command not found"); and drives the
// signal machinery's "check between commands" at the one point that IS a
// command boundary — after this child exits.
export async function run(cmd: string, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  const stdinMode: 'inherit' | 'ignore' | 'pipe' =
    opts.stdin === undefined || opts.stdin === 'inherit' ? 'inherit' : opts.stdin === 'ignore' ? 'ignore' : 'pipe'
  const out = openStdioTarget(opts.stdout, 'inherit')
  const err = openStdioTarget(opts.stderr, 'inherit')

  beginChild()
  let result: RunResult
  try {
    result = await new Promise<RunResult>((settle, reject) => {
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(cmd, args, {
          cwd: opts.cwd,
          env: opts.env ?? process.env,
          stdio: [stdinMode, out.stdio, err.stdio],
        })
      } catch (spawnErr) {
        reject(spawnErr)
        return
      }

      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      if (typeof opts.stdin === 'string') {
        child.stdin?.end(opts.stdin)
      }

      child.once('error', (spawnErr: NodeJS.ErrnoException) => {
        // Command-not-found / not-executable, in EVERY stderr mode (rule 4):
        // bash reports these through the redirection the failing command
        // itself carried, so 'ignore' prints nothing here either, exactly
        // as `2>/dev/null` would.
        const status = spawnErr.code === 'ENOENT' ? 127 : spawnErr.code === 'EACCES' ? 126 : 1
        if (status === 127 || status === 126) {
          const reason = status === 127 ? 'command not found' : 'Permission denied'
          const message = `${cliName()}: ${cmd}: ${reason}\n`
          if (err.stdio === 'pipe') stderr += message
          else if (err.stdio !== 'ignore') process.stderr.write(message)
        }
        settle({ status, stdout, stderr })
      })

      child.once('close', (code, signal) => {
        const status = signal !== null ? 128 + signalNumber(signal) : code ?? 1
        settle({ status, stdout, stderr })
      })
    })
  } finally {
    if (out.openedFd !== undefined) closeSync(out.openedFd)
    if (err.openedFd !== undefined) closeSync(err.openedFd)
    await endChild()
  }

  if (errexitEnabled() && result.status !== 0) {
    throw new CommandFailedError(cmd, result)
  }
  return result
}

// --- the shell-lib bridge (plan §4) -----------------------------------------
//
// Every request/staleness/gate lib stays shell — each has a still-shell
// caller. `bashLib` is the one crossing: `bash -c '. "$1"; <snippet>' $0 LIB
// ARGS…`, bash (not sh) because those libs use arrays. Stdout is captured
// (like `$( )`, trailing newlines stripped); stderr is INHERITED unless the
// caller overrides it — this bridge never swallows a lib's own diagnostics.
//
// The argv0 handed to every `bash -c` bridge call is `cliName()`, never the
// literal `_`: an undefined function inside the sourced lib makes bash print
// its own "$0: line N: NAME: command not found" for it (bash's normal
// diagnostic for an unset function, same shape as a missing command), and
// bash's $0 there is exactly the FIRST argument after the -c script — so a
// bare `_` reports "_: line N: …" where the real, unbridged shell CLI would
// have reported its own invoked path. Passing `cliName()` (== the shim's own
// `$(dirname "$0")`-derived path, plan §2 rule 6) makes the bridge's diagnostic
// read the same leading token the real CLI's own interpreter would have used.
export async function bashLib(
  libPath: string,
  snippet: string,
  args: readonly string[] = [],
  opts: Omit<RunOptions, 'stdout' | 'stdin'> = {},
): Promise<{ readonly stdout: string; readonly status: number }> {
  const r = await run('bash', ['-c', `. "$1"; ${snippet}`, cliName(), libPath, ...args], {
    ...opts,
    stdout: 'capture',
    stderr: opts.stderr ?? 'inherit',
  })
  return { stdout: stripTrailingNewlines(r.stdout), status: r.status }
}

// bashLibs — the same bridge, generalised to SEVERAL libs sourced into one
// bash process before `snippet` runs (plan §4's "one helper", `LIB` plural):
// `a2bp`'s own request-build/-inputs/-file functions call `bp_request_hermetic`
// (request.sh) and `bp_should_substitute`/`bp_substitute_stream`
// (placeholders.sh) INTERNALLY, exactly as cmd_a2bp's `for lib in …; do . …;
// done` sources all of them into the one shell process it runs in. The lib
// paths are passed as the FIRST N positional args, then shifted off, so
// `snippet` addresses its own arguments at "$1", "$2", … exactly as if the
// libs were never there.
export async function bashLibs(
  libPaths: readonly string[],
  snippet: string,
  args: readonly string[] = [],
  opts: Omit<RunOptions, 'stdout' | 'stdin'> = {},
): Promise<{ readonly stdout: string; readonly status: number }> {
  const preamble = libPaths.map((_, i) => `. "$${i + 1}"`).join('; ')
  const r = await run(
    'bash',
    ['-c', `${preamble}; shift ${libPaths.length}; ${snippet}`, cliName(), ...libPaths, ...args],
    { ...opts, stdout: 'capture', stderr: opts.stderr ?? 'inherit' },
  )
  return { stdout: stripTrailingNewlines(r.stdout), status: r.status }
}

async function mktemp(): Promise<string> {
  const r = await run('mktemp', [], { stdout: 'capture', stderr: 'ignore' })
  return stripTrailingNewlines(r.stdout)
}

// --- bp_managed_files / cmd_files (scripts/blueprint:1066-1132) ------------
//
// Slice 1 covers only the two paths that need no network: standing in the
// blueprint itself (no .blueprint-source at the CLI's own root — the else
// branch below), and the BLUEPRINT_ROOT override of that same root. The
// third row in the matrix, `files` in a registered derived project (which
// calls read_blueprint_source, which fetches — P1), is slice 2's, once the
// fetch machinery lands.
function managedFilterKeeps(line: string): boolean {
  if (line === '' || line.endsWith('/') || line === '.blueprint-root') return false
  return !TEMPLATE_FILES.includes(line)
}

async function managedDie(reason: string): Promise<never> {
  process.stderr.write(`${C_RED}error:${C_RESET} the blueprint's managed set could not be derived: ${reason}\n`)
  process.stderr.write(`${C_DIM}  Refusing to continue. Carrying on would sync ZERO files while reporting${C_RESET}\n`)
  process.stderr.write(`${C_DIM}  success — a project would read '✓ everything matches' and be wrong.${C_RESET}\n`)
  await bpSyncCleanup()
  throw new ExitStatusError(1)
}

export async function bpManagedFiles(blueprintRoot: string): Promise<string[]> {
  let tarf: string
  let listf: string
  try {
    tarf = await mktemp()
    listf = await mktemp()
  } catch {
    // mktemp itself failed (errexit-on rejection from run()) — die loudly
    // rather than continue with an unusable path, mirroring the shell's
    // `tarf=$(mktemp) || die "..."`.
    return die('cannot create a temp file to list the blueprint archive')
  }
  try {
    // TASK-081 differential round: BUG-077's own scrub. `bp_managed_files`
    // calls `_bp_git`, never plain `git`, so an exported GIT_DIR on the
    // caller's address path cannot redirect this archive read at some other
    // repository — a bare `run('git', …)` here missed that and read the
    // GIT_DIR-named repo's tree instead of `blueprintRoot`'s, caught by the
    // "an exported GIT_DIR" differential drift row.
    await bpGit(['-C', blueprintRoot, 'archive', '--format=tar', 'HEAD'], {
      stdout: { file: tarf },
      stderr: 'ignore',
    })
  } catch {
    // git archive failed (non-zero, caught here instead of at the call site
    // so the scratch files can still be cleaned up before dying loudly).
    await unchecked(() => run('rm', ['-f', tarf, listf]))
    return managedDie(`'git archive HEAD' failed in ${blueprintRoot}`)
  }
  try {
    await run('tar', ['-tf', tarf], { stdout: { file: listf }, stderr: 'ignore' })
  } catch {
    // tar -t failed on the archive just written — clean up the scratch, then
    // die loudly rather than report an empty or partial managed set.
    await unchecked(() => run('rm', ['-f', tarf, listf]))
    return managedDie("the archive could not be listed ('tar -t' failed)")
  }
  const listing = readFileSync(listf, 'utf8')
  await unchecked(() => run('rm', ['-f', tarf, listf]))
  const managed = listing.split('\n').filter(managedFilterKeeps)
  if (managed.length === 0) {
    return managedDie("it ships no files at HEAD: every file is uncommitted, export-ignore'd or project-owned")
  }
  return managed
}

function printFilesReport(managed: readonly string[]): void {
  const lines: string[] = []
  lines.push(`${C_BOLD}Blueprint-managed files (synced by 'blueprint pull'):${C_RESET}`)
  for (const f of managed) lines.push(`  ${f}`)
  lines.push('')
  lines.push(`${C_BOLD}Template files (seeded once at bootstrap, then project-owned):${C_RESET}`)
  for (const f of TEMPLATE_FILES) lines.push(`  ${f}`)
  lines.push('')
  lines.push(`${C_DIM}Derived: what 'git archive HEAD' ships from the blueprint, minus the template files.${C_RESET}`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

export async function cmdFiles(): Promise<void> {
  const root = resolve(cliDir(), '..')
  if (existsSync(join(root, '.blueprint-source'))) {
    // Same as the shell's `cd "$root" || die ...; read_blueprint_source` —
    // .blueprint-source and every relative path read_blueprint_source touches
    // are read relative to that root.
    process.chdir(root)
    process.env.PWD = root
    const src = await readBlueprintSource()
    printFilesReport(src.managed)
    return
  }
  const blueprintRoot = process.env.BLUEPRINT_ROOT ?? root
  const managed = await bpManagedFiles(blueprintRoot)
  printFilesReport(managed)
}

// =============================================================================
// SLICE 2 — the read path. `drift` complete (plan §8 row 2).
// =============================================================================

// --- the git-transport env scrub (scripts/lib/request.sh's
// BP_REQUEST_TRANSPORT_UNSET, kept as DATA per plan §3 P1 "the same unset
// list, as data" — not bridged, because the fetch launch must be ONE external
// process (`env`, execing `sh`, execing the fetch) for `child.pid` to name the
// fetch itself, exactly as bash's `$!` must). Every git call on the ADDRESS
// path is scrubbed, not only the fetch: `drift` runs inside hooks, where an
// exported GIT_DIR would override `-C` (BUG-077).
const GIT_TRANSPORT_UNSET: readonly string[] = [
  '-u',
  'GIT_DIR',
  '-u',
  'GIT_WORK_TREE',
  '-u',
  'GIT_INDEX_FILE',
  '-u',
  'GIT_OBJECT_DIRECTORY',
  '-u',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  '-u',
  'GIT_CONFIG',
  '-u',
  'GIT_CONFIG_COUNT',
]

// --- run state (scripts/blueprint:669-670's BP_SYNC_* globals) --------------
// GLOBALS, never locals — matching the shell comment's own reasoning: the
// cleanup (bpSyncCleanup, below) is bash's EXIT trap, and it must see whatever
// the run built regardless of which function frame built it.
interface SyncGlobals {
  mode: 'address' | 'override' | ''
  scratch: string
  cache: string
  ref: string
  child: number | null
  childExit: Promise<{ readonly status: number }> | null
  go: string
  remote: string
  branch: string
  sha: string
  fetchedAt: string
  blueprintRoot: string
}
const SYNC: SyncGlobals = {
  mode: '',
  scratch: '',
  cache: '',
  ref: '',
  child: null,
  childExit: null,
  go: '',
  remote: '',
  branch: '',
  sha: '',
  fetchedAt: '',
  blueprintRoot: '',
}

// _bp_git — git against the blueprint side. Scrubbed on the address path,
// plain otherwise (the override path must work with no network libraries
// present at all — the recovery path, plan TASK-025 §5).
async function bpGit(args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  if (SYNC.mode === 'address') {
    return run('env', [...GIT_TRANSPORT_UNSET, 'git', ...args], opts)
  }
  return run('git', args, opts)
}

function bpBlueprintPath(f: string): string {
  return `${SYNC.blueprintRoot}/${f}`
}

// Test-only: point bpBlueprintPath (and so bpCliLibs) at a fixture tree
// without going through the P1 fetch or the BLUEPRINT_ROOT override path.
// Never called from main().
export function _setBlueprintRootForTests(root: string): void {
  SYNC.blueprintRoot = root
}

// Test-only: seed SYNC's cleanup-relevant fields directly, so a unit test can
// exercise bpSyncCleanup's ordering (TASK-081 §8 slice 5, replacing
// sync-by-address #20e's structural shell-text read) without a real P1
// fetch. Never called from main().
export function _setSyncStateForTests(fields: Partial<SyncGlobals>): void {
  Object.assign(SYNC, fields)
}

// --- _bp_sync_cleanup (scripts/blueprint:707-722) — BUG-120 -----------------
//
// This is bash's EXIT trap AND its INT/TERM handler in one: `die()` and
// `managedDie()` above call it before every exit (mirroring the trap firing
// on any exit reason), and it is installed as the real terminating handler
// at the entry point below, replacing slice 1's no-op — so a real signal
// during the fetch (or after) cleans up exactly where bash's trap would.
// No-ops completely when nothing was ever fetched (every field starts empty),
// which is what makes calling it unconditionally, from every exit path, safe.
//
// Part 1 (BUG-120) is synchronous with NO `await` between revoking the GO
// token and sending the TERM — a syscall does not fork, so nothing runs in
// that gap, same as bash's `: >` builtin. Part 2 is bash's `wait`. Part 3 is
// the synchronous tail (`update-ref -d`, `rm -rf`).
export async function bpSyncCleanup(): Promise<void> {
  if (SYNC.go) {
    try {
      writeFileSync(SYNC.go, '')
    } catch {
      // Best-effort, matching the shell's `|| true` — a token file that is
      // already gone needs no truncating.
    }
  }
  const pid = SYNC.child
  const exitPromise = SYNC.childExit
  if (pid !== null) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Already exited — nothing to signal, matching `kill ... 2>/dev/null || true`.
    }
  }
  if (exitPromise) {
    await exitPromise
  }
  if (SYNC.ref) {
    await unchecked(() =>
      bpGit(['-c', 'gc.auto=0', `--git-dir=${SYNC.cache}`, 'update-ref', '-d', SYNC.ref], {
        stdout: 'ignore',
        stderr: 'ignore',
      }),
    )
  }
  if (SYNC.scratch) {
    await unchecked(() => run('rm', ['-rf', SYNC.scratch], { stdout: 'ignore', stderr: 'ignore' }))
  }
  SYNC.child = null
  SYNC.childExit = null
  SYNC.ref = ''
  SYNC.scratch = ''
  SYNC.go = ''
}

// --- exit 5, "could not read the blueprint" (scripts/blueprint:775-792) ----
async function bpFetchFail(reason: string): Promise<never> {
  process.stderr.write(`${C_RED}error:${C_RESET} could not read the blueprint at ${SYNC.remote} (${SYNC.branch})\n`)
  process.stderr.write(`  ${reason}\n`)
  process.stderr.write('  Nothing was compared. This is NOT a clean drift report.\n')
  process.stderr.write('  Offline? Compare against a local checkout explicitly:\n')
  process.stderr.write('    BLUEPRINT_ROOT=<path to a blueprint checkout> blueprint drift\n')
  await bpSyncCleanup()
  throw new ExitStatusError(5)
}

async function bpFetchDamaged(): Promise<never> {
  return bpFetchFail(`cache ${SYNC.cache} is damaged — remove it (rm -rf ${SYNC.cache}) and run again`)
}

// --- command -v, natively (plan §2 rule 6) ----------------------------------
function commandExists(cmd: string): boolean {
  const pathEnv = process.env.PATH ?? ''
  for (const dir of pathEnv.split(':')) {
    if (!dir) continue
    const candidate = join(dir, cmd)
    try {
      accessSync(candidate, fsConstants.X_OK)
      return true
    } catch {
      // Not in this PATH entry — keep searching.
    }
  }
  return false
}

// isReadable — `[ -r "$path" ]`, used by cmd_a2bp/cmd_prs's own required-lib
// checks (each dies with the file's exact message when its lib is missing,
// scripts/blueprint:1819-1824 and :2165).
function isReadable(path: string): boolean {
  try {
    accessSync(path, fsConstants.R_OK)
    return true
  } catch {
    // Absent or unreadable — `[ -r "$path" ]` is false for both, no
    // distinction needed by any caller.
    return false
  }
}

function staleTimeoutCmd(): string {
  if (commandExists('timeout')) return 'timeout'
  if (commandExists('gtimeout')) return 'gtimeout'
  return ''
}

// --- bp_config_load bridge (scripts/lib/request-config.sh) -----------------
// The lib prints `BP_CFG_<KEY>=%q<value>` lines for `eval` by a shell caller.
// The snippet evals them itself, inside the bridge's bash, and re-emits the
// four values NUL-separated — so no %q-quoting has to be un-escaped on this
// side of the bridge, and the values that cross it are exactly what the shell
// CLI would have held in BP_CFG_*.
export interface BpConfig {
  readonly version: string
  readonly remote: string
  readonly branch: string
  readonly readBranch: string
}

export async function bpConfigLoad(file: string): Promise<BpConfig | null> {
  const lib = join(libDir(), 'request-config.sh')
  const snippet =
    'out=$(bp_config_load "$2") || exit 1; eval "$out"; ' +
    'printf "%s\\0%s\\0%s\\0%s\\0" "$BP_CFG_VERSION" "$BP_CFG_REMOTE" "$BP_CFG_BRANCH" "$BP_CFG_READ_BRANCH"'
  const r = await unchecked(() =>
    run('bash', ['-c', `. "$1"; ${snippet}`, cliName(), lib, file], { stdout: 'capture', stderr: 'inherit' }),
  )
  if (r.status !== 0) return null
  const parts = r.stdout.split('\0')
  return { version: parts[0] ?? '', remote: parts[1] ?? '', branch: parts[2] ?? '', readBranch: parts[3] ?? '' }
}

// --- P1: _bp_fetch_blueprint (scripts/blueprint:798-913) --------------------
const BP_FETCH_TIMEOUT = process.env.BP_FETCH_TIMEOUT ?? '30'

async function bpFetchBlueprint(): Promise<void> {
  const libdir = libDir()
  const needed = ['request.sh', 'request-config.sh', 'staleness.sh']
  const missing = needed.filter((l) => !existsSync(join(libdir, l)))
  if (missing.length > 0) {
    const missingStr = missing.map((m) => ` scripts/lib/${m}`).join('')
    process.stderr.write(
      `${C_RED}error:${C_RESET} reading the blueprint needs${missingStr}, which this project does not have.\n`,
    )
    process.stderr.write('  Fetch it once from a local blueprint checkout:\n')
    process.stderr.write(`    BLUEPRINT_ROOT=<path to a blueprint checkout> blueprint pull${missingStr}\n`)
    await bpSyncCleanup()
    throw new ExitStatusError(1)
  }

  const cfg = await bpConfigLoad('.blueprint-source')
  if (!cfg) {
    process.stderr.write('  Or compare against a local checkout: export BLUEPRINT_ROOT=<path to a blueprint checkout>\n')
    await bpSyncCleanup()
    throw new ExitStatusError(4)
  }
  SYNC.remote = cfg.remote
  SYNC.branch = cfg.readBranch

  const tcmd = staleTimeoutCmd()
  if (!tcmd) return bpFetchFail("no 'timeout' or 'gtimeout' on PATH, so the fetch could not be bounded")

  const tmpdir = process.env.TMPDIR ?? '/tmp'
  const scratchR = await unchecked(() =>
    run('mktemp', ['-d', `${tmpdir}/blueprint-sync.XXXXXXXX`], { stdout: 'capture', stderr: 'ignore' }),
  )
  if (scratchR.status !== 0) return bpFetchFail(`could not create a scratch directory under ${tmpdir}`)
  SYNC.scratch = stripTrailingNewlines(scratchR.stdout)

  const cacheRoot = join(process.env.XDG_CACHE_HOME ?? join(process.env.HOME ?? '', '.cache'), 'struct2flow')
  const keyR = await unchecked(() =>
    run('env', [...GIT_TRANSPORT_UNSET, 'git', 'hash-object', '--stdin'], {
      stdin: SYNC.remote,
      stdout: 'capture',
      stderr: 'ignore',
    }),
  )
  if (keyR.status !== 0) return bpFetchFail('could not derive a cache key for the remote address')
  SYNC.cache = `${cacheRoot}/blueprint-${stripTrailingNewlines(keyR.stdout)}.git`

  if (!existsSync(SYNC.cache)) {
    const mkdirR = await unchecked(() => run('mkdir', ['-p', cacheRoot], { stdout: 'ignore', stderr: 'ignore' }))
    if (mkdirR.status !== 0) return bpFetchFail(`could not create the cache directory ${cacheRoot}`)
    const tmpR = await unchecked(() =>
      run('mktemp', ['-d', `${cacheRoot}/.bp-cache-init.XXXXXXXX`], { stdout: 'capture', stderr: 'ignore' }),
    )
    if (tmpR.status !== 0) return bpFetchFail(`could not create the cache under ${cacheRoot}`)
    const initTmp = stripTrailingNewlines(tmpR.stdout)
    const initR = await unchecked(() =>
      run('env', [...GIT_TRANSPORT_UNSET, 'git', 'init', '-q', '--bare', initTmp], { stdout: 'ignore', stderr: 'ignore' }),
    )
    if (initR.status !== 0) {
      await unchecked(() => run('rm', ['-rf', initTmp], { stdout: 'ignore', stderr: 'ignore' }))
      return bpFetchFail(`could not initialise the cache under ${cacheRoot}`)
    }
    const mvR = await unchecked(() => run('mv', [initTmp, SYNC.cache], { stdout: 'ignore', stderr: 'ignore' }))
    if (mvR.status !== 0) await unchecked(() => run('rm', ['-rf', initTmp], { stdout: 'ignore', stderr: 'ignore' }))
  }
  // A lost race's temp, this run's or one a killed run left behind.
  await unchecked(() =>
    run('sh', ['-c', 'rm -rf "$1"/.bp-cache-init.*', '_', SYNC.cache], { stdout: 'ignore', stderr: 'ignore' }),
  )
  if (!existsSync(SYNC.cache)) return bpFetchFail(`the cache ${SYNC.cache} could not be created`)

  SYNC.ref = `refs/bp-run/${SYNC.scratch.split('/').pop()}`
  const errFile = `${SYNC.scratch}/fetch.err`
  SYNC.go = `${SYNC.scratch}/go`
  writeFileSync(SYNC.go, 'go\n')

  // ONE EXTERNAL PROCESS (env, execing sh, execing the fetch) — never a
  // function run in the background, whose `$!` would name a forked subshell
  // rather than the fetch (#20b). The gate ("[ -s "$2" ] || exit 1") is
  // BUG-120's fix: TERM has no default disposition to lose until AFTER the
  // first exec, so cleanup revokes the token before it signals.
  const shScript = 'exec 2>"$1"; [ -s "$2" ] || exit 1; shift 2; exec "$@"'
  const child = spawn(
    'env',
    [
      ...GIT_TRANSPORT_UNSET,
      'sh',
      '-c',
      shScript,
      'bp-refresh',
      errFile,
      SYNC.go,
      tcmd,
      BP_FETCH_TIMEOUT,
      'git',
      '-c',
      'gc.auto=0',
      '-c',
      'maintenance.auto=false',
      `--git-dir=${SYNC.cache}`,
      'fetch',
      '-q',
      '--no-tags',
      SYNC.remote,
      `+refs/heads/${SYNC.branch}:${SYNC.ref}`,
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  )
  const pid = child.pid
  if (pid === undefined) return bpFetchFail('could not start the fetch')
  SYNC.child = pid
  // The exit promise is made HERE, at spawn, in the same synchronous step —
  // never a fresh `once(child, 'exit')` later, which would wait forever on a
  // child already reaped (plan §3 P1).
  const exitPromise = new Promise<{ status: number }>((resolveExit) => {
    child.once('exit', (code, signal) => {
      resolveExit({ status: signal !== null ? 128 + signalNumber(signal) : code ?? 1 })
    })
    child.once('error', () => resolveExit({ status: 127 }))
  })
  SYNC.childExit = exitPromise

  // The one interruptible wait (plan §2 rule 7's exception): `freeze` never
  // lets a killed fetch read as an ordinary failure once a signal is recorded.
  const result = await freeze(exitPromise)
  SYNC.child = null

  if (result.status !== 0) {
    let cause: string
    if (result.status === 124) {
      cause = `timed out after ${BP_FETCH_TIMEOUT}s`
    } else {
      const errText = existsSync(errFile) ? readFileSync(errFile, 'utf8') : ''
      if (/couldn't find remote ref/.test(errText)) {
        cause = `no branch '${SYNC.branch}' on that remote`
      } else {
        const errLines = errText.split('\n')
        cause = errLines.find((l) => /^(fatal|error):/.test(l)) ?? errLines[0] ?? ''
      }
      if (!cause) cause = `git fetch exited ${result.status}`
    }
    return bpFetchFail(cause)
  }

  const shaR = await unchecked(() =>
    bpGit(['--git-dir', SYNC.cache, 'rev-parse', '-q', '--verify', `${SYNC.ref}^{commit}`], {
      stdout: 'capture',
      stderr: 'ignore',
    }),
  )
  if (shaR.status !== 0) return bpFetchDamaged()
  SYNC.sha = stripTrailingNewlines(shaR.stdout)
  const dateR = await run('date', ['-u', '+%Y-%m-%dT%H:%M:%SZ'], { stdout: 'capture', stderr: 'ignore' })
  SYNC.fetchedAt = stripTrailingNewlines(dateR.stdout)

  const treeDir = `${SYNC.scratch}/tree`
  const cloneR = await unchecked(() =>
    bpGit(['clone', '-q', '--shared', '--no-checkout', SYNC.cache, treeDir], { stdout: 'ignore', stderr: 'ignore' }),
  )
  if (cloneR.status !== 0) return bpFetchDamaged()
  const checkoutR = await unchecked(() =>
    bpGit(['-c', 'gc.auto=0', '-C', treeDir, 'checkout', '-q', '--detach', SYNC.sha], {
      stdout: 'ignore',
      stderr: 'ignore',
    }),
  )
  if (checkoutR.status !== 0) return bpFetchDamaged()
  SYNC.blueprintRoot = treeDir
}

// --- history (scripts/blueprint:923-955) ------------------------------------
function bpHistoryUnreadable(): Promise<never> {
  if (SYNC.mode === 'address') return bpFetchDamaged()
  return die(`could not read the history of ${SYNC.blueprintRoot}`)
}

async function bpReportHistory(bootstrapSha: string, currentSha: string): Promise<void> {
  const where = SYNC.mode === 'address' ? `${SYNC.remote} ${SYNC.branch}` : "the local checkout's"

  const hasCommit = await unchecked(() =>
    bpGit(['-C', SYNC.blueprintRoot, 'cat-file', '-e', `${bootstrapSha}^{commit}`], {
      stdout: 'ignore',
      stderr: 'ignore',
    }),
  )
  let rc: number
  if (hasCommit.status === 0) {
    const anc = await unchecked(() =>
      bpGit(['-C', SYNC.blueprintRoot, 'merge-base', '--is-ancestor', bootstrapSha, currentSha], {
        stdout: 'ignore',
        stderr: 'ignore',
      }),
    )
    rc = anc.status
  } else {
    rc = 1
  }
  if (rc === 1) {
    process.stdout.write(
      `${C_YELLOW}bootstrap_sha ${bootstrapSha} is not in ${where} history.${C_RESET} It was recorded from a commit that is not on that branch (never pushed, rewritten, or not yet released), so commits since sync are unknown.\n\n`,
    )
    return
  }
  if (rc !== 0) {
    await bpHistoryUnreadable()
    return
  }

  const countR = await unchecked(() =>
    bpGit(['-C', SYNC.blueprintRoot, 'rev-list', '--count', `${bootstrapSha}..${currentSha}`], {
      stdout: 'capture',
      stderr: 'ignore',
    }),
  )
  if (countR.status !== 0) {
    await bpHistoryUnreadable()
    return
  }
  const logR = await unchecked(() =>
    bpGit(['-C', SYNC.blueprintRoot, 'log', '--oneline', `${bootstrapSha}..${currentSha}`], {
      stdout: 'capture',
      stderr: 'ignore',
    }),
  )
  if (logR.status !== 0) {
    await bpHistoryUnreadable()
    return
  }
  process.stdout.write(
    `${C_BLUE}Blueprint has ${stripTrailingNewlines(countR.stdout)} commit(s) since this project was last synced:${C_RESET}\n`,
  )
  for (const line of stripTrailingNewlines(logR.stdout).split('\n')) process.stdout.write(`  ${line}\n`)
  process.stdout.write('\n')
}

// --- marker structure & merge (BUG-034 / BUG-112, scripts/blueprint:162-275) -
const BP_MARKER_LEAD = '^[[:space:]]*(#|//|<!--)[[:space:]]*BLUEPRINT:'
const BP_MARKER_TAIL = '([[:space:]]*$|[[:space:]]*-->|[[:space:]]+[^[:alnum:][:space:]_])'
const BP_MARKER_BEGIN_ERE = `${BP_MARKER_LEAD}BEGIN${BP_MARKER_TAIL}`
const BP_MARKER_END_ERE = `${BP_MARKER_LEAD}END${BP_MARKER_TAIL}`

const MARKER_STRUCTURE_AWK = `
  $0 ~ rb { if (open) { why = "BEGIN at line " NR " inside an open region"; exit } open = 1; n++; next }
  $0 ~ re { if (!open) { why = "END at line " NR " with no open region"; exit } open = 0; next }
  END {
    if (why == "" && open) why = "a region opened and never closed"
    if (why != "") print "bad " why
    else if (n == 0) print "none"
    else print "ok " n
  }
`

export async function bpMarkerStructure(file: string): Promise<string> {
  const r = await unchecked(() =>
    run('awk', ['-v', `rb=${BP_MARKER_BEGIN_ERE}`, '-v', `re=${BP_MARKER_END_ERE}`, MARKER_STRUCTURE_AWK, file], {
      stdout: 'capture',
      stderr: 'ignore',
    }),
  )
  return stripTrailingNewlines(r.stdout)
}

async function grepCount(pattern: string, file: string): Promise<number> {
  const r = await unchecked(() => run('grep', ['-cE', pattern, file], { stdout: 'capture', stderr: 'ignore' }))
  const n = Number.parseInt(stripTrailingNewlines(r.stdout), 10)
  return Number.isNaN(n) ? 0 : n
}

const MARKER_MERGE_AWK = `
  function read_bp_inside_regions(   line, region_idx, capture) {
    region_idx = 0
    capture = 0
    while ((getline line < bp_file) > 0) {
      if (line ~ rb) {
        capture = 1
        region_idx++
        bp_inside[region_idx] = ""
        continue
      }
      if (line ~ re) {
        capture = 0
        continue
      }
      if (capture) {
        bp_inside[region_idx] = bp_inside[region_idx] line "\\n"
      }
    }
    close(bp_file)
    bp_n_regions = region_idx
  }
  BEGIN { read_bp_inside_regions() ; cur_region = 0 ; in_inside = 0 }
  $0 ~ rb {
    print
    cur_region++
    printf "%s", bp_inside[cur_region]
    in_inside = 1
    next
  }
  $0 ~ re {
    print
    in_inside = 0
    next
  }
  in_inside { next }
  { print }
`

export async function markerAwareMerge(bpFile: string, projFile: string, outFile: string): Promise<boolean> {
  const bpBegin = await grepCount(BP_MARKER_BEGIN_ERE, bpFile)
  const bpEnd = await grepCount(BP_MARKER_END_ERE, bpFile)
  const projBegin = await grepCount(BP_MARKER_BEGIN_ERE, projFile)
  const projEnd = await grepCount(BP_MARKER_END_ERE, projFile)
  if (bpBegin !== bpEnd || projBegin !== projEnd || bpBegin !== projBegin) return false

  // Bare, matching the shell: the awk call is `marker_aware_merge`'s own LAST
  // statement, so ITS exit status is the function's return value — the
  // caller's `&& marker_aware_merge …` reads a failing awk as the function
  // itself failing (falls back to backup-copy) exactly like a real
  // structural mismatch. Returning `true` unconditionally here (as this once
  // did) reported a successful merge from a BROKEN one: the caller took the
  // 'merge' branch over whatever partial or empty bytes a failed awk left in
  // `outFile`, never falling back — reproduced by
  // blueprint-port-f1-pull-awk before this fix, fixed by reading the status.
  const r = await run(
    'awk',
    ['-v', `bp_file=${bpFile}`, '-v', `rb=${BP_MARKER_BEGIN_ERE}`, '-v', `re=${BP_MARKER_END_ERE}`, MARKER_MERGE_AWK, projFile],
    { stdout: { file: outFile }, stderr: 'ignore' },
  )
  return r.status === 0
}

// --- placeholder substitution bridge (scripts/lib/placeholders.sh) ---------
async function bpShouldSubstitute(f: string): Promise<boolean> {
  const lib = join(libDir(), 'placeholders.sh')
  // Neither shell call site (`_should_substitute` at scripts/blueprint:314,
  // :1947) redirects this function's stderr — a MISSING placeholders.sh
  // leaves `bp_should_substitute` undefined, and bash's own "command not
  // found" line for it reaches the CLI's real stderr, once per file
  // processed. `stderr: 'ignore'` (this call's own earlier choice) swallowed
  // that diagnostic entirely rather than merely losing its exact wording.
  // Silence was the wrong choice: AGENTS.md's "no silent swallowing" rule,
  // and blueprint-port's finding-3 row. The leading token now matches too
  // (argv0 is `cliName()`, not `_` — see `bashLib`'s header comment); only
  // the LINE NUMBER can still differ, since this is a different bash process
  // running a one-line inline `-c` script, never the CLI's own interpreter
  // at its own line — the differential's shared `stripLinePrefix` already
  // normalises exactly that (nothing else).
  //
  // The source itself is GUARDED (`[ -r "$1" ]`), exactly as the CLI's own
  // top-level source is (scripts/blueprint:55-58) — `bashLib`'s own
  // unconditional `. "$1"; …` preamble would have bash print ITS OWN
  // "No such file or directory" for the missing lib first, a line the real
  // CLI never emits because it checks readability before ever sourcing.
  const r = await unchecked(() =>
    run('bash', ['-c', 'if [ -r "$1" ]; then . "$1"; fi; bp_should_substitute "$2"', cliName(), lib, f], {
      stdout: 'ignore',
      stderr: 'inherit',
    }),
  )
  return r.status === 0
}

async function bpSubstituteStream(srcFile: string, projName: string, outFile: string): Promise<boolean> {
  const lib = join(libDir(), 'placeholders.sh')
  const r = await unchecked(() =>
    run('bash', ['-c', '. "$1"; bp_substitute_stream "$2" "$3"', cliName(), lib, srcFile, projName], {
      stdout: { file: outFile },
      stderr: 'inherit',
    }),
  )
  return r.status === 0
}

function projectNameFromLogicalPwd(): string {
  const pwd = logicalPwd()
  const idx = pwd.lastIndexOf('/')
  return idx === -1 ? pwd : pwd.slice(idx + 1)
}

// substituted_blueprint_copy (scripts/blueprint:311-330) — the blueprint's
// copy of `f`, placeholder-substituted when `f` is not itself exempt. Callers
// remove the result when it differs from the plain blueprint path (a mktemp).
async function substitutedBlueprintCopy(f: string): Promise<string> {
  const bp = bpBlueprintPath(f)
  if (!(await bpShouldSubstitute(f))) return bp
  const tmp = await mktemp()
  await bpSubstituteStream(bp, projectNameFromLogicalPwd(), tmp)
  return tmp
}

// --- P3, BUG-113: bp_prospective_pull (scripts/blueprint:362-409) ----------
export type ProspectiveMode = 'new' | 'copy' | 'merge' | 'backup-copy' | 'refuse'
export interface Prospective {
  readonly mode: ProspectiveMode
  readonly why: string
  readonly detail: string
  // The shell's `bp_prospective_pull`/`bp_prospective_for` is a bash FUNCTION
  // whose own return status is its LAST command's exit status — for
  // 'refuse' that is an explicit `return 1`, for 'merge' it is the always-
  // succeeding `BP_PP_MODE=merge` assignment (0), and for the 'copy' and
  // 'backup-copy' branches it is THAT `cp`'s own exit status. The 'new'
  // branch is the odd one out: it has an explicit `return 0` after `cp`, so
  // with errexit disabled a failed copy still returns success.
  // Every one of the three call sites (drift :1394, selection :1572, the
  // same-check at :1639) decides on THIS status, never on BP_PP_MODE alone —
  // `if ! bp_prospective_for …`. `ok` is that status, exposed as a field
  // because the type has no bash-style "last command" to fall back on.
  // Missing this field entirely (an earlier port revision) made a cp failure
  // invisible: mode stayed whatever branch was taken, and every caller read
  // `mode === 'refuse'` — silently treating a broken write as a success.
  // Reproduced by blueprint-port-f1-drift-cp before this fix.
  readonly ok: boolean
}

export async function bpProspectivePull(bp: string, proj: string, out: string): Promise<Prospective> {
  const bs = await bpMarkerStructure(bp)
  const projExists = existsSync(proj)
  const ps = projExists ? await bpMarkerStructure(proj) : ''

  if (bs.startsWith('bad')) {
    return { mode: 'refuse', why: `the blueprint copy's markers are invalid — ${bs.slice(4)}`, detail: '', ok: false }
  }
  if (ps.startsWith('bad')) {
    return {
      mode: 'refuse',
      why: `this project's markers are invalid — ${ps.slice(4)} (fix them by hand, then pull again)`,
      detail: '',
      ok: false,
    }
  }
  if (!projExists) {
    await run('cp', [bp, out])
    // The shell explicitly `return 0`s after this cp. Under unchecked(), a
    // failed cp therefore leaves an empty output but the function succeeds;
    // outside unchecked(), run() still throws before reaching this return.
    return { mode: 'new', why: '', detail: '', ok: true }
  }
  if (bs === 'none' && ps === 'none') {
    const r = await run('cp', [bp, out])
    return { mode: 'copy', why: '', detail: '', ok: r.status === 0 }
  }
  if (bs === 'none' && ps.startsWith('ok')) {
    return {
      mode: 'refuse',
      why: 'this project has markers but the blueprint copy has none — a pull would strip them',
      detail: '',
      ok: false,
    }
  }
  if (bs.startsWith('ok') && ps === 'none') {
    const r = await run('cp', [bp, out])
    return { mode: 'backup-copy', why: "blueprint uses markers, project doesn't", detail: '', ok: r.status === 0 }
  }
  // Only ok:ok combinations remain — bad and none have both been handled above.
  if (bs === ps && (await markerAwareMerge(bp, proj, out))) {
    return { mode: 'merge', why: '', detail: '', ok: true }
  }
  const r = await run('cp', [bp, out])
  return {
    mode: 'backup-copy',
    why: `marker structure mismatch (${bs.slice(3)} region(s) upstream, ${ps.slice(3)} here)`,
    detail: '',
    ok: r.status === 0,
  }
}

// --- P4, TASK-042: the settings merge (scripts/blueprint:411-581) ----------
const BP_SETTINGS_LAYER = '.claude/settings.project.json'
const BP_SETTINGS_SHAPE = `type == "object"
  and ((keys - ["$schema", "permissions"]) == [])
  and ((.permissions // {}) | type == "object"
       and ((keys - ["allow", "ask", "deny", "additionalDirectories"]) == [])
       and all(.[]; type == "array" and all(.[]; type == "string")))`
const BP_SETTINGS_MERGE = `def uniq: reduce .[] as $x ([]; if any(.[]; . == $x) then . else . + [$x] end);
  (.[0].permissions // {}) as $b | (.[1].permissions // {}) as $p
  | (($b.ask // []) + ($b.deny // [])) as $tight
  | .[0] | .permissions = reduce ("allow", "ask", "deny", "additionalDirectories") as $k ($b;
      if ($b | has($k)) or ($p | has($k)) then
        .[$k] = (($b[$k] // [])
                 + (($p[$k] // []) | if $k == "allow" then map(select(. as $e | any($tight[]; . == $e) | not)) else . end)
                 | uniq)
      else . end)`
const BP_SETTINGS_KEYS = '["allow", "ask", "deny", "additionalDirectories"]'
const BP_SETTINGS_EXTRA = `${BP_SETTINGS_KEYS} as $keys
  | (.[0].permissions // {}) as $b | (.[1].permissions // {}) as $p
  | [ $keys[] | . as $k
      | {key: $k, value: (if ($p[$k] | type) == "array"
                          then ($p[$k] | map(select(type == "string"))) - ($b[$k] // [])
                          else [] end)}
      | select(.value != []) ]
  | if . == [] then null else {permissions: from_entries} end`
const BP_SETTINGS_UNSUPPORTED = `${BP_SETTINGS_KEYS} as $keys
  | (.[0].permissions // {}) as $b | (.[1].permissions // {}) as $p
  | [ ($p | keys_unsorted[] | . as $k
       | select(($keys | index($k)) == null) | select(($b | has($k)) | not) | $k),
      ($keys[] | . as $k | select($p | has($k))
       | select(if ($p[$k] | type) != "array" then true
                else ($p[$k] | any(.[]; type != "string")) end)) ]
  | unique | map("permissions." + .) | join(", ")`

async function bpOneObject(file: string): Promise<boolean> {
  const r = await unchecked(() =>
    run('jq', ['-e', '-s', 'length == 1 and (.[0] | type == "object")', file], { stdout: 'ignore', stderr: 'ignore' }),
  )
  return r.status === 0
}

interface SettingsResult {
  readonly ok: boolean
  readonly why: string
  readonly detail: string
}

async function bpSettingsLayer(bp: string, out: string): Promise<SettingsResult> {
  if (!commandExists('jq')) {
    return {
      ok: false,
      why: "jq is not on PATH, so pull cannot keep this project's permission rules (bash scripts/install-toolchain.sh)",
      detail: '',
    }
  }
  if (!(await bpOneObject(bp))) {
    return {
      ok: false,
      why: "the blueprint's .claude/settings.json is not a single JSON object, so there is nothing safe to land",
      detail: '',
    }
  }
  if (existsSync(BP_SETTINGS_LAYER)) {
    if (!(await bpOneObject(BP_SETTINGS_LAYER))) {
      return {
        ok: false,
        why: `${BP_SETTINGS_LAYER} must be a single JSON object — not several, and not an array, a number or null`,
        detail: '',
      }
    }
    const shapeOk = await unchecked(() =>
      run('jq', ['-e', '-s', `.[0] | (${BP_SETTINGS_SHAPE})`, BP_SETTINGS_LAYER], { stdout: 'ignore', stderr: 'ignore' }),
    )
    if (shapeOk.status !== 0) {
      return {
        ok: false,
        why: `${BP_SETTINGS_LAYER} must be a JSON object holding only permissions.allow, ask, deny and additionalDirectories, each a list of strings`,
        detail: '',
      }
    }
    const merged = await unchecked(() =>
      run('jq', ['-s', BP_SETTINGS_MERGE, bp, BP_SETTINGS_LAYER], { stdout: { file: out }, stderr: 'ignore' }),
    )
    if (merged.status !== 0) {
      return { ok: false, why: `${BP_SETTINGS_LAYER} could not be merged into the blueprint's settings.json`, detail: '' }
    }
    return { ok: true, why: '', detail: '' }
  }
  if (existsSync('.claude/settings.json')) {
    if (!(await bpOneObject('.claude/settings.json'))) {
      return {
        ok: false,
        why: "this project's .claude/settings.json is not a single JSON object, so its own rules cannot be told from the blueprint's",
        detail: '',
      }
    }
    const proposalR = await unchecked(() =>
      run('jq', ['-s', BP_SETTINGS_EXTRA, bp, '.claude/settings.json'], { stdout: 'capture', stderr: 'ignore' }),
    )
    if (proposalR.status !== 0) {
      return {
        ok: false,
        why: "this project's .claude/settings.json could not be read, so its own rules cannot be told from the blueprint's",
        detail: '',
      }
    }
    const proposal = stripTrailingNewlines(proposalR.stdout)
    const unsupportedR = await unchecked(() =>
      run('jq', ['-r', '-s', BP_SETTINGS_UNSUPPORTED, bp, '.claude/settings.json'], { stdout: 'capture', stderr: 'ignore' }),
    )
    const unsupported = unsupportedR.status === 0 ? stripTrailingNewlines(unsupportedR.stdout) : ''
    if (proposal !== 'null' || unsupported !== '') {
      let detail = ''
      if (proposal !== 'null') {
        const indented = proposal
          .split('\n')
          .map((l) => `        ${l}`)
          .join('\n')
        detail = `      Save the permission rules that are this project's own as ${BP_SETTINGS_LAYER},
      then pull again. Delete any the blueprint removed on purpose; if none are
      yours, write {}. A project file carries permission lists and nothing else:
${indented}`
      }
      if (unsupported !== '') {
        detail = `${detail ? `${detail}\n` : ''}      A project file CANNOT carry these, so a pull replaces them with the
      blueprint's: ${unsupported}
      Keep them in .claude/settings.local.json (host-only), or propose them to
      the blueprint; then remove them from settings.json and pull again.`
      }
      return {
        ok: false,
        why: `this project's settings.json carries permission rules of its own, and there is no ${BP_SETTINGS_LAYER} to keep them (run 'blueprint pull .claude/settings.json' to see them)`,
        detail,
      }
    }
  }
  await run('cp', [bp, out])
  return { ok: true, why: '', detail: '' }
}

// bp_prospective_for (scripts/blueprint:583-607) — the ONE answer every
// caller reads (drift here; pull's selection/preview/write in slice 3).
export async function bpProspectiveFor(f: string, out: string): Promise<Prospective> {
  const bp = bpBlueprintPath(f)
  const cmp = await substitutedBlueprintCopy(f)
  try {
    if (f === '.claude/settings.json') {
      const merged = await mktemp()
      try {
        const layer = await bpSettingsLayer(cmp, merged)
        if (layer.ok) return await bpProspectivePull(merged, f, out)
        return { mode: 'refuse', why: layer.why, detail: layer.detail, ok: false }
      } finally {
        await unchecked(() => run('rm', ['-f', merged], { stdout: 'ignore', stderr: 'ignore' }))
      }
    }
    return await bpProspectivePull(cmp, f, out)
  } finally {
    if (cmp !== bp) await unchecked(() => run('rm', ['-f', cmp], { stdout: 'ignore', stderr: 'ignore' }))
  }
}

// --- staleness report (scripts/lib/staleness.sh bridge) ---------------------
function readLineFromStdin(): string {
  const buf = Buffer.alloc(1)
  let line = ''
  for (;;) {
    let n: number
    try {
      n = readSync(0, buf, 0, 1, null)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EAGAIN') continue
      break
    }
    if (n === 0) break
    const ch = buf.toString('utf8')
    if (ch === '\n') break
    line += ch
  }
  return line
}

async function reportStaleness(root: string, branchOverride?: string): Promise<void> {
  const lib = join(libDir(), 'staleness.sh')
  if (!existsSync(lib)) {
    process.stdout.write(`  ${C_DIM}remote staleness: unknown (scripts/lib/staleness.sh missing)${C_RESET}\n`)
    return
  }
  let branch = branchOverride !== undefined ? branchOverride : process.env.BLUEPRINT_BRANCH ?? ''
  if (!branch) {
    const r = await unchecked(() =>
      run('git', ['-C', root, 'symbolic-ref', '--quiet', '--short', 'HEAD'], { stdout: 'capture', stderr: 'ignore' }),
    )
    branch = r.status === 0 ? stripTrailingNewlines(r.stdout) : 'main'
  }

  const assessR = await unchecked(() =>
    run('bash', ['-c', '. "$1"; bp_staleness_assess "$2" "$3"', cliName(), lib, root, branch], {
      stdout: 'capture',
      stderr: 'ignore',
    }),
  )
  const field = (k: string): string => {
    for (const line of assessR.stdout.split('\n')) {
      if (line.startsWith(`${k}=`)) return line.slice(k.length + 1)
    }
    return ''
  }
  const status = field('status')
  const blocker = field('blocker')
  const offer = field('offer')
  const remote = field('remote')
  const count = field('count')
  const verified = field('verified')

  if (status === 'current') {
    process.stdout.write(`  ${C_GREEN}✓ local checkout is level with ${remote}/${branch}${C_RESET}\n`)
    return
  }
  if (status === 'unknown') {
    process.stdout.write(`  ${C_DIM}? staleness unknown (${blocker}) — cannot confirm the checkout is current${C_RESET}\n`)
    return
  }
  if (status === 'ahead') {
    process.stdout.write(`  ${C_DIM}local checkout is ahead of ${remote}/${branch} (unpushed commits)${C_RESET}\n`)
    return
  }
  if (status === 'diverged') {
    process.stdout.write(`  ${C_YELLOW}⚠ local checkout has DIVERGED from ${remote}/${branch}${C_RESET}\n`)
    process.stdout.write(`  ${C_DIM}    resolve by hand — a merge or rebase is not a prompt${C_RESET}\n`)
    return
  }

  // status === behind
  if (verified === 'yes' && count) {
    process.stdout.write(`  ${C_YELLOW}⚠ local checkout is ${count} commit(s) behind ${remote}/${branch}${C_RESET}\n`)
  } else {
    process.stdout.write(`  ${C_YELLOW}⚠ local checkout is behind ${remote}/${branch}${C_RESET}\n`)
  }

  if (offer !== 'ff') {
    const reasons: Record<string, string> = {
      dirty: 'not offering: uncommitted or untracked changes there',
      detached: 'not offering: that checkout is on a detached HEAD',
      'wrong-branch': `not offering: that checkout is not on ${branch}`,
    }
    process.stdout.write(`  ${C_DIM}    ${reasons[blocker] ?? `not offering (${blocker})`}${C_RESET}\n`)
    return
  }

  if (process.env.BP_NO_PROMPT === '1' || !process.stdin.isTTY) {
    process.stdout.write(`  ${C_DIM}    fast-forward it with: git -C ${root} merge --ff-only${C_RESET}\n`)
    return
  }

  process.stdout.write('      fast-forward it now? [y/N] ')
  const reply = readLineFromStdin()
  if (reply === 'y' || reply === 'Y') {
    // The shell's own call site (staleness.sh:182, `git -C "$root" merge
    // --ff-only FETCH_HEAD`) redirects NEITHER stream — git's own progress
    // ("Updating X..Y", "Fast-forward", the file-stat line) reaches the
    // operator's real terminal. 'ignore' here swallowed it (TASK-081,
    // differential row "y fast-forwards the local checkout").
    const ffR = await unchecked(() =>
      run('bash', ['-c', '. "$1"; bp_staleness_fast_forward "$2" "$3" "$4"', cliName(), lib, root, branch, remote], {
        stdout: 'inherit',
        stderr: 'inherit',
      }),
    )
    if (ffR.status === 0) {
      const shaR = await run('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { stdout: 'capture', stderr: 'ignore' })
      process.stdout.write(`  ${C_GREEN}✓ fast-forwarded to ${stripTrailingNewlines(shaR.stdout)}${C_RESET}\n`)
    } else {
      process.stdout.write(`  ${C_YELLOW}fast-forward refused — the checkout is untouched${C_RESET}\n`)
    }
  } else {
    process.stdout.write(`  ${C_DIM}    left alone${C_RESET}\n`)
  }
}

// --- _bp_project_root / _bp_is_blueprint_itself (state-dir.sh bridge) ------
async function bpProjectRoot(): Promise<string> {
  const lib = join(libDir(), 'state-dir.sh')
  if (existsSync(lib)) {
    const r = await unchecked(() =>
      run('bash', ['-c', '. "$1"; BP_CODE_ROOT="$2"; bp_state_root 2>/dev/null', cliName(), lib, logicalPwd()], {
        stdout: 'capture',
        stderr: 'ignore',
      }),
    )
    const root = stripTrailingNewlines(r.stdout)
    if (r.status === 0 && root) {
      const realR = await unchecked(() =>
        run('sh', ['-c', 'cd "$1" 2>/dev/null && pwd -P', '_', root], { stdout: 'capture', stderr: 'ignore' }),
      )
      if (realR.status === 0) return stripTrailingNewlines(realR.stdout)
    }
  }
  const pwdR = await run('sh', ['-c', 'pwd -P'], { stdout: 'capture', stderr: 'ignore' })
  return stripTrailingNewlines(pwdR.stdout)
}

async function bpIsBlueprintItself(): Promise<boolean> {
  const here = await bpProjectRoot()
  return here !== '' && existsSync(join(here, '.blueprint-root'))
}

// --- gate arming (scripts/lib/gate.mts) ---------------------------------------
// stdout/stderr INHERITED, not captured — gate.mts's own echo lines are the
// bytes this process emits, so there is no re-formatting seam for them to
// drift from the shell CLI's. TASK-088: node runs gate.mts directly; the
// sourced shell adapter and its BP_CODE_ROOT bridge are gone (gate.mts reads
// no BP_CODE_ROOT), and the path comes from libDir(), which is already the
// code root's scripts/lib.
async function armGate(root: string): Promise<void> {
  const lib = join(libDir(), 'gate.mts')
  if (!existsSync(lib)) {
    process.stdout.write(`  ${C_RED}⚠ gate: scripts/lib/gate.mts is missing — the pre-push gate is NOT armed${C_RESET}\n`)
    return die(
      'refusing to report drift without scripts/lib/gate.mts. Fetch it once with: BLUEPRINT_ROOT=<checkout> node <checkout>/scripts/blueprint.mts pull scripts/lib/gate.mts',
    )
  }
  // The arm call stays CHECKED (BUG-152): arm-gate itself never fails
  // (BUG-004), so a non-zero here means node or gate.mts broke and drift must
  // refuse loudly — never carry on and report a gate it did not arm. Only the
  // keepalive is best-effort.
  await run(process.execPath, [lib, 'arm-gate', root], { stdout: 'inherit', stderr: 'inherit' })
  await unchecked(() =>
    run(process.execPath, [lib, 'arm-push-keepalive', root], { stdout: 'inherit', stderr: 'inherit' }),
  )
}

// --- read_blueprint_source (scripts/blueprint:978-1034) --------------------
const UNREGISTERED_MARKERS: readonly string[] = [
  'AGENT_SIGNAL.md',
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'STACK_DEFAULTS.md',
  'scripts/install-toolchain.sh',
  '.githooks/pre-push',
  'scripts/blueprint.mts',
  'scripts/agent-activity.sh',
  'docs/DoD.md',
]

// `_bp_config_value` (scripts/blueprint:1036-1039) — the first `KEY = value`
// line, trimmed. Pure line parsing, no arrays: reimplemented natively per
// plan §2 rule 3 rather than bridged.
function configValue(file: string, key: string): string {
  if (!existsSync(file)) return ''
  const re = new RegExp(`^[ \\t]*${key}[ \\t]*=`)
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (re.test(line)) return line.slice(line.indexOf('=') + 1).trim()
  }
  return ''
}

export interface BlueprintSource {
  readonly managed: string[]
  readonly bootstrapSha: string
  readonly bootstrapDate: string
}

export async function readBlueprintSource(): Promise<BlueprintSource> {
  if (!existsSync('.blueprint-source')) {
    const markers = UNREGISTERED_MARKERS.filter((m) => existsSync(m)).length
    if (markers >= 3) {
      process.stderr.write(`${C_YELLOW}This looks like a struct2flow project (${markers} marker files), but it was${C_RESET}\n`)
      process.stderr.write(`${C_YELLOW}NEVER REGISTERED with blueprint sync — there is no .blueprint-source.${C_RESET}\n`)
      process.stderr.write('\n')
      process.stderr.write("So 'drift' and 'pull' have never done anything here. Adopt it by creating\n")
      process.stderr.write(`${logicalPwd()}/.blueprint-source with:\n`)
      process.stderr.write('\n')
      process.stderr.write('  config_version   = 2\n')
      process.stderr.write('  blueprint_remote = git@github.com:<owner>/<blueprint>.git\n')
      process.stderr.write('  blueprint_branch = main\n')
      process.stderr.write('  bootstrap_sha    = <blueprint commit you are adopting against>\n')
      const dateR = await run('date', ['+%Y-%m-%d'], { stdout: 'capture', stderr: 'ignore' })
      process.stderr.write(`  bootstrap_date   = ${stripTrailingNewlines(dateR.stdout)}\n`)
      return die('unregistered struct2flow project — see the lines above')
    }
    return die(`no .blueprint-source in ${logicalPwd()} — not a struct2flow project (run from project root)`)
  }

  const bootstrapSha = configValue('.blueprint-source', 'bootstrap_sha')
  const bootstrapDate = configValue('.blueprint-source', 'bootstrap_date')

  if (/^[ \t]*blueprint_source[ \t]*=/m.test(readFileSync('.blueprint-source', 'utf8'))) {
    process.stderr.write(
      `${C_YELLOW}warning:${C_RESET} .blueprint-source still has blueprint_source, which is no longer read. The blueprint is read from blueprint_remote (TASK-025). Delete the blueprint_source line.\n`,
    )
  }

  const rootOverride = process.env.BLUEPRINT_ROOT
  if (rootOverride) {
    if (!existsSync(rootOverride) || !statSync(rootOverride).isDirectory()) {
      return die(`BLUEPRINT_ROOT is '${rootOverride}', which is not a directory. Unset it to read the blueprint from blueprint_remote.`)
    }
    SYNC.mode = 'override'
    SYNC.blueprintRoot = rootOverride
  } else {
    SYNC.mode = 'address'
    await bpFetchBlueprint()
  }

  const managed = await bpManagedFiles(SYNC.blueprintRoot)
  return { managed, bootstrapSha, bootstrapDate }
}

// --- cmd_drift (scripts/blueprint:1302-1437) --------------------------------
export async function cmdDrift(): Promise<number> {
  const projRoot = await bpProjectRoot()
  await armGate(projRoot)

  if (await bpIsBlueprintItself()) {
    process.stdout.write(`${C_BOLD}Blueprint drift check${C_RESET}\n`)
    process.stdout.write(`  project:    ${logicalPwd()}\n`)
    process.stdout.write(`  ${C_GREEN}✓ This IS the blueprint — it is the source of truth, so there is${C_RESET}\n`)
    process.stdout.write(`  ${C_GREEN}  nothing to sync against and no drift to report.${C_RESET}\n`)
    await reportStaleness(projRoot, '')
    process.stdout.write('\n')
    process.stdout.write(`${C_DIM}Derived projects run this to compare themselves against here.${C_RESET}\n`)
    process.stdout.write(`${C_DIM}To see what they would sync: blueprint files${C_RESET}\n`)
    await bpSyncCleanup()
    return 0
  }

  const src = await readBlueprintSource()

  process.stdout.write(`${C_BOLD}Blueprint drift check${C_RESET}\n`)
  process.stdout.write(`  project:    ${logicalPwd()}\n`)

  let currentSha: string
  if (SYNC.mode === 'address') {
    currentSha = SYNC.sha
    process.stdout.write(`  blueprint:  ${SYNC.remote}  (${SYNC.branch})\n`)
    process.stdout.write(`  fetched:    ${currentSha}  at ${SYNC.fetchedAt}\n`)
    process.stdout.write(`  bootstrap:  ${src.bootstrapSha} (${src.bootstrapDate})\n`)
  } else {
    const shaR = await unchecked(() =>
      run('git', ['-C', SYNC.blueprintRoot, 'rev-parse', 'HEAD'], { stdout: 'capture', stderr: 'ignore' }),
    )
    currentSha = shaR.status === 0 ? stripTrailingNewlines(shaR.stdout) : 'no-sha'
    process.stdout.write(
      `  blueprint:  LOCAL CHECKOUT ${SYNC.blueprintRoot} (BLUEPRINT_ROOT override, not the published address)\n`,
    )
    process.stdout.write(`  bootstrap:  ${src.bootstrapSha} (${src.bootstrapDate})\n`)
    process.stdout.write(`  blueprint HEAD: ${currentSha}\n`)
    await reportStaleness(SYNC.blueprintRoot)
  }
  process.stdout.write('\n')

  if (src.bootstrapSha && src.bootstrapSha !== 'no-sha' && currentSha !== 'no-sha' && currentSha !== src.bootstrapSha) {
    await bpReportHistory(src.bootstrapSha, currentSha)
  }

  const drifted: string[] = []
  const missingBlueprint: string[] = []
  const missingProject: string[] = []
  const refused: string[] = []

  for (const f of src.managed) {
    const bp = bpBlueprintPath(f)
    if (!existsSync(bp)) {
      missingBlueprint.push(f)
      continue
    }
    if (!existsSync(f)) {
      missingProject.push(f)
      continue
    }
    const driftOut = await mktemp()
    try {
      // Plan §2 rule 4 — the shell calls bp_prospective_for only as an `if`
      // condition, so an inner cp/jq/diff/merge failure inside it must not
      // abort drift; it must continue and the function returns its own
      // last-command status, as bash's disabled errexit does here.
      const prospective = await unchecked(() => bpProspectiveFor(f, driftOut))
      // `if ! bp_prospective_for …` (:1394) — the call's own STATUS, not
      // `BP_PP_MODE` alone: a cp/merge failure inside a non-refuse branch
      // still reads as `! bp_prospective_for` in the shell, so a cp failure
      // here is REFUSED too, carrying whatever BP_PP_WHY that branch left
      // (empty, for the writing branches) rather than being silently read
      // as a clean comparison.
      if (!prospective.ok) {
        refused.push(`${f} — ${prospective.why}`)
      } else {
        const diffR = await unchecked(() => run('diff', ['-q', driftOut, f], { stdout: 'ignore', stderr: 'ignore' }))
        if (diffR.status !== 0) drifted.push(f)
      }
    } finally {
      await unchecked(() => run('rm', ['-f', driftOut], { stdout: 'ignore', stderr: 'ignore' }))
    }
  }

  if (drifted.length === 0 && missingBlueprint.length === 0 && missingProject.length === 0 && refused.length === 0) {
    process.stdout.write(`${C_GREEN}✓ All blueprint-managed files match the blueprint HEAD.${C_RESET}\n`)
    await bpSyncCleanup()
    return 0
  }

  if (refused.length > 0) {
    process.stdout.write(`${C_RED}Cannot sync — pull refuses these until they are fixed: ${refused.length}${C_RESET}\n`)
    for (const f of refused) process.stdout.write(`  ${C_RED}✗${C_RESET} ${f}\n`)
    process.stdout.write('\n')
  }
  if (drifted.length > 0) {
    process.stdout.write(`${C_YELLOW}Drifted (project ≠ blueprint HEAD): ${drifted.length}${C_RESET}\n`)
    for (const f of drifted) process.stdout.write(`  ${C_YELLOW}~${C_RESET} ${f}\n`)
    process.stdout.write('\n')
  }
  if (missingProject.length > 0) {
    process.stdout.write(`${C_BLUE}New in blueprint (not in this project): ${missingProject.length}${C_RESET}\n`)
    for (const f of missingProject) process.stdout.write(`  ${C_BLUE}+${C_RESET} ${f}\n`)
    process.stdout.write('\n')
  }
  if (missingBlueprint.length > 0) {
    process.stdout.write(`${C_RED}Listed managed but missing in blueprint: ${missingBlueprint.length}${C_RESET}\n`)
    for (const f of missingBlueprint) process.stdout.write(`  ${C_RED}!${C_RESET} ${f}\n`)
    process.stdout.write(`${C_DIM}  (committed at the blueprint's HEAD but absent from its working tree)${C_RESET}\n`)
    process.stdout.write('\n')
  }

  process.stdout.write('Next:\n')
  process.stdout.write(`  ${C_DIM}blueprint pull${C_RESET}             # pull all drifted + new forward\n`)
  process.stdout.write(`  ${C_DIM}blueprint pull <file>${C_RESET}      # pull one file\n`)
  process.stdout.write(`  ${C_DIM}blueprint pull <file> --yes${C_RESET}  # skip the per-file prompt\n`)
  await bpSyncCleanup()
  return 0
}

// =============================================================================
// SLICE 3 — `pull` complete (plan §8 row 3): selection, the closure with
// shim-follow (§7), prompts, pullFile, the P2 shielded write, bootstrap_sha,
// retirement.
// =============================================================================

// --- P2, `_bp_shielded_write` (scripts/blueprint:746-760) -------------------
//
// bytes, exec bit and rename finish together. Each STEP below is its own
// spawned `sh -c 'trap "" INT TERM; exec "$@"' bp-shield <cmd> …` — a group
// signal, as a terminal's Ctrl-C sends, cannot kill it mid-step — wrapped in
// `shield()` so a signal recorded while any step runs only waits, and takes
// the terminating path the instant the write finishes (plan §3 P2).
export async function shieldedWrite(src: string, dest: string, modeFrom?: string): Promise<boolean> {
  return shield(async () => {
    const tmp = `${dest}.bp-new.${process.pid}`
    const step = (cmd: string, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> =>
      unchecked(() => run('sh', ['-c', 'trap "" INT TERM; exec "$@"', 'bp-shield', cmd, ...args], opts))

    const rmR = await step('rm', ['-f', tmp], { stdout: 'ignore', stderr: 'ignore' })
    let ok = rmR.status === 0
    if (existsSync(dest)) {
      const cpR = await step('cp', ['-p', dest, tmp], { stdout: 'ignore', stderr: 'ignore' })
      ok = cpR.status === 0
    }
    if (ok) {
      const catR = await step('cat', [src], { stdout: { file: tmp }, stderr: 'ignore' })
      ok = catR.status === 0
    }
    if (ok && modeFrom !== undefined && modeFrom !== '') {
      // _bp_sync_exec_bit, inline (plan §2 rule 3 — a `test` is JS; only the
      // chmod itself is an external, shielded step). Only the executable bit
      // is mirrored, never read/write bits.
      if (existsSync(modeFrom) && existsSync(tmp)) {
        const execBit = (statSync(modeFrom).mode & 0o111) !== 0
        await step('chmod', [execBit ? '+x' : '-x', tmp], { stdout: 'ignore', stderr: 'ignore' })
        // chmod is best-effort (`2>/dev/null || true` in the shell original)
        // and never turns `ok` false.
      }
    }
    if (ok) {
      const mvR = await step('mv', ['-f', tmp, dest], { stdout: 'ignore', stderr: 'ignore' })
      ok = mvR.status === 0
    }
    if (!ok) {
      await step('rm', ['-f', tmp], { stdout: 'ignore', stderr: 'ignore' })
    }
    return ok
  })
}

// --- pull_file (scripts/blueprint:612-640) ----------------------------------
export async function pullFile(f: string, out: string, p: Prospective): Promise<boolean> {
  const bp = bpBlueprintPath(f)
  switch (p.mode) {
    case 'refuse':
      process.stdout.write(`  ${C_RED}    refuse: ${p.why}. Nothing written.${C_RESET}\n`)
      if (p.detail) process.stdout.write(`${p.detail}\n`)
      return false
    case 'backup-copy':
      process.stdout.write(`  ${C_YELLOW}    warn: ${p.why} — backing up + whole-file copy${C_RESET}\n`)
      await shieldedWrite(f, `${f}.bp-bak`)
      process.stdout.write(`  ${C_DIM}    backup at ${f}.bp-bak — reconcile manually${C_RESET}\n`)
      break
    case 'merge':
      process.stdout.write(`  ${C_DIM}    (marker-aware merge: project outside-marker content preserved)${C_RESET}\n`)
      break
    case 'new':
    case 'copy':
      break
  }
  return shieldedWrite(out, f, bp)
}

// --- _bp_cli_libs (plan §7) -------------------------------------------------
//
// Matches both `.sh` and `.mts` lib names: slice 6 (plan §7) walks the same
// text for either, so one scanner serves the whole closure — a lib names
// another `.mts` in a non-comment path assignment, or another `.sh`.
export function extractShLibNames(src: string): string[] {
  const names = new Set<string>()
  for (const line of src.split('\n')) {
    const trimmed = line.trimStart()
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue
    for (const m of line.matchAll(/[A-Za-z0-9_-]+\.(?:sh|mts)/g)) names.add(m[0])
  }
  return [...names]
}

function extractDependencyLibNames(src: string): string[] {
  const names = new Set<string>()
  for (const line of src.split('\n')) {
    const trimmed = line.trimStart()
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue
    // A bare mention is enough to preserve the historical closure membership,
    // but not enough to make one file block another: current libs contain
    // messages and case patterns naming real peers they do not execute. Edges
    // require an executable path-bearing shape used by sourced adapters and
    // TS path construction/imports.
    const dependencyShape =
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(trimmed) ||
      /^(?:\.|source)\s/.test(trimmed) ||
      /\b(?:join|resolve|import)\s*\(/.test(trimmed) ||
      /\bfrom\s+['"]/.test(trimmed)
    if (!dependencyShape) continue
    for (const m of line.matchAll(/scripts\/lib\/([A-Za-z0-9_-]+\.(?:sh|mts))/g)) names.add(m[1]!)
  }
  return [...names]
}

export interface CliLibClosure {
  /** Dependency-first, including an explicitly named dependency that is absent. */
  readonly files: string[]
  /** Direct edges, used by pull to hold a depender back after a dependency fails. */
  readonly needs: ReadonlyMap<string, readonly string[]>
}

async function sortLibNames(names: Iterable<string>): Promise<string[]> {
  const unique = new Set(names)
  const sortedR = await unchecked(() =>
    run('sort', ['-u'], {
      env: { ...process.env, LC_ALL: 'C' },
      stdin: unique.size > 0 ? `${[...unique].join('\n')}\n` : '',
      stdout: 'capture',
      stderr: 'ignore',
    }),
  )
  return nonEmptyLines(sortedR.stdout)
}

// TASK-081 slice 6 round 2 (Vitali review) — the seeding half of
// `bpCliLibClosure`, split out so the general dependency check in `cmdPull`
// can seed the SAME fixed point from whatever libs a pull already selected,
// without re-deriving the CLI's own sourced-lib scan (plan: reuse, not a
// second scanner).
function bpCliSeedNames(): Set<string> {
  try {
    return new Set(extractShLibNames(readFileSync(bpBlueprintPath('scripts/blueprint.mts'), 'utf8')))
  } catch {
    // No scripts/blueprint.mts at that path (a stripped fixture, or a caller
    // that never checked existence first) — every caller here already reads
    // this as "no libs to bring along", the same answer an empty scan gives.
    return new Set()
  }
}

// TASK-081 slice 6 round 2 — the fixed point itself, seeded from an arbitrary
// set of lib basenames rather than always starting from the CLI's own
// sourcing. `bpCliLibClosure` below seeds it from the CLI; `cmdPull` seeds it
// from whatever `scripts/lib/*` files a pull (full or named) already
// selected, so the SAME dependency-first ordering and absent/refused
// hold-back apply whether or not the CLI itself is part of this pull.
export async function bpLibClosureFromSeeds(seedNames: Iterable<string>): Promise<CliLibClosure> {
  const names = new Set(seedNames)
  // SLICE 6 (plan §7) — the closure is a FIXED POINT, not one hop: any lib
  // already in the set may itself be a shim or a sourced shell adapter (a
  // retired shape, TASK-088) naming its own
  // `.sh`/`.mts` sibling in a non-comment bridge-path line, exactly the same
  // textual shape the shim-follow above already reads. Scan every named
  // lib's own text for more names, and repeat until a pass adds nothing.
  // `scanned` guards a cycle (a names b, b names a) from looping forever.
  const scanned = new Set<string>()
  const needsByName = new Map<string, Set<string>>()
  const dependencyNames = new Set<string>()
  let grew = true
  while (grew) {
    grew = false
    for (const name of [...names]) {
      if (scanned.has(name)) continue
      scanned.add(name)
      let libText: string
      try {
        libText = readFileSync(bpBlueprintPath(`scripts/lib/${name}`), 'utf8')
      } catch {
        // Named but not present in this blueprint tree — nothing to scan;
        // if another lib explicitly named it, it remains in the ordered result
        // so pull can report the absence and hold that depender back.
        continue
      }
      const needs = new Set(extractDependencyLibNames(libText))
      // Existing files retain the shell closure's deliberately broad textual
      // discovery. Only executable path-bearing forms above become ordering
      // and hold-back edges; otherwise error strings and case patterns would
      // turn incidental mentions into false hard dependencies.
      for (const n of extractShLibNames(libText)) {
        if (existsSync(bpBlueprintPath(`scripts/lib/${n}`)) && !names.has(n)) {
          names.add(n)
          grew = true
        }
      }
      needsByName.set(name, needs)
      for (const n of needs) {
        dependencyNames.add(n)
        if (!names.has(n)) {
          names.add(n)
          grew = true
        }
      }
    }
  }
  // A lexical list is not dependency order except for a same-stem .mts/.sh
  // pair. Walk the graph post-order so every acyclic dependency is attempted
  // before the adapter/lib that needs it, at every depth.
  const sortedNames = await sortLibNames(names)
  const rank = new Map(sortedNames.map((name, index) => [name, index]))
  const sortedNeeds = new Map<string, string[]>()
  for (const [name, deps] of needsByName) {
    sortedNeeds.set(
      name,
      [...deps].sort((a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER)),
    )
  }
  const ordered: string[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (name: string): void => {
    if (visited.has(name)) return
    if (visiting.has(name)) return // textual cycles terminate deterministically
    visiting.add(name)
    for (const dep of sortedNeeds.get(name) ?? []) visit(dep)
    visiting.delete(name)
    visited.add(name)
    ordered.push(`scripts/lib/${name}`)
  }
  for (const name of sortedNames) {
    // Root-level incidental/missing names keep the historical existence
    // filter. Missing *lib dependencies* were admitted above deliberately so
    // pull can report them and hold their depender back.
    if (existsSync(bpBlueprintPath(`scripts/lib/${name}`)) || dependencyNames.has(name)) visit(name)
  }

  const needs = new Map<string, readonly string[]>()
  for (const name of needsByName.keys()) {
    needs.set(
      `scripts/lib/${name}`,
      (sortedNeeds.get(name) ?? []).map((dep) => `scripts/lib/${dep}`),
    )
  }
  return { files: ordered, needs }
}

export async function bpCliLibClosure(): Promise<CliLibClosure> {
  return bpLibClosureFromSeeds(bpCliSeedNames())
}

export async function bpCliLibs(): Promise<string[]> {
  const closure = await bpCliLibClosure()
  // Preserve the public helper and pre-port shell contract: callers asking
  // only for membership get the C-locale lexical list of files that exist.
  const names = closure.files
    .filter((file) => existsSync(bpBlueprintPath(file)))
    .map((file) => file.slice('scripts/lib/'.length))
  return (await sortLibNames(names)).map((name) => `scripts/lib/${name}`)
}

// --- TASK-021 §4.2, _bp_retire (scripts/blueprint:1477-1541) ----------------
// Returns true when it could not prompt (refused_no_tty), matching the
// shell's `refused_no_tty=1; return 0` — the caller reads it as exit 7.
export async function bpRetire(autoYes: boolean): Promise<boolean> {
  const cur = await mktemp()
  const hist = await mktemp()
  const blob = await mktemp()
  const name = projectNameFromLogicalPwd()
  try {
    const tarf = await mktemp()
    try {
      const archR = await unchecked(() =>
        bpGit(['-C', SYNC.blueprintRoot, 'archive', '--format=tar', 'HEAD'], { stdout: { file: tarf }, stderr: 'ignore' }),
      )
      if (archR.status !== 0) return die('could not list the blueprint archive to look for retired files')
      const listR = await unchecked(() => run('tar', ['-tf', tarf], { stdout: 'capture', stderr: 'ignore' }))
      if (listR.status !== 0) return die('could not list the blueprint archive to look for retired files')
      const curInput = listR.stdout
        .split('\n')
        .filter((l) => l !== '' && !l.endsWith('/'))
        .join('\n')
      const sortCurR = await unchecked(() =>
        run('sort', ['-u'], {
          env: { ...process.env, LC_ALL: 'C' },
          stdin: curInput ? `${curInput}\n` : '',
          stdout: { file: cur },
          stderr: 'ignore',
        }),
      )
      if (sortCurR.status !== 0) return die('could not list the blueprint archive to look for retired files')
    } finally {
      await unchecked(() => run('rm', ['-f', tarf], { stdout: 'ignore', stderr: 'ignore' }))
    }

    const histR = await unchecked(() =>
      bpGit(['-C', SYNC.blueprintRoot, 'log', '--format=', '--name-only', '--no-renames', 'HEAD'], {
        stdout: 'capture',
        stderr: 'ignore',
      }),
    )
    if (histR.status !== 0) return die('could not read the blueprint history to look for retired files')
    const histInput = histR.stdout.split('\n').filter((l) => l !== '').join('\n')
    const sortHistR = await unchecked(() =>
      run('sort', ['-u'], {
        env: { ...process.env, LC_ALL: 'C' },
        stdin: histInput ? `${histInput}\n` : '',
        stdout: { file: hist },
        stderr: 'ignore',
      }),
    )
    if (sortHistR.status !== 0) return die('could not read the blueprint history to look for retired files')

    // stderr is NOT redirected in the shell (`done < <(LC_ALL=C comm -23 …)`,
    // no `2>` anywhere on that line), so a missing `comm` reaches the real
    // stderr there — 'ignore' here used to swallow it silently instead
    // (TASK-081, caught by the differential harness's comm-missing row).
    const commR = await unchecked(() =>
      run('comm', ['-23', hist, cur], { env: { ...process.env, LC_ALL: 'C' }, stdout: 'capture', stderr: 'inherit' }),
    )
    const candidates = stripTrailingNewlines(commR.stdout).split('\n').filter((l) => l !== '')

    const same: string[] = []
    const edited: string[] = []
    for (const p of candidates) {
      if (!existsSync(p) || !statSync(p).isFile()) continue
      if (TEMPLATE_FILES.includes(p)) continue

      let shipped = false
      let match = false
      const commitsR = await unchecked(() =>
        bpGit(['-C', SYNC.blueprintRoot, 'log', '--format=%H', '--no-renames', 'HEAD', '--', `:(literal)${p}`], {
          stdout: 'capture',
          stderr: 'ignore',
        }),
      )
      const commits = stripTrailingNewlines(commitsR.stdout).split('\n').filter((l) => l !== '')

      for (const c of commits) {
        const showR = await unchecked(() =>
          bpGit(['-C', SYNC.blueprintRoot, 'show', `${c}:${p}`], { stdout: { file: blob }, stderr: 'ignore' }),
        )
        if (showR.status !== 0) continue
        // The RAW blob is compared first, unconditionally. A byte match means
        // the copy is literally a version the blueprint shipped, so retiring
        // it loses nothing — and the exemption-gated substitution below alone
        // is not enough: bpShouldSubstitute reads TODAY's exemption list, so
        // when a port moves an exemption to a new path (BUG-155 moved
        // contamination.sh to contamination.mts), the deleted file loses its
        // exemption while its shipped copies were never substituted, the
        // comparison runs against a substituted form, nothing matches, and the
        // file is reported "yours now" and kept forever (BUG-162).
        // `-s` silences cmp's OWN differ output, never bash's diagnostic for a
        // missing binary — the shell's `cmp -s "$blob" "$p"` (:1500) carries no
        // `2>` redirect either, so that diagnostic reaches the real stderr.
        // 'ignore' here swallowed it (TASK-081, cmp-missing differential row).
        const cmpRawR = await unchecked(() => run('cmp', ['-s', blob, p], { stdout: 'ignore', stderr: 'inherit' }))
        if (cmpRawR.status === 0) {
          match = true
          break
        }
        const subOut = `${blob}.s`
        const ok = await bpSubstituteStream(blob, name, subOut)
        if (!ok) {
          await unchecked(() => run('rm', ['-f', subOut], { stdout: 'ignore', stderr: 'ignore' }))
          continue
        }
        const cmpR = await unchecked(() => run('cmp', ['-s', subOut, p], { stdout: 'ignore', stderr: 'inherit' }))
        await unchecked(() => run('rm', ['-f', subOut], { stdout: 'ignore', stderr: 'ignore' }))
        if (cmpR.status === 0) {
          match = true
          break
        }
      }

      if (!match) {
        for (const c of commits) {
          const tarf2 = await mktemp()
          try {
            const archR = await unchecked(() =>
              bpGit(['-C', SYNC.blueprintRoot, 'archive', '--format=tar', c, '--', `:(literal)${p}`], {
                stdout: { file: tarf2 },
                stderr: 'ignore',
              }),
            )
            if (archR.status !== 0) continue
            const listR = await unchecked(() => run('tar', ['-tf', tarf2], { stdout: 'capture', stderr: 'ignore' }))
            if (listR.status !== 0) continue
            if (stripTrailingNewlines(listR.stdout).split('\n').includes(p)) {
              shipped = true
              break
            }
          } finally {
            await unchecked(() => run('rm', ['-f', tarf2], { stdout: 'ignore', stderr: 'ignore' }))
          }
        }
      }

      if (match) same.push(p)
      else if (shipped) edited.push(p)
    }

    for (const p of edited) {
      process.stdout.write(
        `  ${C_DIM}yours now${C_RESET} ${p}  (the blueprint stopped shipping it; this copy differs from every version it shipped, so it stays)\n`,
      )
    }
    for (const p of same) {
      process.stdout.write('\n')
      process.stdout.write(`${C_BOLD}── ${p}${C_RESET}\n`)
      process.stdout.write(`  ${C_YELLOW}retire${C_RESET} — the blueprint no longer ships it, and this copy is unedited\n`)
      if (!autoYes) {
        if (!process.stdin.isTTY) {
          process.stdout.write(`  ${C_YELLOW}not interactive${C_RESET} — cannot prompt, so nothing is retired.\n`)
          process.stdout.write(`  ${C_DIM}Re-run with --yes to accept without prompting, or run from a terminal.${C_RESET}\n`)
          return true
        }
        process.stdout.write('  Delete this file? [y/N/q] ')
        const ans = readLineFromStdin()
        if (ans === 'y' || ans === 'Y') {
          // proceed
        } else if (ans === 'q' || ans === 'Q') {
          process.stdout.write(`  ${C_YELLOW}aborted${C_RESET}\n`)
          return false
        } else {
          process.stdout.write(`  ${C_DIM}kept${C_RESET}\n`)
          continue
        }
      }
      await unchecked(() => run('rm', ['-f', p], { stdout: 'ignore', stderr: 'ignore' }))
      process.stdout.write(`  ${C_GREEN}retired${C_RESET} ${p}\n`)
    }
    return false
  } finally {
    await unchecked(() => run('rm', ['-f', cur, hist, blob, `${blob}.s`], { stdout: 'ignore', stderr: 'ignore' }))
  }
}

export function headLines(text: string, n: number): string {
  const parts = text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  return parts.slice(0, n).join('')
}

// --- cmd_pull (scripts/blueprint:1543-1795) ---------------------------------
export async function cmdPull(args: readonly string[]): Promise<number> {
  const src = await readBlueprintSource()

  let autoYes = false
  let files: string[] = []
  for (const arg of args) {
    if (arg === '--yes' || arg === '-y') autoYes = true
    else if (arg.startsWith('-')) return die(`unknown option: ${arg}`)
    else files.push(arg)
  }

  // BUG-016 — captured before the default-fill below, because afterwards a
  // named-files pull and a default full pull are indistinguishable.
  const partial = files.length > 0

  if (files.length === 0) {
    for (const f of src.managed) {
      const bp = bpBlueprintPath(f)
      if (!existsSync(bp)) continue
      const selOut = await mktemp()
      try {
        // BUG-113 — drift's predicate exactly (bp_prospective_for's own
        // STATUS is the one answer, not BP_PP_MODE alone — see Prospective's
        // `ok`): a refused OR write-failed file is selected too, so it is
        // reported rather than silently left out.
        // Plan §2 rule 4 — same disabled-errexit dynamic extent as drift's call.
        const p = await unchecked(() => bpProspectiveFor(f, selOut))
        if (!p.ok) {
          files.push(f)
        } else {
          const diffR = await unchecked(() => run('diff', ['-q', selOut, f], { stdout: 'ignore', stderr: 'ignore' }))
          if (diffR.status !== 0) files.push(f)
        }
      } finally {
        await unchecked(() => run('rm', ['-f', selOut], { stdout: 'ignore', stderr: 'ignore' }))
      }
    }
  }

  if (files.length === 0) {
    process.stdout.write(`${C_GREEN}✓ Nothing to pull. Project matches blueprint HEAD.${C_RESET}\n`)
    const refusedNoTty = await bpRetire(autoYes)
    await bpSyncCleanup()
    return refusedNoTty ? 7 : 0
  }

  // TASK-025 — the CLI travels with the libs it sources.
  const namesCli = (f: string): boolean => f === 'scripts/blueprint.mts'
  const cliSelected = files.some(namesCli)
  let cliNeeds: string[] = []
  let cliUnmet: string[] = []
  let libNeeds: ReadonlyMap<string, readonly string[]> = new Map()

  // TASK-081 slice 6 round 2 (Vitali review) — this dependency analysis used
  // to run ONLY when the CLI itself was selected (`if (files.some(namesCli))`
  // guarded the whole block below). A full pull selects the CLI only when it
  // differs from the project's copy, so once a project's CLI is already
  // current — the steady state after any project has been ported once — a
  // lib that gained a dependency on something absent, refused, declined or
  // failed pulled through with no check at all. Seed the SAME fixed point
  // (bpLibClosureFromSeeds, not a second scanner) from every `scripts/lib/*`
  // file this pull already selected — full or named — plus, when the CLI IS
  // selected, its own sourced-lib seed names, so the CLI still brings its
  // whole closure along unconditionally (TASK-025). A pull with no lib
  // dependency edges yields an empty closure and the loop below is a no-op,
  // leaving `files`' order and every line of output exactly as before.
  const rest = files.filter((f) => !namesCli(f))
  const seedNames = new Set(
    rest.filter((f) => f.startsWith('scripts/lib/')).map((f) => f.slice('scripts/lib/'.length)),
  )
  if (cliSelected) for (const n of bpCliSeedNames()) seedNames.add(n)
  const closure = await bpLibClosureFromSeeds(seedNames)
  const libs = closure.files
  libNeeds = closure.needs
  let cliNeedsStr = ' '
  for (const lib of libs) {
    if (cliSelected) cliNeedsStr += `${lib} `
    // A full or named pull's file list cannot select a hard dependency that
    // is absent from the blueprint archive, or that this pull didn't already
    // name. It must still be attempted so the miss enters
    // `failedDependencies` before its depender; otherwise the depender lands
    // even though the closure deliberately retained the absent name for
    // hold-back. A partial (named) pull already adds every closure lib.
    if (!rest.includes(lib) && (partial || !existsSync(bpBlueprintPath(lib)))) rest.push(lib)
  }
  // TASK-081 slice 6 (Vitali review) — the closure's dependency-first order
  // must land in `rest` for a FULL pull too, not only a partial one: on a
  // full pull `rest` is every differing file from the default scan, in
  // bpManagedFiles()'s archive (alphabetical) order, which has no relation
  // to which lib sources which. `libNeeds`'s hold-back only works if a
  // dependency was already ATTEMPTED by the time its depender is reached
  // (`failedDependencies.has(need)`, below) — alphabetically-first-but-
  // dependent otherwise lands before a dependency that then refuses,
  // stranding it. Reorder just the closure's own members into `libs`'
  // dependency-first order (the one fixed point bpLibClosureFromSeeds already
  // computed — reused, not re-derived) and leave every unrelated file
  // exactly where the scan put it.
  const closureRank = new Map(libs.map((lib, i) => [lib, i]))
  const orderedRest: string[] = []
  let libGroupInserted = false
  for (const f of rest) {
    if (!closureRank.has(f)) {
      orderedRest.push(f)
      continue
    }
    if (libGroupInserted) continue // already emitted with the group below
    libGroupInserted = true
    for (const lib of libs) if (rest.includes(lib)) orderedRest.push(lib)
  }
  if (cliSelected) {
    // The CLI lands last, after every lib it sources; a refusal or skip of
    // one holds it back.
    cliNeeds = [...libs]
    files = [...orderedRest, 'scripts/blueprint.mts']
    if (partial && cliNeedsStr !== ' ') {
      process.stdout.write(`scripts/blueprint.mts brings the libs it sources:${cliNeedsStr}\n`)
    }
  } else {
    files = orderedRest
  }

  process.stdout.write(
    SYNC.mode === 'address'
      ? `${C_BOLD}Pulling from ${SYNC.remote} (${SYNC.branch}) at ${SYNC.sha}${C_RESET}\n`
      : `${C_BOLD}Pulling from LOCAL CHECKOUT ${SYNC.blueprintRoot} (BLUEPRINT_ROOT override, not the published address)${C_RESET}\n`,
  )

  // BUG-122 — `held` names every selected file this run did NOT land.
  let pulled = 0
  const held: string[] = []
  let refusedGuard = false
  let refusedNoTty = false
  let aborted = false
  const failedDependencies = new Set<string>()

  for (const f of files) {
    const libUnmet = (libNeeds.get(f) ?? []).filter((need) => failedDependencies.has(need))
    if (libUnmet.length > 0) {
      process.stdout.write('\n')
      process.stdout.write(
        `  ${C_RED}skipped${C_RESET} ${f} — it needs${libUnmet.map((need) => ` ${need}`).join('')}, which was not pulled, so it would refuse to run\n`,
      )
      refusedGuard = true
      held.push(f)
      failedDependencies.add(f)
      if (cliNeeds.includes(f)) cliUnmet.push(f)
      continue
    }
    if (namesCli(f) && cliUnmet.length > 0) {
      process.stdout.write('\n')
      process.stdout.write(
        `  ${C_RED}skipped${C_RESET} ${f} — it sources${cliUnmet.map((l) => ` ${l}`).join('')}, which was not pulled, so it would refuse to run\n`,
      )
      refusedGuard = true
      held.push(f)
      continue
    }
    const bp = bpBlueprintPath(f)
    if (!existsSync(bp)) {
      process.stdout.write(`  ${C_RED}skip${C_RESET}  ${f}  (not in blueprint)\n`)
      failedDependencies.add(f)
      if (cliNeeds.includes(f)) cliUnmet.push(f)
      continue
    }

    const pullOut = await mktemp()
    try {
      // BUG-113 — ONE prospective result per file, used for the same-check,
      // the preview AND the write.
      // Plan §2 rule 4 — same disabled-errexit dynamic extent as drift's call.
      const p = await unchecked(() => bpProspectiveFor(f, pullOut))
      const fExists = existsSync(f)
      // `bp_prospective_for … && [ -f "$f" ] && diff -q …` (:1639) — the
      // call's own STATUS gates the "same" shortcut, not BP_PP_MODE alone;
      // see Prospective's `ok`.
      if (p.ok && fExists) {
        const diffR = await unchecked(() => run('diff', ['-q', pullOut, f], { stdout: 'ignore', stderr: 'ignore' }))
        if (diffR.status === 0) {
          process.stdout.write(`  ${C_DIM}same${C_RESET}  ${f}\n`)
          continue
        }
      }

      process.stdout.write('\n')
      process.stdout.write(`${C_BOLD}── ${f}${C_RESET}\n`)

      if (p.mode === 'refuse') {
        const ok = await pullFile(f, pullOut, p)
        if (!ok) {
          refusedGuard = true
          held.push(f)
          failedDependencies.add(f)
          if (cliNeeds.includes(f)) cliUnmet.push(f)
        }
        continue
      }

      if (!fExists) {
        process.stdout.write(`  ${C_BLUE}new file${C_RESET} (blueprint adds it; project doesn't have it yet)\n`)
      } else {
        // The shell's `diff -u "$f" "$pull_out" | head -60 || true` (:1658)
        // pipes only diff's STDOUT into head — diff's stderr is never
        // redirected, so a missing `diff` there reaches the real stderr.
        // 'ignore' here swallowed it (TASK-081, diff-missing differential row).
        const diffU = await unchecked(() => run('diff', ['-u', f, pullOut], { stdout: 'capture', stderr: 'inherit' }))
        process.stdout.write(headLines(diffU.stdout, 60))
        process.stdout.write(`  ${C_DIM}(diff truncated at 60 lines — open the file to see all)${C_RESET}\n`)
      }

      if (!autoYes) {
        if (!process.stdin.isTTY) {
          process.stdout.write(`  ${C_YELLOW}not interactive${C_RESET} — cannot prompt, so nothing is pulled.\n`)
          process.stdout.write(`  ${C_DIM}Re-run with --yes to accept without prompting, or run from a terminal.${C_RESET}\n`)
          refusedNoTty = true
          break
        }
        process.stdout.write('  Pull this file? [y/N/q] ')
        const ans = readLineFromStdin()
        if (ans === 'y' || ans === 'Y') {
          // proceed
        } else if (ans === 'q' || ans === 'Q') {
          process.stdout.write(`  ${C_YELLOW}aborted${C_RESET}\n`)
          held.push(`${f}(aborted-here)`)
          aborted = true
          break
        } else {
          process.stdout.write(`  ${C_DIM}skipped${C_RESET}\n`)
          held.push(f)
          failedDependencies.add(f)
          if (cliNeeds.includes(f)) cliUnmet.push(f)
          continue
        }
      }

      await unchecked(() => run('mkdir', ['-p', dirname(f)], { stdout: 'ignore', stderr: 'ignore' }))
      const ok = await pullFile(f, pullOut, p)
      if (ok) {
        process.stdout.write(`  ${C_GREEN}pulled${C_RESET} ${f}\n`)
        pulled += 1
      } else {
        process.stdout.write(`  ${C_RED}skipped${C_RESET} ${f} (see warning above)\n`)
        refusedGuard = true
        held.push(f)
        failedDependencies.add(f)
        if (cliNeeds.includes(f)) cliUnmet.push(f)
      }
    } finally {
      await unchecked(() => run('rm', ['-f', pullOut], { stdout: 'ignore', stderr: 'ignore' }))
    }
  }

  process.stdout.write('\n')
  if (pulled > 0) {
    let currentSha: string
    if (SYNC.mode === 'address') {
      currentSha = SYNC.sha
    } else {
      const shaR = await unchecked(() =>
        run('git', ['-C', SYNC.blueprintRoot, 'rev-parse', 'HEAD'], { stdout: 'capture', stderr: 'ignore' }),
      )
      currentSha = shaR.status === 0 ? stripTrailingNewlines(shaR.stdout) : 'no-sha'
    }
    if (partial) {
      process.stdout.write(`${C_DIM}bootstrap_sha left unchanged — this was a partial pull, so the\n`)
      process.stdout.write('project is not synced to blueprint HEAD. Run \'blueprint pull\' with no\n')
      process.stdout.write(`paths to sync fully.${C_RESET}\n`)
    } else if (held.length > 0) {
      const heldStr = held.map((h) => ` ${h}`).join('')
      process.stdout.write(`${C_YELLOW}bootstrap_sha left unchanged — these files were not synced:${heldStr}${C_RESET}\n`)
      process.stdout.write(`${C_DIM}Fix or accept them, then run 'blueprint pull' again to record the tip.${C_RESET}\n`)
    } else if (existsSync('.blueprint-source') && currentSha !== 'no-sha') {
      const cfgNew = await mktemp()
      const cfgText = readFileSync('.blueprint-source', 'utf8')
      const newText = cfgText.replace(/^bootstrap_sha.*=.*/m, `bootstrap_sha    = ${currentSha}`)
      writeFileSync(cfgNew, newText)
      await shieldedWrite(cfgNew, '.blueprint-source')
      await unchecked(() => run('rm', ['-f', cfgNew], { stdout: 'ignore', stderr: 'ignore' }))
      process.stdout.write(`Updated .blueprint-source bootstrap_sha → ${currentSha}\n`)
    }
    process.stdout.write(`${C_GREEN}✓ Pulled ${pulled} file(s). Review with 'git diff' and commit.${C_RESET}\n`)
  } else {
    process.stdout.write(`${C_DIM}Nothing pulled.${C_RESET}\n`)
  }

  if (!partial && !aborted && !refusedNoTty) {
    const retireRefusedNoTty = await bpRetire(autoYes)
    if (retireRefusedNoTty) refusedNoTty = true
  }

  await bpSyncCleanup()

  if (refusedNoTty) return 7
  // BUG-034 — a file a guard REFUSED is not a file that was synced.
  if (refusedGuard) return 4
  return 0
}

// --- SLICE 4: a2bp / prs (plan §3 P5) ---------------------------------------
//
// `a2bp` is orchestration over six libs: five shell (request.sh,
// request-build.sh, request-config.sh, request-inputs.sh, request-file.sh),
// which it reaches by bridge calls into the SAME shell functions — not
// reimplemented, only called (plan §4) — and scripts/lib/contamination.mts
// (BUG-155 port), which it imports once the required-libs check has passed.
// `reqLib` recreates the real CLI's point-of-use placeholders.sh fallback
// alongside the shell five: their functions call bp_substitute_stream
// INTERNALLY, so a bridge that omitted it would fail differently. The five
// git/gh wrappers are bridged too, keeping request-file.sh/request.sh as their
// single implementation (review finding 4).
const A2BP_SHELL_LIBS: readonly string[] = [
  'request.sh',
  'request-build.sh',
  'request-config.sh',
  'request-inputs.sh',
  'request-file.sh',
]
const A2BP_LIB_NAMES: readonly string[] = ['contamination.mts', ...A2BP_SHELL_LIBS]

function a2bpLibPaths(): string[] {
  const dir = libDir()
  return A2BP_SHELL_LIBS.map((n) => join(dir, n))
}

// placeholders.sh is NOT one of the six `[ -r … ] || die` libs cmd_a2bp
// requires (scripts/blueprint:1819-1823) — the real CLI sources it once, at
// TOP LEVEL, before any subcommand dispatches (:55-62), with its own
// point-of-use fallback when the file is missing:
//   bp_substitute_stream()   { die "…placeholders.sh is missing…"; }
//   bp_substitute_in_place() { die "…placeholders.sh is missing…"; }
// A bridge subprocess starts fresh each call and has neither that source nor
// the CLI's own `die` function, so reproducing the CLI's behaviour (not
// bash's raw "command not found") means inlining the fallback's effect
// (die's `echo … >&2; exit 1`) directly, guarded exactly as the CLI guards
// it — never blindly sourcing placeholders.sh like one of the six required
// libs, which would leave a missing file failing as bash's own "No such
// file", then 127 on the first call to a function that never got defined.
function placeholdersFallbackSnippet(argIndex: number): string {
  const msg = 'scripts/lib/placeholders.sh is missing — cannot substitute safely'
  const die = `printf '%s\\n' "${C_RED}error:${C_RESET} ${msg}" >&2; exit 1`
  return (
    `if [ -r "$${argIndex}" ]; then . "$${argIndex}"; else ` +
    `bp_substitute_stream() { ${die}; }; bp_substitute_in_place() { ${die}; }; fi`
  )
}

async function reqLib(
  snippet: string,
  args: readonly string[] = [],
  opts: Omit<RunOptions, 'stdout' | 'stdin'> = {},
): Promise<{ readonly stdout: string; readonly status: number }> {
  const placeholders = join(libDir(), 'placeholders.sh')
  const libs = a2bpLibPaths()
  const n = libs.length
  const preamble =
    `${placeholdersFallbackSnippet(1)}; ` + libs.map((_, i) => `. "$${i + 2}"`).join('; ')
  const r = await run(
    'bash',
    ['-c', `${preamble}; shift ${n + 1}; ${snippet}`, cliName(), placeholders, ...libs, ...args],
    { ...opts, stdout: 'capture', stderr: opts.stderr ?? 'inherit' },
  )
  return { stdout: stripTrailingNewlines(r.stdout), status: r.status }
}

function nonEmptyLines(s: string): string[] {
  return s.split('\n').filter((l) => l.length > 0)
}

function pathOf(spec: string): string {
  const i = spec.indexOf(':')
  return i === -1 ? spec : spec.slice(0, i)
}

// BP_RC_* — read at run time from request-file.sh, never copied (plan §3 P5):
// a drift between a hardcoded TS constant and the shell's own definition
// would be invisible to every differential row that only checks exit codes
// against the SAME shell source.
interface RequestCodes {
  readonly ok: number
  readonly pending: number
  readonly blocked: number
  readonly failed: number
  readonly nothing: number
}
async function bpRequestCodes(): Promise<RequestCodes> {
  const lib = join(libDir(), 'request-file.sh')
  const r = await unchecked(() =>
    bashLib(lib, 'printf "%s\\0%s\\0%s\\0%s\\0%s\\0" "$BP_RC_OK" "$BP_RC_PENDING" "$BP_RC_BLOCKED" "$BP_RC_FAILED" "$BP_RC_NOTHING"'),
  )
  const p = r.stdout.split('\0')
  return {
    ok: Number(p[0] ?? '0'),
    pending: Number(p[1] ?? '3'),
    blocked: Number(p[2] ?? '4'),
    failed: Number(p[3] ?? '5'),
    nothing: Number(p[4] ?? '6'),
  }
}

// bp_inputs_is_managed (scripts/lib/request-inputs.sh:79) — `grep -qxF`, an
// exact full-line membership test with no locale- or regex-dependence.
// Reimplemented directly rather than bridged: it is a one-line primitive with
// nothing for a shell process to get right that Array#includes does not.
function isManaged(canon: string, managedList: readonly string[]): boolean {
  return managedList.includes(canon)
}

function slugFromRemote(remote: string): string {
  return remote.replace(/^git@[^:]+:/, '').replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, '')
}

function splitFindingLine(line: string): { readonly ln: string; readonly kind: string; readonly reason: string; readonly text: string } {
  const parts = line.split('|')
  return { ln: parts[0] ?? '', kind: parts[1] ?? '', reason: parts[2] ?? '', text: parts.slice(3).join('|') }
}

// bp_file_pr_body, bp_file_remote_tip, bp_file_push, bp_file_existing_pr and
// the `gh pr create` call (scripts/lib/request-file.sh:54-163,
// scripts/blueprint:2117-2119) are ALL bridged into the same shell functions
// rather than reimplemented, per plan §4 ("libs stay shell") — the orchestrator's
// decision on review: a hand-copied `GIT_TRANSPORT_UNSET`/message duplicate
// can drift from `request.sh`'s own `bp_request_transport_env` and this
// file's own text, in a way no differential row that only checks output
// would catch until the two disagree.

// bp_file_pr_body PROJECT BASE REMOTE BRANCH UNSHIPPED SPEC...
// (scripts/lib/request-file.sh:141) — UNSHIPPED is newline-delimited, exactly
// as the shell's `cmd_a2bp` builds it.
async function bpFilePrBody(
  project: string,
  base: string,
  remote: string,
  branch: string,
  unshippedPaths: readonly string[],
  specs: readonly string[],
): Promise<string> {
  const r = await reqLib('bp_file_pr_body "$1" "$2" "$3" "$4" "$5" "${@:6}"', [
    project,
    base,
    remote,
    branch,
    // scripts/blueprint:1911-1917 builds this with a TRAILING newline after
    // EVERY entry (`unshipped="${unshipped}${path}"$'\n'`), which is what
    // lets its own `case $'\n'"$unshipped" in *$'\n'"$path"$'\n'*)` match the
    // last entry too — `.join('\n')` alone drops that trailing newline.
    unshippedPaths.map((p) => `${p}\n`).join(''),
    ...specs,
  ])
  return r.stdout
}

// bp_file_remote_tip REMOTE BRANCH (scripts/lib/request-file.sh:54).
async function bpFileRemoteTip(remote: string, branch: string): Promise<string> {
  const r = await unchecked(() => reqLib('bp_file_remote_tip "$1" "$2"', [remote, branch]))
  return r.stdout
}

// bp_file_push BARE REMOTE REF COMMIT (scripts/lib/request-file.sh:76-104) —
// its own stderr messages (adopting / rejected / push failed) are the
// shell's, inherited by reqLib's default, never duplicated here.
async function bpFilePush(bare: string, remote: string, ref: string, commit: string): Promise<boolean> {
  const r = await reqLib('bp_file_push "$1" "$2" "$3" "$4"', [bare, remote, ref, commit])
  return r.status === 0
}

// bp_file_existing_pr SLUG REF (scripts/lib/request-file.sh:118-130) — its own
// `command -v gh` guard stands; `existing=$(...) || true` in the shell ignores
// the status, so this bridge does too.
async function bpFileExistingPr(slug: string, ref: string): Promise<string> {
  const r = await unchecked(() => reqLib('bp_file_existing_pr "$1" "$2"', [slug, ref]))
  return r.stdout
}

// `bp_request_transport_env gh pr create … 2>&1` (scripts/blueprint:2118) —
// merged inside the bridged bash so stdout and stderr interleave the way a
// real `2>&1` redirect would, and the env-scrub is request.sh's own
// `bp_request_transport_env`, not a hand-copied unset list.
async function ghPrCreate(
  slug: string,
  branch: string,
  ref: string,
  title: string,
  body: string,
): Promise<{ readonly stdout: string; readonly status: number }> {
  return reqLib(
    'bp_request_transport_env gh pr create --repo "$1" --base "$2" --head "$3" --title "$4" --body "$5" 2>&1',
    [slug, branch, ref, title, body],
    { stderr: 'ignore' },
  )
}

// _a2bp_managed_list — `bp_request_hermetic git archive` + `tar -tf` + the
// SAME filter cmd_files already applies (managedFilterKeeps === shell's
// `_bp_managed_filter`, scripts/blueprint:1088-1096), against the fetched
// BASE rather than the blueprint root's HEAD.
async function a2bpManagedList(bare: string, base: string, scratch: string): Promise<string[] | null> {
  const tarf = join(scratch, 'base.tar')
  const archiveR = await unchecked(() =>
    reqLib('bp_request_hermetic git -C "$1" archive --format=tar "$2" > "$3"', [bare, base, tarf], {
      stderr: 'ignore',
    }),
  )
  if (archiveR.status !== 0) return null
  const listR = await unchecked(() => run('tar', ['-tf', tarf], { stdout: 'capture', stderr: 'ignore' }))
  if (listR.status !== 0) return null
  return listR.stdout.split('\n').filter(managedFilterKeeps)
}

async function cmdA2bp(args: readonly string[]): Promise<number> {
  for (const lib of A2BP_LIB_NAMES) {
    if (!isReadable(join(libDir(), lib))) {
      return die(`scripts/lib/${lib} is missing — refusing to file a request without it`)
    }
  }
  // Imported HERE, after the check above, for the same reason the shell
  // sourced its libs after `[ -r … ] || die`: a missing guard is this refusal,
  // never a module-resolution crash on every subcommand.
  const { contaminationStage, contaminationScan } = await import('./lib/contamination.mts')

  let dryRun = false
  const files: string[] = []
  for (const arg of args) {
    if (arg === '--dry-run') dryRun = true
    else if (arg === '--force') {
      return die(
        "--force is gone. a2bp files a request that a person reviews, so there is nothing to waive. Fix the finding, or mark the line with an inline 'a2bp-allow: <why it is safe>' comment. If the guard is wrong, that is a bug in scripts/lib/contamination.mts.",
      )
    } else if (arg.startsWith('-')) {
      return die(`unknown option: ${arg} (usage: blueprint a2bp [--dry-run] FILE...)`)
    } else {
      files.push(arg)
    }
  }
  if (files.length === 0) return die('usage: blueprint a2bp [--dry-run] FILE [FILE...]')

  const codes = await bpRequestCodes()

  const gitVerR = await unchecked(() => reqLib('bp_request_check_git_version'))
  if (gitVerR.status !== 0) return codes.failed

  const cfg = await bpConfigLoad('.blueprint-source')
  if (!cfg) return codes.blocked

  const projName = projectNameFromLogicalPwd()
  const root = logicalPwd()

  process.stdout.write(`${C_BOLD}Apply-to-blueprint — filing a request${C_RESET}\n`)
  process.stdout.write(`  project:  ${root}  ${C_DIM}(name: ${projName})${C_RESET}\n`)
  process.stdout.write(`  remote:   ${cfg.remote}\n`)
  process.stdout.write(`  branch:   ${cfg.branch}\n`)
  if (dryRun) process.stdout.write(`  ${C_DIM}--dry-run: reads the remote, writes nothing${C_RESET}\n`)
  process.stdout.write('\n')

  const validatedR = await unchecked(() => reqLib('bp_inputs_validate "$1" "$2" "${@:3}"', [root, '', ...files]))
  if (validatedR.status !== 0) return codes.blocked
  const validated = validatedR.stdout

  const scratchR = await unchecked(() => reqLib('bp_file_scratch'))
  if (scratchR.status !== 0) return codes.failed
  let scratch = scratchR.stdout
  const bare = join(scratch, 'bare')

  const cleanup = async (): Promise<void> => {
    if (!scratch) return
    const dir = scratch
    scratch = ''
    const r = await unchecked(() => run('rm', ['-rf', dir], { stdout: 'ignore', stderr: 'ignore' }))
    if (r.status !== 0) {
      process.stderr.write(`${C_YELLOW}could not remove ${dir} — clean it up by hand${C_RESET}\n`)
    }
  }
  // scripts/blueprint:1886's own trap, EXIT INT TERM in one: cleaned up on
  // every return path below (the `finally`) AND on a signal (BUG-116, kept —
  // setTerminatingHandler's own comment).
  setTerminatingHandler(cleanup, true)

  try {
    const baseR = await unchecked(() =>
      reqLib('bp_file_fetch_base "$1" "$2" "$3"', [scratch, cfg.remote, cfg.branch]),
    )
    if (baseR.status !== 0) return codes.failed
    let base = baseR.stdout
    process.stdout.write(`  base:     ${base}\n\n`)

    const managedList = await a2bpManagedList(bare, base, scratch)
    if (managedList === null) {
      process.stderr.write(`${C_RED}error:${C_RESET} could not list what the base ${base} ships\n`)
      return codes.failed
    }

    // bp_inputs_refuse_ignored's 2nd argument is a FILE (the managed-set
    // listing), not a value — written under scratch first.
    const managedFile = join(scratch, 'managed')
    writeFileSync(managedFile, managedList.length > 0 ? `${managedList.join('\n')}\n` : '')
    const refuseR = await unchecked(() =>
      reqLib('bp_inputs_refuse_ignored "$1" "$2" "$3"', [root, managedFile, validated]),
    )
    if (refuseR.status !== 0) return codes.blocked

    const unshippedPaths: string[] = []
    for (const line of nonEmptyLines(validated)) {
      const canon = pathOf(line)
      if (!isManaged(canon, managedList)) unshippedPaths.push(canon)
    }
    const isUnshipped = (p: string): boolean => unshippedPaths.includes(p)

    const paths = nonEmptyLines(validated).map(pathOf)
    const validateBaseR = await unchecked(() => reqLib('bp_build_validate_base "$1" "$2" "${@:3}"', [bare, base, ...paths]))
    if (validateBaseR.status !== 0) return codes.blocked

    let blocked = 0
    const specs: string[] = []
    for (const spec of nonEmptyLines(validated)) {
      const path = pathOf(spec)
      const mode = spec.slice(path.length + 1)

      if (isUnshipped(path)) {
        process.stdout.write(
          `  ${C_YELLOW}not shipped${C_RESET}  ${path}  ${C_DIM}(not managed: no existing project receives it)${C_RESET}\n`,
        )
      }

      const flatName = path.replace(/\//g, '_')
      const basecopy = join(scratch, `base.${flatName}`)
      // Bare in the shell (scripts/blueprint:1944) under `set -e`, not a
      // condition — a failing `git show` there aborts the whole run with its
      // own status. Not wrapped in unchecked(): the ambient errexit-on
      // context makes reqLib() throw on failure, same as bash's -e here.
      try {
        await reqLib('bp_file_base_content "$1" "$2" "$3" "$4"', [bare, base, path, basecopy])
      } catch (e) {
        await cleanup()
        if (e instanceof CommandFailedError) throw new ExitStatusError(e.result.status)
        throw e
      }

      const staged = join(scratch, `staged.${flatName}`)
      if (await bpShouldSubstitute(path)) {
        const stageStatus = contaminationStage(join(root, path), basecopy, projName, staged)
        if (stageStatus !== 0) {
          process.stdout.write(`  ${C_RED}reject${C_RESET}  ${path}  (staging failed)\n`)
          if (stageStatus === 3) {
            process.stdout.write(
              `    ${C_DIM}Round-trip check failed: substituting the staged result does not${C_RESET}\n`,
            )
            process.stdout.write(
              `    ${C_DIM}reproduce your file. Refusing rather than risk altering content.${C_RESET}\n`,
            )
          } else {
            process.stdout.write(
              `    ${C_DIM}'diff' must support --unchanged-line-format/--old-line-format/${C_RESET}\n`,
            )
            process.stdout.write(`    ${C_DIM}--new-line-format (GNU diffutils). Install GNU diffutils and re-run.${C_RESET}\n`)
          }
          blocked += 1
          continue
        }
      } else {
        try {
          await run('cp', [join(root, path), staged])
        } catch (e) {
          await cleanup()
          if (e instanceof CommandFailedError) throw new ExitStatusError(e.result.status)
          throw e
        }
      }

      const { findings, blocked: hasBlock } = contaminationScan(staged, projName, path)
      for (const line of findings) {
        const { ln, kind, reason, text } = splitFindingLine(line)
        const colour = kind === 'BLOCK' ? C_RED : C_YELLOW
        process.stdout.write(`    ${colour}${kind}${C_RESET}  ${path}:${ln} — ${reason}\n`)
        process.stdout.write(`      ${C_DIM}${text}${C_RESET}\n`)
      }
      if (hasBlock) {
        process.stdout.write(`  ${C_RED}reject${C_RESET}  ${path}  (contamination)\n`)
        process.stdout.write(
          `    ${C_DIM}Fix the lines above, or mark a known-benign one with an inline${C_RESET}\n`,
        )
        process.stdout.write(
          `    ${C_DIM}'a2bp-allow: <why it is safe>' comment — the justification is required.${C_RESET}\n`,
        )
        blocked += 1
        continue
      }

      specs.push(`${path}:${mode}:${staged}`)
    }

    if (blocked > 0) {
      process.stdout.write('\n')
      process.stdout.write(`${C_RED}✗ ${blocked} file(s) blocked — nothing filed.${C_RESET}\n`)
      return codes.blocked
    }

    const dropR = await unchecked(() => reqLib('bp_inputs_drop_unchanged "$1" "$2" "${@:3}"', [bare, base, ...specs]))
    let dropRc = dropR.status
    if (dropRc === 2) {
      process.stdout.write(`${C_DIM}Nothing to request.${C_RESET}\n`)
      return codes.nothing
    }
    if (dropRc !== 0) return codes.failed
    let kept = nonEmptyLines(dropR.stdout)

    // key=$(bp_request_key ...) — the FIRST call, `|| return $BP_RC_FAILED`.
    const keyR = await unchecked(() => reqLib('bp_request_key "$1" "$2" "$3" "$4" "${@:5}"', [cfg.remote, cfg.branch, base, projName, ...kept]))
    if (keyR.status !== 0) return codes.failed
    let key = keyR.stdout

    const refR = await unchecked(() => reqLib('bp_request_ref "$1" "$2"', [projName, key]))
    if (refR.status !== 0) return codes.blocked
    let ref = refR.stdout

    const commitR = await unchecked(() =>
      reqLib('bp_build_request "$1" "$2" "$3" "$4" "${@:5}"', [bare, base, ref, projName, ...kept]),
    )
    if (commitR.status !== 0) return codes.failed
    let commit = commitR.stdout

    process.stdout.write('\n')
    process.stdout.write(`${C_BOLD}Request${C_RESET}\n`)
    process.stdout.write(`  branch:   ${ref}\n`)
    process.stdout.write(`  commit:   ${commit}\n`)
    process.stdout.write(`  files:    ${kept.length}\n\n`)
    // Bare pipeline in the shell (scripts/blueprint:2025) under `set -e
    // -o pipefail`, not a condition — a failing `git diff --stat` there
    // aborts the whole run. Not wrapped in unchecked() for the same reason
    // as bp_file_base_content above.
    let diffR: { readonly stdout: string; readonly status: number }
    try {
      diffR = await reqLib('bp_request_hermetic git -C "$1" --no-pager diff --stat "$2" "$3"', [bare, base, commit])
    } catch (e) {
      await cleanup()
      if (e instanceof CommandFailedError) throw new ExitStatusError(e.result.status)
      throw e
    }
    process.stdout.write(
      diffR.stdout
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n') + (diffR.stdout ? '\n' : ''),
    )
    process.stdout.write('\n')
    const keptPaths = kept.map(pathOf)
    for (const path of keptPaths) {
      if (isUnshipped(path)) {
        process.stdout.write(`  ${C_YELLOW}not shipped to derived projects:${C_RESET} ${path}\n`)
      }
    }

    if (dryRun) {
      process.stdout.write(`${C_DIM}--dry-run: nothing pushed. Full diff:${C_RESET}\n`)
      process.stdout.write(`  ${C_DIM}git -C ${bare} diff ${base} ${commit}${C_RESET}\n`)
      process.stdout.write(`${C_YELLOW}(the scratch clone is removed on exit; re-run without --dry-run to file)${C_RESET}\n`)
      return codes.ok
    }

    const tip = await bpFileRemoteTip(cfg.remote, cfg.branch)
    if (tip && tip !== base) {
      process.stdout.write(`${C_YELLOW}The blueprint moved while this request was being built — rebuilding once.${C_RESET}\n`)
      process.stdout.write(`  ${C_DIM}was ${base}, now ${tip}${C_RESET}\n`)
      const base2R = await unchecked(() => reqLib('bp_file_fetch_base "$1" "$2" "$3"', [scratch, cfg.remote, cfg.branch]))
      if (base2R.status !== 0) return codes.failed
      const base2 = base2R.stdout
      base = base2
      const validateBase2R = await unchecked(() => reqLib('bp_build_validate_base "$1" "$2" "${@:3}"', [bare, base2, ...paths]))
      if (validateBase2R.status !== 0) return codes.blocked

      // Quirk 1 (plan §3 P5, kept exactly): the shell's second
      // `kept=$(...) || drop_rc=$?` neither resets drop_rc nor refuses a
      // non-2 failure — only the ===2 ("nothing to request") case is acted
      // on; any OTHER non-zero status is silently ignored and the (possibly
      // empty/partial) stdout is used as-is.
      const drop2R = await unchecked(() => reqLib('bp_inputs_drop_unchanged "$1" "$2" "${@:3}"', [bare, base2, ...specs]))
      dropRc = drop2R.status
      if (dropRc === 2) {
        process.stdout.write(`${C_DIM}Nothing to request against the new base.${C_RESET}\n`)
        return codes.nothing
      }
      kept = nonEmptyLines(drop2R.stdout)

      // Quirk 2 (plan §3 P5, kept exactly): `key=$(bp_request_key ...)` here
      // has NO `|| return` — under `set -e` a failure exits the whole script
      // with bp_request_key's OWN status, not BP_RC_FAILED. Reproduced by
      // calling reqLib OUTSIDE unchecked(), so run() throws (errexit-on is
      // the ambient default) and the process exits with that raw status —
      // after this same cleanup, matching the EXIT trap still firing.
      let key2R: { readonly stdout: string; readonly status: number }
      try {
        key2R = await reqLib('bp_request_key "$1" "$2" "$3" "$4" "${@:5}"', [
          cfg.remote,
          cfg.branch,
          base2,
          projName,
          ...kept,
        ])
      } catch (e) {
        await cleanup()
        if (e instanceof CommandFailedError) throw new ExitStatusError(e.result.status)
        throw e
      }
      key = key2R.stdout

      const ref2R = await unchecked(() => reqLib('bp_request_ref "$1" "$2"', [projName, key]))
      if (ref2R.status !== 0) return codes.blocked
      ref = ref2R.stdout

      const commit2R = await unchecked(() =>
        reqLib('bp_build_request "$1" "$2" "$3" "$4" "${@:5}"', [bare, base2, ref, projName, ...kept]),
      )
      if (commit2R.status !== 0) return codes.failed
      commit = commit2R.stdout

      const tip2 = await bpFileRemoteTip(cfg.remote, cfg.branch)
      if (tip2 && tip2 !== base2) {
        process.stdout.write(`${C_RED}✗ The blueprint moved again. Re-run when it settles.${C_RESET}\n`)
        return codes.failed
      }
    }

    const pushed = await bpFilePush(bare, cfg.remote, ref, commit)
    if (!pushed) return codes.failed
    process.stdout.write(`${C_GREEN}✓ pushed ${ref}${C_RESET}\n`)

    const slug = slugFromRemote(cfg.remote)

    if (!commandExists('gh')) {
      process.stdout.write(`${C_YELLOW}gh is not installed — the branch is pushed but no PR was opened.${C_RESET}\n`)
      process.stdout.write(`  ${C_DIM}Open one from ${ref} against ${cfg.branch}.${C_RESET}\n`)
      return codes.failed
    }

    const existing = await bpFileExistingPr(slug, ref)
    if (existing && existing !== '\t' && existing !== 'null\tnull' && !existing.startsWith('null\t')) {
      const tabIdx = existing.indexOf('\t')
      const state = tabIdx === -1 ? existing : existing.slice(0, tabIdx)
      const url = tabIdx === -1 ? '' : existing.slice(tabIdx + 1)
      if (state === 'CLOSED' || state === 'MERGED') {
        process.stdout.write(`${C_YELLOW}A PR for this exact request already exists and is ${state}:${C_RESET}\n`)
        process.stdout.write(`  ${url}\n`)
        process.stdout.write(`  ${C_DIM}Not re-filing. If the decision should be revisited, say so there.${C_RESET}\n`)
        return codes.pending
      }
      process.stdout.write(`${C_GREEN}✓ request already open:${C_RESET} ${url}\n`)
      return codes.pending
    }

    const bodyText = await bpFilePrBody(projName, base, cfg.remote, cfg.branch, unshippedPaths, kept)
    const createR = await unchecked(() => ghPrCreate(slug, cfg.branch, ref, `a2bp: ${kept.length} file(s) from ${projName}`, bodyText))
    if (createR.status !== 0) {
      process.stdout.write(`${C_YELLOW}The branch is pushed, but opening the PR failed:${C_RESET}\n`)
      process.stdout.write(
        createR.stdout
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n') + '\n',
      )
      process.stdout.write(`  ${C_DIM}Open one by hand from ${ref}, or re-run — the branch will be adopted.${C_RESET}\n`)
      return codes.failed
    }
    const url = createR.stdout
    if (!/^https:\/\/[^ ]*\/pulls?\//.test(url)) {
      process.stdout.write(`${C_YELLOW}gh reported success but returned no usable PR URL:${C_RESET}\n`)
      process.stdout.write(`  ${url || '<empty>'}\n`)
      process.stdout.write(`  ${C_DIM}The branch is pushed. Open a PR from ${ref} against ${cfg.branch}.${C_RESET}\n`)
      return codes.failed
    }

    process.stdout.write(`${C_GREEN}✓ request filed:${C_RESET} ${url}\n\n`)
    process.stdout.write(`${C_BOLD}This is a REQUEST, not a delivery.${C_RESET}\n`)
    process.stdout.write(`${C_DIM}  The blueprint owner implements it upstream — merging as-is, adapting,${C_RESET}\n`)
    process.stdout.write(`${C_DIM}  or rewriting — and decides which ripples travel with it. Merging as-is${C_RESET}\n`)
    process.stdout.write(`${C_DIM}  is legitimate BECAUSE someone judged it trivial; that judgement is the${C_RESET}\n`)
    process.stdout.write(`${C_DIM}  step that must not be skipped.${C_RESET}\n`)
    return codes.pending
  } finally {
    await cleanup()
  }
}

// --- Subcommand: prs (scripts/blueprint:2160-2229) --------------------------
//
// Sources ONLY request-config.sh, exactly as the shell does — never
// request.sh. The orphan-branches section below calls
// `bp_request_transport_env`, which only request.sh defines: with request.sh
// unsourced that call is "command not found" (127), `2>/dev/null` hides the
// message, `|| true` hides the status, and the listing never prints. That is
// dead code in the real CLI today (plan §3 P5), and this reproduces it byte
// for byte by never attempting the call at all, which is observably identical
// to attempting it and having it silently fail.
async function cmdPrs(): Promise<number> {
  const cfgLib = join(libDir(), 'request-config.sh')
  if (!isReadable(cfgLib)) return die('scripts/lib/request-config.sh is missing')

  const cfg = await bpConfigLoad('.blueprint-source')
  if (!cfg) return 1

  const slug = slugFromRemote(cfg.remote)

  if (!commandExists('gh')) return die('gh is not installed — cannot list requests')

  process.stdout.write(`${C_BOLD}Open a2bp requests on ${slug}${C_RESET}\n\n`)

  const prsR = await unchecked(() =>
    run(
      'gh',
      [
        'pr',
        'list',
        '--repo',
        slug,
        '--state',
        'open',
        '--limit',
        '100',
        '--json',
        'number,headRefName,title,createdAt,isDraft,url',
        '--jq',
        // Byte-identical to the shell CLI's own `--jq '...'` argument
        // (scripts/blueprint:2184-2185), embedded newline and 14-space
        // indent included: the real script's single-quoted string spans two
        // source lines for readability, and bash passes that literal
        // whitespace through to gh's argv unchanged. jq itself does not
        // care (it ignores insignificant whitespace in a filter), but the
        // exact bytes are what TASK-081's differential harness compares in
        // the gh-argv log (plan §5), so the port matches them rather than
        // reformatting.
        '.[] | select(.headRefName | startswith("a2bp/")) |\n              "\\(.number)\\t\\(.headRefName)\\t\\(.createdAt)\\t\\(.isDraft)\\t\\(.url)"',
      ],
      { stdout: 'capture', stderr: 'ignore' },
    ),
  )
  if (prsR.status !== 0) {
    process.stdout.write(`${C_RED}✗ Could not query GitHub — this list is INCOMPLETE, not empty.${C_RESET}\n`)
    return 1
  }
  const prs = stripTrailingNewlines(prsR.stdout)

  if (!prs) {
    process.stdout.write(`${C_DIM}No open a2bp requests.${C_RESET}\n`)
  } else {
    for (const line of nonEmptyLines(prs)) {
      const [num, ref, created, draft, url] = line.split('\t')
      if (!num) continue
      const project = (ref ?? '').split('/')[1] ?? ''
      process.stdout.write(`  #${num.padEnd(5)} ${project.padEnd(20)} ${(created ?? '').split('T')[0] ?? ''}`)
      if (draft === 'true') process.stdout.write(`  ${C_YELLOW}[draft]${C_RESET}`)
      process.stdout.write(`\n    ${C_DIM}${url ?? ''}${C_RESET}\n`)
    }
  }

  // Dead code, reproduced by omission — see the function comment above.
  process.stdout.write('\n')
  return 0
}

// --- dispatch ---------------------------------------------------------------
export async function main(argv: readonly string[]): Promise<number> {
  const [subcmdRaw, ...rest] = argv
  const subcmd = subcmdRaw ?? 'help'
  switch (subcmd) {
    case 'files':
    case 'list':
      await cmdFiles()
      return 0
    case 'drift':
      return await cmdDrift()
    case 'pull':
      return await cmdPull(rest)
    case 'a2bp':
      return await cmdA2bp(rest)
    case 'prs':
      return await cmdPrs()
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP_TEXT)
      return 0
    case 'push':
      return die(
        "'blueprint push' is gone: a2bp files a REQUEST against the blueprint remote, it does not push into " +
          "the blueprint. Use 'blueprint a2bp FILE...'",
      )
    default: {
      return die(`unknown subcommand: ${subcmd} (try 'blueprint help')`)
    }
  }
}

// --- entry point (scripts/shell-inventory-check.mts's own guard shape) -----
function safeRealpath(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    // Absent or unreadable: fall back to the raw path, the same degrade
    // shell-inventory-check.mts's own guard already relies on.
    return p
  }
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  (safeRealpath(process.argv[1]) === safeRealpath(fileURLToPath(import.meta.url)) ||
    process.argv[1].endsWith('/scripts/blueprint.mts'))

if (isEntryPoint) {
  // bpSyncCleanup no-ops when nothing was ever fetched, so installing it
  // unconditionally (rather than slice 1's no-op) is correct for every
  // subcommand: a real signal during or after the P1 fetch now cleans up the
  // GO token, the fetch child, the run ref and the scratch directory exactly
  // where bash's EXIT/INT/TERM traps would (plan §3 P1).
  installSignals(bpSyncCleanup)
  main(process.argv.slice(2))
    .then(async (code) => {
      await bpSyncCleanup()
      process.exitCode = code
    })
    .catch(async (err: unknown) => {
      await bpSyncCleanup()
      if (err instanceof ExitStatusError) {
        process.exitCode = err.status
        return
      }
      if (err instanceof CommandFailedError) {
        process.exitCode = err.result.status
        return
      }
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
      process.exitCode = 1
    })
}
