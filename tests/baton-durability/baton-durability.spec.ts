/**
 * tests/baton-durability/baton-durability.spec.ts — BUG-019: a branch operation
 * must not destroy a live dispatch.
 *
 * THE DEFECT. `AGENT_SIGNAL.md` was a TRACKED file holding LIVE runtime state.
 * Both properties are fine alone and a bug together: git owns the content of
 * tracked files in the working tree, so `git switch`, `git checkout <file>`,
 * `git stash` and `git rebase` all rewrite it — correctly, by their own contract
 * — including while an agent is mid-dispatch.
 *
 * Reproduced live against a running Codex, not inferred: a `git checkout
 * AGENT_SIGNAL.md` from another branch reverted the baton, and Codex refused to
 * proceed — "I stopped because the baton changed before I could claim it".
 * Nothing failed. The watcher simply had nothing left to claim, which is what
 * makes this expensive: a dispatch that dies loudly costs minutes, one that dies
 * silently costs the session.
 *
 * THE MECHANISM, precisely. `signal-watch.mts` builds a trigger key from
 * Holder|State|Task and dispatches once it settles. A branch operation rewrites
 * all three at once, which produces a new key (resetting the settle window) and
 * usually restores a State that is not the target (clearing the pending state
 * outright). The reverted content does not merely go stale — it CANCELS the
 * in-flight dispatch.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHERE CASE #0 WENT, because it did not go away.
 *
 * The shell suite's `#0` — "the real baton and journal are byte-identical, no
 * fixture reached live state" — is DISSOLVED by the migration rather than
 * dropped, and this is the one place in this port where coverage moves instead of
 * being restated.
 *
 * `tests/harness/canary.ts` runs exactly that comparison at the end of EVERY
 * scenario in EVERY suite, over the baton, the journal, the activity feed and
 * `.git/config`. It also carries the discrimination the shell version could not:
 * BUG-068 — a baton change WITH a matching `signal-history.log` append is a
 * concurrent agent legitimately flipping the mic and is REPORTED as a
 * `CANARY-NOTE:`; a baton change with NO append is BUG-030's clobber and FAILS.
 * Five agents work in this repo at once, so the live baton genuinely changes
 * under a test run, and the pre-BUG-068 guard could not tell the two apart.
 *
 * That discrimination is pinned by four cases in `tests/harness/harness.spec.ts`
 * rather than asserted here, which is where it belongs: the check now lives in
 * the harness, so its non-vacuity proof lives with it. Restating it in this file
 * would be the second copy R1 exists to refuse — and the version here would be
 * the one that drifts, because it is not the one that runs.
 *
 * The shell suite's remaining two lines of isolation machinery — the `unset`s for
 * `GIT_*` and `AGENT_*`, each of which was a one-line omission away from being
 * BUG-046 or BUG-047 — are likewise gone into `tests/harness/env.ts`, which
 * offers no way to obtain an environment that carries them.
 *
 * PORTED FROM tests/baton-durability/test.sh (TASK-018). Equivalence measured
 * over a mutant population — see docs/waiting-acceptance/TASK-018-EQUIVALENCE-mic/.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { startWatcher, until, type Watcher } from '../harness/watcher.js'
import type { FixtureRepo } from '../harness/fixture-repo.js'

/**
 * The dispatcher's own pointers must NOT be inherited, and that is BUG-046's
 * exact shape: `signal-watch.mts` does `export AGENT_SIGNAL_FILE` before
 * running the wake command, so every process inside a dispatch — including an
 * agent running this suite as part of a review — inherits a pointer to the REAL
 * baton. `agent_signal_file()` honours it, so the fixture's own copy of
 * `signal-set.sh` wrote live state no matter what its cwd or script root said.
 *
 * It happened: Codex ran this suite while reviewing the PR that introduced it,
 * four fixture rows landed in the real baton and journal, and it was left at
 * OVER_TO_CODEX — a self-dispatching loop, which on a metered agent is a cost
 * incident rather than an annoyance.
 *
 * Every case here must therefore resolve the baton from the FIXTURE's tree, which
 * means the inherited pointers go. The harness scrubs them from the ambient
 * environment already; these unsets remove the scenario's own per-scenario values
 * as well, because this suite's whole subject is where the derivation lands.
 */
const DERIVE_FROM_THE_FIXTURE = {
  AGENT_SIGNAL_FILE: undefined,
  AGENT_STATE_HOME: undefined,
} as const

/** Whole seconds. Never fractional — `signal-watch.mts` compares `date +%s`. */
const SETTLE = 2
const POLL = 0.2
/** Poll iterations spanning one settle window plus two, so a pending candidate is decidable. */
const QUIET_ITERATIONS = Math.ceil(SETTLE / POLL) + 2

const COMMITTED_BASELINE =
  '# Agent Signal\n\n| Field | Value |\n|---|---|\n| Holder | Nobody |\n' +
  '| State | IDLE |\n| Task | committed baseline |\n'

const IDLE_BATON =
  '| Field | Value |\n|---|---|\n| Holder | Nobody |\n| State | IDLE |\n| Task | nothing yet |\n'

/**
 * The fixture shim for `state-dir.sh`: resolve the baton through a POINTER FILE,
 * so the path can move WHILE the watcher runs.
 *
 * This shims the DERIVATION, not the watcher. What is under test is whether the
 * watcher asks again — it either does or it does not — and there is no other way
 * to move a baton under a live process without also changing the thing being
 * measured.
 */
const POINTER_SHIM =
  '#!/bin/sh\n' +
  "bp_state_root()     { printf '%s\\n' \"$(cat \"$BD_POINTER\")\"; }\n" +
  "agent_state_dir()   { printf '%s\\n' \"$(cat \"$BD_POINTER\")\"; }\n" +
  "agent_signal_file() { printf '%s\\n' \"${AGENT_SIGNAL_FILE:-$(cat \"$BD_POINTER\")/signal.md}\"; }\n" +
  'agent_signal_journal() { printf \'%s\\n\' "$(dirname "$(agent_signal_file "${1:-}")")/signal-history.log"; }\n'

interface Fixture {
  readonly root: string
  readonly repo: FixtureRepo
  /** How many times the stub Codex has been dispatched. */
  dispatches(): Promise<number>
  /** Poll iterations the watcher has provably completed. */
  iterations(): Promise<number>
  /** Wait until the watcher has polled `n` more times than it has now. */
  afterIterations(n: number, fact: string): Promise<void>
  /** Publish through the FIXTURE's own copy of signal-set.sh, from inside the fixture. */
  publish(args: string[]): Promise<void>
  /** Replace the fixture's state-dir.sh with the pointer shim. */
  usePointer(target: string): Promise<void>
  /** Point the shim at a different state directory. */
  movePointer(target: string): Promise<void>
  /** Start the real launcher against this fixture. */
  start(args: string[], settle?: number): Promise<Watcher>
  /** The live baton this fixture's own derivation resolves to. */
  liveBaton(): string
  write(rel: string, content: string): Promise<string>
  read(rel: string): Promise<string>
}

async function fixture(s: Scenario, name: string): Promise<Fixture> {
  const repo = await s.gitRepo(name)
  const root = repo.dir
  const rel = (p: string) => join(name, p)

  for (const script of [
    'scripts/signal-watch.mts',
    'scripts/start-codex-signal-watch.mts',
    'scripts/codex-feed-filter.sh',
    'scripts/signal-set.sh',
    'scripts/lib/state-dir.sh',
  ]) {
    await s.fs.copyIn(join(REPO_ROOT, script), rel(script))
    // The launcher EXECS signal-watch.mts rather than running `bash` on it,
    // so the bit is load-bearing rather than cosmetic.
    await s.fs.chmod(rel(script), 0o755)
  }
  // TASK-065 (round 3) — signal-watch.mts also imports a sibling .mts lib
  // directly (scripts/lib/spawn-bounded.mts), not sourced through a shell
  // function like scripts/lib/state-dir.sh above, so it has to travel with
  // the copied watcher too or it fails ERR_MODULE_NOT_FOUND on startup.
  await s.fs.copyIn(join(REPO_ROOT, 'scripts/lib/spawn-bounded.mts'), rel('scripts/lib/spawn-bounded.mts'))
  // TASK-083 — the ported start-codex-signal-watch.mts imports
  // scripts/lib/find-bin.mts and scripts/lib/scratch-tmpdir.mts directly.
  await s.fs.copyIn(join(REPO_ROOT, 'scripts/lib/find-bin.mts'), rel('scripts/lib/find-bin.mts'))
  await s.fs.copyIn(join(REPO_ROOT, 'scripts/lib/scratch-tmpdir.mts'), rel('scripts/lib/scratch-tmpdir.mts'))

  await s.fs.write(rel('AGENT_SIGNAL.md'), COMMITTED_BASELINE)
  await repo.commitAll('baseline')

  // APPEND, never truncate: a second dispatch must not be able to hide inside the
  // first, which is how #6c counts a replay rather than merely observing one run.
  const marker = s.workspace.path(name, 'dispatches')
  await s.fs.write(rel('stub-codex'), `#!/usr/bin/env bash\nprintf 'ran\\n' >> "${marker}"\n`, {
    mode: 0o755,
  })

  const pollsPath = s.workspace.path(name, 'polls')
  const shims = await s.shimDir(`${name}/shims`)
  await shims.add(
    'sleep',
    `printf 'i\\n' >> "${pollsPath}"\n` +
      'for _real in /bin/sleep /usr/bin/sleep; do\n' +
      '  [ -x "$_real" ] && exec "$_real" "$@"\n' +
      'done\n' +
      'echo "baton-durability spec: no real sleep found" >&2\n' +
      'exit 127\n',
  )

  const pointer = s.workspace.path(name, 'pointer')

  const countLines = async (p: string) =>
    (await s.fs.exists(p)) ? (await s.fs.read(p)).split('\n').filter(Boolean).length : 0

  const f: Fixture = {
    root,
    repo,

    dispatches: () => countLines(`${name}/dispatches`),
    iterations: () => countLines(`${name}/polls`),

    async afterIterations(n, fact) {
      const base = await f.iterations()
      await until(fact, async () => (await f.iterations()) >= base + n)
    },

    async publish(args) {
      // FROM INSIDE THE FIXTURE, and through the fixture's OWN copy. The first
      // draft of this suite called the repo's script from the repo root and
      // published into the REAL baton — the live watcher then dispatched the real
      // Codex against a task reading "baton durability fixture", in the real
      // working tree, with workspace-write.
      const r = await s.run('bash', [join(root, 'scripts/signal-set.sh'), ...args], {
        cwd: root,
        env: DERIVE_FROM_THE_FIXTURE,
      })
      expect(r.code, `publishing the fixture baton failed: ${r.output}`).toBe(0)
    },

    async usePointer(target) {
      await s.fs.write(rel('scripts/lib/state-dir.sh'), POINTER_SHIM)
      await s.fs.write(`${name}/pointer`, `${target}\n`)
    },

    movePointer: (target) => s.fs.write(`${name}/pointer`, `${target}\n`).then(() => undefined),

    async start(args, settle = SETTLE) {
      const w = startWatcher(s, 'node', [join(root, 'scripts/start-codex-signal-watch.mts'), ...args], {
        cwd: root,
        env: {
          ...DERIVE_FROM_THE_FIXTURE,
          PATH: shims.path(),
          AGENT_SIGNAL_SETTLE: String(settle),
          CODEX_BIN: join(root, 'stub-codex'),
          STUB_MARKER: marker,
          BD_POINTER: pointer,
        },
      })
      // Startup is a fact, not a duration: the watcher has to have taken at least
      // one reading before a perturbation means anything, and one completed poll
      // iteration is that fact. `--once` watchers take no liveness lock (a
      // one-shot probe is not a listener), so the lock oracle tests/signal-dispatch
      // uses is not available here.
      await until('the watcher has taken its first reading', async () => {
        expect(w.exited, `the watcher died during startup:\n${w.output()}`).toBe(false)
        return (await f.iterations()) >= 1
      })
      return w
    },

    liveBaton: () => join(root, 'logs/state/signal.md'),
    write: (p, content) => s.fs.write(rel(p), content),
    read: (p) => s.fs.read(rel(p)),
  }

  return f
}

describe('BUG-019 — a branch operation cannot destroy a live dispatch', () => {
  it('#1 THE REPRODUCER: a git checkout of the TRACKED signal, fired inside the settle window, does not cancel the dispatch', async () => {
    await scenario('baton-1', async (s) => {
      // On the parent commit the live baton IS the tracked file, so the checkout
      // restores `State = IDLE`, the watcher clears its pending state, and the
      // stub never runs. After the fix the live baton is untracked, so the
      // checkout touches a file the watcher is not reading.
      const f = await fixture(s, 'b1')
      await f.publish(['--holder', 'Tester', '--state', 'OVER_TO_CODEX', '--task', 'baton durability fixture'])
      const w = await f.start(['--poll', String(POLL), '--once'])

      try {
        // THE CHECKOUT MUST LAND INSIDE THE SETTLE WINDOW, and a race that can
        // pass for the wrong reason is worse than no test (Codex F5). The shell
        // version widened the window — settle 8, sleep 2 — so that overshoot
        // needed a ~6 s stall rather than a ~4 s one, and then DETECTED overshoot
        // anyway, because rare-and-silent is the combination this repo keeps
        // getting burned by.
        //
        // Here the pause is the CONDITION instead of a guess: two completed poll
        // iterations means the watcher has demonstrably observed the
        // OVER_TO_CODEX baton and opened its settle window, which is what "inside
        // the window" actually requires, and it takes ~0.4 s of a 2 s window
        // rather than 2 s of an 8 s one. The overshoot detection is KEPT, because
        // an iteration count bounds observations and not wall-clock: a green from
        // this case must mean "the checkout demonstrably preceded the dispatch",
        // never "a marker exists".
        await f.afterIterations(2, 'the watcher has observed the OVER_TO_CODEX baton')
        expect(
          await f.dispatches(),
          'INCONCLUSIVE: the watcher dispatched before the checkout landed — the settle window was missed, so this run proves nothing',
        ).toBe(0)

        const checkout = await f.repo.git(['checkout', '--', 'AGENT_SIGNAL.md'])
        expect(checkout.code, `the fixture checkout itself failed — the test proves nothing: ${checkout.output}`).toBe(0)

        await w.awaitExit('the dispatch was LOST by a git checkout — BUG-019')
      } finally {
        await w.stop()
      }

      expect(await f.dispatches(), 'the dispatch was LOST by a git checkout — BUG-019').toBe(1)
    })
  })

  it('#1b CONTROL: the same fixture with NO checkout dispatches — so #1 can tell the bug from a broken fixture', async () => {
    await scenario('baton-1b', async (s) => {
      // Without this, a watcher that never dispatches for an unrelated reason
      // (missing stub, bad fixture, changed CLI) would make #1 fail for the wrong
      // reason — or, if the assertion were inverted, pass while proving nothing.
      const f = await fixture(s, 'b1b')
      await f.publish(['--holder', 'Tester', '--state', 'OVER_TO_CODEX', '--task', 'control, no checkout'])
      const w = await f.start(['--poll', String(POLL), '--once'])

      try {
        await w.awaitExit('the control FAILED to dispatch — #1 cannot distinguish the bug from a broken fixture')
      } finally {
        await w.stop()
      }

      expect(await f.dispatches(), 'the control FAILED to dispatch').toBe(1)
    })
  })

  it('#2 switch and stash leave the live mic state BYTE-IDENTICAL — asserted on the class, not only the instance that bit us', async () => {
    await scenario('baton-2', async (s) => {
      // `checkout <file>` is only the instance that bit us. `switch` and `stash`
      // rewrite the working tree the same way.
      const f = await fixture(s, 'b2')
      await f.publish(['--holder', 'Tester', '--state', 'ACTIVE', '--task', 'durability across branch ops'])

      const live = f.liveBaton()
      const before = await readFile(live, 'utf8')

      await f.repo.git(['checkout', '-q', '-b', 'other'])
      await f.repo.git(['checkout', '-q', '-'])
      await f.repo.git(['stash', '-q'])
      await f.repo.git(['stash', 'pop', '-q'])

      expect(await readFile(live, 'utf8'), 'a branch operation rewrote live mic state').toBe(before)
    })
  })

  it('#3 the TRACKED signal file carries no live mic state — so branch ops have nothing live to rewrite', async () => {
    await scenario('baton-3', async () => {
      // Structural, and deliberately modest: it stops the split being half-done
      // (prose updated, table left behind). #1 is the load-bearing assertion —
      // the same division of labour tests/state-dir settled on.
      const tracked = await readFile(join(REPO_ROOT, 'AGENT_SIGNAL.md'), 'utf8')
      const liveRows = tracked
        .split('\n')
        .filter((l) => /^\|\s*(Holder|State)\s*\|\s*[A-Za-z_]/.test(l))

      expect(
        liveRows,
        'AGENT_SIGNAL.md still holds a live Holder/State row — it is tracked, so branch ops still rewrite it',
      ).toEqual([])
    })
  })

  for (const mode of ['env', 'flag'] as const) {
    it(`#4 the journal follows a baton overridden by --${mode}`, async () => {
      await scenario(`baton-4-${mode}`, async (s) => {
        // The journal is meant to replace `git log -p AGENT_SIGNAL.md` as the
        // hand-off history. Its first version derived its own path from the repo
        // root instead of from the baton, so a suite that points the baton at a
        // fixture still appended to the REAL journal — tests/signal-set wrote
        // eleven fixture rows into it on the first run. Two independent
        // derivations of one location is the A-09 defect, reintroduced in the very
        // change that documents it.
        //
        // BOTH override paths are checked. The first fix honoured
        // $AGENT_SIGNAL_FILE and still leaked, because `--file` is parsed AFTER
        // the journal was derived. One input path validated and the other not is
        // the same hole signal-set.sh's --task/--task-file normalisation once had,
        // so testing only the path one happens to think of re-ships it.
        const baton = s.workspace.path('elsewhere', 'signal.md')
        await s.fs.mkdirp('elsewhere')

        // BUG-140: this case runs the REAL repo's signal-set.sh (it is testing the
        // journal derivation, not the fixture), so it resolves the REAL
        // AGENT_ROSTER.md unless told otherwise. 'JTest' names nothing about a
        // roster — point AGENT_ROSTER_FILE at a path that does not exist, the same
        // degrade a fresh clone gets before its roster is copied in.
        const noRoster = s.workspace.path('elsewhere', 'AGENT_ROSTER.md')
        const args = ['--holder', 'JTest', '--state', 'ACTIVE', '--task', 'journal follows the baton']
        const r = await s.run(
          'bash',
          mode === 'env'
            ? [join(REPO_ROOT, 'scripts/signal-set.sh'), ...args]
            : [join(REPO_ROOT, 'scripts/signal-set.sh'), '--file', baton, ...args],
          {
            cwd: s.workspace.root,
            env: {
              ...(mode === 'env' ? { AGENT_SIGNAL_FILE: baton } : DERIVE_FROM_THE_FIXTURE),
              AGENT_ROSTER_FILE: noRoster,
            },
          },
        )
        expect(r.code, `publishing failed: ${r.output}`).toBe(0)

        expect(
          await s.fs.exists('elsewhere/signal-history.log'),
          `no journal beside the baton overridden by --${mode} — it went elsewhere, probably the real one`,
        ).toBe(true)
      })
    })
  }

  it('#5 Codex F4: first creation publishes only the REQUESTED baton — the default seed is never visible at the canonical path', async () => {
    await scenario('baton-5', async (s) => {
      // The seed used to be written straight to $SIGNAL and replaced a moment
      // later, so a poller could read an empty, partial or IDLE baton at the
      // canonical path. The IDLE default made an accidental dispatch unlikely, but
      // "unlikely" is not the guarantee this script exists to provide.
      //
      // Asserted by SAMPLING the path while a first publication happens: every
      // sample that sees a file at all must see the requested baton, never the
      // seed's Holder=Nobody / State=IDLE.
      const dir = await s.fs.mkdirp('first')
      const baton = join(dir, 'signal.md')

      // BUG-140: same reason as #4 above — this runs the REAL repo's script, so
      // AGENT_ROSTER_FILE is pointed at a path that does not exist to keep 'Atomic'
      // from being validated against the real checkout's roster.
      const publisher = startWatcher(
        s,
        'bash',
        [
          join(REPO_ROOT, 'scripts/signal-set.sh'),
          '--holder', 'Atomic',
          '--state', 'ACTIVE',
          '--task', 'first creation is atomic',
        ],
        {
          cwd: s.workspace.root,
          env: { AGENT_SIGNAL_FILE: baton, AGENT_ROSTER_FILE: s.workspace.path('first', 'AGENT_ROSTER.md') },
        },
      )

      const samples: string[] = []
      try {
        while (!publisher.exited) {
          try {
            samples.push(await readFile(baton, 'utf8'))
          } catch {
            // Not created yet, or gone mid-rename. Both are legitimate: the
            // guarantee is about what a reader SEES, not that it always sees one.
          }
          await new Promise((r) => setImmediate(r))
        }
      } finally {
        await publisher.stop()
      }

      expect(
        samples.filter((c) => c.includes('Holder | Nobody')),
        'the default seed baton was visible at the canonical path — first creation is not atomic',
      ).toEqual([])
      expect(await readFile(baton, 'utf8'), 'no baton was produced at all').toContain('Holder | Atomic')
    })
  })

  it('#6 a RUNNING watcher follows the baton when the path moves under it', async () => {
    await scenario('baton-6', async (s) => {
      // THIS PR CAUSED THE FAILURE IT FIXES. Moving the live baton left every
      // already-running dispatcher polling the OLD path — a file that no longer
      // changes — and it never fired again, silently. Hit live: a dispatch of that
      // very review went nowhere, noticed only because the verdict never arrived
      // and the run log was 26 minutes stale.
      //
      // A POSITIVE-EMISSION test, deliberately. The property is "a dispatch still
      // happens", and only a test that DEMANDS the dispatch can tell a watcher
      // that followed the move from one quietly polling nothing.
      const f = await fixture(s, 'b6')
      const a = await s.fs.mkdirp('b6/a')
      const b = await s.fs.mkdirp('b6/b')
      await f.usePointer(a)
      await f.write('a/signal.md', IDLE_BATON)

      const w = await f.start(['--poll', String(POLL), '--once'])
      try {
        await f.afterIterations(2, 'the watcher has settled on the ORIGINAL path')
        await f.write('b/signal.md',
          '| Field | Value |\n|---|---|\n| Holder | Tester |\n| State | OVER_TO_CODEX |\n' +
            '| Task | the path moved under a running watcher |\n')
        await f.movePointer(b)

        await w.awaitExit('the watcher kept polling the old path and never fired — the migration hazard')
      } finally {
        await w.stop()
      }

      expect(await f.dispatches(), 'the watcher never followed the baton to its new path').toBe(1)
    })
  })

  it('#6b an EXPLICIT --file pin is never re-resolved: the watcher stays on the path the operator named, and #6 is therefore not vacuous', async () => {
    await scenario('baton-6b', async (s) => {
      // TWO JOBS IN ONE CASE. It is the non-vacuity proof for #6 — the identical
      // scenario with re-resolution disabled must NOT dispatch, so #6's green
      // comes from the refresh and not from the fixture dispatching anyway. And it
      // asserts the refresh did not quietly override an operator: `--file` means
      // "watch exactly this", and a watcher that wandered off it would be a worse
      // bug than the one being fixed.
      //
      // ASSERT THE MECHANISM, NOT THE ABSENCE. Codex was right that a bare
      // marker-absence check false-passes: "no dispatch" is indistinguishable from
      // "the watcher had not got round to it yet", and with `--once` the timeout IS
      // the case's whole runtime. A watcher STILL RUNNING after the move has
      // demonstrably not dispatched, because `--once` would have exited it. The
      // shell version bought that with `sleep 5` against a 2 s settle; here it is
      // one settle window counted in the watcher's own poll iterations, which a
      // stalled host cannot shorten.
      const f = await fixture(s, 'b6b')
      const a = await s.fs.mkdirp('b6b/a')
      const b = await s.fs.mkdirp('b6b/b')
      await f.usePointer(a)
      await f.write('a/signal.md', IDLE_BATON)

      const w = await f.start(['--poll', String(POLL), '--once', '--file', join(a, 'signal.md')])
      try {
        await f.write('b/signal.md',
          '| Field | Value |\n|---|---|\n| Holder | Tester |\n| State | OVER_TO_CODEX |\n' +
            '| Task | pinned watcher must ignore this |\n')
        await f.movePointer(b)

        await f.afterIterations(
          QUIET_ITERATIONS,
          'the watcher has polled past the point a WANDERING watcher would have dispatched',
        )
        // Liveness BEFORE the marker check: `--once` exits on dispatch, so a
        // process still running is positive evidence that none happened.
        w.assertStillRunning('#6b the --file pin')
        expect(
          await f.dispatches(),
          'a --file pin was overridden by re-resolution — the watcher wandered off the path the operator named',
        ).toBe(0)
      } finally {
        await w.stop()
      }
    })
  })

  it('#6c Codex round-3 HIGH: a path move must not REPLAY an already-dispatched baton', async () => {
    await scenario('baton-6c', async (s) => {
      // The first version of the move handler cleared `last_trigger_key` along
      // with the settle state, reasoning that pending state belonged to the old
      // file. But a migration that COPIES the baton to its new home produces an
      // identical Holder|State|Task — and a cleared key makes that look like a
      // brand-new instruction, so finished work is dispatched a second time.
      //
      // On a metered agent that is a duplicate BILL, not a duplicate log line,
      // which is why it ranks HIGH rather than as a tidiness point. It is also the
      // defect the settle window exists to prevent, arriving through a different
      // door.
      const f = await fixture(s, 'b6c')
      const a = await s.fs.mkdirp('b6c/a')
      const b = await s.fs.mkdirp('b6c/b')
      await f.usePointer(a)
      const baton =
        '| Field | Value |\n|---|---|\n| Holder | Tester |\n| State | OVER_TO_CODEX |\n' +
        '| Task | identical baton, must dispatch exactly once |\n'
      await f.write('a/signal.md', baton)
      await f.write('b/signal.md', baton)

      // NO --once: the watcher must stay alive so a SECOND dispatch is possible.
      const w = await f.start(['--poll', String(POLL)], 1)
      try {
        // WAIT FOR THE FIRST DISPATCH BEFORE MOVING (Codex round-4 MEDIUM). If it
        // lands only AFTER the move, the run count is still 1 and the case reports
        // "no replay" while having tested nothing, because there was no prior
        // dispatch to replay.
        await until('exactly one dispatch has landed BEFORE the move', async () => (await f.dispatches()) >= 1)
        expect(await f.dispatches(), 'more than one dispatch before the move — the precondition is not what it claims').toBe(1)

        await f.movePointer(b) // identical content, new path
        await f.afterIterations(QUIET_ITERATIONS, 'the watcher has polled long enough for a replay to have happened')

        expect(
          await f.dispatches(),
          'the path move REPLAYED an already-dispatched baton — finished work re-run',
        ).toBe(1)
      } finally {
        await w.stop()
      }
    })
  })
})
