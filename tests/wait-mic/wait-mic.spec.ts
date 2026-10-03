/**
 * tests/wait-mic/wait-mic.spec.ts — FEATURE-005: the mic watcher EXITS on the
 * first change, so that stopping is an event rather than silence.
 *
 * WHAT IS ACTUALLY BEING GUARDED. An always-on `Monitor` fails invisibly: a dead
 * one and a quiet one look identical, and A-40 records that `ps` cannot see them,
 * so there is no liveness check either. Two died in one session and the founder
 * noticed before the agent did. A waiter that exits converts three things into
 * visible events — the baton moved, the waiter crashed, the harness stopped it —
 * because the harness notifies on task exit whatever the code.
 *
 * WHAT IS NOT GUARDED, and must not be claimed: this does not close the
 * blindness. The waiter must be RE-ARMED after every event, and forgetting is
 * silent. Only harness supervision would close that, and this repo has none. The
 * gap is NARROWED, not closed.
 *
 * THE NEGATIVE CASES ARE THE ONES THAT EARN THEIR TIME: a waiter that exits when
 * NOTHING has changed is worse than the Monitor it replaces, because a spurious
 * exit reads as a handoff that never happened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW THE SHELL SUITE'S FIXED SLEEPS WERE REMOVED (TASK-018 R4).
 *
 * The shell version could not express either half without a duration, and both
 * were guesses:
 *
 *   `sleep 0.5` before every perturbation, because the waiter captures its
 *   BASELINE reading at startup — perturb before that and the waiter adopts the
 *   new value as its baseline and correctly never fires, so the case fails for a
 *   reason that has nothing to do with the subject.
 *
 *   `timeout 1` for every negative, asserting exit 124 — five poll intervals at
 *   the suite's 0.2 s clock, chosen as "probably enough".
 *
 * Neither is expressible as a condition while the waiter's progress is
 * invisible. So it is MADE visible, with a `sleep` shim ahead of the real one on
 * PATH: `wait-mic.sh` calls `sleep` exactly once per loop iteration and nothing
 * else in these fixtures calls it at all, so the shim's log is a faithful
 * ITERATION COUNTER. Every wait below is then expressed in the subject's own
 * iterations — "it has taken a baseline reading", "it has compared seven times
 * since the perturbation" — which no machine load can shorten. A stalled host
 * makes the waiter do FEWER iterations, and the only way to reach a failing
 * verdict is the waiter exiting, which is the defect itself rather than a timing
 * artefact.
 *
 * The shim EXECS the real `sleep`, so the subject's behaviour is unchanged. It
 * observes, it does not substitute.
 *
 * PORTED FROM tests/wait-mic/test.sh (TASK-018). Equivalence measured over a
 * mutant population — see docs/waiting-acceptance/TASK-018-EQUIVALENCE-mic/.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type RunResult, type Scenario } from '../harness/index.js'
import { startWatcher, until, type Watcher } from '../harness/watcher.js'

const WAIT_MIC = join(REPO_ROOT, 'scripts/wait-mic.sh')
const SIGNAL_SET = join(REPO_ROOT, 'scripts/signal-set.sh')

/** BUG-140: a minimal roster, for the one case that needs a REAL one on disk. */
const ROSTER =
  '# Agent Roster\n\n## Members\n\n| Role | Name | Backing agent |\n|---|---|---|\n' +
  '| Orchestrator | Alisa | Claude Code |\n'

/** A well-formed baton nobody has handed off yet. */
const SEED =
  '| Field | Value |\n|---|---|\n| Holder | OLD |\n| State | IDLE |\n' +
  '| Task | seed |\n| Last update | 1970-01-01 |\n'

/**
 * ITERATIONS, NOT SECONDS, is the unit every wait below is expressed in.
 *
 * THE ARITHMETIC, STATED EXACTLY. The shim records its marker BEFORE it execs the
 * real `sleep`, so N markers prove N COMPARISONS reached the sleep call and only
 * N−1 sleeps RETURNED — the elapsed time N markers guarantee is (N−1)·poll. The
 * first version of this constant read "six is one more than the five poll
 * intervals the shell's `timeout 1` bought", which was off by exactly that one:
 * six markers are five completed intervals, i.e. equal to the shell rather than
 * one better.
 *
 * SEVEN restores the claim instead of retreating from it: six completed
 * intervals, one more than the shell's five, AND seven comparisons of the
 * perturbed baton — which `timeout 1` could not promise at all, since a stalled
 * host can burn a whole second with the waiter having looked zero times.
 *
 * The marker stays before the sleep: it is what makes `arm()`'s "the waiter has
 * taken its baseline reading" observable at the instant it happens rather than
 * one poll later.
 *
 * The poll interval is latency and not correctness — `wait-mic.sh` says so, and
 * nothing asserted here depends on it — so it runs fast.
 */
const QUIET_ITERATIONS = 7
const POLL = '0.05'

interface Mic {
  /** The baton the waiter is watching. */
  readonly signal: string
  /** Markers: comparisons the waiter has provably MADE (and N−1 sleeps returned). */
  iterations(): Promise<number>
  /** Arm the waiter and wait until it has taken its BASELINE reading. */
  arm(): Promise<Watcher>
  /** Write the baton directly — the hand-edit path AGENT_SIGNAL.md forbids and people use. */
  hand(content: string): Promise<void>
  /** Publish through the only sanctioned writer, i.e. by atomic rename. */
  publish(args: string[]): Promise<void>
  /** Same call, raw — for a case that expects signal-set.sh to REFUSE. */
  publishRaw(args: string[], env?: Record<string, string>): Promise<RunResult>
  /** Wait until the waiter has compared QUIET_ITERATIONS times since now. */
  settle(): Promise<void>
}

/**
 * A baton, a poll counter, and a way to arm the waiter on it.
 *
 * `seeded: false` leaves the baton ABSENT, which is a legitimate state — a fresh
 * checkout has no baton — and is what case #7 needs.
 */
async function mic(s: Scenario, name: string, seeded = true): Promise<Mic> {
  const dir = await s.fs.mkdirp(`${name}/state`)
  const signal = join(dir, 'signal.md')
  if (seeded) await s.fs.write(`${name}/state/signal.md`, SEED)

  const polls = s.workspace.path(name, 'polls')
  const shims = await s.shimDir(`${name}/shims`)

  // ONE LINE PER LOOP ITERATION, written BEFORE the real sleep runs, then the
  // real sleep is exec'd so the subject is unaltered. `/bin/sleep` is tried
  // first and `/usr/bin/sleep` second rather than resolved through PATH, which
  // would find this shim again.
  await shims.add(
    'sleep',
    `printf 'i\\n' >> "${polls}"\n` +
      'for _real in /bin/sleep /usr/bin/sleep; do\n' +
      '  [ -x "$_real" ] && exec "$_real" "$@"\n' +
      'done\n' +
      'echo "wait-mic spec: no real sleep found" >&2\n' +
      'exit 127\n',
  )

  const iterations = async () =>
    (await s.fs.exists(`${name}/polls`))
      ? (await s.fs.read(`${name}/polls`)).split('\n').filter(Boolean).length
      : 0

  const m: Mic = {
    signal,
    iterations,

    async arm() {
      const w = startWatcher(s, 'sh', [WAIT_MIC, signal], {
        env: { PATH: shims.path(), AGENT_WAIT_MIC_POLL: POLL },
      })
      // THE ONE PRECONDITION EVERY CASE NEEDS, and the reason the shell suite
      // slept: `prev="$(mic)"` runs once at startup. A perturbation that lands
      // before it makes the NEW value the baseline, so the waiter correctly
      // never fires and the case fails while proving nothing about the subject.
      // One marker is that precondition exactly — it is written on the way into
      // the first sleep, which the loop reaches only after `prev` was captured —
      // stated as a fact rather than bought with a guess.
      await until('the waiter has taken its baseline reading', async () => (await iterations()) >= 1)
      return w
    },

    async hand(content) {
      await s.fs.write(`${name}/state/signal.md`, content)
    },

    async publishRaw(args, env = {}) {
      // BUG-140: this runs the REAL repo's signal-set.sh, which validates
      // --holder against a roster. AGENT_ROSTER_FILE defaults to a path that
      // does not exist in THIS fixture, degrading to a no-op — the arbitrary
      // holders ('OLD', 'NEW', …) every case here uses before this change are
      // otherwise unaffected. A case that means to exercise the roster check
      // itself (e.g. #13) overrides it.
      const r = await s.run('bash', [SIGNAL_SET, '--file', signal, ...args], {
        cwd: s.workspace.root,
        env: { AGENT_ROSTER_FILE: join(dir, 'AGENT_ROSTER.md'), ...env },
      })
      return r
    },

    async publish(args) {
      const r = await this.publishRaw(args)
      expect(r.code, `publishing the fixture baton failed: ${r.output}`).toBe(0)
    },

    async settle() {
      const base = await iterations()
      await until(
        `the waiter has compared ${QUIET_ITERATIONS} more times`,
        async () => (await iterations()) >= base + QUIET_ITERATIONS,
      )
    },
  }

  return m
}

/**
 * Run a NEGATIVE case: perturb, let the waiter compare QUIET_ITERATIONS more times, and
 * require it to still be waiting.
 *
 * `perturb` runs only after the baseline is captured, so a failure here is the
 * subject firing on something that is not a handoff — a phantom.
 */
async function stillWaiting(m: Mic, label: string, perturb: () => Promise<void>): Promise<void> {
  const w = await m.arm()
  try {
    await perturb()
    await m.settle()
    w.assertStillRunning(label)
  } finally {
    await w.stop()
  }
}

/** Run a POSITIVE case: perturb, require an exit, and hand back what it printed. */
async function fires(m: Mic, why: string, perturb: () => Promise<void>): Promise<string> {
  const w = await m.arm()
  try {
    await perturb()
    await w.awaitExit(why)
    expect(w.code, `${why} — the waiter exited abnormally`).toBe(0)
    return w.output()
  } finally {
    await w.stop()
  }
}

describe('FEATURE-005 — the mic waiter fires once on a real handoff and exits', () => {
  it('#1 a real ATOMIC publish makes the waiter report the new Holder and State, and EXIT', async () => {
    await scenario('wait-mic-1', async (s) => {
      // Published through signal-set.sh, not by editing the file: publication is
      // an atomic RENAME, and a waiter that only noticed ordinary writes would
      // pass a hand-rolled test and fail in production on every real handoff.
      const m = await mic(s, 'one')
      const out = await fires(m, 'a real atomic publish did not make the waiter exit', () =>
        m.publish(['--holder', 'Jesko', '--state', 'OVER_TO_CODEX', '--task', 'go']),
      )

      expect(out, 'the new Holder was not reported').toContain('Jesko')
      expect(out, 'the new State was not reported').toContain('OVER_TO_CODEX')
    })
  })

  it('#2 an unchanged baton keeps the waiter waiting — no phantom handoff', async () => {
    await scenario('wait-mic-2', async (s) => {
      // THE LOAD-BEARING CASE. A spurious exit is read as a handoff, and
      // re-arming on a phantom is how a watcher starts LYING instead of merely
      // going quiet.
      const m = await mic(s, 'two')
      await stillWaiting(m, '#2 an unchanged baton', async () => {})
    })
  })

  it('#3 a neighbouring file changing is not a handoff', async () => {
    await scenario('wait-mic-3', async (s) => {
      // The journal sits BESIDE the baton and is appended on every flip, so a
      // waiter keyed on the directory rather than on the baton's CONTENT would
      // fire on its own bookkeeping.
      const m = await mic(s, 'three')
      await stillWaiting(m, '#3 a neighbouring file changed', async () => {
        await s.fs.write('three/state/signal-history.log', '[x] noise\n')
      })
    })
  })

  it('#4 only Holder/State move the mic — a Task-only edit does not', async () => {
    await scenario('wait-mic-4', async (s) => {
      // Holder and State are the mic; Task is PAYLOAD. Waking on payload would
      // re-arm the agent for nothing.
      const m = await mic(s, 'four')
      await stillWaiting(m, '#4 only the Task changed', () =>
        m.publish(['--holder', 'OLD', '--state', 'IDLE', '--task', 'different text']),
      )
    })
  })

  it('#5 a DELETED baton is "cannot see the mic", not "the mic moved"', async () => {
    await scenario('wait-mic-5', async (s) => {
      // Found by Jesko (S1): the waiter exited 0 and printed an empty `MIC:`.
      // That is the worst available outcome — worse than the blindness being
      // replaced, because silence is merely uninformed while a false handoff
      // makes the agent ACT on one that never happened.
      const m = await mic(s, 'five')
      await stillWaiting(m, '#5 the baton was deleted', () => s.fs.rm('five/state/signal.md'))
    })
  })

  it('#6 column padding is not a mic change — the comparison is on VALUES, not rendered rows', async () => {
    await scenario('wait-mic-6', async (s) => {
      // Found by Jesko (S1): the waiter compared rendered rows, so re-aligning
      // the table fired it while Holder and State were byte-identical.
      //
      // This is BUG-010 exactly — a roster parser matching literal single spaces
      // broke on a padded table, and the miss was indistinguishable from "no
      // roster". The lesson was to compare VALUES, and the same defect was
      // reintroduced in the file whose whole job is reading that table.
      const m = await mic(s, 'six')
      await stillWaiting(m, '#6 the table was re-aligned', () =>
        m.hand(
          '| Field | Value |\n|---|---|\n|   Holder   |   OLD   |\n|  State  |  IDLE  |\n' +
            '| Task | seed |\n| Last update | 1970-01-01 |\n',
        ),
      )
    })
  })

  it('#7 seeding an ABSENT baton DOES fire — so the negative cases above are not vacuous', async () => {
    await scenario('wait-mic-7', async (s) => {
      // NON-VACUITY. Every negative case above passes against a waiter that never
      // exits at all. Seeding a baton that did not exist IS the mic moving, and it
      // must still fire — the converse of #5, and the reason #5 is about
      // READABILITY rather than about change.
      const m = await mic(s, 'seven', false)
      const out = await fires(m, 'seeding an absent baton did not fire', () => m.hand(SEED))
      expect(out, 'fired but did not report the seeded value').toContain('OLD')
    })
  })

  it('#8 a baton with NO Holder row is unreadable, not a handoff', async () => {
    await scenario('wait-mic-8', async (s) => {
      // THE DELETION BUG ONE LEVEL IN (Jesko, R2). The first fix handled an
      // absent FILE and stopped there, so a baton that is PRESENT but not
      // readable as a mic still produced a PARTIAL reading — `Holder= State=IDLE`
      // — which compares unequal to a real one and fires.
      //
      // Written directly rather than through signal-set.sh, which refuses to
      // publish a malformed baton. These arrive by hand-editing, which
      // AGENT_SIGNAL.md forbids and people do anyway.
      const m = await mic(s, 'eight')
      await stillWaiting(m, '#8 the Holder row was removed', () =>
        m.hand('| Field | Value |\n|---|---|\n| State | IDLE |\n| Task | seed |\n'),
      )
    })
  })

  it('#9 TWO Holder rows are unreadable, not a handoff', async () => {
    await scenario('wait-mic-9', async (s) => {
      const m = await mic(s, 'nine')
      await stillWaiting(m, '#9 a second Holder row was added', () =>
        m.hand(
          '| Field | Value |\n|---|---|\n| Holder | OLD |\n| Holder | SOMEONE-ELSE |\n| State | IDLE |\n',
        ),
      )
    })
  })

  it('#10 a whitespace-only Holder is unreadable, not a handoff', async () => {
    await scenario('wait-mic-10', async (s) => {
      const m = await mic(s, 'ten')
      await stillWaiting(m, '#10 the Holder was blanked to whitespace', () =>
        m.hand('| Field | Value |\n|---|---|\n| Holder |    |\n| State | IDLE |\n'),
      )
    })
  })

  it("#11 a '|' inside a Holder is REJOINED and reported verbatim, not rejected", async () => {
    await scenario('wait-mic-11', async (s) => {
      // THIS CASE ONCE ASSERTED THE OPPOSITE, and the inversion is Christian's
      // finding. Andreas was right that comparing only the PREFIX of a split row
      // makes two different values read as identical; refusing to read the row
      // was the wrong cure. A row's value is everything between the second
      // delimiter and the last one, so `| Holder | NEW | EXTRA |` carries the
      // recoverable value `NEW | EXTRA` — and recovering it is what stops the
      // prefix compare, not throwing the row away.
      //
      // Swallowing it was a MISSED handoff of its own: the reading is
      // all-or-nothing, so an unreadable Holder blinds State too (#13 proves it).
      const m = await mic(s, 'eleven')
      const out = await fires(m, "a rejoinable '|' in the Holder did not fire — the row was thrown away", () =>
        m.hand('| Field | Value |\n|---|---|\n| Holder | NEW | EXTRA |\n| State | IDLE |\n'),
      )
      expect(out, 'fired but did not report the rejoined value verbatim').toContain(
        'MIC: Holder=NEW | EXTRA State=IDLE',
      )
    })
  })

  it('#12 an UNRECOGNISED State is still a mic move and must fire, because readability is this script’s business and validity is the writer’s', async () => {
    await scenario('wait-mic-12', async (s) => {
      // THIS INVERTS WHAT THE IMPLEMENTER WROTE, and the disagreement is the
      // useful part. He whitelisted `State` against the protocol's IDLE / ACTIVE
      // / OVER_TO_*, which matches AGENT_SIGNAL.md exactly — but `signal-set.sh`
      // validates no such thing, so `State | DONE` is reachable and well-formed.
      // Swallowing it would leave the waiter waiting through a REAL handoff.
      //
      // Validity belongs to the WRITER, where it fails loudly at the point of the
      // mistake instead of turning into silence three layers away. Failing closed
      // here buys exactly the blindness the feature exists to remove.
      const m = await mic(s, 'twelve')
      const out = await fires(m, 'an unrecognised State did not fire — the waiter would sleep through it', () =>
        m.hand('| Field | Value |\n|---|---|\n| Holder | OLD |\n| State | BROKEN |\n'),
      )
      expect(out, 'fired but did not report the unrecognised State').toContain('BROKEN')
    })
  })

  it("#13 BUG-140: a Holder containing '|' can never be a roster row, so the real setter now REFUSES it", async () => {
    await scenario('wait-mic-13', async (s) => {
      // Was "signal-set.sh escapes `|` in Task ONLY; Holder and State are
      // printed raw, so `--holder 'A|B'` publishes cleanly and this baton is
      // REACHABLE rather than hand-edited." BUG-140 changes that premise: a `|`
      // cannot appear inside a roster's Name cell without breaking the table
      // itself (same reason Task's escaping exists), so once a roster is on
      // disk 'A|B' is unreachable through the real writer — not a fixture gap,
      // a correct refusal. The READ side this case used to cover — the waiter
      // recovering a piped Holder verbatim — stays covered by #11, which hands
      // the baton directly rather than going through signal-set.sh.
      const m = await mic(s, 'thirteen')
      await s.fs.write('thirteen/state/AGENT_ROSTER.md', ROSTER)

      const r = await m.publishRaw(['--holder', 'A|B', '--state', 'ACTIVE', '--task', 'go'])
      expect(r.code, `--holder 'A|B' PUBLISHED against a real roster:\n${r.output}`).not.toBe(0)
      expect(r.output, 'the refusal does not name the roster file').toContain('AGENT_ROSTER.md')
    })
  })
})
