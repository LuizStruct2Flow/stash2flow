/**
 * tests/spawn-bounded/spawn-bounded.spec.ts — TASK-065 (Codex re-review,
 * round 3).
 *
 * spawnBounded's whole job is to bound a wait: spawn a child, and however it
 * ends — exits cleanly, times out — resolve within a known ceiling. The
 * timeout path's ceiling used to rest on an assumption: `process.kill(-pid,
 * 'SIGKILL')`'s catch treated ANY failure as "the group is already gone"
 * (ESRCH). In Codex's sandbox that call instead fails EPERM (a container, a
 * pid namespace) — a real failure the catch was never told apart from ESRCH
 * — so nothing gets killed, and the function then awaits `close` with NO
 * bound at all. The helper whose one job is to bound a wait can itself hang
 * the caller forever. 3/15 mic-recovery cases hit exactly this in that
 * sandbox; this suite pins it directly against `spawnBounded`, not against
 * the higher-level scenario, because the sandbox-specific errno is not
 * reproducible through a real kill — it is reproduced here with an injected
 * kill function instead (`killFn`), which is the seam this port adds ahead
 * of the actual fix so the bug is provable before it is fixed.
 *
 * HAZARD: parallel-safe. Each case spawns its own short-lived child via
 * `node -e`; nothing shared, nothing that outlives the test (the child that
 * survives its own SIGKILL attempt dies of natural causes shortly after the
 * assertions run, well inside the test's own timeout).
 *
 * WHY A PLAIN UNIT TEST, not the `scenario()`/`home.spawn()` fixture API
 * TASK-018-CONVENTIONS.md requires elsewhere in this repo: that requirement
 * guards against a spec leaking GIT_* / AGENT_* ambient state into a fixture
 * that stands in for a real repo or the real baton (BUG-046/BUG-047). Nothing
 * here touches a repo, the baton, or any of those variables — spawnBounded is
 * a dependency-free utility over `node:child_process`, and the child spawned
 * below is a throwaway `node -e` process that reads no environment and
 * writes nothing outside itself. There is no fixture for the ambient state to
 * leak into.
 */
import { describe, it, expect } from 'vitest'
import { spawnBounded } from '../../scripts/lib/spawn-bounded.mts'

function eperm(): NodeJS.ErrnoException {
  return Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
}

describe('TASK-065 (round 3) — spawnBounded must resolve even when the group kill itself fails', () => {
  it('a group kill that fails EPERM (not ESRCH) still lets spawnBounded resolve, timed out, within timeout + grace', async () => {
    const TIMEOUT_MS = 50
    // A generous ceiling on the WHOLE call: the timeout, plus whatever grace
    // period the fix adds for `close` before giving up on it, plus slack for
    // scheduler jitter — well under the child's own natural lifetime below,
    // so a version that (bug) just waits unbounded for `close` is told apart
    // from a version that (fix) resolves on its own bound: it fails THIS
    // assertion with a real elapsed time near the child's lifetime, rather
    // than hanging the test runner itself.
    const CEILING_MS = 4_500

    let groupKillAttempted = false
    let directKillAttempted = false
    const killFn = (pid: number, _signal: NodeJS.Signals): void => {
      if (pid < 0) {
        groupKillAttempted = true
        throw eperm()
      }
      // The direct-child fallback (once the fix adds one) is exercised but
      // deliberately made a no-op here, not a real kill: the point of this
      // case is that NEITHER kill actually reaps the child, so the only way
      // spawnBounded can still resolve on time is the bounded-grace fallback,
      // not a kill that happened to work.
      directKillAttempted = true
    }

    // A child that outlives TIMEOUT_MS + any plausible grace window, so
    // `close` genuinely cannot fire before the ceiling — then exits on its
    // own well after, so nothing is left running once the test is done.
    const started = Date.now()
    const result = await spawnBounded(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 6000)'],
      { stdio: ['ignore', 'ignore', 'ignore'] },
      TIMEOUT_MS,
      killFn,
    )
    const elapsedMs = Date.now() - started

    expect(groupKillAttempted, 'the group kill must have been attempted').toBe(true)
    expect(elapsedMs, `spawnBounded must resolve within ${CEILING_MS}ms even when the group kill fails EPERM`).toBeLessThan(CEILING_MS)
    expect(result.error?.message, 'a bounded-but-unreaped timeout must still be reported as timed out').toMatch(/timed out/)
    // Recorded, not asserted on: whether a fallback direct-child kill exists
    // at all is exactly what this reproducer is red against on main (there is
    // none), and green once the fix adds it.
    void directKillAttempted
  }, 8_000)
})
