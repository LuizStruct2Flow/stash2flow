/**
 * tests/sync-by-address/sync-by-address.spec.ts — TASK-025: `drift` and `pull`
 * read the blueprint by its ADDRESS.
 *
 * Parallelism class: serial-global. Every case owns a scenario workspace, its
 * own fixture remote, its own HOME and therefore its own blueprint cache.
 *
 * THE DEFECT. `drift` and `pull` read a LOCAL checkout: `$BLUEPRINT_ROOT`, else
 * `blueprint_source`, else the checkout the running CLI lives in. So a project
 * reported against whatever that folder held — a stale sibling, or unpushed
 * commits nobody else could see. On 2026-09-14 the blueprint checkout was ahead
 * of its remote and every derived project was reporting against the unpushed
 * commits; a `pull` at that moment would have recorded an unpushed SHA in
 * `bootstrap_sha` (PLAN-TASK-025 §0.2 #4).
 *
 * THE CLI UNDER TEST IS A COPY, placed in a workspace directory that is not a
 * blueprint. Not decoration: the CLI in REPO_ROOT lives inside a real blueprint
 * checkout, so any code path that falls back to "the checkout the CLI runs from"
 * — the parent commit, or a mutant restoring it — would compare against the
 * operator's real tree and probe its real `origin` over the network. A copy
 * keeps every run, red or green, inside the workspace. #13 places its copy
 * inside a FIXTURE checkout on purpose, because that fallback is its subject.
 *
 * NO NETWORK. Remotes are workspace paths, or `ssh://git@127.0.0.1/…` behind an
 * `ssh` shim. The harness scrubs GIT_SSH_COMMAND and GIT_SSH (H5), so the shim is
 * the ssh git runs, not merely the first one on PATH.
 *
 * SIGNAL SEAMS, deterministic and sleep-free (R4). A shim opens its FIFO
 * read-write (which never blocks), writes a `reached` marker, then blocks reading
 * a line. The case waits for the marker, sends the signal, then writes the line
 * so the shim returns. Opening read-write BEFORE the marker is what makes the
 * release race-free: a release that finds no reader means the shim is already
 * gone, never "not yet there".
 *
 * REPRODUCER RECORD — observed on the reproducer commit, before the CLI change:
 *
 *   #1   rc=1 with NO message. `.blueprint-source` has no `blueprint_source`
 *        line, and `grep '^blueprint_source' | cut | xargs` under `pipefail`
 *        kills the CLI through `set -e` before it prints anything. A project
 *        that deletes the field today gets a silent exit 1 from drift and pull.
 *   #2   rc=128. It read the stale sibling (header `blueprint: …/sibling`),
 *        whose history lacks the project's bootstrap_sha, and `git log` failed.
 *   #3   rc=1, the same silent death as #1, where 5 is required.
 *   #13  rc=1, the same silent death as #1. The fallback this case exists for
 *        (the checkout the CLI runs from) is shown red by its mutant instead.
 *
 * MUTATION RECORD (R6) — each mutant applied alone to scripts/blueprint (M8 to
 * scripts/lib/request-config.sh), this suite run, the file restored. OBSERVED:
 *
 *   M1   fall back to the checkout the CLI runs from    → #12 #13
 *        #1 cannot see it BY ITS PREMISE: it has no checkout to fall back to,
 *        and giving it one would make it #13. #1's own red is M1h.
 *   M1h  drift's header omits the fetched SHA            → #1 #2 #5 #13 #15 #19 #24 #26 #27b
 *   M2   blueprint_source takes precedence again         → #2 #29
 *   M3   `wait … || true` (a failed fetch ignored)       → #3 #4 #16 — each still exits 5,
 *        through the damaged-cache check, so they catch it on the MESSAGE.
 *   M4   no `timeout` around the fetch                   → #4
 *   M5   answer from the cache without refreshing        → #5 #24 #25 #26 #27b
 *   M6   the BLUEPRINT_ROOT override ignored             → #6 #7 #12
 *   M7   a refused config infers the remote from origin  → #7 #8
 *   M8   request-config.sh's placeholder arm removed     → #8
 *   M9   bootstrap_sha recorded as a short SHA           → #9
 *   M9b  drift compares the raw blueprint copy           → #1 #2 #5 #6 #7 #9b #13 #14 #15 #19 #26 #27b
 *   M11  cleanup keeps the per-run ref                   → #11 #21 #22 #23 #24 #28
 *   M12  the network libs sourced unconditionally        → #12
 *   M14  an absent bootstrap_sha printed as "? commits"  → #14
 *   M15  git on the cache run without the transport scrub → #15
 *   M16  fetch the remote's HEAD instead of the branch   → #16
 *   M17  run the fetch unbounded when no provider exists → #17
 *   M18  scratch falls back to $PWD                      → #18
 *   M19  the tree resolved with `rev-parse --show-toplevel` from scratch
 *                                                        → 20 cases, #19 among them
 *   M20  revision 1's trap: `trap cleanup EXIT INT TERM` → #20 #21 #22 #23
 *   M20b cleanup kills only the refresh subshell         → #20 (on its bound: the
 *        orphaned fetch held the run's output for the whole 30 s budget).
 *        Superseded by the launch fix below: there is no subshell to kill.
 *   F1   the fetch launched as a shell function, cleanup by `pkill -P`
 *        (the launch before the implementation review)   → #20b
 *   F1b  the function launch with a plain `kill $!`      → #20 #20b
 *   M22b the handler installed after the refresh         → #11 #20 — NOT #22: the
 *        write step comes after the refresh either way, so only a signal at the
 *        fetch can see where the handler went in.
 *   M23a no shield on the writer                         → #23 #23b #23c
 *   M23b the shield ignores INT only                     → #23 (the TERM run) #23b #23c
 *   M23c the redirect outside the shielding subshell     → #23b only. No runtime
 *        case can see it: the window between the parent opening the file and
 *        the child ignoring the signals is microseconds wide and runs no
 *        command, so #23b asserts the helper's text instead.
 *   F2   the exec bit mirrored after the shielded write  → #23c (mode left 644)
 *
 *   COMMIT 3 (the released branch), same method, same copy discipline:
 *   R30a drift and pull read blueprint_branch regardless → #30 #32 #39
 *   R30b blueprint_release_branch not validated         → #30
 *   R31  bp_config_load emits the release branch as BP_CFG_BRANCH → #31. One
 *        full-set run also showed #20c red; re-run alone the mutant reddened #31
 *        only, and #20c does not read that value. Recorded as an intermittent
 *        #20c failure, not as a red of this mutant.
 *   R32  an absent bootstrap_sha printed as "? commits" → #14 #32
 *   R33a a job left out of the release job's `needs`   → #33
 *   R33b the push-event condition dropped               → #33
 *   R33c contents: write granted to the whole workflow  → #33
 *   R33d `shell: bash` dropped                          → #33
 *   R33e the release push forced                        → #33b
 *   R33f the ancestry check replaced by `true`          → #33b
 *   R33g `refs/remotes/origin/main` pushed instead of the tested SHA → #33b
 *   R33h revision 4's `origin/released` instead of FETCH_HEAD → #33b
 *   R39  the rollback does not restore the workflow     → #39
 *   M24  cleanup deletes the cache                       → #5 #11 #26 #27a #27b #28 #28b —
 *        NOT #24: run A reads its history BEFORE it blocks in compare, so a
 *        deleted cache behind it changes nothing it prints. #24's reds are
 *        M5 M11 M26.
 *   M25  a failed refresh answers from the last tip      → #25
 *   M26  read the first bp-run ref instead of this run's → #24 #26 #28
 *   M27a a failed tree build ignored                     → #27a
 *   M27b any fetch stderr treated as corruption          → #27b
 *   M28b the nested init temp not removed                → #28b (#28 is the smoke
 *        partner and is not mutant-deterministic)
 *   M29  no warning on the override path                 → #29
 *
 *   BUG-120 (#20c revised, #20d, #20e), observed on a copy (.scratch/b120/mutants120.py):
 *     the CLI before the fix (no token gate) → #20d, red 10/10 pinned, every run
 *       sitting out the 3 s budget (3010–3027 ms)
 *     the gate never checks the token        → #20d #20e
 *     token revoked AFTER the TERM           → #20e
 *     token revoked with a forking `rm -f`   → #20e; as the fix's first version,
 *       it also left #20d 7/50 and #20c 2/50 red pinned
 *     no token written                       → every case that fetches (fails
 *       closed: no refresh runs at all)
 *   The two ordering mutants go red only in #20e: no timed case holds the
 *   microseconds they move.
 *   STRESS AFTER THE FIX, one vitest process per run, pinned with `taskset -c N`:
 *     #20c 50/50 green, #20d 50/50 green; unpinned #20c 50/50 green.
 *   Before it, #20c pinned was red 40/40 on an unmodified copy of the tree.
 *
 *   M16 onward were run against a COPY of the tree, not this checkout: every
 *   derived project on the machine runs this checkout's scripts/blueprint
 *   through the per-machine command, and a mutant there is a broken tool for
 *   them. REPO_ROOT follows the harness's own location, so the copy is enough.
 *
 * #16b (Alexey, c3-4 review #5), observed on a copy (.scratch/c025/mutants9.py
 * set9b): the read falls back to blueprint_branch when the release branch is
 * missing → #16b. It also reddens #4, #20, #20b and #20c, whose remotes the
 * mutant's extra ls-remote hangs on or cannot reach.
 *
 * TASK-081 slice 0 (PLAN-TASK-081-blueprint-port.md §3 P2, §8): #23b is
 * rewritten from a structural read of `_bp_shielded_write`'s TEXT to a
 * behavioural case — a `cp -p` seam, group-signalled, asserting DEST ends
 * with the blueprint's NEW bytes and mode. "The file is complete" (the old
 * #23 shape) passes on a shield that dies at `cp` under a temp-and-rename
 * write, because the OLD file is what's left complete; only "DEST holds the
 * NEW content" catches it. The M23c note above (the redirect-outside-subshell
 * mutant, invisible to any runtime case) describes the helper's shape before
 * TASK-025's S1-S2 review moved it to temp-and-rename entirely inside the
 * ignore; it is kept as history, not as this test's current proof.
 *
 * Plan: docs/done/PLAN-TASK-025.md §9.2.
 */

import { describe, it, expect, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import {
  closeSync,
  constants,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { chmod, cp, mkdir, readFile, readdir, rename, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { notGithubActions, skipVisibly } from '../helpers/project-config.js'
import { parseDocument } from 'yaml'
import { bpSyncCleanup, _setSyncStateForTests } from '../../scripts/blueprint.mts'

const BLACKHOLE = 'ssh://git@127.0.0.1/blackhole.git'
const WARNING =
  'warning: .blueprint-source still has blueprint_source, which is no longer read. ' +
  'The blueprint is read from blueprint_remote (TASK-025). Delete the blueprint_source line.'

async function git(s: Scenario, cwd: string, args: string[]) {
  const r = await s.run('git', args, { cwd })
  expect(r.code, `git ${args.join(' ')} failed in ${cwd}:\n${r.output}`).toBe(0)
  return r.stdout.trim()
}

async function initRepo(s: Scenario, dir: string) {
  await git(s, dir, ['init', '-q', '-b', 'main', '.'])
  await git(s, dir, ['config', 'user.email', 't@local'])
  await git(s, dir, ['config', 'user.name', 't'])
  await git(s, dir, ['config', 'commit.gpgsign', 'false'])
}

async function commitAll(s: Scenario, dir: string, message: string) {
  await git(s, dir, ['add', '-A'])
  await git(s, dir, ['commit', '-q', '-m', message])
  return git(s, dir, ['rev-parse', 'HEAD'])
}

/**
 * Copy the CLI and its libs to `<at>/scripts/`. Returns the CLI's path. Run it
 * as `node <path>` (the .mts has no exec bit).
 */
async function cliCopy(s: Scenario, at: string): Promise<string> {
  const dest = s.workspace.path(at, 'scripts')
  await cp(join(REPO_ROOT, 'scripts'), dest, { recursive: true })
  return join(dest, 'blueprint.mts')
}

const dodText = (who: string, line: string) => `# DoD\nowner ${who}\n${line}\n`

/**
 * A fixture blueprint that serves as the REMOTE. A plain working repository: git
 * fetches from a path as readily as from a bare one, and a working tree lets a
 * case advance it with an ordinary commit.
 *
 * `tests/fixture/test.sh` is mandatory: `tests/` is a managed directory whose
 * expansion is fail-closed (BUG-029).
 */
async function blueprintRemote(s: Scenario, dod = 'published', name = 'remote') {
  const dir = await s.workspace.dir(name)
  await s.fs.write(join(dir, 'CLAUDE.md'), '# CLAUDE\nfor {{PROJECT_NAME}}\n')
  await s.fs.write(join(dir, 'docs/DoD.md'), dodText('{{PROJECT_NAME}}', dod))
  await s.fs.write(join(dir, 'tests/fixture/test.sh'), 'echo fixture\n')
  await initRepo(s, dir)
  const head = await commitAll(s, dir, 'base')
  return { dir, head }
}

/** Advance a fixture repository by rewriting its DoD. Returns the new HEAD. */
async function advance(s: Scenario, dir: string, dod: string) {
  await s.fs.write(join(dir, 'docs/DoD.md'), dodText('{{PROJECT_NAME}}', dod))
  return commitAll(s, dir, dod)
}

interface ProjectOptions {
  /** Lines appended to the config. */
  extra?: string[]
  /** Parent directory, so one scenario can hold several projects named `proj`. */
  tag?: string
  branch?: string
}

/**
 * A derived project named `proj` (the basename IS {{PROJECT_NAME}}), whose DoD
 * carries `dod` already substituted.
 */
async function project(s: Scenario, remote: string, sha: string, dod: string, o: ProjectOptions = {}) {
  const dir = await s.workspace.dir(o.tag ?? 'p', 'proj')
  await s.fs.write(join(dir, 'CLAUDE.md'), '# CLAUDE\nfor proj\n')
  await s.fs.write(join(dir, 'docs/DoD.md'), dodText('proj', dod))
  await s.fs.write(join(dir, 'tests/fixture/test.sh'), 'echo fixture\n')
  await s.fs.write(
    join(dir, '.blueprint-source'),
    [
      'config_version   = 2',
      `blueprint_remote = ${remote}`,
      `blueprint_branch = ${o.branch ?? 'main'}`,
      `bootstrap_sha    = ${sha}`,
      'bootstrap_date   = 2026-01-01',
      ...(o.extra ?? []),
      '',
    ].join('\n'),
  )
  await initRepo(s, dir)
  await commitAll(s, dir, 'init')
  return dir
}

/** Run a CLI copy in the project. */
function run(s: Scenario, cli: string, proj: string, args: string[], env: Record<string, string> = {}) {
  return s.run('node', [cli, ...args], { cwd: proj, env, timeoutMs: 60_000 })
}

/**
 * The report's per-file lines for one list. `!` (missing in the blueprint) is
 * what a mis-resolved blueprint produces, so the lists are never read as one.
 */
function marked(output: string, mark: '~' | '+' | '!'): string[] {
  return output
    .split('\n')
    .filter((l) => l.trimStart().startsWith(mark + ' '))
    .map((l) => l.trim().slice(2).trim())
}

/** The fixture files; the real MANAGED_FILES names ~70 others a fixture lacks. */
const FIXTURE_FILES = ['CLAUDE.md', 'docs/DoD.md', 'tests/fixture/test.sh']

function fixtureMarked(output: string, mark: '~' | '+' | '!'): string[] {
  return marked(output, mark).filter((p) => FIXTURE_FILES.includes(p))
}

const fetched = (sha: string) => new RegExp(`fetched:\\s+${sha}\\s+at\\s+\\S+`)

/**
 * A failure must not LOOK like a report, on either stream: no clean mark, and no
 * per-file line a reader could take as the answer (PLAN §9.2 preamble).
 */
function expectNoReport(r: { stdout: string; stderr: string }) {
  for (const [name, text] of [
    ['stdout', r.stdout],
    ['stderr', r.stderr],
  ] as const) {
    expect(text, `${name} carries the clean mark on a failed read`).not.toContain(
      '✓ All blueprint-managed files match',
    )
    for (const mark of ['~', '+', '!'] as const) {
      expect(marked(text, mark), `${name} carries '${mark}' report lines on a failed read`).toEqual([])
    }
  }
}

// --- the cache and the scratch, as a case observes them ---------------------

const cacheRoot = (s: Scenario) => join(s.home, '.cache', 'struct2flow')

async function caches(s: Scenario): Promise<string[]> {
  const names = await readdir(cacheRoot(s)).catch(() => [] as string[])
  return names.filter((n) => n.startsWith('blueprint-') && n.endsWith('.git')).map((n) => join(cacheRoot(s), n))
}

async function onlyCache(s: Scenario): Promise<string> {
  const all = await caches(s)
  expect(all, 'expected exactly one blueprint cache').toHaveLength(1)
  return all[0] ?? ''
}

async function runRefs(s: Scenario, cache: string): Promise<string[]> {
  const r = await s.run('git', ['--git-dir', cache, 'for-each-ref', '--format=%(refname)', 'refs/bp-run/'], {
    cwd: s.workspace.root,
  })
  expect(r.code, r.output).toBe(0)
  return r.stdout.split('\n').filter(Boolean)
}

async function scratchLeft(s: Scenario): Promise<string[]> {
  const names = await readdir(s.workspace.path('tmp')).catch(() => [] as string[])
  return names.filter((n) => n.startsWith('blueprint-sync.'))
}

/** No scratch under TMPDIR and no per-run ref in any cache. */
async function expectNothingLeft(s: Scenario, label: string) {
  expect(await scratchLeft(s), `${label}: scratch left under TMPDIR`).toEqual([])
  for (const c of await caches(s)) {
    expect(await runRefs(s, c), `${label}: a per-run ref survived in ${c}`).toEqual([])
  }
}

const WATCHED = ['CLAUDE.md', 'docs/DoD.md', '.blueprint-source']

async function snapshot(dir: string): Promise<string[]> {
  return Promise.all(WATCHED.map((f) => readFile(join(dir, f), 'utf8').catch(() => '<absent>')))
}

// --- seams ------------------------------------------------------------------

interface Seam {
  path: string
  /** The shim directory alone, to put two seams on one PATH. */
  dir: string
  marker: string
  fifo: string
}

/**
 * A `tool` shim that blocks once, the first time `when` holds, then behaves as
 * the real tool (`ssh` exits 255 instead: there is no real one to reach).
 */
async function seam(s: Scenario, name: string, tool: string, when = 'true'): Promise<Seam> {
  const dirName = `seam-${name}`
  const shims = await s.shimDir(dirName)
  const marker = s.workspace.path(dirName, 'reached')
  const fifo = s.workspace.path(dirName, 'release.fifo')
  const mk = await s.run('mkfifo', [fifo], { cwd: s.workspace.root })
  expect(mk.code, `mkfifo failed, so the seam would not block:\n${mk.output}`).toBe(0)

  let tail = 'exit 255'
  if (tool !== 'ssh') {
    const found = await s.run('sh', ['-c', `command -v ${tool}`], { cwd: s.workspace.root })
    const real = found.stdout.trim()
    expect(real, `no real ${tool} to hand over to`).not.toBe('')
    tail = `exec '${real}' "$@"`
  }
  await shims.add(
    tool,
    `if [ ! -e '${marker}' ] && ${when}; then\n` +
      `  exec 3<>'${fifo}'\n` +
      `  : > '${marker}'\n` +
      `  read -r _ <&3\n` +
      `  exec 3<&-\n` +
      `fi\n` +
      tail,
  )
  return { path: shims.path(), dir: shims.dir, marker, fifo }
}

/** The command names of a process's direct children. */
async function childNames(s: Scenario, pid: number): Promise<string[]> {
  const listed = await s.run('pgrep', ['-P', String(pid)], { cwd: s.workspace.root })
  const names: string[] = []
  for (const kid of listed.stdout.split('\n').filter(Boolean)) {
    const ps = await s.run('ps', ['-o', 'comm=', '-p', kid], { cwd: s.workspace.root })
    if (ps.stdout.trim()) names.push(ps.stdout.trim())
  }
  return names.sort()
}

/**
 * TASK-081 §3 P1: the refresh child's identity is process comm `bash` on the
 * shell CLI, and will be `sh` under the port's `spawn` launch (§3 P1: `sh -c
 * 'exec 2>"$1"; …'`, no bash in the chain). Widened here so slice 0's tests
 * stay green on both, ahead of any port code existing.
 */
const isRefreshChild = (names: string[]) => names.includes('bash') || names.includes('sh')

async function reached(seam: Seam) {
  await vi.waitFor(
    () => {
      if (!existsSync(seam.marker)) throw new Error(`the seam was never reached: ${seam.marker}`)
    },
    { timeout: 60_000, interval: 10 },
  )
}

/** Let a blocked shim return. A shim that is already gone has no reader: fine. */
function release(seam: Seam) {
  let fd: number
  try {
    fd = openSync(seam.fifo, constants.O_WRONLY | constants.O_NONBLOCK)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENXIO') return
    throw err
  }
  try {
    writeSync(fd, 'go\n')
  } finally {
    closeSync(fd)
  }
}

/**
 * BUG-120 — wait until the run's cleanup has revoked the refresh token (emptied
 * or removed with its scratch). Without the token (the CLI before BUG-120's fix)
 * this returns at once, so the release is as immediate as it always was.
 */
async function revoked(token: string) {
  await vi.waitFor(
    () => {
      if (existsSync(token) && statSync(token).size > 0) throw new Error(`the token is not revoked yet: ${token}`)
    },
    { timeout: 60_000, interval: 1 },
  )
}

/** A FIFO's read end, or null when cleanup has already removed it with its scratch. */
function openReader(fifo: string): number | null {
  try {
    return openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

interface Done {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

function start(s: Scenario, cli: string, proj: string, args: string[], env: Record<string, string>) {
  const child: ChildProcess = s.background('node', [cli, ...args], { cwd: proj, env })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (d: Buffer) => {
    stdout += d.toString('utf8')
  })
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString('utf8')
  })
  const done = new Promise<Done>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
  return { child, done }
}

type Sig = 'SIGINT' | 'SIGTERM'
const SIGNALS: Sig[] = ['SIGINT', 'SIGTERM']

function diedOf(d: Done, sig: Sig): boolean {
  return d.signal === sig || d.code === (sig === 'SIGINT' ? 130 : 143)
}

const show = (d: Done) => `code=${d.code} signal=${d.signal}\n${d.stdout}${d.stderr}`

// --- the release job (PLAN §7.4) ---------------------------------------------

interface WfStep {
  name?: string
  run?: string
  shell?: string
}
interface WfJob {
  if?: string
  needs?: string[] | string
  permissions?: Record<string, string>
  steps?: WfStep[]
}
interface Workflow {
  permissions?: unknown
  jobs?: Record<string, WfJob>
}

/** The job and step that publish `released`, found by what the step does. */
function releaseOf(text: string) {
  const wf = parseDocument(text).toJS() as Workflow
  for (const [id, job] of Object.entries(wf.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (typeof step.run === 'string' && step.run.includes('refs/heads/released')) {
        return { wf, id, job, step }
      }
    }
  }
  return null
}

/** Run a release block the way a `shell: bash` step runs, with GITHUB_SHA set. */
async function runReleaseBlock(s: Scenario, block: string, work: string, sha: string, tag: string) {
  const file = await s.fs.write(`release-${tag}.sh`, block)
  return s.run('bash', ['--noprofile', '--norc', '-eo', 'pipefail', file], {
    cwd: work,
    env: { GITHUB_SHA: sha },
  })
}

async function bareRef(s: Scenario, bare: string, ref: string): Promise<string> {
  const r = await s.run('git', ['--git-dir', bare, 'rev-parse', '-q', '--verify', ref], { cwd: s.workspace.root })
  return r.code === 0 ? r.stdout.trim() : ''
}

const MINIMAL_WORKFLOW = [
  'name: security',
  'on:',
  '  push:',
  '    branches: [main]',
  'jobs:',
  '  noop:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: "true"',
  '',
].join('\n')

describe('TASK-025 — drift and pull read the blueprint by its address', () => {
  it('#1 drift reads the remote when NO local checkout exists, and says which commit it read', async () => {
    await scenario('sync-by-address-1', async (s) => {
      const remote = await blueprintRemote(s, 'published')
      // The project is behind on exactly one file, so "the report matches the
      // remote" is a claim about content and not merely an exit status.
      const proj = await project(s, remote.dir, remote.head, 'OLD')
      const cli = await cliCopy(s, 'cli')

      const r = await run(s, cli, proj, ['drift'])

      expect(r.code, r.output).toBe(0)
      expect(r.stdout, 'the header does not name the remote and its branch').toContain(
        `blueprint:  ${remote.dir}  (main)`,
      )
      expect(r.stdout, 'the header does not name the full fetched SHA').toMatch(fetched(remote.head))
      expect(fixtureMarked(r.output, '!'), r.output).toEqual([])
      expect(fixtureMarked(r.output, '~'), r.output).toEqual(['docs/DoD.md'])
    })
  })

  it('#2 a stale sibling named by blueprint_source is NOT consulted', async () => {
    await scenario('sync-by-address-2', async (s) => {
      const remote = await blueprintRemote(s, 'v1')
      const sibling = s.workspace.path('sibling')
      await git(s, s.workspace.root, ['clone', '-q', remote.dir, sibling])
      // The remote moves on; the sibling does not. The project matches the tip.
      const tip = await advance(s, remote.dir, 'v2')
      const proj = await project(s, remote.dir, tip, 'v2', { extra: [`blueprint_source = ${sibling}`] })
      const cli = await cliCopy(s, 'cli')

      const r = await run(s, cli, proj, ['drift'])

      expect(r.code, r.output).toBe(0)
      expect(
        fixtureMarked(r.output, '~'),
        'drift reported DoD drifted: it compared against the stale sibling, not the remote',
      ).toEqual([])
      expect(r.stdout).toMatch(fetched(tip))
      expect(r.stdout, 'the header names the sibling').not.toContain(`blueprint:  ${sibling}`)
    })
  })

  it('#3 an unreachable remote exits 5, says so, and produces nothing that reads as a report', async () => {
    await scenario('sync-by-address-3', async (s) => {
      const proj = await project(s, s.workspace.path('no-such-remote'), 'no-sha', 'OLD')
      const cli = await cliCopy(s, 'cli')

      const r = await run(s, cli, proj, ['drift'])

      expect(r.code, r.output).toBe(5)
      expect(r.stderr, r.output).toContain('could not read the blueprint')
      expect(r.stderr, r.output).toContain('NOT a clean drift report')
      // The cause is the transport's, not a misdiagnosis: an ignored fetch
      // failure would also end in 5, through the damaged-cache check, and would
      // send the operator to delete a healthy cache.
      expect(r.stderr, r.output).not.toContain('is damaged')
      expectNoReport(r)
    })
  })

  it('#4 a HUNG remote is cut off at the fetch budget and exits 5, naming the timeout', async () => {
    await scenario('sync-by-address-4', async (s) => {
      // serial-timing. The ssh shim accepts the connection and never answers,
      // which is the condition; `timeout` is what ends it.
      const hole = await seam(s, 'hung', 'ssh')
      const proj = await project(s, BLACKHOLE, 'no-sha', 'OLD')
      const cli = await cliCopy(s, 'cli')

      const began = Date.now()
      const r = await run(s, cli, proj, ['drift'], { PATH: hole.path, BP_FETCH_TIMEOUT: '2' })
      const elapsed = Date.now() - began

      expect(r.code, r.output).toBe(5)
      expect(r.stderr, r.output).toContain('timed out after 2s')
      expect(elapsed, `a hung remote held drift for ${elapsed}ms`).toBeLessThan(20_000)
      expectNoReport(r)
    })
  })

  it('#5 the remote advances between two runs sharing one cache: run 2 answers from the new tip', async () => {
    await scenario('sync-by-address-5', async (s) => {
      const remote = await blueprintRemote(s, 'v1')
      const proj = await project(s, remote.dir, remote.head, 'v1')
      const cli = await cliCopy(s, 'cli')

      const first = await run(s, cli, proj, ['drift'])
      expect(first.code, first.output).toBe(0)
      expect(fixtureMarked(first.output, '~'), first.output).toEqual([])

      const tip = await advance(s, remote.dir, 'v2')
      const second = await run(s, cli, proj, ['drift'])

      expect(second.code, second.output).toBe(0)
      expect(second.stdout, 'run 2 answered from what the cache already held').toMatch(fetched(tip))
      expect(fixtureMarked(second.output, '~'), second.output).toEqual(['docs/DoD.md'])
      expect(await caches(s), 'the second run built a second cache instead of refreshing').toHaveLength(1)
    })
  })

  it('#6 the BLUEPRINT_ROOT override works offline, says it is local, and touches no cache', async () => {
    await scenario('sync-by-address-6', async (s) => {
      const local = await blueprintRemote(s, 'published', 'local-checkout')
      const proj = await project(s, s.workspace.path('no-such-remote'), local.head, 'OLD')
      const cli = await cliCopy(s, 'cli')

      const r = await run(s, cli, proj, ['drift'], { BLUEPRINT_ROOT: local.dir })

      expect(r.code, r.output).toBe(0)
      expect(r.stdout).toContain(`LOCAL CHECKOUT ${local.dir}`)
      expect(r.stdout).toContain('BLUEPRINT_ROOT override')
      // A local checkout is exactly where staleness means something.
      expect(r.stdout, 'the override path lost its staleness line').toMatch(/staleness unknown|local checkout is/)
      expect(fixtureMarked(r.output, '~'), r.output).toEqual(['docs/DoD.md'])
      expect(existsSync(cacheRoot(s)), 'the override path created a cache anyway').toBe(false)
    })
  })

  it('#7 a version 1 config exits 4 and names the override; with BLUEPRINT_ROOT it reports', async () => {
    await scenario('sync-by-address-7', async (s) => {
      const remote = await blueprintRemote(s, 'published')
      const proj = await project(s, remote.dir, remote.head, 'OLD')
      await s.fs.write(join(proj, '.blueprint-source'), `bootstrap_sha    = ${remote.head}\nbootstrap_date   = x\n`)
      // An `origin` that WOULD answer, so "the remote is never inferred from it"
      // is an observation rather than true for want of anything to infer from.
      await git(s, proj, ['remote', 'add', 'origin', remote.dir])
      const cli = await cliCopy(s, 'cli')

      const refused = await run(s, cli, proj, ['drift'])
      expect(refused.code, refused.output).toBe(4)
      expect(refused.stderr).toContain('version 1 config')
      expect(refused.stderr).toContain('BLUEPRINT_ROOT')
      expectNoReport(refused)

      const local = await run(s, cli, proj, ['drift'], { BLUEPRINT_ROOT: remote.dir })
      expect(local.code, local.output).toBe(0)
      expect(fixtureMarked(local.output, '~'), local.output).toEqual(['docs/DoD.md'])
    })
  })

  it('#8 a placeholder remote exits 4 without ever starting a transport', async () => {
    await scenario('sync-by-address-8', async (s) => {
      // An scp-style placeholder: git WOULD hand it to ssh, so "ssh was never
      // called" is a real observation and not true of every address.
      const shims = await s.shimDir('ssh-recorder')
      const record = s.workspace.path('ssh-recorder', 'called')
      await shims.add('ssh', `echo called >> '${record}'\nexit 255`)
      const proj = await project(s, 'git@example.invalid:<owner>/<blueprint>.git', 'no-sha', 'OLD')
      const cli = await cliCopy(s, 'cli')

      const r = await run(s, cli, proj, ['drift'], { PATH: shims.path() })

      expect(r.code, r.output).toBe(4)
      expect(r.stderr).toContain('placeholder')
      expect(existsSync(record), 'a transport was started for a placeholder address').toBe(false)
      expectNoReport(r)
    })
  })

  it('#9 a full pull records the FULL fetched SHA; a partial pull leaves the config byte-identical', async () => {
    await scenario('sync-by-address-9', async (s) => {
      const remote = await blueprintRemote(s, 'v1')
      const tip = await advance(s, remote.dir, 'v2')
      const cli = await cliCopy(s, 'cli')

      const full = await project(s, remote.dir, remote.head, 'v1', { tag: 'full' })
      const f = await run(s, cli, full, ['pull', '--yes'])
      expect(f.code, f.output).toBe(0)
      const conf = await readFile(join(full, '.blueprint-source'), 'utf8')
      expect(conf, 'a full pull did not record the full fetched SHA').toMatch(
        new RegExp(`^bootstrap_sha\\s*=\\s*${tip}$`, 'm'),
      )

      const partial = await project(s, remote.dir, remote.head, 'v1', { tag: 'partial' })
      const before = await readFile(join(partial, '.blueprint-source'), 'utf8')
      const p = await run(s, cli, partial, ['pull', 'docs/DoD.md', '--yes'])
      expect(p.code, p.output).toBe(0)
      expect(await readFile(join(partial, 'docs/DoD.md'), 'utf8')).toBe(dodText('proj', 'v2'))
      expect(await readFile(join(partial, '.blueprint-source'), 'utf8')).toBe(before)
    })
  })

  it('#9b BUG-113 through the remote: project-owned lines outside the region are not drift, not selected, not previewed', async () => {
    await scenario('sync-by-address-9b', async (s) => {
      const region = (body: string) =>
        `# DoD\n<!-- BLUEPRINT:BEGIN -->\n${body}\n<!-- BLUEPRINT:END -->\n`
      const remote = await blueprintRemote(s, 'x')
      await s.fs.write(join(remote.dir, 'docs/DoD.md'), region('managed {{PROJECT_NAME}}'))
      const head = await commitAll(s, remote.dir, 'markers')
      const proj = await project(s, remote.dir, head, 'x')
      const mine = region('managed proj') + 'PROJECT-TAIL\n'
      await s.fs.write(join(proj, 'docs/DoD.md'), mine)
      const cli = await cliCopy(s, 'cli')

      const d = await run(s, cli, proj, ['drift'])
      expect(d.code, d.output).toBe(0)
      expect(fixtureMarked(d.output, '~'), d.output).toEqual([])

      const p = await run(s, cli, proj, ['pull', '--yes'])
      expect(p.code, p.output).toBe(0)
      expect(p.output).toContain('Nothing to pull')
      expect(p.output).not.toContain('-PROJECT-TAIL')
      expect(await readFile(join(proj, 'docs/DoD.md'), 'utf8')).toBe(mine)
    })
  })

  it('#11 scratch and the per-run ref are removed on exit 0, exit 5 and exit 1', async () => {
    await scenario('sync-by-address-11', async (s) => {
      const cli = await cliCopy(s, 'cli')

      const remote = await blueprintRemote(s, 'published')
      const ok = await project(s, remote.dir, remote.head, 'OLD', { tag: 'zero' })
      const r0 = await run(s, cli, ok, ['drift'])
      expect(r0.code, r0.output).toBe(0)
      expect(await caches(s), 'the healthy run built no cache, so the ref checks below see nothing').toHaveLength(1)
      await expectNothingLeft(s, 'exit 0')

      const gone = await project(s, s.workspace.path('no-such-remote'), 'no-sha', 'OLD', { tag: 'five' })
      const r5 = await run(s, cli, gone, ['drift'])
      expect(r5.code, r5.output).toBe(5)
      await expectNothingLeft(s, 'exit 5')

      // A remote whose archive ships nothing: the managed set fails closed with
      // exit 1 AFTER the fetch, so a cache ref exists by then.
      const bad = await s.workspace.dir('bad-remote')
      await s.fs.write(join(bad, 'CLAUDE.md'), '# CLAUDE\n')
      await s.fs.write(join(bad, 'docs/DoD.md'), '# DoD\n')
      await s.fs.write(join(bad, '.gitattributes'), '* export-ignore\n')
      await initRepo(s, bad)
      const badHead = await commitAll(s, bad, 'nothing ships')
      const one = await project(s, bad, badHead, 'OLD', { tag: 'one' })
      const r1 = await run(s, cli, one, ['drift'])
      expect(r1.code, r1.output).toBe(1)
      expect(r1.output).toContain('managed set could not be derived')
      await expectNothingLeft(s, 'exit 1')
    })
  })

  it('#12 recovery: a project missing a network lib gets it through the override, and is told how without one', async () => {
    await scenario('sync-by-address-12', async (s) => {
      const remote = await blueprintRemote(s, 'v1')
      await cp(join(REPO_ROOT, 'scripts/lib/request-config.sh'), join(remote.dir, 'scripts/lib/request-config.sh'))
      const head = await commitAll(s, remote.dir, 'ship the lib')
      const proj = await project(s, remote.dir, head, 'v1')
      await cp(join(REPO_ROOT, 'scripts'), join(proj, 'scripts'), { recursive: true })
      await rm(join(proj, 'scripts/lib/request-config.sh'))
      const own = join(proj, 'scripts/blueprint.mts')

      const told = await run(s, own, proj, ['drift'])
      expect(told.code, told.output).toBe(1)
      expect(told.stderr).toContain(
        'BLUEPRINT_ROOT=<path to a blueprint checkout> blueprint pull scripts/lib/request-config.sh',
      )

      const fixed = await run(s, own, proj, ['pull', 'scripts/lib/request-config.sh', '--yes'], {
        BLUEPRINT_ROOT: remote.dir,
      })
      expect(fixed.code, fixed.output).toBe(0)
      expect(existsSync(join(proj, 'scripts/lib/request-config.sh')), fixed.output).toBe(true)
    })
  })

  it('#13 unpushed commits in the checkout the CLI runs from are not reported', async () => {
    await scenario('sync-by-address-13', async (s) => {
      const remote = await blueprintRemote(s, 'published')
      const local = s.workspace.path('bp-local')
      await git(s, s.workspace.root, ['clone', '-q', remote.dir, local])
      await git(s, local, ['config', 'user.email', 't@local'])
      await git(s, local, ['config', 'user.name', 't'])
      await git(s, local, ['config', 'commit.gpgsign', 'false'])
      const unpushed = await advance(s, local, 'UNPUSHED')
      // The CLI runs from INSIDE the checkout that holds the unpushed commit —
      // the per-machine wrapper's shape today, and the fallback's whole premise.
      const cli = await cliCopy(s, 'bp-local')
      const proj = await project(s, remote.dir, remote.head, 'published')

      const r = await run(s, cli, proj, ['drift'])

      expect(r.code, r.output).toBe(0)
      expect(
        fixtureMarked(r.output, '~'),
        'drift reported the UNPUSHED DoD as the blueprint — it read the working checkout',
      ).toEqual([])
      expect(r.stdout).toMatch(fetched(remote.head))
      expect(r.output, 'the unpushed commit appears in the report').not.toContain(unpushed)
    })
  })

  it('#14 a bootstrap_sha absent from the remote history is said so, explicitly, and drift still reports', async () => {
    await scenario('sync-by-address-14', async (s) => {
      const remote = await blueprintRemote(s, 'published')
      const absent = '0123456789abcdef0123456789abcdef01234567'
      const proj = await project(s, remote.dir, absent, 'OLD')
      const cli = await cliCopy(s, 'cli')

      const r = await run(s, cli, proj, ['drift'])

      expect(r.code, r.output).toBe(0)
      expect(r.stdout).toContain(`bootstrap_sha ${absent} is not in ${remote.dir} main history`)
      expect(r.stdout).not.toContain('commit(s) since')
      expect(fixtureMarked(r.output, '~'), r.output).toEqual(['docs/DoD.md'])
    })
  })

  it("#15 hook context: an exported GIT_DIR does not redirect the fetch, the tree or the history", async () => {
    await scenario('sync-by-address-15', async (s) => {
      const remote = await blueprintRemote(s, 'published')
      const tip = await advance(s, remote.dir, 'published-2')
      const proj = await project(s, remote.dir, remote.head, 'OLD')
      const cli = await cliCopy(s, 'cli')

      // Warm-up, so the gate and keepalive config drift writes are already there
      // and any change below is the fetch path's.
      const warm = await run(s, cli, proj, ['drift'])
      expect(warm.code, warm.output).toBe(0)
      const before = await Promise.all(
        ['config', 'HEAD', 'index'].map((f) => readFile(join(proj, '.git', f)).catch(() => Buffer.from(''))),
      )

      // A FRESH cache, so the cache's creation runs under GIT_DIR too.
      const r = await run(s, cli, proj, ['drift'], {
        GIT_DIR: join(proj, '.git'),
        XDG_CACHE_HOME: s.workspace.path('fresh-cache'),
      })

      expect(r.code, r.output).toBe(0)
      expect(r.stdout).toMatch(fetched(tip))
      expect(r.stdout).toContain('commit(s) since')
      expect(fixtureMarked(r.output, '~'), r.output).toEqual(['docs/DoD.md'])
      const after = await Promise.all(
        ['config', 'HEAD', 'index'].map((f) => readFile(join(proj, '.git', f)).catch(() => Buffer.from(''))),
      )
      expect(after, "the project's own repository was written through GIT_DIR").toEqual(before)
    })
  })

  it('#16 a reachable remote WITHOUT the branch exits 5 and says the branch is missing, not that it could not connect', async () => {
    await scenario('sync-by-address-16', async (s) => {
      const remote = await blueprintRemote(s, 'published')
      const proj = await project(s, remote.dir, remote.head, 'OLD', { branch: 'nope' })
      const cli = await cliCopy(s, 'cli')

      const r = await run(s, cli, proj, ['drift'])

      expect(r.code, r.output).toBe(5)
      expect(r.stderr).toContain("no branch 'nope' on that remote")
      expect(r.stderr).not.toMatch(/could not connect|unable to connect|Could not read from remote/i)
      expectNoReport(r)
    })
  })

  it('#16b the RELEASE branch named but missing, with main present: drift and pull exit 5, never fall back to main', async () => {
    await scenario('sync-by-address-16b', async (s) => {
      // Alexey (Codex) review of 1cc78cf, finding 5: #16 names a missing
      // blueprint_branch with no release field, and #30 a present release
      // branch. Neither pins a read that quietly falls back to main when only
      // the release branch is missing — which would hand a project untested
      // commits while every header still looked normal.
      const remote = await blueprintRemote(s, 'published')
      const proj = await project(s, remote.dir, remote.head, 'OLD', {
        extra: ['blueprint_release_branch = not-yet-released'],
      })
      const cli = await cliCopy(s, 'cli')
      const before = await snapshot(proj)

      for (const args of [['drift'], ['pull', '--yes']]) {
        const r = await run(s, cli, proj, args)
        expect(r.code, `${args.join(' ')}:\n${r.output}`).toBe(5)
        expect(r.stderr, `${args.join(' ')} did not name the missing release branch`).toContain(
          "no branch 'not-yet-released' on that remote",
        )
        expect(r.output, `${args.join(' ')} read main instead`).not.toContain('(main)')
        expectNoReport(r)
        expect(await snapshot(proj), `${args.join(' ')} changed project files`).toEqual(before)
      }
    })
  })

  it('#17 no timeout provider exits 5 before any fetch, and creates no cache', async () => {
    await scenario('sync-by-address-17', async (s) => {
      const remote = await blueprintRemote(s, 'published')
      const proj = await project(s, remote.dir, remote.head, 'OLD')
      const cli = await cliCopy(s, 'cli')
      const path = await s.pathWithout(['timeout', 'gtimeout'])

      const r = await run(s, cli, proj, ['drift'], { PATH: path })

      expect(r.code, r.output).toBe(5)
      expect(r.stderr).toContain("no 'timeout' or 'gtimeout'")
      expect(existsSync(cacheRoot(s)), 'a cache was created for a fetch that could not be bounded').toBe(false)
      expectNoReport(r)
    })
  })

  it('#18 scratch that cannot be created exits 5, with no cache and no project write', async () => {
    await scenario('sync-by-address-18', async (s) => {
      // A regular file as TMPDIR: mktemp -d cannot work under it, and unlike a
      // chmod this holds when the suite runs as root.
      const remote = await blueprintRemote(s, 'published')
      const proj = await project(s, remote.dir, remote.head, 'OLD')
      const cli = await cliCopy(s, 'cli')
      await s.fs.write('not-a-directory', 'x\n')
      const before = await snapshot(proj)

      const r = await run(s, cli, proj, ['pull', '--yes'], { TMPDIR: s.workspace.path('not-a-directory') })

      expect(r.code, r.output).toBe(5)
      expect(r.stderr).toContain('could not create a scratch directory')
      expect(existsSync(cacheRoot(s))).toBe(false)
      expect(await snapshot(proj)).toEqual(before)
    })
  })

  it('#19 BUG-110: a .git marker above every scratch directory redirects nothing', async () => {
    await scenario('sync-by-address-19', async (s) => {
      const remote = await blueprintRemote(s, 'published')
      const proj = await project(s, remote.dir, remote.head, 'OLD')
      const cli = await cliCopy(s, 'cli')

      const decoy = await s.workspace.dir('decoy')
      await s.fs.write(join(decoy, 'CLAUDE.md'), '# CLAUDE\nDECOY\n')
      await s.fs.write(join(decoy, 'docs/DoD.md'), dodText('proj', 'OLD'))
      await s.fs.write(join(decoy, 'tests/fixture/test.sh'), 'echo decoy\n')
      await initRepo(s, decoy)
      await commitAll(s, decoy, 'decoy')
      await s.fs.write('tmp/.git', `gitdir: ${join(decoy, '.git')}\n`)
      const refsBefore = await git(s, decoy, ['for-each-ref'])
      const cfgBefore = await readFile(join(decoy, '.git/config'), 'utf8')

      const r = await run(s, cli, proj, ['drift'])

      expect(r.code, r.output).toBe(0)
      expect(r.stdout).toMatch(fetched(remote.head))
      // The decoy's DoD MATCHES the project, and its CLAUDE.md does not. So a
      // run that read the decoy would call DoD clean and CLAUDE.md drifted.
      expect(fixtureMarked(r.output, '~'), r.output).toEqual(['docs/DoD.md'])
      expect(await git(s, decoy, ['for-each-ref'])).toBe(refsBefore)
      expect(await readFile(join(decoy, '.git/config'), 'utf8')).toBe(cfgBefore)
    })
  })

  it('#20 INT and TERM during the fetch: died of the signal, no scratch, no ref, no write', async () => {
    await scenario('sync-by-address-20', async (s) => {
      for (const sig of SIGNALS) {
        const tag = sig.toLowerCase()
        const hole = await seam(s, `fetch-${tag}`, 'ssh')
        const proj = await project(s, BLACKHOLE, 'no-sha', 'OLD', { tag })
        const cli = await cliCopy(s, `cli-${tag}`)
        const before = await snapshot(proj)

        const { child, done } = start(s, cli, proj, ['pull', '--yes'], {
          PATH: hole.path,
          BP_FETCH_TIMEOUT: '30',
        })
        await reached(hole)
        const signalled = Date.now()
        child.kill(sig)
        // The fetch is waited on in the background, so the handler runs at once
        // and kills it: nothing needs releasing before the run ends.
        const d = await done
        const ending = Date.now() - signalled
        release(hole)

        expect(diedOf(d, sig), `${sig} did not end the run\n${show(d)}`).toBe(true)
        // A BOUND, not a sleep. The run's output stays open while any descendant
        // holds it, so an orphaned fetch shows up here as the 30 s budget —
        // which is exactly how killing only the refresh subshell presented.
        expect(ending, `${sig}: a descendant outlived the run for ${ending}ms`).toBeLessThan(10_000)
        await expectNothingLeft(s, sig)
        expect(await snapshot(proj), `${sig}: the project was written`).toEqual(before)
      }
    })
  })

  it('#20b the refresh child IS the fetch process, and a signal before it becomes `timeout` still ends the run', async () => {
    await scenario('sync-by-address-20b', async (s) => {
      // WHY THE FIRST HALF IS STRUCTURAL. The fetch used to be launched as a
      // shell FUNCTION in the background, so `$!` named a bash subshell that had
      // not necessarily forked `timeout` yet. Cleanup then looked the fetch up
      // by parent (`pkill -P`), a snapshot: a signal landing between `$!` and
      // that fork found no child, and the subshell went on to start the fetch
      // after cleanup, holding the run open for the whole budget (Alexey, S1).
      // That window is inside bash — no command on PATH runs in it — so no shim
      // can open it. What CAN be asserted is the property that removes it: the
      // process `$!` names is the one that runs the fetch.
      const hole = await seam(s, 'identity', 'ssh')
      const proj = await project(s, BLACKHOLE, 'no-sha', 'OLD', { tag: 'identity' })
      const cli = await cliCopy(s, 'cli-identity')

      const one = start(s, cli, proj, ['drift'], { PATH: hole.path, BP_FETCH_TIMEOUT: '30' })
      await reached(hole)
      const kids = await childNames(s, one.child.pid ?? 0)
      one.child.kill('SIGTERM')
      const d1 = await one.done
      release(hole)

      expect(kids, 'the run\'s refresh child is not the fetch process itself').toEqual([
        expect.stringMatching(/^g?timeout$/),
      ])
      expect(diedOf(d1, 'SIGTERM'), show(d1)).toBe(true)

      // SECOND HALF: the earliest point a command on PATH can observe. `env` is
      // what becomes `timeout`; its shim blocks BEFORE exec'ing it, so the fetch
      // process exists but has not become `timeout` and has started nothing.
      // A signal there must end the run at once, and ssh must never be reached.
      // Honest limit: the old launch passed this half too, because the shim is
      // already a child for `pkill -P` to find. The first half is the witness.
      const early = await seam(s, 'env-early', 'env', 'printf "%s\\n" "$@" | grep -qx fetch')
      const never = await seam(s, 'never', 'ssh')
      const proj2 = await project(s, BLACKHOLE, 'no-sha', 'OLD', { tag: 'early' })
      const cli2 = await cliCopy(s, 'cli-early')

      const two = start(s, cli2, proj2, ['drift'], {
        PATH: `${early.dir}:${never.path}`,
        BP_FETCH_TIMEOUT: '30',
      })
      await reached(early)
      const signalled = Date.now()
      two.child.kill('SIGINT')
      const d2 = await two.done
      const ending = Date.now() - signalled
      release(early)

      expect(diedOf(d2, 'SIGINT'), show(d2)).toBe(true)
      expect(ending, `a signal before the fetch started held the run for ${ending}ms`).toBeLessThan(10_000)
      expect(existsSync(never.marker), 'the fetch started after the run was signalled').toBe(false)
      await expectNothingLeft(s, 'signal before the fetch process became timeout')
    })
  })

  it('#20c a signal while the refresh child exists but has not started the fetch: no fetch ever starts', async () => {
    await scenario('sync-by-address-20c', async (s) => {
      // THE SPAWN WINDOW, HELD OPEN. The refresh's stderr goes to
      // "$BP_SYNC_SCRATCH/fetch.err", and bash applies an async command's
      // redirections in the FORKED child before that child runs anything. A
      // `mktemp` shim makes this one scratch directory predictable and puts a
      // FIFO there, so the child blocks opening its stderr: forked, `$!`
      // published, no fetch process yet.
      //
      // Under the old launch (a shell function in the background, cleanup by
      // `pkill -P`) that child was a subshell with NO child of its own, so
      // cleanup found nothing to stop; released, it went on to start the fetch
      // after the run had been signalled (Alexey, S1). Under the current launch
      // the held process IS `$!`, cleanup ends it, and nothing starts.
      const never = await seam(s, 'never', 'ssh')
      const proj = await project(s, BLACKHOLE, 'no-sha', 'OLD')
      const cli = await cliCopy(s, 'cli')
      const tmp = s.workspace.path('tmp')
      const held = join(tmp, 'blueprint-sync.HELD0000')
      const fifo = join(held, 'fetch.err')

      const real = (await s.run('sh', ['-c', 'command -v mktemp'], { cwd: s.workspace.root })).stdout.trim()
      expect(real, 'no real mktemp to hand over to').not.toBe('')
      const shims = await s.shimDir('mktemp-held')
      await shims.add(
        'mktemp',
        `case "$*" in\n` +
          `  *blueprint-sync.XXXXXXXX*) mkdir '${held}' && mkfifo '${fifo}' && printf '%s\\n' '${held}' ;;\n` +
          `  *) exec '${real}' "$@" ;;\n` +
          `esac`,
      )

      const run1 = start(s, cli, proj, ['drift'], {
        PATH: `${shims.dir}:${never.path}`,
        BP_FETCH_TIMEOUT: '3',
      })
      const pid = run1.child.pid ?? 0

      // Held: the cache exists (the last step before the launch) and the run has
      // a `bash` (shell CLI) or `sh` (port, TASK-081 §3 P1) child — the refresh
      // child, blocked opening its stderr. No timing: that child cannot get past
      // the open until something reads.
      await vi.waitFor(
        async () => {
          if ((await caches(s)).length === 0) throw new Error('the cache is not created yet')
          if (!isRefreshChild(await childNames(s, pid))) throw new Error('no refresh child yet')
        },
        { timeout: 60_000, interval: 10 },
      )

      run1.child.kill('SIGINT')
      // BUG-120: release only once cleanup has revoked the token, so the claim
      // under test is exactly "no fetch starts after cleanup has begun". A
      // release racing the signal lets the child reach the gate before the run's
      // handler has even started, which no design can prevent and which is
      // indistinguishable from a signal sent a moment later (#20d covers it).
      await revoked(join(held, 'go'))
      // Now let any still-waiting writer open the FIFO, and keep the read end
      // open so a fetch that does start is not killed by a closed pipe.
      const reader = openReader(fifo)
      const d = await run1.done
      if (reader !== null) closeSync(reader)
      release(never)

      expect(diedOf(d, 'SIGINT'), show(d)).toBe(true)
      expect(
        existsSync(never.marker),
        'a fetch started AFTER the run was signalled — cleanup could not see the refresh child',
      ).toBe(false)
      await expectNothingLeft(s, 'signal before the fetch started')
    })
  })

  it('#20d BUG-120: a TERM that reaches the held refresh child with its release is not lost — no fetch, no wait for the budget', async () => {
    await scenario('sync-by-address-20d', async (s) => {
      // THE LOST TERM. #20c's sequence, with the run's processes pinned to one
      // CPU. The test signals the run and releases the child's FIFO at once; on
      // one CPU both land before the child runs again. Its open then SUCCEEDS,
      // bash's own handler only RECORDS the TERM cleanup sent, and the exec into
      // `env` discards the record: the fetch starts after cleanup signalled it,
      // and cleanup's `wait` sits out the whole budget (BUG-120). Measured red
      // 40/40 on an unmodified copy of the tree before the fix.
      //
      // No stop-based seam reaches this: on SIGCONT the pending TERM interrupts
      // the open (EINTR) and bash dies of it. Pinning is what orders it. Where
      // `taskset` is absent the same assertion runs unpinned, rather than being
      // skipped; there it catches the loss only when the machine is busy.
      const pin = (await s.run('sh', ['-c', 'command -v taskset || true'], { cwd: s.workspace.root })).stdout.trim()
      const real = (await s.run('sh', ['-c', 'command -v mktemp'], { cwd: s.workspace.root })).stdout.trim()
      expect(real, 'no real mktemp to hand over to').not.toBe('')
      const tmp = s.workspace.path('tmp')

      for (const tag of ['r1', 'r2', 'r3']) {
        const never = await seam(s, `never-${tag}`, 'ssh')
        const proj = await project(s, BLACKHOLE, 'no-sha', 'OLD', { tag })
        const cli = await cliCopy(s, `cli-${tag}`)
        const held = join(tmp, `blueprint-sync.HELD${tag}`)
        const fifo = join(held, 'fetch.err')
        const shims = await s.shimDir(`mktemp-held-${tag}`)
        await shims.add(
          'mktemp',
          `case "$*" in\n` +
            `  *blueprint-sync.XXXXXXXX*) mkdir '${held}' && mkfifo '${fifo}' && printf '%s\\n' '${held}' ;;\n` +
            `  *) exec '${real}' "$@" ;;\n` +
            `esac`,
        )
        const env = { PATH: `${shims.dir}:${never.path}`, BP_FETCH_TIMEOUT: '3' }
        const child: ChildProcess = pin
          ? s.background(pin, ['-c', '0', 'node', cli, 'drift'], { cwd: proj, env })
          : s.background('node', [cli, 'drift'], { cwd: proj, env })
        let out = ''
        child.stdout?.on('data', (b: Buffer) => (out += b.toString('utf8')))
        child.stderr?.on('data', (b: Buffer) => (out += b.toString('utf8')))
        const done = new Promise<Done>((resolve, reject) => {
          child.on('error', reject)
          child.on('close', (code, signal) => resolve({ code, signal, stdout: out, stderr: '' }))
        })
        const pid = child.pid ?? 0

        // BUG-146: both waits below are given their OWN, much shorter budget
        // through waitOrDump, so a hang here fails in seconds WITH a process-
        // tree dump instead of running out vitest's global 320s testTimeout
        // with nothing captured — which is exactly what the three CI
        // occurrences of this hang (61cfe01, 374a8d9, c7c47f6) cost: 320019-
        // 320024ms each, and none of it evidence.
        await s.waitOrDump(
          vi.waitFor(
            async () => {
              if (!existsSync(fifo)) throw new Error('the refresh scratch is not created yet')
              if (!isRefreshChild(await childNames(s, pid))) throw new Error('no refresh child yet')
            },
            { timeout: 60_000, interval: 10 },
          ),
          65_000,
          `#20d ${tag}: waiting for the refresh child`,
        )

        const signalled = Date.now()
        child.kill('SIGINT')
        const reader = openReader(fifo)
        // `done` has no bound of its own — it resolves on the child's `close`
        // event and nothing else. That is exactly the wait BUG-146's row is
        // about: a lost TERM (the defect this test exists to catch) means the
        // child never exits, and until now nothing bounded this await short
        // of vitest's own test timeout.
        const d = await s.waitOrDump(done, 30_000, `#20d ${tag}: waiting for the run to exit`)
        const ending = Date.now() - signalled
        if (reader !== null) closeSync(reader)
        release(never)

        // WHAT THIS ASSERTS, AND WHY NOT "ssh never reached". The release races
        // the signal here on purpose: it is what loses the TERM. It also lets the
        // child reach the gate before the run's handler starts (1/50 pinned), a
        // fetch started in the run's own reaction time, which nothing can
        // prevent. What the fix guarantees is that such a fetch is past its exec,
        // so cleanup's TERM kills it at once. A LOST TERM is what makes the run
        // sit out the budget, so the budget is the assertion. "No fetch starts
        // after cleanup has begun" is #20c's.
        expect(diedOf(d, 'SIGINT'), `${tag}: ${show(d)}`).toBe(true)
        expect(ending, `${tag}: the run sat out the fetch budget — cleanup's TERM was lost (BUG-120)`).toBeLessThan(2_000)
        await expectNothingLeft(s, `${tag}: a TERM with the release`)
      }
    })
  })

  it('#20f two signals while cleanup is already in progress end the run once, with nothing left (TASK-081 §2 rule 7, §3 P1)', async () => {
    await scenario('sync-by-address-20f', async (s) => {
      // TASK-081 §3 P1 "Repeated signals are serialised": under the port, the
      // first recorded signal decides and a signal arriving while the handler
      // runs is recorded but never re-enters it. The shell has no such
      // mechanism — bash's own trap handling decides what happens when a
      // second signal arrives while `_bp_sync_cleanup` is already running (in
      // its `wait` on the held refresh child). This case PINS that outcome so
      // slice 5's port has a real answer to match, per #20f's own rule:
      // "if the shell's observable outcome differs from this rule, the port
      // follows the shell and the plan records the difference."
      //
      // Same held-FIFO technique as #20c/#20d: the refresh child is blocked
      // opening its stderr redirect, so cleanup's `wait` is still pending when
      // the second signal arrives.
      //
      // THE WITNESS. Sending both signals back to back proves nothing about a
      // signal arriving DURING cleanup — the second one could just as well land
      // before the first signal's handler has even started. `_bp_sync_cleanup`
      // (scripts/blueprint, BUG-120 comment) truncates `$BP_SYNC_GO` as its very
      // FIRST action, before it sends TERM to the held child and blocks in
      // `wait`; the FIFO is still held, so that `wait` cannot have returned.
      // Waiting for the token's truncation between the two signals is therefore
      // a real, deterministic proof that cleanup is already running — not just
      // signalled — when the second signal is sent.
      for (const [tag, first, second] of [
        ['int-term', 'SIGINT', 'SIGTERM'],
        ['int-int', 'SIGINT', 'SIGINT'],
      ] as const) {
        const never = await seam(s, `never-20f-${tag}`, 'ssh')
        const proj = await project(s, BLACKHOLE, 'no-sha', 'OLD', { tag })
        const cli = await cliCopy(s, `cli-20f-${tag}`)
        const before = await snapshot(proj)
        const tmp = s.workspace.path('tmp')
        const held = join(tmp, `blueprint-sync.HELD20F${tag}`)
        const fifo = join(held, 'fetch.err')

        const real = (await s.run('sh', ['-c', 'command -v mktemp'], { cwd: s.workspace.root })).stdout.trim()
        expect(real, 'no real mktemp to hand over to').not.toBe('')
        const shims = await s.shimDir(`mktemp-held-20f-${tag}`)
        await shims.add(
          'mktemp',
          `case "$*" in\n` +
            `  *blueprint-sync.XXXXXXXX*) mkdir '${held}' && mkfifo '${fifo}' && printf '%s\\n' '${held}' ;;\n` +
            `  *) exec '${real}' "$@" ;;\n` +
            `esac`,
        )

        const run1 = start(s, cli, proj, ['drift'], {
          PATH: `${shims.dir}:${never.path}`,
          BP_FETCH_TIMEOUT: '3',
        })
        const pid = run1.child.pid ?? 0

        await vi.waitFor(
          async () => {
            if ((await caches(s)).length === 0) throw new Error('the cache is not created yet')
            if (!isRefreshChild(await childNames(s, pid))) throw new Error('no refresh child yet')
          },
          { timeout: 60_000, interval: 10 },
        )

        run1.child.kill(first)
        await revoked(join(held, 'go'))
        run1.child.kill(second)
        const reader = openReader(fifo)
        const d = await run1.done
        if (reader !== null) closeSync(reader)
        release(never)

        expect(
          diedOf(d, first as Sig) || diedOf(d, second as Sig),
          `${tag}: the run did not die of either signal\n${show(d)}`,
        ).toBe(true)
        await expectNothingLeft(s, `${tag}: two signals during cleanup`)
        expect(await snapshot(proj), `${tag}: a project file changed`).toEqual(before)
        expectNoReport(d)
      }
    })
  })

  it('#20e BUG-120: the fetch is gated on a token that cleanup revokes, without forking, before its TERM (structural)', async () => {
    // WHY STRUCTURAL. The lost TERM needs the child's release and cleanup's TERM
    // to land in the microseconds between its open returning and its exec, and
    // no command on PATH runs there. A stopped child cannot hold it: on SIGCONT
    // the pending TERM interrupts the open and bash dies of it (measured). #20d
    // catches a missing gate by the budget it then sits out, but only the text
    // can pin the two orderings the gate relies on: the token is revoked BEFORE
    // the TERM, and with a builtin, since a forked `rm` yields the CPU to the
    // child in between (7/50 red pinned, measured).
    //
    // TASK-081 §8 slice 5 (plan §3 P1): scripts/blueprint is now the two-line
    // shim, so this case can no longer read `_bp_sync_cleanup`'s TEXT out of
    // it — that logic lives in scripts/blueprint.mts's bpSyncCleanup now.
    // Replaced by two checks, exactly as the plan schedules: a BEHAVIOURAL
    // unit test on the exported cleanup (an injected `process.kill`, proving
    // the token is empty by the time `kill` is called), and a STRUCTURAL
    // check on the .mts source (no `await` or spawn between the write and
    // the kill — a syscall does not fork, so nothing can run in that gap
    // only if nothing yields the event loop there).
    const goPath = join(mkdtempSync(join(tmpdir(), 'bp-sync-cleanup-')), 'go')
    writeFileSync(goPath, 'go\n')
    let goAtKillTime: string | undefined
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      goAtKillTime = readFileSync(goPath, 'utf8')
      return true
    })
    try {
      _setSyncStateForTests({ go: goPath, child: 999999, childExit: Promise.resolve({ status: 0 }) })
      await bpSyncCleanup()
      expect(killSpy, 'bpSyncCleanup never called process.kill on the refresh child').toHaveBeenCalledWith(
        999999,
        'SIGTERM',
      )
      expect(goAtKillTime, 'the GO token was not yet empty when process.kill was called').toBe('')
    } finally {
      killSpy.mockRestore()
      _setSyncStateForTests({ go: '', child: null, childExit: null })
      await rm(goPath, { force: true })
    }

    const source = await readFile(join(REPO_ROOT, 'scripts/blueprint.mts'), 'utf8')
    const body = source.match(/^export async function bpSyncCleanup\(\): Promise<void> \{\n([\s\S]*?)\n\}\n/m)?.[1] ?? ''
    expect(body, 'no bpSyncCleanup() { … } definition to check').not.toBe('')
    const writeIdx = body.indexOf('writeFileSync(SYNC.go')
    const killIdx = body.indexOf("process.kill(pid, 'SIGTERM')")
    expect(writeIdx, 'cleanup does not revoke the token with a synchronous write').toBeGreaterThanOrEqual(0)
    expect(killIdx, 'cleanup sends no TERM to the refresh child').toBeGreaterThan(writeIdx)
    expect(
      body.slice(writeIdx, killIdx),
      'cleanup awaits or spawns something between revoking the token and its TERM, which can yield the event loop to the child',
    ).not.toMatch(/\bawait\b/)

    // The other half of the old shell-text check: the token is written
    // non-empty BEFORE the refresh child is launched (the gate embedded in
    // its own `sh -c` script reads that same file) — bpFetchBlueprint, not
    // bpSyncCleanup.
    const launchBody =
      source.match(/^async function bpFetchBlueprint\(\): Promise<void> \{\n([\s\S]*?)\n\}\n/m)?.[1] ?? ''
    expect(launchBody, 'no bpFetchBlueprint() { … } definition to check').not.toBe('')
    const tokenWrite = launchBody.indexOf('writeFileSync(SYNC.go')
    const spawnCall = launchBody.indexOf('const child = spawn(')
    expect(tokenWrite, 'the token is not written non-empty before the launch').toBeGreaterThanOrEqual(0)
    expect(spawnCall, 'the refresh child is never spawned').toBeGreaterThan(tokenWrite)
  })

  it('#21 INT and TERM during the compare: died of the signal, no scratch, no ref, no write', async () => {
    await scenario('sync-by-address-21', async (s) => {
      const remote = await blueprintRemote(s, 'published')
      for (const sig of SIGNALS) {
        const tag = sig.toLowerCase()
        const blocker = await seam(s, `diff-${tag}`, 'diff')
        const proj = await project(s, remote.dir, remote.head, 'OLD', { tag })
        const cli = await cliCopy(s, `cli-${tag}`)
        const before = await snapshot(proj)

        const { child, done } = start(s, cli, proj, ['drift'], { PATH: blocker.path })
        await reached(blocker)
        child.kill(sig)
        release(blocker)
        const d = await done

        expect(diedOf(d, sig), `${sig} did not end the run\n${show(d)}`).toBe(true)
        expect(d.stdout, `${sig}: the run went on to report`).not.toContain('Drifted (project')
        await expectNothingLeft(s, sig)
        expect(await snapshot(proj)).toEqual(before)
      }
    })
  })

  it("#22 INT and TERM at pull's write step: died of the signal, and no file is written after it", async () => {
    await scenario('sync-by-address-22', async (s) => {
      const remote = await blueprintRemote(s, 'published')
      for (const sig of SIGNALS) {
        const tag = sig.toLowerCase()
        // cmd_pull runs `mkdir -p docs` immediately before writing docs/DoD.md.
        const blocker = await seam(s, `mkdir-${tag}`, 'mkdir', '[ "$1" = -p ] && [ "$2" = docs ]')
        const proj = await project(s, remote.dir, remote.head, 'OLD', { tag })
        const cli = await cliCopy(s, `cli-${tag}`)
        const before = await snapshot(proj)

        const { child, done } = start(s, cli, proj, ['pull', '--yes'], { PATH: blocker.path })
        await reached(blocker)
        child.kill(sig)
        release(blocker)
        const d = await done

        expect(diedOf(d, sig), `${sig} did not end the run\n${show(d)}`).toBe(true)
        expect(await snapshot(proj), `${sig}: a file was written after the signal`).toEqual(before)
        await expectNothingLeft(s, sig)
      }
    })
  })

  it('#23 group INT and group TERM mid-write: the file is complete, nothing later is written, the run dies of it', async () => {
    await scenario('sync-by-address-23', async (s) => {
      // The signal goes to the whole process group, as a terminal's Ctrl-C does,
      // so it reaches the writer too. The `cat` shim blocks AFTER the redirect
      // has truncated the target, which is the moment an unshielded writer dies
      // and leaves the file empty.
      const remote = await blueprintRemote(s, 'SENTINEL-TASK025')
      for (const sig of SIGNALS) {
        const tag = sig.toLowerCase()
        const blocker = await seam(s, `cat-${tag}`, 'cat', `grep -q SENTINEL-TASK025 "$1" 2>/dev/null`)
        const proj = await project(s, remote.dir, remote.head, 'OLD', { tag })
        const cli = await cliCopy(s, `cli-${tag}`)
        const config = await readFile(join(proj, '.blueprint-source'), 'utf8')

        const { child, done } = start(s, cli, proj, ['pull', '--yes'], { PATH: blocker.path })
        await reached(blocker)
        process.kill(-(child.pid ?? 0), sig)
        release(blocker)
        const d = await done

        expect(diedOf(d, sig), `group ${sig} did not end the run\n${show(d)}`).toBe(true)
        expect(
          await readFile(join(proj, 'docs/DoD.md'), 'utf8'),
          `group ${sig}: the file being written is not complete`,
        ).toBe(dodText('proj', 'SENTINEL-TASK025'))
        expect(
          await readFile(join(proj, '.blueprint-source'), 'utf8'),
          `group ${sig}: a later write (bootstrap_sha) ran after the signal`,
        ).toBe(config)
        await expectNothingLeft(s, `group ${sig}`)
      }
    })
  })

  it("#23b group INT and group TERM at the `cp -p` step (DEST already exists): DEST ends with the blueprint's NEW bytes and mode, nothing later is written", async () => {
    await scenario('sync-by-address-23b', async (s) => {
      // WHY BEHAVIOURAL NOW, AND WHY THIS SEAM. `_bp_shielded_write` first
      // `cp -p`s the EXISTING destination to a temp beside it (so an untouched
      // destination keeps its own mode), then overwrites the temp's bytes, then
      // renames the temp over the destination. Under a temp-and-rename write, a
      // shield that dies AT the `cp` step — because its ignore was set too late,
      // or because the `cp` sits outside the ignore wrapper — leaves the temp
      // incomplete and the OLD destination untouched. "The file is complete"
      // alone would pass on that broken shield, because the OLD file IS
      // complete; what must be asserted is that DEST ends holding the
      // blueprint's NEW bytes and mode, not merely SOME complete file (Alexey,
      // S2; Markus, Slava). The `cp` shim blocks the whole group signal exactly
      // at that step, as a terminal's Ctrl-C would.
      const tool = 'scripts/signal-set.sh'
      const bytes = '#!/bin/sh\necho v2\n'
      const remote = await blueprintRemote(s, 'published')
      await s.fs.write(join(remote.dir, tool), bytes, { mode: 0o755 })
      const head = await commitAll(s, remote.dir, 'an executable managed file')

      for (const sig of SIGNALS) {
        const tag = sig.toLowerCase()
        // cp -p "$2" "$tmp" — $2 is DEST (the project's own copy), $tmp is
        // "$2.bp-new.$$". The seam blocks only that call, not any other cp.
        const blocker = await seam(
          s,
          `cp-${tag}`,
          'cp',
          `[ "$1" = -p ] && [ "$2" = ${tool} ] && case "$3" in ${tool}.bp-new.*) true ;; *) false ;; esac`,
        )
        const proj = await project(s, remote.dir, head, 'published', { tag })
        await s.fs.write(join(proj, tool), '#!/bin/sh\necho v1\n', { mode: 0o644 })
        const cli = await cliCopy(s, `cli-${tag}`)
        const config = await readFile(join(proj, '.blueprint-source'), 'utf8')

        const { child, done } = start(s, cli, proj, ['pull', '--yes'], { PATH: blocker.path })
        await reached(blocker)
        process.kill(-(child.pid ?? 0), sig)
        release(blocker)
        const d = await done

        expect(diedOf(d, sig), `group ${sig} did not end the run\n${show(d)}`).toBe(true)
        expect(await readFile(join(proj, tool), 'utf8'), `group ${sig}: DEST does not hold the blueprint's NEW bytes`).toBe(bytes)
        const { mode } = await stat(join(proj, tool))
        expect(
          (mode & 0o111) !== 0,
          `group ${sig}: DEST kept its old mode ${(mode & 0o777).toString(8)} instead of the blueprint's`,
        ).toBe(true)
        expect(await readFile(join(proj, '.blueprint-source'), 'utf8'), `group ${sig}: a later write (bootstrap_sha) ran`).toBe(config)
        await expectNothingLeft(s, `group ${sig}`)
      }
    })
  })

  it('#23c group INT and TERM while the executable bit is set: the pulled file ends with the blueprint\'s mode', async () => {
    await scenario('sync-by-address-23c', async (s) => {
      // BUG-008 makes the executable bit part of what a pull lands, so the bit
      // must be written under the same shield as the bytes. It used to be set by
      // a `chmod` AFTER the shielded write, where a group signal killed it and
      // left the completed file at its old mode (Alexey, S1). The `chmod` shim
      // blocks on this file only, so the signal lands exactly there.
      const tool = 'scripts/signal-set.sh'
      const bytes = '#!/bin/sh\necho v2\n'
      const remote = await blueprintRemote(s, 'published')
      await s.fs.write(join(remote.dir, tool), bytes, { mode: 0o755 })
      const head = await commitAll(s, remote.dir, 'an executable managed file')

      for (const sig of SIGNALS) {
        const tag = sig.toLowerCase()
        // The bit is set on the temp the atomic write renames into place.
        const blocker = await seam(s, `chmod-${tag}`, 'chmod', `[ "$1" = +x ] && case "$2" in ${tool}.bp-new.*) true ;; *) false ;; esac`)
        const proj = await project(s, remote.dir, head, 'published', { tag })
        await s.fs.write(join(proj, tool), '#!/bin/sh\necho v1\n', { mode: 0o644 })
        const cli = await cliCopy(s, `cli-${tag}`)
        const config = await readFile(join(proj, '.blueprint-source'), 'utf8')

        const { child, done } = start(s, cli, proj, ['pull', '--yes'], { PATH: blocker.path })
        await reached(blocker)
        process.kill(-(child.pid ?? 0), sig)
        release(blocker)
        const d = await done

        expect(diedOf(d, sig), `group ${sig} did not end the run\n${show(d)}`).toBe(true)
        expect(await readFile(join(proj, tool), 'utf8'), `group ${sig}: bytes`).toBe(bytes)
        const { mode } = await stat(join(proj, tool))
        expect(
          (mode & 0o111) !== 0,
          `group ${sig}: the pulled file kept its old mode ${(mode & 0o777).toString(8)}`,
        ).toBe(true)
        expect(await readFile(join(proj, '.blueprint-source'), 'utf8'), `group ${sig}: a later write ran`).toBe(config)
      }
    })
  })

  it('#24 concurrent runs share one cache, and each answers from its OWN tip (per-run-tip isolation)', async () => {
    await scenario('sync-by-address-24', async (s) => {
      // WHAT THIS DOES NOT PROVE, stated because a reader would assume it: that
      // cleanup leaves the cache usable for a run still reading through it. A
      // has built its tree and read its history BEFORE it blocks in compare, so
      // it no longer depends on the cache — deleting the cache in cleanup leaves
      // this case green (Alexey, S3). That property is proven by #5, #11, #26,
      // #27a, #27b, #28 and #28b, which that mutant reddens.
      const remote = await blueprintRemote(s, 'v0')
      const base = remote.head
      const tip1 = await advance(s, remote.dir, 'one-ahead')
      const proj = await project(s, remote.dir, base, 'v0')
      const cli = await cliCopy(s, 'cli')

      // A fetches tip1 and stops in its compare.
      const blocker = await seam(s, 'diff-a', 'diff')
      const a = start(s, cli, proj, ['drift'], { PATH: blocker.path })
      await reached(blocker)

      const b = await run(s, cli, proj, ['drift'])
      expect(b.code, b.output).toBe(0)

      const tip2 = await advance(s, remote.dir, 'two-ahead')
      const c = await run(s, cli, proj, ['drift'])
      expect(c.code, c.output).toBe(0)
      expect(c.stdout).toMatch(fetched(tip2))

      release(blocker)
      const d = await a.done

      expect(d.code, show(d)).toBe(0)
      expect(d.stdout, "A answered from another run's tip").toMatch(fetched(tip1))
      expect(d.stdout, 'A lost its own history').toContain('one-ahead')
      expect(d.stdout, "A listed commits only C fetched").not.toContain('two-ahead')
      await expectNothingLeft(s, 'after all three')
      const again = await run(s, cli, proj, ['drift'])
      expect(again.code, `the shared cache is no longer usable\n${again.output}`).toBe(0)
    })
  })

  it('#25 a failed refresh with a WARM cache exits 5 — it does not answer from what the cache holds', async () => {
    await scenario('sync-by-address-25', async (s) => {
      const remote = await blueprintRemote(s, 'published')
      const proj = await project(s, remote.dir, remote.head, 'OLD')
      const cli = await cliCopy(s, 'cli')

      const warm = await run(s, cli, proj, ['drift'])
      expect(warm.code, warm.output).toBe(0)

      await rename(remote.dir, `${remote.dir}-gone`)
      const r = await run(s, cli, proj, ['drift'])

      expect(r.code, r.output).toBe(5)
      expect(r.stderr).toContain('could not read the blueprint')
      expectNoReport(r)
    })
  })

  it("#26 an interrupted refresh's leftovers do not change the answer", async () => {
    await scenario('sync-by-address-26', async (s) => {
      const remote = await blueprintRemote(s, 'v1')
      const proj = await project(s, remote.dir, remote.head, 'v1')
      const cli = await cliCopy(s, 'cli')
      const warm = await run(s, cli, proj, ['drift'])
      expect(warm.code, warm.output).toBe(0)

      // What a SIGKILLed run leaves (PLAN §0.4): a dead per-run ref at an OLDER
      // commit, that ref's lock, and a temp pack.
      const cache = await onlyCache(s)
      const tip = await advance(s, remote.dir, 'v2')
      // Named to sort FIRST among bp-run refs, so a run that reads "some" per-run
      // ref rather than its own reads this one.
      await git(s, s.workspace.root, ['--git-dir', cache, 'update-ref', 'refs/bp-run/blueprint-sync.0', remote.head])
      await writeFile(join(cache, 'refs/bp-run/blueprint-sync.0.lock'), '')
      await mkdir(join(cache, 'objects/pack'), { recursive: true })
      await writeFile(join(cache, 'objects/pack/tmp_pack_DEADBEEF'), 'partial')

      const r = await run(s, cli, proj, ['drift'])

      expect(r.code, r.output).toBe(0)
      expect(r.stdout, 'the run answered from a leftover ref').toMatch(fetched(tip))
      expect(fixtureMarked(r.output, '~'), r.output).toEqual(['docs/DoD.md'])
    })
  })

  it('#27a a cache missing the tip tree exits 5, naming the cache and how to remove it', async () => {
    await scenario('sync-by-address-27a', async (s) => {
      const remote = await blueprintRemote(s, 'published')
      const proj = await project(s, remote.dir, remote.head, 'OLD')
      const cli = await cliCopy(s, 'cli')
      const warm = await run(s, cli, proj, ['drift'])
      expect(warm.code, warm.output).toBe(0)

      // Every object loose, then the tip's root tree deleted, with a leftover
      // per-run ref still at the tip — what a killed run leaves. That ref is the
      // condition, and it is not decoration: a refresh checks connectivity only
      // against objects NO ref already covers, so with the ref present it trusts
      // the tip, fetches nothing and reports success. Without one, git notices
      // the gap and refetches, and the cache heals (observed while writing this).
      const cache = await onlyCache(s)
      await git(s, s.workspace.root, ['--git-dir', cache, 'update-ref', 'refs/bp-run/blueprint-sync.0', remote.head])
      const packDir = join(cache, 'objects/pack')
      for (const name of await readdir(packDir).catch(() => [] as string[])) {
        if (!name.endsWith('.pack')) continue
        const moved = s.workspace.path(`loose-${name}`)
        await rename(join(packDir, name), moved)
        const unpack = await s.run('sh', ['-c', 'git --git-dir="$1" unpack-objects -q < "$2"', 'sh', cache, moved], {
          cwd: s.workspace.root,
        })
        expect(unpack.code, unpack.output).toBe(0)
      }
      for (const name of await readdir(packDir).catch(() => [] as string[])) {
        if (name.endsWith('.idx') || name.endsWith('.rev')) await rm(join(packDir, name), { force: true })
      }
      const tree = await git(s, s.workspace.root, ['--git-dir', cache, 'rev-parse', `${remote.head}^{tree}`])
      const object = join(cache, 'objects', tree.slice(0, 2), tree.slice(2))
      expect(existsSync(object), 'the tree object is not loose, so deleting it proves nothing').toBe(true)
      await rm(object)

      const r = await run(s, cli, proj, ['drift'])

      expect(r.code, r.output).toBe(5)
      expect(r.stderr).toContain(`cache ${cache} is damaged`)
      expect(r.stderr).toContain(`rm -rf ${cache}`)
      expectNoReport(r)
    })
  })

  it('#27b a truncated pack heals on refresh: exit 0 and a correct report', async () => {
    await scenario('sync-by-address-27b', async (s) => {
      const remote = await blueprintRemote(s, 'published')
      const proj = await project(s, remote.dir, remote.head, 'OLD')
      const cli = await cliCopy(s, 'cli')
      const warm = await run(s, cli, proj, ['drift'])
      expect(warm.code, warm.output).toBe(0)

      // A fixture this small is fetched as loose objects, so pack it first — under
      // a temporary ref, since repack packs only what a ref reaches, and removed
      // again so the cache holds no refs between runs, as in use.
      const cache = await onlyCache(s)
      await git(s, s.workspace.root, ['--git-dir', cache, 'update-ref', 'refs/heads/pack-me', remote.head])
      await git(s, s.workspace.root, ['--git-dir', cache, 'repack', '-a', '-d', '-q'])
      await git(s, s.workspace.root, ['--git-dir', cache, 'update-ref', '-d', 'refs/heads/pack-me'])
      const packs = (await readdir(join(cache, 'objects/pack'))).filter((n) => n.endsWith('.pack'))
      expect(packs, 'no pack to truncate').not.toEqual([])
      for (const name of packs) {
        const file = join(cache, 'objects/pack', name)
        const { size } = await stat(file)
        await chmod(file, 0o644)
        await truncate(file, Math.floor(size / 2))
      }

      const r = await run(s, cli, proj, ['drift'])

      expect(r.code, r.output).toBe(0)
      expect(r.stdout).toMatch(fetched(remote.head))
      expect(fixtureMarked(r.output, '~'), r.output).toEqual(['docs/DoD.md'])
    })
  })

  it('#28 eight concurrent first runs all succeed and leave one cache, with no init debris (smoke)', async () => {
    await scenario('sync-by-address-28', async (s) => {
      const remote = await blueprintRemote(s, 'published')
      const proj = await project(s, remote.dir, remote.head, 'OLD')
      const cli = await cliCopy(s, 'cli')

      const results = await Promise.all(Array.from({ length: 8 }, () => run(s, cli, proj, ['drift'])))

      for (const r of results) expect(r.code, r.output).toBe(0)
      expect(await caches(s)).toHaveLength(1)
      const debris = (await readdir(cacheRoot(s))).filter((n) => n.startsWith('.bp-cache-init.'))
      expect(debris).toEqual([])
      await expectNothingLeft(s, 'eight runs')
    })
  })

  it("#28b a lost creation race's temp directory inside a valid cache is removed by the next run", async () => {
    await scenario('sync-by-address-28b', async (s) => {
      const remote = await blueprintRemote(s, 'published')
      const proj = await project(s, remote.dir, remote.head, 'OLD')
      const cli = await cliCopy(s, 'cli')
      const warm = await run(s, cli, proj, ['drift'])
      expect(warm.code, warm.output).toBe(0)

      // GNU and BSD mv both put a loser's temp INSIDE the winner.
      const stray = join(await onlyCache(s), '.bp-cache-init.STRAY0001')
      await mkdir(stray)
      await writeFile(join(stray, 'HEAD'), 'ref: refs/heads/main\n')

      const r = await run(s, cli, proj, ['drift'])

      expect(r.code, r.output).toBe(0)
      expect(existsSync(stray), 'the lost race left its temp in the cache').toBe(false)
    })
  })

  it('#30 blueprint_release_branch is the branch drift and pull read, and it is validated', async () => {
    await scenario('sync-by-address-30', async (s) => {
      // `main` is one commit ahead of `released`, and that commit changes a
      // managed file, so which branch was read is visible in the report itself.
      const remote = await blueprintRemote(s, 'released-content')
      await git(s, remote.dir, ['branch', 'released'])
      const mainTip = await advance(s, remote.dir, 'main-only')
      const cli = await cliCopy(s, 'cli')

      const rel = await project(s, remote.dir, remote.head, 'OLD', {
        tag: 'rel',
        extra: ['blueprint_release_branch = released'],
      })
      const d1 = await run(s, cli, rel, ['drift'])
      expect(d1.code, d1.output).toBe(0)
      expect(d1.stdout).toContain(`blueprint:  ${remote.dir}  (released)`)
      expect(d1.stdout).toMatch(fetched(remote.head))
      const p1 = await run(s, cli, rel, ['pull', '--yes'])
      expect(p1.code, p1.output).toBe(0)
      expect(await readFile(join(rel, 'docs/DoD.md'), 'utf8')).toBe(dodText('proj', 'released-content'))
      expect(await readFile(join(rel, '.blueprint-source'), 'utf8')).toMatch(
        new RegExp(`^bootstrap_sha\\s*=\\s*${remote.head}$`, 'm'),
      )

      // Field absent: blueprint_branch, exactly as before commit 3.
      const plain = await project(s, remote.dir, remote.head, 'OLD', { tag: 'plain' })
      const d2 = await run(s, cli, plain, ['drift'])
      expect(d2.code, d2.output).toBe(0)
      expect(d2.stdout).toContain(`blueprint:  ${remote.dir}  (main)`)
      expect(d2.stdout).toMatch(fetched(mainTip))
      const p2 = await run(s, cli, plain, ['pull', '--yes'])
      expect(p2.code, p2.output).toBe(0)
      expect(await readFile(join(plain, 'docs/DoD.md'), 'utf8')).toBe(dodText('proj', 'main-only'))
      expect(await readFile(join(plain, '.blueprint-source'), 'utf8')).toMatch(
        new RegExp(`^bootstrap_sha\\s*=\\s*${mainTip}$`, 'm'),
      )

      // A name git would refuse is refused before any transport, naming the field.
      const bad = await project(s, remote.dir, remote.head, 'OLD', {
        tag: 'bad',
        extra: ['blueprint_release_branch = bad..name'],
      })
      const d3 = await run(s, cli, bad, ['drift'])
      expect(d3.code, d3.output).toBe(4)
      expect(d3.stderr).toContain('blueprint_release_branch')
      expectNoReport(d3)
    })
  })

  it("#31 a2bp's base does not move: it still files against blueprint_branch", async () => {
    await scenario('sync-by-address-31', async (s) => {
      const remote = await blueprintRemote(s, 'released-content')
      await git(s, remote.dir, ['branch', 'released'])
      const mainTip = await advance(s, remote.dir, 'main-only')
      const proj = await project(s, remote.dir, mainTip, 'a project improvement', {
        extra: ['blueprint_release_branch = released'],
      })
      const cli = await cliCopy(s, 'cli')

      const r = await run(s, cli, proj, ['a2bp', '--dry-run', 'docs/DoD.md'])

      expect(r.code, r.output).toBe(0)
      expect(r.stdout, 'a2bp filed against the release branch').toMatch(/branch:\s+main\s*$/m)
      expect(r.stdout, "a2bp's base is not main's tip").toMatch(new RegExp(`base:\\s+${mainTip}\\b`))
    })
  })

  it('#32 switched before released caught up: said so, then the normal list once it has', async () => {
    await scenario('sync-by-address-32', async (s) => {
      const remote = await blueprintRemote(s, 'r')
      await git(s, remote.dir, ['branch', 'released'])
      const mainOnly = await advance(s, remote.dir, 'main-one')
      const mainTip = await advance(s, remote.dir, 'main-two')
      // Synced to a commit released does not contain yet.
      const proj = await project(s, remote.dir, mainOnly, 'main-two', {
        extra: ['blueprint_release_branch = released'],
      })
      const cli = await cliCopy(s, 'cli')

      const early = await run(s, cli, proj, ['drift'])
      expect(early.code, early.output).toBe(0)
      expect(early.stdout).toContain(`bootstrap_sha ${mainOnly} is not in ${remote.dir} released history`)
      expect(early.stdout).toContain('not yet released')
      expect(early.stdout).not.toContain('commit(s) since')

      await git(s, remote.dir, ['branch', '-f', 'released', mainTip])
      const later = await run(s, cli, proj, ['drift'])
      expect(later.code, later.output).toBe(0)
      expect(later.stdout).not.toContain('is not in')
      expect(later.stdout).toContain('Blueprint has 1 commit(s) since this project was last synced')
      expect(later.stdout).toContain('main-two')
    })
  })

  it("#33 the release job's declared shape: bash, push events in this repository, after every other job, the only writer", async (ctx) => {
    const notGithub = await notGithubActions(REPO_ROOT)
    if (notGithub) skipVisibly(ctx, notGithub)
    const text = await readFile(join(REPO_ROOT, '.github/workflows/security.yml'), 'utf8')
    const found = releaseOf(text)
    expect(found, 'no job publishes refs/heads/released').not.toBeNull()
    if (!found) return
    const { wf, id, job, step } = found

    expect(step.shell, 'the release step does not declare shell: bash').toBe('bash')
    expect(job.if ?? '', 'the release job can run for non-push events').toContain("github.event_name == 'push'")
    expect(job.if ?? '', 'the release job runs in every repository the file ships to').toMatch(
      /github\.repository\s*==\s*'[^']+'/,
    )

    // DERIVED, not listed: a job added later and left out of `needs` fails here.
    const others = Object.keys(wf.jobs ?? {}).filter((j) => j !== id).sort()
    const needs = (Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : []).slice().sort()
    expect(needs, 'the release does not wait for every other job').toEqual(others)

    expect(job.permissions?.contents, 'the release job cannot push').toBe('write')
    expect(JSON.stringify(wf.permissions ?? {}), 'the whole workflow was granted write').not.toContain('write')
    for (const other of others) {
      expect(wf.jobs?.[other]?.permissions?.contents, `${other} was granted contents: write`).not.toBe('write')
    }
  })

  it('#33b the release block, run: every state of released, with and without a fetch refspec', async (ctx) => {
    const notGithub = await notGithubActions(REPO_ROOT)
    if (notGithub) skipVisibly(ctx, notGithub)
    await scenario('sync-by-address-33b', async (s) => {
      const found = releaseOf(await readFile(join(REPO_ROOT, '.github/workflows/security.yml'), 'utf8'))
      expect(found, 'no release block to run').not.toBeNull()
      const block = found?.step.run ?? ''

      // A bare remote holding C1 <- C2 <- C3 on main, and X branching from C1.
      const src = await s.workspace.dir('src')
      await s.fs.write(join(src, 'f'), '1\n')
      await initRepo(s, src)
      const c1 = await commitAll(s, src, 'C1')
      await s.fs.write(join(src, 'f'), '2\n')
      const c2 = await commitAll(s, src, 'C2')
      await s.fs.write(join(src, 'f'), '3\n')
      const c3 = await commitAll(s, src, 'C3')
      await git(s, src, ['checkout', '-q', '-b', 'x', c1])
      await s.fs.write(join(src, 'f'), 'x\n')
      const x = await commitAll(s, src, 'X')
      const bare = s.workspace.path('origin.git')
      await git(s, s.workspace.root, ['init', '-q', '--bare', '-b', 'main', bare])
      await git(s, src, ['push', '-q', bare, `${c3}:refs/heads/main`, `${x}:refs/heads/x`])

      const states: Array<{ tag: string; before: string; sha: string; code: 0 | 1; after: string }> = [
        { tag: 'a-missing', before: '', sha: c2, code: 0, after: c2 },
        { tag: 'b-newer-published', before: c3, sha: c2, code: 0, after: c3 },
        { tag: 'c-diverged', before: x, sha: c3, code: 1, after: x },
        { tag: 'd-older', before: c1, sha: c3, code: 0, after: c3 },
      ]
      for (const shape of ['refspec', 'url-only'] as const) {
        for (const st of states) {
          const tag = `${shape}-${st.tag}`
          if (st.before) await git(s, s.workspace.root, ['--git-dir', bare, 'update-ref', 'refs/heads/released', st.before])
          else await s.run('git', ['--git-dir', bare, 'update-ref', '-d', 'refs/heads/released'], { cwd: s.workspace.root })

          // What the checkout action leaves: the tested commit's objects, and
          // either a configured remote or only its URL.
          const work = await s.workspace.dir(`work-${tag}`)
          await git(s, work, ['init', '-q', '-b', 'main', '.'])
          if (shape === 'refspec') {
            await git(s, work, ['remote', 'add', 'origin', bare])
            await git(s, work, ['fetch', '-q', 'origin'])
          } else {
            await git(s, work, ['config', 'remote.origin.url', bare])
            await git(s, work, ['fetch', '-q', 'origin', 'main'])
          }

          const r = await runReleaseBlock(s, block, work, st.sha, tag)
          expect(r.code === 0 ? 0 : 1, `${tag}: exit status\n${r.output}`).toBe(st.code)
          expect(await bareRef(s, bare, 'refs/heads/released'), `${tag}: where released ended`).toBe(st.after)
        }
      }
    })
  })

  it('#39 the rollback reaches migrated projects: published through the job, the job removed last', async (ctx) => {
    const notGithub = await notGithubActions(REPO_ROOT)
    if (notGithub) skipVisibly(ctx, notGithub)
    await scenario('sync-by-address-39', async (s) => {
      // "CI" is this function: after every push, if the workflow AT THE PUSHED
      // SHA has the release job, run that SHA's own release block against the
      // bare remote. That is how GitHub picks the workflow to run.
      const bare = s.workspace.path('origin.git')
      await git(s, s.workspace.root, ['init', '-q', '--bare', '-b', 'main', bare])
      let ciRun = 0
      const pushAndCi = async (sha: string) => {
        await git(s, bp, ['push', '-q', 'origin', 'main'])
        const shown = await s.run('git', ['--git-dir', bare, 'show', `${sha}:.github/workflows/security.yml`], {
          cwd: s.workspace.root,
        })
        const found = shown.code === 0 ? releaseOf(shown.stdout) : null
        if (!found?.step.run) return
        ciRun += 1
        const work = s.workspace.path(`ci-${ciRun}`)
        await git(s, s.workspace.root, ['clone', '-q', bare, work])
        await git(s, work, ['checkout', '-q', '--detach', sha])
        const r = await runReleaseBlock(s, found.step.run, work, sha, `ci-${ciRun}`)
        expect(r.code, `the release job failed at ${sha}\n${r.output}`).toBe(0)
      }

      const bp = await s.workspace.dir('bp')
      await s.fs.write(join(bp, 'CLAUDE.md'), '# CLAUDE\nfor {{PROJECT_NAME}}\n')
      await s.fs.write(join(bp, 'docs/DoD.md'), dodText('{{PROJECT_NAME}}', 'B-content'))
      await s.fs.write(join(bp, 'tests/fixture/test.sh'), 'echo fixture\n')
      await s.fs.write(join(bp, '.github/workflows/security.yml'), MINIMAL_WORKFLOW)
      await initRepo(s, bp)
      const b = await commitAll(s, bp, 'B')
      await git(s, bp, ['remote', 'add', 'origin', bare])
      await pushAndCi(b)

      const ta = await advance(s, bp, 'Ta-content')
      await pushAndCi(ta)
      await s.fs.write(
        join(bp, '.github/workflows/security.yml'),
        await readFile(join(REPO_ROOT, '.github/workflows/security.yml'), 'utf8'),
      )
      const tb = await commitAll(s, bp, 'Tb: the release job')
      await pushAndCi(tb)
      expect(await bareRef(s, bare, 'refs/heads/released'), 'the job did not publish Tb').toBe(tb)

      const cli = await cliCopy(s, 'cli')
      const proj = await project(s, bare, tb, 'Ta-content', { extra: ['blueprint_release_branch = released'] })

      // §10 step 1, verbatim in shape: revert every TASK commit, KEEP the workflow.
      await git(s, bp, ['revert', '--no-commit', tb, ta])
      await git(s, bp, ['checkout', 'HEAD', '--', '.github/workflows/security.yml'])
      const rollback = await commitAll(s, bp, 'roll back, keeping the release job so released carries the rollback')
      await pushAndCi(rollback)

      const after1 = await run(s, cli, proj, ['drift'])
      expect(after1.code, after1.output).toBe(0)
      expect(after1.stdout, 'a migrated project does not see the rollback').toMatch(fetched(rollback))
      expect(fixtureMarked(after1.output, '~'), after1.output).toContain('docs/DoD.md')
      const pulled = await run(s, cli, proj, ['pull', 'docs/DoD.md', '--yes'])
      expect(pulled.code, pulled.output).toBe(0)
      expect(await readFile(join(proj, 'docs/DoD.md'), 'utf8')).toBe(dodText('proj', 'B-content'))

      // §10 step 5: only then remove the job. Its run has none, so released stays.
      await git(s, bp, ['checkout', b, '--', '.github/workflows/security.yml'])
      const removal = await commitAll(s, bp, 'remove the release job')
      await pushAndCi(removal)
      expect(await bareRef(s, bare, 'refs/heads/released'), 'removing the job moved released').toBe(rollback)
      const after5 = await run(s, cli, proj, ['drift'])
      expect(after5.code, after5.output).toBe(0)
      expect(after5.stdout).toMatch(fetched(rollback))
    })
  })

  it('#29 a leftover blueprint_source warns once on every run and changes nothing else', async () => {
    await scenario('sync-by-address-29', async (s) => {
      const remote = await blueprintRemote(s, 'published')
      const decoy = await s.workspace.dir('decoy')
      await s.fs.write(join(decoy, 'docs/DoD.md'), dodText('proj', 'DECOY'))
      const cli = await cliCopy(s, 'cli')
      const withField = await project(s, remote.dir, remote.head, 'OLD', {
        tag: 'with',
        extra: [`blueprint_source = ${decoy}`],
      })
      const without = await project(s, remote.dir, remote.head, 'OLD', { tag: 'without' })

      // What legitimately differs between two runs: the project's path, the fetch
      // time, and the preview's `diff -u` header lines (mtimes, temp-file names).
      const normal = (text: string, proj: string) =>
        text
          .split(proj)
          .join('<PROJ>')
          .replace(/ at \d{4}-\d\d-\d\dT[\d:]+Z/g, ' at <TIME>')
          .replace(/^(---|\+\+\+) .*$/gm, '$1 <FILE>')
      const warnings = (text: string) => text.split(WARNING).length - 1

      for (const args of [['drift'], ['drift'], ['pull', '--yes']]) {
        const a = await run(s, cli, withField, args)
        const b = await run(s, cli, without, args)
        const label = args.join(' ')
        expect(warnings(a.stderr), `${label}: the warning did not print exactly once\n${a.stderr}`).toBe(1)
        expect(a.code, `${label}: the field changed the exit status`).toBe(b.code)
        expect(normal(a.stdout, withField), `${label}: the field changed stdout`).toBe(normal(b.stdout, without))
        expect(b.output, `${label}: blueprint_source mentioned with no such field`).not.toContain('blueprint_source')
      }

      const local = await run(s, cli, withField, ['drift'], { BLUEPRINT_ROOT: remote.dir })
      expect(warnings(local.stderr), 'the override path skipped the warning').toBe(1)
    })
  })
})
