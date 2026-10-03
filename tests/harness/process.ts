/**
 * tests/harness/process.ts — every child process a scenario spawns is owned,
 * tracked, and reaped.
 *
 * WHY OWNERSHIP AND NOT PATTERN MATCHING. The shell suites discover their own
 * processes with `ps -eo pid,args | grep '[a]gent-activity.sh --supervise'` and
 * then filter by cwd. That works only because each fixture has a unique cwd, it
 * costs an lsof per candidate process, and two of the assertions never filtered
 * at all — `agent-activity-bound:264,491,494` count `tail -n0 -F` across the
 * WHOLE MACHINE, so any unrelated process falsifies them.
 *
 * scripts/lib/watcher-lock.sh:17 already records why the process table is the
 * wrong oracle: a `pgrep -f` matches the checking shell's own command line. The
 * repo knew; the tests did it anyway.
 *
 * Here a process is a handle. You cannot obtain one without the registry
 * recording it, and afterEach fails if any survive — which is how "leaves no
 * stray processes" becomes checkable instead of promised. Orphaned supervisors
 * were observed for real on 2026-09-09: two, at ppid 1, causing a failure that
 * vanished when they were killed.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { readlink } from 'node:fs/promises'
import { fixtureEnv } from './env.js'

/**
 * The kernel id (`pipe:[N]` or, on this Linux's libuv, `socket:[N]` — stdio
 * pipes are backed by an AF_UNIX socketpair, not a POSIX pipe(2), measured
 * directly rather than assumed) of `child`'s own fd `fdNum`, read from the
 * CHILD's OWN /proc entry rather than the parent's.
 *
 * WHY THE CHILD'S OWN VIEW, NOT THE PARENT'S. A socketpair has two distinct
 * endpoints with two distinct inode numbers — the parent's read side and the
 * child's write side are NOT the same id. A grandchild that inherits fd 1
 * across fork() inherits the CHILD's endpoint, so that is the id any later
 * holder-scan (BUG-146: dump.ts's findPipeHolders) must search for. Reading
 * the parent's own `_handle.fd` here would capture the wrong half of the
 * pair — one no orphaned descendant could ever hold.
 *
 * Best-effort: /proc is Linux-only, and reading another process's fd table —
 * even one's own child's — needs the OS to permit it (same-uid normally does;
 * a hardened sandbox may not). Either way this returns undefined rather than
 * throwing, which is the same degrade-gracefully contract the rest of this
 * module and dump.ts already keep.
 *
 * RETRIED A FEW TIMES, measured rather than assumed necessary: on this
 * project's own sandboxed dev host, reading a just-spawned child's own
 * `/proc/<pid>/fd/N` fails EACCES immediately after `spawn()` returns and
 * succeeds within one 20ms retry — a transient race in that host's fd
 * virtualization, not a real permission boundary (the SAME read against an
 * already-reparented, unrelated process succeeds on the first try, with no
 * delay, on the same host). Five tries costs at most 100ms, once, at spawn
 * time, and is silent when the first attempt already succeeds.
 */
async function childPipeId(pid: number, fdNum: number): Promise<string | undefined> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await readlink(`/proc/${pid}/fd/${fdNum}`)
    } catch {
      // A transient EACCES right after spawn (see above): retry, and after the
      // last try return undefined rather than throw — capture is best-effort.
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  return undefined
}

/**
 * Is ANY process in group `pgid` still signalable by us?
 *
 * THE CONDITION, AND WHY IT IS THE RIGHT ONE. What teardown must establish is
 * that nothing from this scenario can still run and write into the fixture — or
 * into the operator's real feed. `kill(-pgid, 0)` answering ESRCH is exactly
 * that fact: the kernel holds no member of the group, so there is nothing left
 * to schedule.
 *
 * It is deliberately NOT the claim "the group was reaped". Those differ, and the
 * difference cuts the way that matters: a zombie is signalable (so this reports
 * alive) yet cannot execute, which errs toward failing the test rather than
 * passing it; and a GRANDCHILD is never our child, so its reaping is not an
 * event this process can ever observe — reparented to init, the group is the
 * only handle on it we have. Asserting reaping would therefore mean asserting
 * something unobservable, and the harness would end up checking a proxy for it.
 * That is the trap docs/config/findings.md F-002 has seven instances of; this is
 * not the eighth, because the fact asserted here is the same fact `disposeAll`
 * uses to DECIDE a survivor, so oracle and assertion cannot drift apart.
 *
 * EPERM is the one answer that means "a member exists which we may not signal".
 * Impossible for our own descendants, and reading it as "gone" would be the
 * unsafe direction, so it is reported as alive rather than swallowed with ESRCH.
 */
function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Wait until group `pgid` is gone, or until the budget runs out. `false` means
 * the budget expired with the group still there.
 *
 * BOUNDED ON PURPOSE. An unbounded poll turns a leaked process into a hung
 * teardown, and `scripts/log-activity.sh` already argues that trade at length
 * for its roster lookup: a hook that hangs is worse than one that dies, because
 * a death is a report and a hang is silence. The bound is a ceiling, never the
 * pacing — a group that exits in 4 ms is waited on for 4 ms.
 */
async function waitGroupGone(pgid: number, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (groupAlive(pgid)) {
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  return true
}

/** How often the group is re-asked. Matches the harness's sanctioned `vi.waitFor` interval. */
const POLL_INTERVAL_MS = 10

/**
 * How long SIGTERM is given before SIGKILL.
 *
 * This bound is a ceiling on POLITENESS, not on correctness: it is only reached
 * by a group that ignored SIGTERM, and the next thing that happens is SIGKILL.
 * Nothing about the verdict depends on its value.
 */
const TERM_GRACE_MS = 2_000

/**
 * How long SIGKILL is given. 5 s is the bound `watcher.ts` already measured as
 * sufficient for the `wait-mic.sh` + `sleep` grandchild shape, which is the
 * slowest group any scenario here starts.
 */
const KILL_GRACE_MS = 5_000

/**
 * How long a group gets to finish dying on its own before `disposeAll` records
 * it as a survivor at all.
 *
 * BUG-111, reopened. That row fixed only the TIMEOUT path in `run()`: a group
 * `run()` itself had just SIGKILLed could still be mid-reap when `disposeAll`
 * sampled it, so `run()` was made to await `waitGroupGone` before its promise
 * settles. `disposeAll`'s OWN first sample (this loop, before either signal is
 * sent) had the identical shape and was left as-is — a single
 * `groupAlive(pgid)` call, decided and recorded in `survivors` before any
 * grace is given. Two more cases hit it under CI load in the following days
 * (tests/subagent-feed BUG-133 #17, then BUG-124 #4): a scenario's own process
 * — a deferred bookend child that had already written its output and reached
 * `exit`, or a background `sleep` a trap had just signalled — was still in the
 * kernel's process table for a few milliseconds while init/the subreaper
 * caught up, and `disposeAll` recorded that instant as a permanent defect
 * regardless of what happened a moment later.
 *
 * MEASURED, not guessed: instrumenting this exact spot against both failing
 * cases under 4-core-pinned load (`taskset -c 0-3`) plus 18 CPU-bound busy
 * loops pinned to the same 4 cores (heavier than the 6-loop rig that
 * reproduced the CI failure at all) — every group caught alive on the first
 * sample resolved within 10-15ms (`waitGroupGone`'s own 10ms poll granularity
 * is the only reason it was not measured sub-10ms). 250ms is therefore >15x
 * the worst observed case, while staying far below what any REAL leaked
 * process shows: every orphan this suite has ever caught (the daemons in
 * "reaps a background process the scenario forgot", `harness-slow-reap`'s
 * zombie) is still alive well past a second. `TERM_GRACE_MS` (2s) or
 * `KILL_GRACE_MS` (5s) could not serve this role without hiding an actual
 * multi-second leak for the whole first phase.
 *
 * A group still alive after this grace is exactly as much a defect as before
 * — this delays the VERDICT, not the definition of one.
 */
const PROCESS_SNAPSHOT_GRACE_MS = 250

export interface SpawnOptions {
  cwd: string
  env?: Record<string, string | undefined>
  /** Milliseconds before the process is killed and the call rejects. */
  timeoutMs?: number
}

export interface RunResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  /** stdout and stderr interleaved is NOT reconstructable; this is stdout+stderr concatenated for convenience greps. */
  output: string
}

/**
 * Tracks every process a scenario starts. One per scenario, created by the
 * harness — specs never construct it.
 */
export class ProcessRegistry {
  private readonly live = new Set<ChildProcess>()
  private readonly groups = new Set<number>()
  /**
   * Every stdio pipe id (BUG-146) this scenario's children have ever held,
   * captured once at spawn and never removed — a dump reads this AFTER a
   * child may already look exited in `ps`, so the id has to survive that.
   */
  private readonly pipeIds = new Set<string>()

  /** Fire-and-forget capture of `child`'s stdout/stderr pipe ids (BUG-146).
   * Not awaited by either caller: neither `run()`'s nor `startBackground()`'s
   * contract should block on a /proc read that exists purely for a dump that
   * may never happen, and the capture completes in well under the shortest
   * `waitOrDump` bound any spec uses. */
  private capturePipeIds(child: ChildProcess): void {
    if (child.pid === undefined) return
    const pid = child.pid
    void (async () => {
      const [out, err] = await Promise.all([childPipeId(pid, 1), childPipeId(pid, 2)])
      if (out !== undefined) this.pipeIds.add(out)
      if (err !== undefined) this.pipeIds.add(err)
    })()
  }

  /**
   * `escapeToken` is the scenario's own token. The registry does not use it
   * itself — it hands it to fixtureEnv, which is where "an override of
   * AGENT_FEED_TAG must still carry the token" is enforced (BUG-062). It is
   * threaded rather than looked up because there is exactly one token per
   * scenario and the environment builder cannot invent it.
   *
   * `options.cwd` is handed over for the same reason: with AGENT_FEED_LOG unset
   * the feed a child writes to is derived from where it RUNS, so whether the
   * token may be dropped is a question only the spawn site can answer.
   */
  constructor(
    private readonly workspaceRoot: string,
    private readonly escapeToken?: string,
  ) {}

  /**
   * Spawn a process and wait for it to exit.
   *
   * Uses `detached: true` so the child gets its own process GROUP, which is
   * what makes reaping GRANDCHILDREN possible. Without it, killing the child
   * leaves its children orphaned at ppid 1 — exactly the shape observed on
   * 2026-09-09, and the gap Jesko flagged in the "assert no survivors" check.
   */
  async run(
    command: string,
    args: string[],
    options: SpawnOptions,
  ): Promise<RunResult> {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: fixtureEnv(options.env, this.workspaceRoot, this.escapeToken, options.cwd),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.live.add(child)
    if (child.pid !== undefined) this.groups.add(child.pid)
    this.capturePipeIds(child)

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString('utf8')
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
    })

    const timeoutMs = options.timeoutMs ?? 120_000
    let timer: NodeJS.Timeout | undefined
    let timedOut = false

    try {
      const code = await new Promise<{
        code: number | null
        signal: NodeJS.Signals | null
      }>((resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          this.killGroup(child)
        }, timeoutMs)

        child.on('error', reject)
        child.on('close', (code, signal) => resolve({ code, signal }))
      })

      if (timedOut) {
        // BUG-111. `close` means the LEADER is reaped and the pipes are shut,
        // not that the group is gone. A killed `sh -c 'sleep …'` leaves `sleep`
        // a zombie until its parent or init reaps it, and returning inside that
        // window hands teardown a "survivor" this timeout already killed. So
        // wait on the same fact `disposeAll` decides survivors by. Past the
        // bound it stays registered, so teardown still reports it. Ported from
        // PR #68 (linkedin-watcher-agent).
        if (child.pid !== undefined) await waitGroupGone(child.pid, KILL_GRACE_MS)
        throw new Error(
          `Timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}\n` +
            `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
        )
      }

      return {
        code: code.code,
        signal: code.signal,
        stdout,
        stderr,
        output: stdout + stderr,
      }
    } finally {
      if (timer) clearTimeout(timer)
      this.live.delete(child)
    }
  }

  /**
   * Start a long-lived process (a daemon, a watcher) without waiting for exit.
   * The caller gets the handle; the registry keeps it for teardown.
   */
  startBackground(
    command: string,
    args: string[],
    options: SpawnOptions,
  ): ChildProcess {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: fixtureEnv(options.env, this.workspaceRoot, this.escapeToken, options.cwd),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.live.add(child)
    if (child.pid !== undefined) this.groups.add(child.pid)
    this.capturePipeIds(child)
    return child
  }

  /** Kill a process and its whole group. Negative pid = the group. */
  private killGroup(child: ChildProcess, signal: NodeJS.Signals = 'SIGKILL'): void {
    if (child.pid === undefined) return
    try {
      process.kill(-child.pid, signal)
    } catch {
      // Group already gone, or never became a group leader. Fall back to the
      // single pid rather than assuming failure.
      try {
        child.kill(signal)
      } catch {
        // Already reaped.
      }
    }
  }

  /**
   * Every process group this scenario currently has a live handle on — the
   * roots `dumpProcessTree` (dump.ts) walks down from. A snapshot, not a
   * live view: taken at the moment a wait times out, before teardown reaps
   * anything (BUG-146).
   */
  trackedPids(): number[] {
    return [...this.groups]
  }

  /**
   * Every stdio pipe id this scenario's children have ever held (BUG-146) —
   * what `findPipeHolders` (dump.ts) searches for regardless of parentage, so
   * a grandchild reparented past the ppid walk still turns up in a dump.
   */
  trackedPipeIds(): string[] {
    return [...this.pipeIds]
  }

  /**
   * Reap everything. Returns the pids that had to be killed — a non-empty
   * result is a DEFECT in the scenario, not routine housekeeping, and the
   * harness fails the test on it.
   *
   * BUG-111 (reopened): a group found alive on the FIRST sample gets
   * `PROCESS_SNAPSHOT_GRACE_MS` to finish on its own before it is recorded as
   * a survivor at all — see that constant for why the number is safe. A group
   * still alive after the grace is recorded exactly as before, and everything
   * downstream (the SIGTERM/SIGKILL escalation, the returned list, the
   * scenario failing) is unchanged.
   */
  async disposeAll(): Promise<number[]> {
    const survivors: number[] = []

    for (const pgid of this.groups) {
      if (!groupAlive(pgid)) continue
      if (await waitGroupGone(pgid, PROCESS_SNAPSHOT_GRACE_MS)) continue
      survivors.push(pgid)
      try {
        process.kill(-pgid, 'SIGTERM')
      } catch {
        // It exited between the check and the signal. Still a survivor: it was
        // alive when teardown started, which is the defect being reported.
      }
    }

    // SIGTERM, then insist — waiting on THE GROUP BEING GONE rather than on a
    // plausible interval. The 300 ms sleep this replaces was a fixed wait
    // standing in for exactly this condition (R4), and it was wrong in both
    // directions: it paused every clean teardown, and a group slower than the
    // guess was SIGKILLed while already dying.
    for (const pgid of survivors) {
      if (await waitGroupGone(pgid, TERM_GRACE_MS)) continue
      try {
        process.kill(-pgid, 'SIGKILL')
      } catch {
        // Gone between the wait and the signal, which is what SIGKILL was for.
        continue
      }
      // A group that outlives SIGKILL is unkillable (uninterruptible sleep), and
      // the bound expiring is where we stop rather than hang. The test fails
      // either way: it is already in `survivors`.
      await waitGroupGone(pgid, KILL_GRACE_MS)
    }

    this.live.clear()
    this.groups.clear()
    return survivors
  }
}
