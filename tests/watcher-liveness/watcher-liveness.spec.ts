/**
 * tests/watcher-liveness/watcher-liveness.spec.ts — BUG-022.
 *
 * A dispatch to a dead watcher fails SILENTLY. The baton reads OVER_TO_CODEX, the
 * feed is quiet exactly as it looks when an agent is thinking, and the run log —
 * the only honest surface — is the one nobody reads. On 2026-08-05 a BA dispatch
 * sat unheard until the founder asked; a peer project's identical incident cost
 * ~40 minutes.
 *
 * The mic state and the dispatcher's liveness are two facts that are unremarkable
 * alone and conclusive together. Nothing compared them.
 *
 * WHY flock AND NEVER pgrep. Every process-table check written during that
 * incident matched the checking shell's OWN command line — a `pgrep -f` for a
 * pattern present in its own arguments — and was wrong three different ways. A
 * lock is repo-scoped, cannot self-match, and is released by the KERNEL on death
 * including SIGKILL, so "can I take it?" answers "is a holder alive?" with no
 * stale-pid ambiguity.
 *
 * EQUIVALENCE RECORD (R6, and this migration's own evidence).
 *
 * Nineteen trees — one per check carrying exactly the defect it exists to catch,
 * plus the healthy control and two negative controls — were built once and BOTH
 * implementations run over each: the retiring `tests/watcher-liveness/test.sh`,
 * copied into the tree, and this spec with `BP_SPEC_ROOT` pointed at it. The
 * per-id verdict sets were compared mechanically. Divergences are recorded in the
 * report for TASK-018 rather than smoothed over; the two that matter are:
 *
 *   - `#2`'s lock-path assertion ("the lock is not beside the baton dir it was
 *     given") had NO pass branch in the shell version — it could only ever print
 *     a failure, so on a healthy tree it was invisible and its absence from the
 *     output was indistinguishable from it not existing. Here it is a named case.
 *     That is a tightening, and it is the reason to look: an assertion with no
 *     positive outcome cannot be told from an assertion that was deleted.
 *   - the shell `#3` greps the lib with comments stripped and `#4`/`#5` grep the
 *     watcher and the feed RAW. So documenting `pgrep` in either of those two
 *     files is safe and documenting `dead_last` is not, for no reason anyone
 *     chose. Every source check here strips comments.
 *
 * `#2`'S LOCK-PATH ASSERTION NOW HAS ITS OWN NEGATIVE PROOF, added 2026-09-11
 * after a cross-provider review observed that the recorded population proved the
 * derivation and proved both callers mention the library, but never reddened this
 * case specifically.
 *
 * Mutant `W1`: `bp_watch_lock_path`'s `_wl_dir="${1:-.}"` replaced by
 * `_wl_dir="$(git rev-parse --show-toplevel)"` — the lock derived from a repo
 * ROOT instead of the baton directory it was handed, which is the incident this
 * function's docblock describes. OBSERVED, both implementations:
 *
 *     shell   #2 (the lock path), #6 (x2), #7
 *     port    × #2 the lock is derived from the baton dir it was given, not from
 *               a repo root
 *             × #2 dead · × #2 alive · × #2 after SIGKILL
 *             × #6 (x2) · × #7 it put the lock beside the baton it was watching
 *
 * The collateral is the defect being real rather than the mutant being blunt —
 * every lock user is broken by it — and the named case is red in both. Harness:
 * `.scratch/markus-feed-r6.sh`.
 *
 * This does NOT close BUG-092 part 5. A SPLIT derivation — the feed passing
 * `$state_dir` where the watcher passes `dirname "$signal_file"` — is still
 * invisible to both implementations, because every fixture makes those two the
 * same directory. That needs a new case with them deliberately different, not a
 * stricter version of this one.
 *
 * TIMING (R4). No case waits a duration. The two that need a lock HELD by a live
 * process use a pid-file handshake: the holder writes its pid and `exec`s a long
 * sleep, so the test waits for the FILE to exist and then kills the exact process
 * whose fd holds the lock. The two that drive a real feed wait for a line to
 * appear, and prove that further ticks elapsed by round-tripping a sentinel
 * through the pumped run log — not by sleeping and hoping.
 */

import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { startWatcher, until } from '../harness/watcher.js'
import { feedFixture } from '../helpers/feed-fixture.js'

/**
 * The tree under test. `BP_SPEC_ROOT` repoints it at a perturbed copy, which is
 * how the equivalence driver runs this spec and the retiring shell suite over the
 * same bytes. It selects the SUBJECT, never the sandbox.
 */
const SUBJECT = process.env.BP_SPEC_ROOT ?? REPO_ROOT

const LIB = join(SUBJECT, 'scripts', 'lib', 'watcher-lock.sh')
const WATCH = join(SUBJECT, 'scripts', 'signal-watch.mts')
const FEED = join(SUBJECT, 'scripts', 'agent-activity.sh')

/**
 * A script's source with comments stripped.
 *
 * The lib NAMES `pgrep` in the comment explaining why it must never be used, and
 * a check that cannot tell an explanation from a call would force that
 * explanation to be deleted to stay green — removing the one place a future
 * reader learns why.
 */
async function code(path: string): Promise<string> {
  const raw = await readFile(path, 'utf8').catch(() => '')
  return raw.replace(/^[ \t]*#.*$/gm, '')
}

/** Call a lock-lib function in the tree under test. */
async function lib(s: Scenario, snippet: string): Promise<string> {
  const r = await s.run('sh', ['-c', `. "${LIB}"; ${snippet}`], { cwd: s.workspace.root })
  return r.stdout.trim()
}

/**
 * A baton dir with a baton in it — the first argument every lock function takes.
 *
 * The default state is ACTIVE, so a watcher on it waits rather than dispatches.
 * The lock is taken for the state the watcher is WAITING FOR, not the state the
 * baton reads, so #7 passes OVER_TO_CODEX deliberately: the dispatch is its proof
 * that the watcher got past the lock step.
 */
async function batonDir(s: Scenario, rel = 'proj/logs/state', state = 'ACTIVE'): Promise<string> {
  const dir = await s.fs.mkdirp(rel)
  await s.fs.write(
    `${rel}/signal.md`,
    `| Field | Value |\n|---|---|\n| Holder | X |\n| State | ${state} |\n| Task | t |\n`,
  )
  return dir
}

/**
 * Hold a lock with a real process, and return a release function.
 *
 * `flock file cmd` FORKS rather than execs, so the command inherits the open fd
 * and keeps the lock held after its parent dies. That is not a quirk to route
 * around — it is exactly how a real watcher's children behave, and a test that
 * killed only the parent would assert something production never does. So the
 * inner shell `exec`s the sleep: the pid file then names the process whose fd
 * actually holds the lock, and killing it is what releases it.
 */
async function holdLock(
  s: Scenario,
  lockPath: string,
  pidFile: string,
): Promise<{ release: (signal: string) => Promise<void>; settled: Promise<unknown> }> {
  const settled = s
    .run(
      'flock',
      [lockPath, 'sh', '-c', `echo $$ > "${pidFile}"; exec sleep 300`],
      { cwd: s.workspace.root, timeoutMs: 120_000 },
    )
    .catch(() => undefined)

  // Condition, not a duration: the lock is held once the holder has published
  // the pid it holds it with.
  await vi.waitFor(async () => expect(await s.fs.exists(pidFile)).toBe(true), {
    timeout: 20_000,
    interval: 50,
  })

  return {
    settled,
    release: async (signal) => {
      const pid = (await s.fs.read(pidFile)).trim()
      await s.run('kill', [signal, pid], { cwd: s.workspace.root })
      // The kernel releases on process death, so the condition to wait for is
      // that the lock has become takeable — never a sleep after the kill.
      await vi.waitFor(
        async () => {
          const r = await s.run('flock', ['-n', lockPath, 'true'], { cwd: s.workspace.root })
          expect(r.code).toBe(0)
        },
        { timeout: 20_000, interval: 50 },
      )
    },
  }
}

/**
 * A "live repo" INSIDE the workspace: the watcher and its libs from the tree
 * under test, under a root marker, with its own `logs/state/`.
 *
 * U8. #7 used to read the REAL checkout's state root, where a genuine dispatcher
 * — which AGENTS.md says to start once and leave running — legitimately keeps its
 * lock. The watcher resolves its state root from its own physical location, so a
 * copy here is a live repo in every respect the lock derivation can see, and a
 * pre-existing dispatcher lock can be planted without touching real state.
 */
async function liveRepo(s: Scenario, name = 'live') {
  const root = await s.fs.mkdirp(name)
  await s.fs.write(`${name}/.blueprint-source`, '')
  const watch = await s.fs.copyIn(WATCH, `${name}/scripts/signal-watch.mts`)
  // The WHOLE lib dir, never named files — feed-fixture.ts records why.
  // TASK-065 (round 3): signal-watch.mts now imports a sibling .mts lib
  // (scripts/lib/spawn-bounded.mts) directly, not just the .sh libs it
  // sources through shell functions — the filter has to carry both
  // extensions or the copied-out watcher fails ERR_MODULE_NOT_FOUND.
  const libs = await s.run('sh', ['-c', `ls "${join(SUBJECT, 'scripts', 'lib')}"`], {
    cwd: s.workspace.root,
  })
  for (const n of libs.stdout.split('\n').filter((f) => f.endsWith('.sh') || f.endsWith('.mts'))) {
    await s.fs.copyIn(join(SUBJECT, 'scripts', 'lib', n), `${name}/scripts/lib/${n}`)
  }
  const stateDir = await s.fs.mkdirp(`${name}/logs/state`)
  return { root, watch, stateDir }
}

describe('BUG-022 — a dispatch into silence is visible', () => {
  it('#1 scripts/lib/watcher-lock.sh exists', async () => {
    // Without it the watcher and the feed each invent one, and two
    // implementations of "is a watcher alive" disagree exactly when it matters
    // while each keeps passing its own tests.
    expect(await code(LIB)).not.toBe('')
  })

  it('#1 bp_watch_lock_path is exposed', async () => {
    await scenario('wl-1a', async (s) => {
      const r = await s.run(
        'sh',
        ['-c', `. "${LIB}"; command -v bp_watch_lock_path >/dev/null 2>&1`],
        { cwd: s.workspace.root },
      )
      expect(r.code).toBe(0)
    })
  })

  it('#1 bp_watch_liveness is exposed', async () => {
    await scenario('wl-1b', async (s) => {
      const r = await s.run(
        'sh',
        ['-c', `. "${LIB}"; command -v bp_watch_liveness >/dev/null 2>&1`],
        { cwd: s.workspace.root },
      )
      expect(r.code).toBe(0)
    })
  })

  it("#2 no lock file → 'none' (a project without watchers is never warned)", async () => {
    await scenario('wl-2-none', async (s) => {
      const dir = await batonDir(s)
      // THIS is what makes the check safe to run unconditionally on every poll.
      // A project that has never run a watcher must never be warned about one it
      // never had, or the warning becomes noise and noise gets muted.
      expect(await lib(s, `bp_watch_liveness "${dir}" OVER_TO_CODEX`)).toBe('none')
    })
  })

  it('#2 the lock is derived from the baton dir it was given, not from a repo root', async () => {
    await scenario('wl-2-path', async (s) => {
      const dir = await batonDir(s)
      const lock = await lib(s, `bp_watch_lock_path "${dir}" OVER_TO_CODEX`)

      // THE SHELL VERSION OF THIS ASSERTION HAD NO PASS BRANCH — it could only
      // print a failure — so on a healthy tree it was invisible. Deriving the
      // lock from a ROOT is what let a test's watcher take the LIVE repo's lock
      // (see #7), so it is worth a case that can be seen succeeding.
      expect(lock.startsWith(dir + '/')).toBe(true)
      expect(lock).toBe(join(dir, '.watch-over_to_codex.lock'))
    })
  })

  it("#2 an unheld lock file → 'dead' (a watcher was expected and is gone)", async () => {
    await scenario('wl-2-dead', async (s) => {
      const dir = await batonDir(s)
      await s.fs.write('proj/logs/state/.watch-over_to_codex.lock', '')

      // THIS IS THE INCIDENT: a watcher claimed this mic at some point, and is
      // gone.
      expect(await lib(s, `bp_watch_liveness "${dir}" OVER_TO_CODEX`)).toBe('dead')
    })
  })

  it("#2 a held lock → 'alive'", async () => {
    await scenario('wl-2-alive', async (s) => {
      const dir = await batonDir(s)
      const lock = join(dir, '.watch-over_to_codex.lock')
      await s.fs.write('proj/logs/state/.watch-over_to_codex.lock', '')
      const holder = await holdLock(s, lock, join(s.workspace.root, 'holder.pid'))

      expect(await lib(s, `bp_watch_liveness "${dir}" OVER_TO_CODEX`)).toBe('alive')

      await holder.release('-TERM')
      await holder.settled
    })
  })

  it("#2 after SIGKILL → 'dead' (the kernel released it; no stale-pid ambiguity)", async () => {
    await scenario('wl-2-sigkill', async (s) => {
      const dir = await batonDir(s)
      const lock = join(dir, '.watch-over_to_codex.lock')
      await s.fs.write('proj/logs/state/.watch-over_to_codex.lock', '')
      const holder = await holdLock(s, lock, join(s.workspace.root, 'holder.pid'))
      expect(await lib(s, `bp_watch_liveness "${dir}" OVER_TO_CODEX`)).toBe('alive')

      // SIGKILL leaves no chance to clean up. The kernel releases the lock
      // anyway, which is the entire reason this is a lock and not a pid file.
      await holder.release('-KILL')
      await holder.settled

      expect(await lib(s, `bp_watch_liveness "${dir}" OVER_TO_CODEX`)).toBe('dead')
    })
  })

  it('#3 the lib never greps the process table', async () => {
    const body = await code(LIB)
    // Guarded on the lib being NON-EMPTY, or this passes vacuously: a grep over a
    // missing file finds no pgrep and reports clean, which is a green earned by
    // the ABSENCE of the thing under test. That was in the shell version's first
    // draft, and it is the failure this suite exists to prevent one level up.
    expect(body, 'cannot check for process-table use — the lib does not exist').not.toBe('')
    expect(body, 'the lib consults the process table — it will match its own command line')
      .not.toMatch(/pgrep|pidof|ps -ef|ps -eo/)
  })

  /**
   * #4 — BEHAVIOURAL, not a source grep (BUG-144 commit 0). The two cases this
   * replaces read `code(WATCH)` for `watcher-lock.sh` and `bp_watch_hold` —
   * properties of WATCH's own source text. That stops meaning anything once a
   * migrated consumer is a two-line shim (TASK-067): the shim contains
   * neither string, and the guarantee moves to its `.mts` target, which holds
   * the lock by an entirely different mechanism (a lifeline pipe, not a
   * sourced shell function). The GUARANTEE — the watcher holds a real lock
   * for its whole life, so a second watcher on the same state is refused —
   * is observable from OUTSIDE regardless of implementation, which is the
   * F-002 lesson (a source grep is a proxy; prefer the thing itself). Proven
   * here against WATCH as shipped today (still shell) and unchanged, with no
   * further edit, once WATCH is the shim: `startWatcher`/`s.background` just
   * run the file at that path, whatever it execs.
   */
  it('#4 the watcher holds the lock for its lifetime — a second watcher on the same state is refused', async () => {
    await scenario('wl-4-refuse', async (s) => {
      const dir = await batonDir(s, 'proj/logs/state', 'ACTIVE')
      const args = [
        WATCH,
        '--file', join(dir, 'signal.md'),
        '--state', 'OVER_TO_CODEX',
        '--poll', '0.2',
        '--log', join(dir, 'signal.log'),
      ]
      const first = startWatcher(s, 'node', args)
      try {
        await until(
          'the first watcher holds the lock',
          async () => (await lib(s, `bp_watch_liveness "${dir}" OVER_TO_CODEX`)) === 'alive',
        )

        const second = await s.run('node', args, { cwd: s.workspace.root, timeoutMs: 15_000 })

        expect(
          second.code,
          `a second watcher on the same state was not refused:\n${second.output}`,
        ).toBe(1)
        expect(second.output).toMatch(/already holds/)
        first.assertStillRunning(
          'refusing the second watcher must not disturb the first',
        )
      } finally {
        await first.stop()
      }
    })
  })

  it('#4 SIGKILL of the watcher frees the lock — no cleanup needed (TASK-006)', async () => {
    await scenario('wl-4-sigkill', async (s) => {
      const dir = await batonDir(s, 'proj/logs/state', 'ACTIVE')
      const child = s.background(
        'node',
        [
          WATCH,
          '--file', join(dir, 'signal.md'),
          '--state', 'OVER_TO_CODEX',
          '--poll', '0.2',
          '--log', join(dir, 'signal.log'),
        ],
        { cwd: s.workspace.root },
      )
      const pid = child.pid
      expect(pid, 'the watcher never started').toBeDefined()

      await until(
        'the watcher holds the lock',
        async () => (await lib(s, `bp_watch_liveness "${dir}" OVER_TO_CODEX`)) === 'alive',
      )

      process.kill(pid as number, 'SIGKILL')

      // 'dead', not 'none': TASK-006 — the lock FILE is never removed, only
      // released. Its persistence is the record that a watcher was expected.
      await until(
        'SIGKILL released the lock (it reads dead, not alive)',
        async () => (await lib(s, `bp_watch_liveness "${dir}" OVER_TO_CODEX`)) === 'dead',
      )
    })
  })

  it("#5 the feed compares the mic against the dispatcher's liveness", async () => {
    expect(await code(FEED)).toMatch(/bp_watch_liveness/)
  })

  it('#5 the warning is edge-triggered, not repeated every poll', async () => {
    // A line on every poll trains the operator to ignore the feed, which is the
    // failure this is meant to prevent rather than cause.
    expect(await code(FEED)).toMatch(/dead_last/)
  })

  it('#6 a running feed warns that the mic is held with nobody listening', async () => {
    await scenario('wl-6-dead', async (s) => {
      // #4 and #5 are source checks: they prove the code SAYS the right thing,
      // not that a running supervisor emits the warning. That distinction is the
      // entire subject of this bug — a check nothing invokes looks exactly like a
      // check that passed.
      const f = await feedFixture(s, 'dead', {
        source: SUBJECT,
        holder: 'Codexy',
        state: 'OVER_TO_CODEX',
      })
      // An unheld lock: a watcher claimed this state and is gone.
      await s.fs.write('dead/state/.watch-over_to_codex.lock', '')

      await f.withFeed(async () => {
        await f.expectLine('NO watcher is listening')
      })
    })
  })

  it('#6 it fires exactly once across many polls, not per tick', async () => {
    await scenario('wl-6-once', async (s) => {
      const f = await feedFixture(s, 'once', {
        source: SUBJECT,
        holder: 'Codexy',
        state: 'OVER_TO_CODEX',
      })
      await s.fs.write('once/state/.watch-over_to_codex.lock', '')
      // A pumped Claude subagent JSONL is how further ticks are PROVEN to have
      // elapsed. Provider run logs are labelled at dispatch and deliberately are
      // not supervisor subjects; a sentinel that comes back out of this real
      // supervisor source is evidence, and it does not get slower on a loaded box.
      const subject = `home/.claude/projects/${f.repo.replace(/\//g, '-')}/sess/subagents/agent-liveness-once.jsonl`
      await s.fs.write(subject, '')

      await f.withFeed(async () => {
        await f.expectLine('NO watcher is listening')
        await f.readerReady(subject, {
          wrap: (tag) => `${JSON.stringify({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: tag }] } })}\n`,
        })
        for (const tick of ['TICK-A', 'TICK-B', 'TICK-C']) {
          await s.fs.write(
            subject,
            `${JSON.stringify({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: tick }] } })}\n`,
            { append: true },
          )
          await f.expectLine(tick)
        }

        expect(
          await f.count('NO watcher is listening'),
          'a per-poll warning trains the operator to ignore it',
        ).toBe(1)
      })
    })
  })

  it('#6 a live watcher produces no warning, and the feed WAS running', async () => {
    await scenario('wl-6-alive', async (s) => {
      // NON-VACUITY, AND IT IS LOAD-BEARING: an implementation that warned
      // unconditionally would satisfy both cases above. This one must also prove
      // the feed was AWAKE, or "no warning" cannot be told from "never ran".
      const f = await feedFixture(s, 'alive', {
        source: SUBJECT,
        holder: 'Codexy',
        state: 'OVER_TO_CODEX',
      })
      await s.fs.write('alive/state/.watch-over_to_codex.lock', '')
      const subject = `home/.claude/projects/${f.repo.replace(/\//g, '-')}/sess/subagents/agent-liveness-alive.jsonl`
      await s.fs.write(subject, '')
      const lock = join(f.stateDir, '.watch-over_to_codex.lock')
      const holder = await holdLock(s, lock, join(s.workspace.root, 'holder.pid'))

      await f.withFeed(async () => {
        // The awake-ness proof comes FIRST, so the absence assertion below is
        // known to be measuring a feed that had the chance to warn. It has to be
        // the BUG-038 handshake rather than one append: with no warning to wait
        // for, this case reaches its first write before the supervisor has seeded
        // the run log, and a single append is then lost permanently — which is
        // how this case failed on its first run, reading exactly like the feed
        // having gone silent.
        await f.readerReady(subject, {
          wrap: (tag) => `${JSON.stringify({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: tag }] } })}\n`,
        })
        await s.fs.write(
          subject,
          `${JSON.stringify({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'AWAKE' }] } })}\n`,
          { append: true },
        )
        await f.expectLine('AWAKE')

        expect(
          await f.count('NO watcher is listening'),
          'the feed warned while the lock was HELD — it warns unconditionally',
        ).toBe(0)
      })

      await holder.release('-TERM')
      await holder.settled
    })
  })

  /**
   * #7 — ASSERTED ON WHAT THE FIXTURE WATCHER DID, NEVER ON WHAT EXISTS (U8).
   *
   * tests/signal-dispatch runs the REAL watcher against a fixture baton, and
   * while the lock was derived from the repo root the watcher took the LIVE
   * repo's lock — leaving a record that made a checkout which never ran a
   * watcher report `dead` forever, and refusing a genuine watcher started while
   * the suite ran. Isolation has to fall out of where the path comes from.
   *
   * The first oracle asked whether a lock EXISTED in the real checkout. A real
   * dispatcher, which AGENTS.md says to start once and leave running, keeps one
   * there, and the file outlives it — so a push was refused over a lock no test
   * had touched. TASK-021 had already deleted the "only if there was no lock
   * before" conjunct, correctly: it made the check skip itself whenever a lock
   * existed (tests/live-state-canary pins that shape). So neither "exists" nor
   * "exists unless it already did" is an oracle.
   *
   * WHY NOT A STAT SNAPSHOT. Taking an existing unheld lock is `exec 7>>` plus
   * `flock` — no write, so inode, size and mtime are unchanged, and once the
   * watcher exits the kernel has released it. Nothing on disk records the
   * acquisition. So the live lock's LIVENESS is probed while the watcher runs,
   * against a live repo built in the workspace (real state is never read), from
   * every state it can be in beforehand:
   *
   *   none   a root-derived watcher CREATES and holds it  → none becomes alive
   *   dead   it TAKES a stopped dispatcher's leftover     → dead becomes alive
   *   alive  it is REFUSED and exits                      → no lock beside its own
   *                                                         baton, and not running
   *
   * READINESS IS A DISPATCH, not a probe of the fixture lock: a probe of a lock
   * the watcher is about to take can win the `flock -n` race and make it refuse.
   * A wake command runs only after the lock step, so every probe below happens
   * while the watcher already holds whatever it took.
   *
   * MUTATION RECORD (TASK-006), observed via BP_SPEC_ROOT: the watcher's
   * `bp_watch_hold` handed `"$BP_STATE_ROOT/logs/state"` — the historical
   * root-derived lock — goes red in all three cases; unmutated, all three green.
   */
  it.each(['none', 'dead', 'alive'] as const)(
    '#7 U8 a watcher on a fixture baton takes no lock in the live repo (live lock before: %s)',
    async (before) => {
      await scenario(`wl-7-${before}`, async (s) => {
        const live = await liveRepo(s)
        const liveLock = join(live.stateDir, '.watch-over_to_codex.lock')
        const liveness = (dir: string) => lib(s, `bp_watch_liveness "${dir}" OVER_TO_CODEX`)

        // The watcher's own derivation must land on the dir this case watches, or
        // every assertion below is about a path it never touches (TASK-021).
        const root = await s.run(
          'sh',
          ['-c', `BP_CODE_ROOT="${live.root}" . "${join(live.root, 'scripts/lib/state-dir.sh')}"; bp_state_root`],
          { cwd: live.root },
        )
        expect(join(root.stdout.trim(), 'logs', 'state'), 'the live repo resolves elsewhere').toBe(live.stateDir)

        if (before !== 'none') await s.fs.write('live/logs/state/.watch-over_to_codex.lock', '')
        const holder =
          before === 'alive' ? await holdLock(s, liveLock, join(s.workspace.root, 'holder.pid')) : undefined
        expect(await liveness(live.stateDir), 'fixture precondition').toBe(before)

        const dir = await batonDir(s, 'fix/state', 'OVER_TO_CODEX')
        const w = startWatcher(
          s,
          'node',
          [
            live.watch,
            '--file', join(dir, 'signal.md'),
            '--poll', '0.2',
            '--log', join(dir, 'signal.log'),
            '--', 'touch', s.workspace.path('dispatched'),
          ],
          { env: { AGENT_SIGNAL_SETTLE: '0', AGENT_STATE_HOME: undefined, AGENT_SIGNAL_FILE: undefined } },
        )
        try {
          await until('the fixture watcher has dispatched, or exited', async () =>
            w.exited || (await s.fs.exists('dispatched')),
          )
          expect(
            await liveness(live.stateDir),
            `the fixture watcher took the LIVE repo's lock (${liveLock})`,
          ).toBe(before)
          expect(
            await liveness(dir),
            `the fixture watcher holds no lock beside the baton it watches:\n${w.output()}`,
          ).toBe('alive')
          w.assertStillRunning('the fixture watcher must still be listening')
        } finally {
          await w.stop()
          await holder?.release('-TERM')
          await holder?.settled
        }
      })
    },
  )

  it('#7 it put the lock beside the baton it was actually watching', async () => {
    await scenario('wl-7b', async (s) => {
      // #7 also asserts this, from a copy of the watcher. This one runs it IN
      // PLACE: a watcher that took NO lock at all also leaves none in the live repo.
      const dir = await batonDir(s, 'fix/state')
      await s.run(
        'sh',
        [
          '-c',
          `AGENT_SIGNAL_SETTLE=0 timeout 3 node "${WATCH}" --file "${join(dir, 'signal.md')}" ` +
            `--poll 1 --log "${join(dir, 'signal.log')}" -- true`,
        ],
        { cwd: s.workspace.root, env: { AGENT_SIGNAL_SETTLE: '0' }, timeoutMs: 30_000 },
      )

      expect(
        await s.fs.exists('fix/state/.watch-over_to_codex.lock'),
        'no lock beside the fixture baton — the watcher took none, so #7 proves nothing',
      ).toBe(true)
    })
  })
})
