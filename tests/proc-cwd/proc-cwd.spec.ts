/**
 * tests/proc-cwd/proc-cwd.spec.ts — BUG-036 regression, TypeScript.
 *
 * FIRST MIGRATED SUITE. Chosen as the exemplar because it is small, it was
 * written in shell earlier the same day, and its shell twin
 * (tests/proc-cwd/test.sh) still exists — so the two can be compared directly,
 * which is what §5 of PLAN-TASK-018 requires before any shell runner is deleted.
 *
 * Parallelism class: parallel-safe.
 *   Every scenario owns its workspace, its HOME and its processes. It makes no
 *   global-absence claim and reads no shared file. Verified by the
 *   self-concurrency check.
 *
 * THE BUG. Three test helpers resolved a process's working directory by reading
 * /proc/<pid>/cwd. macOS has no procfs, so the read returned empty, ownership
 * comparisons never matched, and every "how many of MY processes are running?"
 * count came back 0 while the processes ran fine. Six cases failed closed and
 * the pre-push gate could not pass on a Mac at all.
 *
 * WHAT CHANGES IN THE PORT, and why it is not a weakening: the shell suite
 * tested `bp_proc_cwd`, a shell function. Its TypeScript equivalent is the
 * harness's own process ownership. So these scenarios assert the PROPERTY the
 * shell function existed to provide — that a scenario can identify and reap the
 * processes it started, on this OS — rather than re-testing a shell helper that
 * the TS harness does not use. Case IDs are preserved so the mapping to the
 * shell suite, and to the bug row, stays legible.
 *
 * THAT PARAGRAPH WAS TRUE AND INCOMPLETE, and the second `describe` block at the
 * bottom of this file is the correction. "A helper the TS harness does not use"
 * is not the same as "a helper nothing uses": two live shell suites source it,
 * neither tests it, and `tests/proc-cwd/test.sh` held the only assertion that a
 * cwd mechanism exists on the host at all. Retiring the shell runner on the
 * strength of the block above would have made `agent-activity-bound` #5b pass
 * over zero information. Measured, not reasoned — see that block's header for
 * the four-part measurement, and BUG-089 for the fail-open it exposed in the two
 * consumers.
 *
 * RETIREMENT READINESS: with that block present, this spec is a genuine superset
 * of `tests/proc-cwd/test.sh` — #1 to #5 are carried across by driving the
 * shipped helper — and the shell runner can go.
 *
 * R6 NEGATIVE PROOF — per CASE, not per case GROUP.
 *
 * The record above compares VERDICT SETS between the shell suite and this
 * port. Three Codex reviews of neighbouring groups refused certification on
 * the same point: agreeing on `#3` does not say which of the cases NAMED `#3`
 * can be made red. So every `it()` here was put to the narrower question —
 * is there a perturbation OBSERVED to turn it red — and the answer is
 * recorded in docs/waiting-acceptance/TASK-018-R6-isolation/outputs/gap.txt, which names
 * the mutant(s) per case. The denominator comes from the runner rather than
 * from a grep, so the `it.each` tables are expanded rather than counted once.
 *
 * AND IT FOUND ONE THING THIS BLOCK CANNOT CLAIM. `#1`, `#3` and `#5` of the
 * first describe — the three asserting that `pwd -P` equals the workspace
 * path — have NO isolable negative proof on Linux. The mutant that removes
 * the workspace root's realpath (with TMPDIR pointed at a symlink, which is
 * the macOS shape reproduced here) turns all ten cases red with the SAME
 * thrown error: assertOverrideAllowed realpaths both sides of its
 * containment test, so a non-physical root aborts every scenario before any
 * assertion runs. Their own `expect` was never observed failing.
 *
 * That is a stronger guard catching the defect first, not a weakness in the
 * port — but it is evidence these three do not have, and it is recorded
 * rather than engineered around. On macOS the same mutant reaches them.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type RunResult, type Scenario } from '../harness/index.js'
import { platform } from 'node:os'

describe('BUG-036 — process identity resolves on this OS', () => {
  it('#1 a scenario can spawn a process and observe its real working directory', async () => {
    await scenario('proc-cwd-1', async (s) => {
      const dir = await s.workspace.dir('plain')

      // `pwd -P` gives the PHYSICAL path. On macOS the workspace root is
      // already physical (the harness resolves it at creation), so these must
      // match exactly. Before BUG-036 they did not: mktemp handed back
      // /var/folders/... while the process reported /private/var/folders/...
      // and the comparison silently matched nothing.
      const r = await s.run('sh', ['-c', 'pwd -P'], { cwd: dir })

      expect(r.code).toBe(0)
      expect(r.stdout.trim()).toBe(dir)
    })
  })

  it('#3 a working directory containing spaces survives intact', async () => {
    await scenario('proc-cwd-3', async (s) => {
      const dir = await s.workspace.dir('with space', 'inner')
      const r = await s.run('sh', ['-c', 'pwd -P'], { cwd: dir })

      expect(r.code).toBe(0)
      expect(r.stdout.trim()).toBe(dir)
      expect(r.stdout).toContain('with space')
    })
  })

  it('#5 the workspace root is a physical path, not a symlinked one', async () => {
    await scenario('proc-cwd-5', async (s) => {
      // The regression this pins is subtle and cost hours: on macOS /var is a
      // symlink to /private/var, so an unresolved workspace root compares
      // unequal to every path a real process reports. Asserting the invariant
      // here means no future scenario has to remember it.
      const r = await s.run('sh', ['-c', 'pwd -P'], { cwd: s.workspace.root })

      expect(r.stdout.trim()).toBe(s.workspace.root)
      if (platform() === 'darwin') {
        expect(s.workspace.root.startsWith('/var/folders')).toBe(false)
      }
    })
  })

  it('#6 the harness scrubs git repo pointers from every child (BUG-047)', async () => {
    await scenario('proc-cwd-6', async (s) => {
      // Not in the shell suite — this is new coverage the harness makes cheap.
      // BUG-047: with GIT_DIR inherited, `git -C <fixture> init` returns 0,
      // creates no .git in the fixture, and later commits land in the real
      // repository. Two suites did exactly that.
      const r = await s.run('sh', ['-c', 'echo "[${GIT_DIR:-unset}]"'], {
        cwd: s.workspace.root,
        env: {},
      })

      expect(r.stdout.trim()).toBe('[unset]')
    })
  })

  it('#7 the harness gives each scenario its own baton, never the real one', async () => {
    await scenario('proc-cwd-7', async (s) => {
      // BUG-046: signal-set.sh honours AGENT_SIGNAL_FILE, and the watcher
      // exports it into every dispatched wake, which is how four bootstrap
      // suites overwrote the LIVE baton. A scenario must never see the real one.
      const r = await s.run('sh', ['-c', 'echo "$AGENT_SIGNAL_FILE"'], {
        cwd: s.workspace.root,
      })

      expect(r.stdout.trim()).toBe(s.signalFile)
      expect(r.stdout).toContain(s.workspace.root)
      expect(r.stdout.trim()).not.toContain('/sources/struct2flow/blueprint/logs')
    })
  })
})

/**
 * THE SHELL HELPER ITSELF — and why this block had to be added before
 * `tests/proc-cwd/test.sh` could retire.
 *
 * The block above was written as the exemplar port and it is honest about what it
 * changed: "these scenarios assert the PROPERTY the shell function existed to
 * provide … rather than re-testing a shell helper that the TS harness does not
 * use." That was true, and it left a hole, because the harness is not the only
 * consumer: `tests/helpers/proc-cwd.sh` is SOURCED by two live shell suites,
 * `tests/agent-activity-bound` and `tests/subagent-feed`, and neither of them
 * tests it.
 *
 * MEASURED RATHER THAN REASONED, by breaking the helper in a copy of the tree and
 * running all three things over it:
 *
 *   1. the shell suite CATCHES it — #1 red, exit 1;
 *   2. the spec above does not, and cannot: it never loads the helper (grepped,
 *      not remembered — no reference to `helpers/proc-cwd.sh`, no call to
 *      `bp_proc_cwd`);
 *   3. and the shape the two consumers actually use goes VACUOUS. With one live
 *      process whose cwd is genuinely under `$WORK`, the real helper counts 1 and
 *      the assertion correctly fails; the broken helper counts 0 and
 *      `[ "$(supervisors)" -eq 0 ]` — `agent-activity-bound` #5b, "--stop leaves
 *      zero residue" — PASSES. A leaked supervisor becomes invisible.
 *
 * That is exactly the trap `bp_proc_cwd_available` was written to refuse, and its
 * ONLY caller anywhere is the shell suite being retired. So these five cases
 * carry #1-#5 across, by DRIVING the shipped helper rather than restating it —
 * the helper stays shell because its consumers are shell, and a TypeScript
 * reimplementation of it would be a second mechanism agreeing by coincidence,
 * which is the A-09 defect.
 *
 * When `agent-activity-bound` and `subagent-feed` become specs, the helper loses
 * its last consumer and this block retires with it.
 */
describe('BUG-036 — the shell helper two live suites depend on', () => {
  /** Source the SHIPPED helper and call it. Never a reimplementation. */
  const helper = join(REPO_ROOT, 'tests/helpers/proc-cwd.sh')

  /**
   * Ask the helper about one pid.
   *
   * `sh -c '. "$1"; bp_proc_cwd "$2"'` and not a wrapper script: the point is to
   * exercise the shipped file, and anything that copies or rewrites it first has
   * stopped testing it.
   */
  const lookup = (s: Scenario, pid: number | undefined): Promise<RunResult> =>
    s.run('sh', ['-c', '. "$1"; bp_proc_cwd "$2"', 'sh', helper, String(pid)], {
      cwd: s.workspace.root,
    })

  /**
   * A sleeper in `dir`, and its reaping.
   *
   * The kill is AWAITED on the close event rather than followed by a sleep (R4),
   * and it is not optional: `background` detaches the child into its own process
   * group, and the harness FAILS a scenario that leaves one running — orphaned
   * supervisors at ppid 1 caused a real, hours-long misdiagnosis.
   */
  async function sleeper(s: Scenario, dir: string) {
    const child = s.background('sh', ['-c', 'exec sleep 30'], { cwd: dir })
    const exited = new Promise<void>((done) => child.on('close', () => done()))
    return {
      pid: child.pid,
      async reap(): Promise<void> {
        child.kill('SIGKILL')
        await exited
      },
    }
  }

  it('#1 a cwd mechanism is available on this host — without which every count is 0', async () => {
    await scenario('proc-cwd-h1', async (s) => {
      // If this fails the rest is vacuous, so it is asserted rather than assumed
      // — the BUG-005 lesson, and the one assertion that exists nowhere else in
      // the repository.
      const r = await s.run('sh', ['-c', '. "$1"; bp_proc_cwd_available', 'sh', helper], {
        cwd: s.workspace.root,
      })

      expect(
        r.code,
        'no cwd mechanism on this host — every process count would be 0 and every ' +
          '"expected 0" assertion in agent-activity-bound and subagent-feed would ' +
          'pass for the wrong reason',
      ).toBe(0)
    })
  })

  it('#2 a live process resolves to the directory it was started in', async () => {
    await scenario('proc-cwd-h2', async (s) => {
      // THIS is what returned empty on macOS and produced BUG-036.
      const dir = await s.workspace.dir('plain')
      const proc = await sleeper(s, dir)

      const r = await lookup(s, proc.pid)
      await proc.reap()

      expect(r.stdout.trim(), `cwd lookup returned '${r.stdout.trim()}', expected '${dir}'`).toBe(dir)
    })
  })

  it('#3 a cwd containing SPACES survives the lookup intact', async () => {
    await scenario('proc-cwd-h3', async (s) => {
      // agent-activity-bound #7 asserts exactly this, and column-parsing lsof
      // output reintroduces the break — which is why the helper uses `-Fn`.
      const dir = await s.workspace.dir('with space', 'inner')
      const proc = await sleeper(s, dir)

      const r = await lookup(s, proc.pid)
      await proc.reap()

      expect(r.stdout.trim()).toBe(dir)
      expect(r.stdout).toContain('with space')
    })
  })

  it('#4 a DEAD pid yields empty, not a stale or wrong path', async () => {
    await scenario('proc-cwd-h4', async (s) => {
      // Callers use the result to decide "is this MY process", so a confident
      // wrong answer is worse than none. The pid is one this scenario owned and
      // reaped, so it is known dead rather than assumed unused.
      const dir = await s.workspace.dir('dead')
      const proc = await sleeper(s, dir)
      // Awaited, not slept on: the lookup must happen after the kernel has reaped
      // it, and `close` is the condition that says so (R4).
      await proc.reap()

      const r = await lookup(s, proc.pid)

      expect(
        r.stdout.trim(),
        'a dead pid resolved to a path — callers would count a process that no longer exists',
      ).toBe('')
    })
  })

  it('#5 an EMPTY pid is a no-op, not an error under `set -u`', async () => {
    await scenario('proc-cwd-h5', async (s) => {
      const r = await s.run('sh', ['-cu', '. "$1"; bp_proc_cwd ""', 'sh', helper], {
        cwd: s.workspace.root,
      })

      expect(r.code).toBe(0)
      expect(`${r.stdout}${r.stderr}`.trim()).toBe('')
    })
  })
})
