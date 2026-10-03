/**
 * tests/helpers/feed-fixture.ts — a project-shaped tree that runs the real feed.
 *
 * WHY A SHARED HELPER. Four suites drive `scripts/agent-activity.sh` against a
 * fixture — agent-activity-bound, subagent-feed, watcher-liveness, roster — and
 * their shell originals each built the tree by hand. Every one of them then
 * needed the same retrofit twice: `cp -R scripts/lib/.` instead of naming one
 * lib (the fragility that bit when `state-dir.sh` was added), and the
 * `.blueprint-source` root marker (TASK-021). A fixture shape copied four times
 * is four fixtures, and they drifted in exactly the way CLAUDE.md says two copies
 * of a rule drift.
 *
 * WHAT IT DOES NOT DO, deliberately: it is not a sandbox. HOME, TMPDIR, the
 * baton and every AGENT_* variable come from `scenario()` (R3), and this helper
 * cannot widen any of them. All it owns is the SHAPE of the tree and the
 * lifecycle of the supervisor.
 *
 * THE FEED IS RUN IN THE FOREGROUND, NOT AS A DAEMON, and that is a safety
 * property rather than a preference. `cmd_daemon` re-execs under `setsid`, which
 * takes the supervisor out of the scenario's process group — so the harness's
 * "every spawned process is reaped" guarantee cannot see it, and a failed
 * `--stop` leaks a supervisor into a parallel run. Foreground mode runs the same
 * `supervise()` loop, writes the same state file, holds the same lock and answers
 * `--stop` the same way, while staying inside the group the harness kills. The
 * suites that are ABOUT `--daemon` (agent-activity-bound #1/#4/#6/#13) drive it
 * explicitly and own that risk; nothing else should.
 */

import { vi } from 'vitest'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { REPO_ROOT, type Scenario } from '../harness/index.js'

export interface FeedFixtureOptions {
  /** Which tree the scripts come from. Defaults to the blueprint under test. */
  readonly source?: string
  /** `AGENT_ROSTER.md` content. Omitted → only the shipped example is present. */
  readonly roster?: string
  /** Baton fields. Omitted → an ACTIVE baton, which is the quiet default. */
  readonly holder?: string
  readonly state?: string
  /** Also copy `scripts/log-activity.mts` (the hook). */
  readonly withHook?: boolean
  /** Further `scripts/`-relative files to copy in (`team-kickoff.sh`, …). */
  readonly extraScripts?: readonly string[]
  /** Poll interval in seconds. The default of 2 makes every wait eight ticks. */
  readonly tick?: string
}

export interface FeedFixture {
  /** The fixture project root — what the feed sees as its repo. */
  readonly repo: string
  /** The fixture state dir. The baton, the run logs and the watcher locks live here. */
  readonly stateDir: string
  /** The baton the feed actually watches. */
  readonly signal: string
  /** The feed log the feed actually writes. Derived from `repo`, never overridable. */
  readonly log: string
  /** The environment every invocation of this fixture's feed receives. */
  readonly env: Record<string, string | undefined>

  /** Run the feed's CLI once and wait for it to exit (`--status`, `--stop`, …). */
  cli(args: string[]): ReturnType<Scenario['run']>
  /** The feed log's current content, or '' before the feed has written anything. */
  read(): Promise<string>
  /** Occurrences of a literal in the feed log. */
  count(needle: string): Promise<number>
  /** Wait until a literal appears in the feed log. Condition, never a duration (R4). */
  expectLine(needle: string, timeoutMs?: number): Promise<void>
  /**
   * Wait until the supervisor is READING the named file — not merely resident.
   *
   * BUG-038. `supervise()` seeds each watched file's offset at registration so
   * that pre-existing content is never replayed, and those two instants are not
   * the same: a payload appended after the supervisor exists but before that file
   * is seeded is folded into the baseline and is **never emitted**. So the suite
   * reports "the reader lost it", which is indistinguishable from the regression
   * the case exists to catch.
   *
   * WAITING LONGER CANNOT FIX IT, and that is the whole reason this is a
   * handshake. The loss is PERMANENT: measured with `seed_offset` delayed by 5s,
   * the payload never appeared in 184s. So the sentinel is RE-APPENDED until one
   * of them lands after the seed, which is the only thing that closes the gap.
   *
   * Failure is loud. The first shell version of this returned a status nobody
   * checked, so a failed handshake degraded to exactly the unsynchronised
   * behaviour it exists to prevent — a guard whose failure mode is invisible is
   * not a guard.
   */
  /**
   * `wrap` formats the sentinel for the file's KIND. A run log takes a bare line; a
   * transcript is projected through `jq`, so a bare line yields nothing at all and
   * the handshake could never complete — which is how three cases here first burned
   * their whole timeout appending 120 sentinels that were never going to be
   * readable. The default is a bare line.
   */
  readerReady(
    workspaceRelFile: string,
    options?: { timeoutMs?: number; wrap?: (tag: string) => string },
  ): Promise<void>
  /**
   * Run `body` with a live foreground supervisor, stopping it on every exit path.
   *
   * `ceilingMs` is a SAFETY NET, not a wait: nothing in `body` sleeps on it, and
   * reaching it means the feed hung. It exists because a supervisor that outlives
   * its scenario is a defect under the harness's own contract, so there has to be
   * an outer bound that is not the vitest timeout.
   */
  withFeed(body: () => Promise<void>, ceilingMs?: number): Promise<void>

  /**
   * Supervisors and `tail -F` followers belonging to THIS scenario.
   *
   * Ownership matters: the shell suite counted followers machine-wide, so a
   * sibling test's processes changed its verdict. That is the reading-what-you-do-
   * not-own bug R5 says makes a test look like it needs serial execution.
   */
  ownedProcesses(): Promise<{ supervisors: number; tails: number }>
  /** Wait until exactly `want` owned supervisors are resident. A condition, not a wait. */
  expectSupervisors(want: number, timeoutMs?: number): Promise<void>
  /** The pid the supervisor published in its state file, or '' if there is none. */
  supervisorPid(): Promise<string>
  /**
   * Run `body` with a live DAEMON supervisor, stopping it on every exit path and
   * asserting it is gone.
   *
   * `--daemon` re-execs under `setsid`, so the supervisor leaves the scenario's
   * process group and the harness's reaper cannot see it. Prefer `withFeed` unless
   * the daemon itself is the subject.
   */
  withDaemon(
    body: () => Promise<void>,
    extraEnv?: Record<string, string | undefined>,
  ): Promise<void>
}

/** The libs the feed sources. The WHOLE directory, never a named file. */
async function copyLibs(s: Scenario, source: string, destRel: string): Promise<void> {
  const libs = await s.run('sh', ['-c', `ls "${join(source, 'scripts', 'lib')}"`], {
    cwd: s.workspace.root,
  })
  const names = libs.stdout.split('\n').filter((n) => n.endsWith('.sh'))
  if (names.length === 0) {
    throw new Error(
      `fixture source ${source} has no scripts/lib/*.sh — the feed aborts on a ` +
        `missing source dependency, and a fixture that reproduces that failure ` +
        `instead of preventing it tests nothing.`,
    )
  }
  for (const n of names) {
    await s.fs.copyIn(join(source, 'scripts', 'lib', n), `${destRel}/scripts/lib/${n}`)
  }
}

export async function feedFixture(
  s: Scenario,
  name: string,
  options: FeedFixtureOptions = {},
): Promise<FeedFixture> {
  const source = options.source ?? REPO_ROOT
  const repo = await s.fs.mkdirp(name)
  await s.fs.mkdirp(`${name}/logs`)
  const stateDir = await s.fs.mkdirp(`${name}/state`)
  await s.fs.mkdirp(`${name}/scripts/lib`)

  // TASK-021 — the marker that makes this a project-shaped root. Without it the
  // state-dir resolution walks up and out of the fixture.
  await s.fs.write(`${name}/.blueprint-source`, '')
  await s.fs.copyIn(join(source, 'scripts', 'agent-activity.sh'), `${name}/scripts/agent-activity.sh`)
  if (options.withHook) {
    await s.fs.copyIn(join(source, 'scripts', 'log-activity.mts'), `${name}/scripts/log-activity.mts`)
  }
  for (const extra of options.extraScripts ?? []) {
    await s.fs.copyIn(join(source, 'scripts', extra), `${name}/scripts/${extra}`)
  }
  await copyLibs(s, source, name)
  await s.fs.copyIn(join(source, 'AGENT_ROSTER.example.md'), `${name}/AGENT_ROSTER.example.md`)
  if (options.roster !== undefined) await s.fs.write(`${name}/AGENT_ROSTER.md`, options.roster)

  const signal = join(stateDir, 'signal.md')
  await s.fs.write(
    `${name}/state/signal.md`,
    `# Agent Signal\n\n| Field | Value |\n|---|---|\n| Holder | ${options.holder ?? 'Fixture'} |\n` +
      `| State | ${options.state ?? 'ACTIVE'} |\n| Task | fixture |\n| Last update | 2026-09-11 |\n`,
  )

  const log = join(repo, 'logs', 'agent-activity.log')
  const env: Record<string, string | undefined> = {
    AGENT_STATE_HOME: stateDir,
    // BOTH, and the second is not redundant. `agent_signal_file` honours
    // AGENT_SIGNAL_FILE BEFORE it consults the state dir, so AGENT_STATE_HOME
    // alone does not move the baton. The shell suites this replaces passed only
    // AGENT_STATE_HOME and were correct purely because nothing in their
    // environment set AGENT_SIGNAL_FILE — i.e. they were one exported variable
    // away from driving a fixture feed off the operator's LIVE baton, which is
    // the BUG-046 class exactly. The harness sets AGENT_SIGNAL_FILE for every
    // scenario, so the omission fails loudly here instead of silently there.
    AGENT_SIGNAL_FILE: signal,
    AGENT_FEED_TICK: options.tick ?? '0.25',
    // A persona name is the SUBJECT of the roster suites, so it cannot carry the
    // scenario's escape token — see the AGENT_PERSONA note in harness/index.ts.
    // Unset rather than overridden: the feed must resolve identity from the
    // roster, which is the whole point of every case that uses this.
    AGENT_PERSONA: undefined,
    AGENT_BACKING: undefined,
  }

  const read = async (): Promise<string> => readFile(log, 'utf8').catch(() => '')

  const fixture: FeedFixture = {
    repo,
    stateDir,
    signal,
    log,
    env,

    cli: (args) => s.run('bash', ['scripts/agent-activity.sh', ...args], { cwd: repo, env }),

    read,

    async count(needle) {
      return (await read()).split(needle).length - 1
    },

    // 8 s IS THE SHELL'S OWN DEFAULT (`wait_for`'s `lim=8`, agent-activity-bound
    // test.sh:200), restored after the port shipped 20 s. A ceiling is what the
    // test waits before declaring failure, and widening one is the cheapest way
    // to make a flaky port look green — so it is measured rather than felt.
    //
    // MEASURED on this host (Linux, 4 full runs of the four feed suites,
    // 129 + 43 samples): p50 0.30 s, p90 0.30 s, worst 3.31 s. The worst is
    // `TICK-PROOF-1`, whose reader is deliberately slowed by the case itself, so
    // it is a property of the fixture rather than of load. 8 s is 2.4x it.
    // The one caller that genuinely needs more is #10's `RACE-C`, which passes
    // the same explicit 30 s the shell gave it (`wait_for RACE-C 30`, :578).
    async expectLine(needle, timeoutMs = 8_000) {
      await vi.waitFor(
        async () => {
          const body = await read()
          if (!body.includes(needle)) {
            throw new Error(
              `'${needle}' has not reached the feed. Log tail:\n${body.split('\n').slice(-4).join('\n')}`,
            )
          }
        },
        { timeout: timeoutMs, interval: 100 },
      )
    },

    async readerReady(workspaceRelFile, options = {}) {
      // 20 s IS THE SHELL'S BOUND EXACTLY — 20 outer sentinels x 4 x 0.25 s
      // (agent-activity-bound test.sh:250, subagent-feed test.sh:158) — restored
      // after the port shipped 30 s. MEASURED here over 4 full runs (111 + 37
      // samples): p50 0.25 s, p90 0.50 s, worst 3.26 s at 14 re-appends, which is
      // the `--daemon` case where registration genuinely lags. 20 s is 6x that.
      const { timeoutMs = 20_000, wrap = (t: string) => `${t}\n` } = options
      const tag = `READY-${randomBytes(6).toString('hex')}`
      // THE FILE MUST ALREADY EXIST. `ScopedFs.write` creates parents, so a wrong
      // path silently creates a file nothing watches and the handshake then burns
      // its whole budget reporting "the supervisor has not registered <path>" —
      // naming a mechanism that is working fine. That happened during this port
      // (one case pointed at a sibling fixture's directory) and cost a diagnosis;
      // it is the BUG-041/042 misdirection class, where the message names the one
      // thing that demonstrably did not go wrong.
      if (!(await s.fs.exists(workspaceRelFile))) {
        throw new Error(
          `readerReady("${workspaceRelFile}"): no such file in this scenario. The ` +
            `path is WORKSPACE-relative, so it must carry the fixture directory ` +
            `name (e.g. "myfixture/state/gemini-runs.log").`,
        )
      }
      let appends = 0
      await vi.waitFor(
        async () => {
          // The append happens on every attempt, which IS the mechanism: only a
          // sentinel written after the seed can ever come out the other end.
          appends += 1
          await s.fs.write(workspaceRelFile, wrap(tag), { append: true })
          const body = await read()
          if (!body.includes(tag)) {
            throw new Error(
              `the supervisor has not registered ${workspaceRelFile} after ${appends} ` +
                `sentinel append(s) — until it has, anything written there is ` +
                `folded into the baseline and lost permanently (BUG-038).`,
            )
          }
        },
        { timeout: timeoutMs, interval: 250 },
      )
    },

      async ownedProcesses() {
      // ONE shell pass, and it counts only processes belonging to THIS scenario.
      //
      // The shell suite counted `tail -n0 -F` MACHINE-WIDE, which is precisely the
      // "reads something it does not own" bug TASK-018-TARGET §1.2 names as the
      // reason a test looks like it needs serial execution. Ownership is decided by
      // the process's cwd, through `tests/helpers/proc-cwd.sh` — the same mechanism
      // the shell suites use (procfs on Linux, lsof on BSD), sourced rather than
      // re-implemented, because two ways to answer one question is two answers.
      //
      // The supervisor re-execs as `agent-activity.sh --supervise` with a RELATIVE
      // path, so its argv does not contain the fixture path: ownership is confirmed
      // via the cwd instead.
      //
      // THE MATCH IS DELIBERATELY NOT `--supervise`. A FOREGROUND feed runs the same
      // `supervise()` loop under a bare `agent-activity.sh` with no mode argument, so
      // matching the internal flag counts it as ZERO — which is how the foreground
      // case first "proved" that a blocking supervisor was not resident. The one-shot
      // CLI modes are excluded by name instead; none of them is a supervisor, and
      // each has exited by the time any caller here looks.
      const r = await s.run(
        'sh',
        [
          '-c',
          `. "${join(REPO_ROOT, 'tests', 'helpers', 'proc-cwd.sh')}"
           bp_proc_cwd_available || { echo NO-PROC-CWD-MECHANISM; exit 1; }
           sup=0; tails=0
           for p in $(ps -eo pid,args 2>/dev/null | grep '[a]gent-activity.sh' | grep -v -e --stop -e --status -e --daemon -e --whoami | awk '{print $1}'); do
             case "$(bp_proc_cwd "$p")" in "$1"*) sup=$((sup+1)) ;; esac
           done
           for p in $(ps -eo pid,args 2>/dev/null | grep '[t]ail -n0 -F' | awk '{print $1}'); do
             case "$(bp_proc_cwd "$p")" in "$1"*) tails=$((tails+1)) ;; esac
           done
           printf '%s %s\\n' "$sup" "$tails"`,
          'x',
          s.workspace.root,
        ],
        { cwd: s.workspace.root },
      )
      // BUG-089 — AN EMPTY `bp_proc_cwd` RESULT IS "UNKNOWN", NEVER "DOES NOT
      // MATCH", and the helper's own contract says so. Both shell suites this
      // replaces broke that rule with a bare `case "$(bp_proc_cwd "$p")" in "$WORK"*)`,
      // so on a host with neither /proc nor lsof every count was 0 and every
      // assertion of the form `-eq 0` passed over zero information — #5b, "--stop
      // leaves zero residue", reporting clean while a real supervisor leaked. Latent
      // on Linux, live on macOS. Asking `bp_proc_cwd_available` first turns that
      // into a loud failure, which is what the helper exposed it for.
      if (r.stdout.includes('NO-PROC-CWD-MECHANISM')) {
        throw new Error(
          'this host has neither /proc nor lsof, so process OWNERSHIP cannot be ' +
            'determined. Every count here would be 0, and a count of 0 is what most ' +
            'of these cases assert — so the suite refuses to answer rather than ' +
            'reporting clean over nothing (BUG-089).',
        )
      }
      const [sup = '0', tails = '0'] = r.stdout.trim().split(/\s+/)
      return { supervisors: Number(sup), tails: Number(tails) }
    },

    // 4 s IS THE SHELL'S BOUND EXACTLY — `wait_sup`'s 40 x 0.1 s
    // (agent-activity-bound test.sh:207, subagent-feed test.sh:139). The port
    // shipped 30 s, then 10 s on the reasoning below; neither was measured, and
    // both were wider than the shell's.
    //
    // MEASURED here over 4 full runs (180 + 60 samples): p50 39 ms, p99 47 ms,
    // worst 120 ms. 4 s is 33x the worst observation.
    //
    // The bound matters on the FAILING side, not the passing one: under the RC-1
    // mutant (instance guard deleted) every case burns the whole ceiling twice,
    // which at 30 s turned a 40 s spec into a 36 minute one and made the
    // equivalence sweep impractical.
    async expectSupervisors(want, timeoutMs = 4_000) {
      await vi.waitFor(
        async () => {
          const { supervisors } = await fixture.ownedProcesses()
          if (supervisors !== want) {
            throw new Error(`expected ${want} owned supervisor(s), saw ${supervisors}`)
          }
        },
        { timeout: timeoutMs, interval: 100 },
      )
    },

    async supervisorPid() {
      const body = await readFile(join(repo, 'logs', '.agent-activity.state'), 'utf8').catch(() => '')
      return /^pid=(\d+)$/m.exec(body)?.[1] ?? ''
    },

    async withDaemon(body, extraEnv = {}) {
      // `cmd_daemon` re-execs under `setsid`, so the supervisor leaves this
      // scenario's process group and the harness's reaper cannot see it. That makes
      // `--stop` mandatory rather than tidy, and it is why this wrapper exists at
      // all: every case that starts a daemon must end with zero owned supervisors,
      // asserted, or a leak crosses into a sibling scenario.
      await s.run('bash', ['scripts/agent-activity.sh', '--daemon'], {
        cwd: repo,
        env: { ...env, ...extraEnv },
      })
      try {
        await fixture.expectSupervisors(1)
        await body()
      } finally {
        await s.run('bash', ['scripts/agent-activity.sh', '--stop'], { cwd: repo, env })
        await fixture.expectSupervisors(0)
      }
    },

  async withFeed(body, ceilingMs = 60_000) {
      // Un-awaited on purpose: this is the supervisor, and it only returns when
      // it is stopped. The rejection on the ceiling is swallowed here and the
      // promise is awaited in the finally, so a hang cannot escape as an
      // unhandled rejection (vitest is configured to fail on those).
      const running = s
        .run('bash', ['scripts/agent-activity.sh'], { cwd: repo, env, timeoutMs: ceilingMs })
        .catch(() => undefined)
      try {
        await body()
      } finally {
        await s.run('bash', ['scripts/agent-activity.sh', '--stop'], { cwd: repo, env })
        await running
      }
    },
  }

  return fixture
}
