/**
 * tests/signal-dispatch/signal-dispatch.release.spec.ts — the dispatcher will not fire
 * on a Task nobody has updated.
 *
 * The signal is TWO fields written by TWO edits. Flipping `State` to the target
 * before writing `Task` gives the watcher a brand-new trigger key while `Task`
 * still holds the previous round's text — so the agent is dispatched, in earnest,
 * against work that is already finished.
 *
 * This happened twice in one session. "Flip the mic last" was already written in
 * AGENTS.md and in HANDOVER before the second occurrence, which is exactly what
 * makes a rule the wrong fix: it has to be remembered at the moment the author is
 * busy. Same lesson as BUG-004 — the guard belongs in code on the path that
 * already runs.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE TEST CLOCK, AND WHY IT SURVIVES THE PORT UNCHANGED IN SHAPE
 *
 * This suite cost 125.4 s and was excluded from the pre-push gate for it. That
 * cost was scaffolding, not signal: the shell version started an infinite
 * watcher under `timeout N` and threw the timeout status away, so every case
 * burned its whole bound no matter when its assertion became decidable. The six
 * bounds summed to exactly 125 (22+18+26+13+26+20).
 *
 * Two properties removed it without weakening a single assertion, and BOTH are
 * preserved here rather than re-derived:
 *
 *   1. EVERYTHING IS EXPRESSED IN SETTLE UNITS. The watcher's settle window is
 *      the only real timescale — every wait existed to be "shorter than settle"
 *      or "longer than settle".
 *   2. A CASE STOPS ITS WATCHER AS SOON AS THE ASSERTION IS DECIDABLE. That is
 *      what `startWatcher` is for: the subject is a handle, not something wrapped
 *      in `timeout` and abandoned. `tests/harness/watcher.ts` records the same
 *      reasoning at the primitive.
 *
 * SETTLE STAYS AN INTEGER SECOND, DELIBERATELY, and 2 IS A FLOOR RATHER THAN A
 * PREFERENCE. The watcher compares `date +%s`, which truncates to whole seconds,
 * and the wrong-order cases depend on a pause the watcher must read as SHORTER
 * than settle. A sub-second pause can straddle a second boundary, so two
 * observations 0.4 s apart can read as 1 s elapsed. At SETTLE=1 that makes
 * `elapsed < settle` false and the stale Task dispatches — an alignment race,
 * roughly 40% of runs, independent of machine load. It was shipped at 1 once and
 * the gate caught it on the very next push: three green standalone runs, red
 * inside the gate, and still green under artificial CPU load, which is what ruled
 * load out and pointed at clock granularity.
 *
 * "Sound" is scoped to that integral-clock race and nothing wider (Codex R2).
 * Case #5 characterises the behaviour a scheduler stall actually produces, and
 * `scripts/signal-set.sh` (case #6) is the real fix for it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE PORT CHANGED, AND IT IS A STRENGTHENING RATHER THAN A TRANSLATION
 *
 * The shell suite had three waits it could not express as conditions, so it slept:
 * `quiet()` slept `settle + 2·poll`, `observe_tick()` slept `2·poll`, and the
 * wrong-order cases slept a fraction of settle between the two edits.
 *
 * All three are now counted in the WATCHER'S OWN POLL ITERATIONS, made visible by
 * a `sleep` shim ahead of the real one on PATH — `signal-watch.mts` calls
 * `sleep` exactly once per loop iteration (:343) and nothing else in these
 * fixtures calls it at all. The shim execs the real `sleep`, so the subject is
 * observed rather than altered.
 *
 * That is strictly stronger than the sleeps it replaces, for the reason the
 * sleeps were never quite sound: `sleep 2.4` guarantees that 2.4 s passed, NOT
 * that the watcher looked at anything during it. On a stalled host the shell's
 * `quiet()` could elapse with the watcher having polled zero times, making the
 * negative assertion vacuous — green, while the case checked nothing. An
 * iteration count cannot be vacuous, and it cannot be shortened by load either.
 *
 * THE ARITHMETIC, STATED EXACTLY, because the first version of this note was off
 * by one poll and overstated the bound. The shim records its marker BEFORE it
 * execs the real `sleep`, so N markers prove N COMPARISONS reached the sleep
 * call — and therefore only N−1 sleeps have RETURNED. The elapsed time N markers
 * guarantee is (N−1)·poll, not N·poll. The marker stays where it is: it is what
 * makes "the watcher has taken its first reading" observable at the instant it
 * happens rather than one poll later, and every wait here is written in
 * comparisons. The constants below carry the −1 instead.
 *
 * PORTED FROM tests/signal-dispatch/test.sh (TASK-018). Equivalence measured
 * over a mutant population — see docs/waiting-acceptance/TASK-018-EQUIVALENCE-mic/.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { startWatcher, until, type Watcher } from '../harness/watcher.js'

const WATCHER = join(REPO_ROOT, 'scripts/signal-watch.mts')
const SETTER = join(REPO_ROOT, 'scripts/signal-set.sh')
const LOCK_LIB = join(REPO_ROOT, 'scripts/lib/watcher-lock.sh')

/** Whole seconds. See the header: 2 is the floor, not a preference. */
const SETTLE = 2
/** The poll interval has no integral-clock constraint and goes sub-second freely. */
const POLL = 0.2

/**
 * Markers that together span one settle window, plus two to observe both ends.
 *
 * The `+ 1` is the shim's off-by-one (see the header): N markers buy (N−1)·poll
 * of elapsed time, so spanning the settle window needs ceil(SETTLE/POLL) + 1
 * markers before the two observation polls are added. At 13 that is 12·0.2 =
 * 2.4 s — exactly the `settle + 2·poll` the shell's `quiet()` slept, and now
 * ALSO 13 comparisons, which the sleep could not promise at all.
 */
const QUIET_ITERATIONS = Math.ceil(SETTLE / POLL) + 3
/**
 * Enough markers for the watcher to have taken one full reading after an edit.
 *
 * One would do — a marker recorded after the edit was preceded by a comparison
 * made after the edit — and two is deliberate margin, matching the shell's
 * `observe_tick()` sleep of 2·poll.
 */
const OBSERVE_ITERATIONS = 2

interface Dispatcher {
  /** Tasks dispatched, in order. The whole verdict of every case below. */
  hits(): Promise<string[]>
  /** Hand-write the baton: State and Task as two fields in one file. */
  writeSignal(state: string, task: string): Promise<void>
  /** Publish through signal-set.sh — ONE atomic rename, State and Task together. */
  publish(holder: string, state: string, task: string): Promise<void>
  /** Start the real watcher and wait until it holds its fixture-scoped liveness lock. */
  start(): Promise<Watcher>
  /** Wait until `n` dispatches have landed. The positive half, and pollable. */
  awaitHits(n: number): Promise<void>
  /** Wait until the watcher has looked again since the last edit. */
  observeTick(): Promise<void>
  /** Wait out one whole settle window IN THE WATCHER'S OWN ITERATIONS. */
  quiet(): Promise<void>
}

async function dispatcher(s: Scenario, name: string): Promise<Dispatcher> {
  const stateDir = await s.fs.mkdirp(`${name}/state`)
  const signal = join(stateDir, 'AGENT_SIGNAL.md')
  const hitsPath = s.workspace.path(name, 'hits')
  const pollsPath = s.workspace.path(name, 'polls')

  await s.fs.write(`${name}/hits`, '')

  const shims = await s.shimDir(`${name}/shims`)
  // One line per watcher loop iteration, written BEFORE the real sleep, then the
  // real sleep is exec'd. Absolute paths for the real binary, because resolving
  // `sleep` through PATH would find this shim. N lines therefore mean N
  // comparisons reached the sleep call and N−1 sleeps returned — see the header.
  await shims.add(
    'sleep',
    `printf 'i\\n' >> "${pollsPath}"\n` +
      'for _real in /bin/sleep /usr/bin/sleep; do\n' +
      '  [ -x "$_real" ] && exec "$_real" "$@"\n' +
      'done\n' +
      'echo "signal-dispatch spec: no real sleep found" >&2\n' +
      'exit 127\n',
  )

  // The wake command: record the Task it was handed, one line per dispatch.
  // APPEND, never truncate — a second dispatch must not be able to hide inside
  // the first, which is how #1 and #6 count rounds rather than merely observe one.
  const record = await s.fs.write(
    `${name}/record.sh`,
    `#!/bin/sh\nprintf '%s\\n' "$AGENT_SIGNAL_TASK" >> "${hitsPath}"\n`,
    { mode: 0o755 },
  )

  // Liveness is read through the PRODUCTION helper, never re-implemented here:
  // the lock's path and the meaning of "held" are owned by
  // scripts/lib/watcher-lock.sh, and a second copy would drift from it silently
  // while both kept passing their own tests. That is the failure TASK-005,
  // TASK-002 and BUG-021 each landed on.
  const liveness = await s.fs.write(
    `${name}/liveness.sh`,
    `#!/bin/sh\n. "${LOCK_LIB}"\nbp_watch_liveness "$1" "$2"\n`,
    { mode: 0o755 },
  )

  const iterations = async () =>
    (await s.fs.exists(`${name}/polls`))
      ? (await s.fs.read(`${name}/polls`)).split('\n').filter(Boolean).length
      : 0

  const afterIterations = async (n: number, fact: string) => {
    const base = await iterations()
    await until(fact, async () => (await iterations()) >= base + n)
  }

  const d: Dispatcher = {
    async hits() {
      return (await s.fs.read(`${name}/hits`)).split('\n').filter(Boolean)
    },

    async writeSignal(state, task) {
      await s.fs.write(
        `${name}/state/AGENT_SIGNAL.md`,
        '# Agent Signal\n\n| Field | Value |\n|---|---|\n| Holder | Jesko |\n' +
          `| State | ${state} |\n| Task | ${task} |\n| Last update | test |\n`,
      )
    },

    async publish(holder, state, task) {
      // BUG-159: this runs the REAL repo's signal-set.sh in place (never
      // copied into the fixture), so it resolves the REAL, gitignored
      // AGENT_ROSTER.md unless told otherwise (see #7's reproducer for the
      // exact resolution chain: BP_CODE_ROOT from the script's own physical
      // location, BP_STATE_ROOT walking up from there, never from this
      // fixture's cwd). Fixture holders ('Jesko', 'Eto', ...) name nothing
      // about a roster — point AGENT_ROSTER_FILE at a path that does not
      // exist, the same degrade a fresh clone gets before its roster is
      // copied in. Same pattern as tests/baton-durability and tests/wait-mic.
      const noRoster = s.workspace.path(name, 'no-roster', 'AGENT_ROSTER.md')
      const r = await s.run(
        'bash',
        [SETTER, '--file', signal, '--holder', holder, '--state', state, '--task', task],
        { cwd: s.workspace.root, env: { AGENT_ROSTER_FILE: noRoster } },
      )
      expect(r.code, `publishing the fixture baton failed: ${r.output}`).toBe(0)
    },

    async start() {
      const w = startWatcher(
        s,
        'node',
        [
          WATCHER,
          '--file', signal,
          '--poll', String(POLL),
          '--log', s.workspace.path(name, 'signal.log'),
          '--', record,
        ],
        {
          cwd: s.workspace.root,
          // AGENT_SIGNAL_RECOVERY=0 — this suite is not testing BUG-144's mic
          // recovery, and `record` (below) is exactly the "backgrounded,
          // fire-and-forget" shape recoverStrandedMic's own docblock
          // documents as indistinguishable from a stranded ACTIVE: it returns
          // instantly, and every later state transition this suite drives
          // (claim, hand-back, the next round) arrives as a SEPARATE write
          // after the wake command has already returned, never inside it.
          // Once BUG-144 round 3 made recovery load-bearing, that made every
          // dispatch here look stranded to it, and #5 could race a genuine
          // round-3 publish against a round-2 recovery still resolving the
          // roster and lose it — no re-check closes that gap, because
          // "stranded on ACTIVE" and "still legitimately claimed, working"
          // carry identical Holder/State/Task. Opting out here changes
          // nothing about the mechanism this test's own case #5 exists to
          // characterize (the settle window), and nothing about production,
          // where this variable is unset.
          env: { PATH: shims.path(), AGENT_SIGNAL_SETTLE: String(SETTLE), AGENT_SIGNAL_RECOVERY: '0' },
        },
      )

      // READINESS IS THE PRODUCTION FACT, NOT A SLEEP. The shell suite once
      // slept a whole settle unit before every first edit, although STARTUP —
      // not settling — was the condition it needed. The lock is what "a
      // dispatcher is listening here" means (BUG-022), so wait for that.
      await until('the watcher holds its fixture-scoped liveness lock', async () => {
        expect(w.exited, `the watcher died during startup:\n${w.output()}`).toBe(false)
        const r = await s.run('sh', [liveness, stateDir, 'OVER_TO_CODEX'], {
          cwd: s.workspace.root,
        })
        return r.stdout.trim() === 'alive'
      })
      return w
    },

    async awaitHits(n) {
      await until(`${n} dispatch(es) have landed`, async () => (await d.hits()).length >= n)
    },

    observeTick: () =>
      afterIterations(OBSERVE_ITERATIONS, 'the watcher has looked again since the last edit'),

    quiet: () =>
      afterIterations(
        QUIET_ITERATIONS,
        `the watcher has polled ${QUIET_ITERATIONS} times — one whole settle window, ` +
          `so any pending candidate is decidable`,
      ),
  }

  return d
}

describe('the settle window dispatches a wrong-order edit ONCE, on the Task that settled', () => {
  it('#1 THE REPRODUCER — the mic is flipped BEFORE the Task is written, and the stale text is never dispatched', async () => {
    await scenario('dispatch-1', async (s) => {
      // THE INCIDENT, EXACTLY: State goes to the target while Task still holds
      // the previous round's text, and the real Task lands a few seconds later.
      // The watcher must dispatch ONCE, carrying the NEW text — never the stale
      // text it briefly saw mid-write.
      const d = await dispatcher(s, 'd1')
      await d.writeSignal('ACTIVE', 'task-one')
      const w = await d.start()

      try {
        await d.writeSignal('OVER_TO_CODEX', 'task-one') // round 1 — legitimate
        await d.awaitHits(1)
        await d.writeSignal('ACTIVE', 'task-one') // the agent hands back
        await d.observeTick()

        await d.writeSignal('OVER_TO_CODEX', 'task-one') // WRONG ORDER: mic first…
        // THE COALESCING CONDITION, and it is what the shell's fractional sleep
        // was reaching for. The two edits must be ONE publication as far as the
        // watcher is concerned: it has to SEE the intermediate state (or there is
        // no torn state to sample, and the case proves nothing) and the second
        // edit has to land inside the settle window (or #5's behaviour is what
        // gets measured). Two poll iterations satisfies the first exactly, and
        // 0.4 s is comfortably inside a 2 s settle — where the shell's 0.8 s
        // sleep satisfied the second while only ASSUMING the first.
        await d.observeTick()
        await d.writeSignal('OVER_TO_CODEX', 'task-two') // …then the real Task

        await d.awaitHits(2)
        await d.quiet() // nothing further may arrive
      } finally {
        await w.stop()
      }

      const hits = await d.hits()
      expect(
        hits.filter((h) => h === 'task-one').length,
        `dispatched the stale 'task-one' more than once — the mid-write state was taken as a real instruction: ${hits.join('|')}`,
      ).toBe(1)
      expect(hits, 'the real Task was never dispatched').toContain('task-two')
      expect(hits, 'expected exactly two dispatches, one per round').toEqual(['task-one', 'task-two'])
    })
  })

  it('#2 a genuinely new Task after a hand-back still dispatches', async () => {
    await scenario('dispatch-2', async (s) => {
      // The normal case, and the one that fails if the guard is too strict: a
      // stalled round is indistinguishable from a wedged watcher.
      const d = await dispatcher(s, 'd2')
      await d.writeSignal('ACTIVE', 'task-one')
      const w = await d.start()

      try {
        await d.writeSignal('OVER_TO_CODEX', 'task-one')
        await d.awaitHits(1)
        await d.writeSignal('ACTIVE', 'task-one')
        await d.observeTick()
        await d.writeSignal('OVER_TO_CODEX', 'task-TWO')
        await d.awaitHits(2)
      } finally {
        await w.stop()
      }

      const hits = await d.hits()
      expect(hits, 'the first round never dispatched').toContain('task-one')
      expect(hits, 'a genuinely new Task was refused — the guard would stall every round').toContain('task-TWO')
    })
  })

  it('#3 Codex F2: two rounds with IDENTICAL Task text both dispatch — task text is not a round identity', async () => {
    await scenario('dispatch-3', async (s) => {
      // The first version of this guard refused any Task byte-identical to the
      // last dispatched one. Codex's objection: identical instructions can
      // legitimately recur, and the block lasted the whole life of the watcher
      // rather than the "one poll interval" its author claimed. Case #2 could not
      // catch that — it changes the Task text, so it never exercised the
      // identical case at all.
      const d = await dispatcher(s, 'd3')
      await d.writeSignal('ACTIVE', 'same-task')
      const w = await d.start()

      try {
        await d.writeSignal('OVER_TO_CODEX', 'same-task') // round 1
        await d.awaitHits(1)
        await d.writeSignal('ACTIVE', 'same-task') // hand back
        await d.observeTick()
        await d.writeSignal('OVER_TO_CODEX', 'same-task') // round 2 — deliberately identical
        await d.awaitHits(2)
      } finally {
        await w.stop()
      }

      expect(
        (await d.hits()).length,
        'an intentional identical rerun was blocked — task text is being treated as a round identity (Codex F2)',
      ).toBeGreaterThanOrEqual(2)
    })
  })

  it('#4 the watcher still dispatches after settling — the settle window is not a permanent stall', async () => {
    await scenario('dispatch-4', async (s) => {
      const d = await dispatcher(s, 'd4')
      await d.writeSignal('ACTIVE', 'later-task')
      const w = await d.start()

      try {
        await d.writeSignal('OVER_TO_CODEX', 'later-task')
        await d.awaitHits(1)
      } finally {
        await w.stop()
      }

      expect((await d.hits()).length, 'nothing dispatched after a settle — the watcher has wedged').toBeGreaterThanOrEqual(1)
    })
  })

  it('#5 Codex R2-F2: a hand-edit pause LONGER than settle publishes a torn state — the exact trace old/old/new, a documented limit', async () => {
    await scenario('dispatch-5', async (s) => {
      // THE HONEST LIMIT OF A TIMEOUT. A State-first write with a pause longer
      // than the settle value still publishes a torn state, and the watcher
      // dispatches the stale Task. No timeout is a publication boundary; this
      // case exists so the limit is DEMONSTRATED rather than described, and #6 is
      // the actual fix.
      //
      // CHARACTERIZATION, ASSERTED EXACTLY. An earlier version of this case
      // passed for almost every outcome — no dispatches, extra dispatches, a
      // missing final task — and so demonstrated nothing. If the hand-edit path
      // is ever given a real publication boundary, this case SHOULD fail;
      // updating it alongside that fix is normal maintenance. An exact
      // characterization does not lock a defect in — a vague one hides it.
      const d = await dispatcher(s, 'd5')
      await d.writeSignal('ACTIVE', 'old-task')
      const w = await d.start()

      try {
        await d.writeSignal('OVER_TO_CODEX', 'old-task') // round 1
        await d.awaitHits(1)
        await d.writeSignal('ACTIVE', 'old-task')
        await d.observeTick()

        await d.writeSignal('OVER_TO_CODEX', 'old-task') // State first…
        await d.awaitHits(2) // …and the stale publication became decisive
        await d.writeSignal('OVER_TO_CODEX', 'new-task')
        await d.awaitHits(3)
        await d.quiet() // the trace must be exactly three
      } finally {
        await w.stop()
      }

      expect(await d.hits()).toEqual(['old-task', 'old-task', 'new-task'])
    })
  })

  it('#6 Codex R2-F2, the fix: atomic publication never exposes a torn state, at ANY pause length', async () => {
    await scenario('dispatch-6', async (s) => {
      // `scripts/signal-set.sh` publishes the whole baton in ONE atomic move, so
      // there is no window in which the new State sits beside the old Task — at
      // any pause. Compare #5, which is the same scenario through the hand-edit
      // path.
      const d = await dispatcher(s, 'd6')
      await d.writeSignal('ACTIVE', 'old-task')
      const w = await d.start()

      try {
        await d.publish('Jesko', 'OVER_TO_CODEX', 'round-one')
        await d.awaitHits(1)
        await d.publish('Eto', 'ACTIVE', 'round-one')
        await d.observeTick()
        await d.publish('Jesko', 'OVER_TO_CODEX', 'round-two')
        await d.awaitHits(2)
        await d.quiet() // exactly two, no torn extra
      } finally {
        await w.stop()
      }

      const hits = await d.hits()
      expect(hits, 'a stale Task was dispatched despite atomic publication').not.toContain('old-task')
      expect(hits, 'the second round never dispatched').toContain('round-two')
      expect(hits, 'expected exactly two dispatches').toEqual(['round-one', 'round-two'])
    })
  })

  it('#7 BUG-159 REPRODUCER — publish must not depend on the OPERATOR\'s own AGENT_ROSTER.md', async () => {
    await scenario('dispatch-7', async (s) => {
      // `publish` (above) calls the REAL scripts/signal-set.sh with no
      // AGENT_ROSTER_FILE override. signal-set.sh resolves the roster it
      // validates --holder against from `${AGENT_ROSTER_FILE:-$BP_STATE_ROOT}`
      // (scripts/signal-set.sh:121), and BP_STATE_ROOT comes from
      // `bp_state_root()`, which walks up from BP_CODE_ROOT — the SCRIPT'S OWN
      // physical location (BASH_SOURCE, BUG-019), never this fixture's cwd or
      // BP_STATE_ROOT_CEILING (scripts/lib/state-dir.sh). SETTER here is
      // `join(REPO_ROOT, 'scripts/signal-set.sh')`, run in place rather than
      // copied into the fixture (contrast tests/baton-durability's `fixture()`,
      // which copies its own signal-set.sh and so is self-contained), so
      // BP_CODE_ROOT is the REAL checkout and BP_STATE_ROOT resolves to it
      // too — this repo's own `.blueprint-root` terminates the walk at the
      // first step. The roster read is therefore always THIS machine's real,
      // gitignored AGENT_ROSTER.md.
      //
      // Every other case in this file publishes as 'Jesko' or 'Eto' and
      // passes ONLY because those happen to be personas on THIS engineer's
      // roster (AGENT_ROSTER.md is per-engineer — CLAUDE.md "AGENT_ROSTER.md").
      // A freshly bootstrapped project's seeded roster, or any other fleet,
      // does not name them, and scripts/lib/roster.sh's
      // bp_roster_backing_for_name then finds no match, so signal-set.sh's own
      // guard (scripts/signal-set.sh:122-124) dies with "--holder '<name>' is
      // not a persona in <roster>". A roster that is simply ABSENT degrades to
      // a skipped, always-passing check (signal-set.sh:126) — it is a PRESENT
      // roster that doesn't name the holder that fails, which is exactly what
      // a fresh clone or a different fleet has.
      //
      // A holder name guaranteed to be on nobody's roster reproduces this
      // without depending on — or needing to fabricate — any specific real
      // roster's contents: it fails today for the same reason a fresh
      // project's seeded roster would reject 'Jesko'/'Eto'.
      const d = await dispatcher(s, 'd7')
      await d.publish('Bug159Reproducer', 'ACTIVE', 'reproducer task')

      const signal = await s.fs.read('d7/state/AGENT_SIGNAL.md')
      expect(
        signal,
        'the fixture holder was not published — signal-set.sh rejected it against ' +
          'the REAL operator roster, which is BUG-159',
      ).toContain('| Holder | Bug159Reproducer |')
    })
  })
})
