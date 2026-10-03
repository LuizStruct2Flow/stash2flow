// scripts/lib/spawn-bounded.mts — TASK-065 (Codex re-review, round 3).
//
// Extracted out of scripts/signal-watch.mts so a unit test can drive it
// directly: it is a pure, self-contained function (no top-level await, no
// repo/env dependency) and its only previous host is a module whose import
// runs live shell-lib resolution at load time.
//
// spawn the child DETACHED (its own process group) and on timeout kill the
// WHOLE GROUP (`kill(-pid)`), because a grandchild started without its own
// `setpgid` stays in the parent's group and a plain child-only kill leaves it
// running (see signal-watch.mts's own header comment for the measurement).
//
// THIS FILE'S OWN FIX (the finding this file exists to close, and the bug
// tests/spawn-bounded pinned RED in the previous commit): the ORIGINAL
// group-kill catch treated every failure as "the group is already gone" —
// true for ESRCH, not for EPERM (a sandbox, a container, a pid namespace) or
// any other errno. On an EPERM the group was never touched, and the function
// then awaited `close` with no further bound — the helper whose one job is to
// bound a wait could itself hang forever. Fixed by: (1) telling ESRCH (already
// gone, fine) apart from anything else (log it, fall back to killing just the
// direct child), and (2) a short GRACE window after the kill attempt(s) — if
// `close` still hasn't come, resolve as timed out anyway and say descendants
// may have survived, naming the pid. The wait is bounded under every outcome,
// not just the common one.
import { spawn } from 'node:child_process'

export type StdioMode = 'ignore' | 'pipe' | 'inherit'

export interface BoundedSpawnResult {
  readonly status: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly error?: Error
}

// GRACE_MS: how long, after a SIGKILL attempt, spawnBounded waits for `close`
// before giving up on it and resolving anyway. Chosen, not measured like
// KILL_GRACE_MS in tests/harness/process.ts (that one bounds a REAL group kill
// that usually works; this one bounds the case where the kill itself failed,
// so there is nothing left to wait FOR except an unrelated, unbounded event).
// 1.5s is long enough that a kill which DID land has every practical chance to
// produce `close` first — keeping the two grandchild-kill regression tests
// green — while staying a small, fixed addition to the caller's own timeout
// rather than a second unbounded wait wearing a grace-period costume.
const GRACE_MS = 1_500

function errnoCode(err: unknown): string | undefined {
  return err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined
}

export function spawnBounded(
  command: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; stdio: readonly [StdioMode, StdioMode, StdioMode] },
  timeoutMs: number,
  // Test-only seam: production callers never pass this, so `process.kill` is
  // exactly what always ran. A test can inject a stub that fails a negative
  // (group) pid with EPERM to prove the fallback and the grace bound without
  // needing a real sandbox/namespace to reproduce that errno in.
  killFn: (pid: number, signal: NodeJS.Signals) => void = process.kill,
): Promise<BoundedSpawnResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, {
        env: options.env,
        stdio: [...options.stdio],
        detached: true,
      })
    } catch (err) {
      resolve({ status: null, signal: null, stdout: '', stderr: '', error: err instanceof Error ? err : new Error(String(err)) })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let graceTimer: NodeJS.Timeout | undefined

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

    const finish = (status: number | null, signal: NodeJS.Signals | null, error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(graceTimer)
      // exactOptionalPropertyTypes: the `error` key is only ADDED when there
      // actually is one — never set to `undefined` on purpose, which is a
      // distinct (and disallowed) shape from leaving it out.
      const resolvedError = error ?? (timedOut ? new Error(`timed out after ${timeoutMs}ms`) : undefined)
      resolve(resolvedError === undefined
        ? { status, signal, stdout, stderr }
        : { status, signal, stdout, stderr, error: resolvedError })
    }

    const timer = setTimeout(() => {
      if (settled) return
      timedOut = true
      const pid = child.pid as number
      // Negative pid = the whole process group (valid because `detached:
      // true` made this child its own group leader). SIGKILL, not SIGTERM: a
      // hung shell/child is exactly the case where a trap or a stuck syscall
      // could no-op a termination request, and nothing on this bounded path
      // needs a graceful shutdown.
      try {
        killFn(-pid, 'SIGKILL')
      } catch (err) {
        if (errnoCode(err) !== 'ESRCH') {
          // Not "the group is already gone" — the kill itself failed (EPERM in
          // a sandbox/container, a pid namespace, anything else). Nothing was
          // killed yet, so fall back to the one thing we can still try: the
          // direct child by its own pid.
          process.stderr.write(
            `spawnBounded: group kill of pid ${pid} failed (${errnoCode(err) ?? String(err)}); ` +
            `falling back to killing the direct child only\n`,
          )
          try {
            killFn(pid, 'SIGKILL')
          } catch {
            // The direct child is already gone too — nothing left to kill.
          }
        }
      }
      // Bounded even if neither kill above actually reaped anything: wait a
      // short grace for `close`, then resolve as timed out regardless. This is
      // the fix — the previous version waited for `close` here with no bound
      // at all once the group kill's catch had (wrongly) assumed success.
      graceTimer = setTimeout(() => {
        if (settled) return
        process.stderr.write(
          `spawnBounded: pid ${pid} did not close within ${GRACE_MS}ms of the kill attempt; ` +
          `descendants may have survived\n`,
        )
        finish(null, null)
      }, GRACE_MS)
    }, timeoutMs)

    child.once('error', (err) => finish(null, null, err))
    // 'close', not 'exit' — waits for the stdio streams to actually end, the
    // same guarantee spawnSync's captured stdout/stderr always had. Reachable
    // now because the group kill above closes every fd a grandchild held,
    // instead of leaving the read end waiting on a pipe nothing will ever
    // close.
    child.once('close', (code, signal) => finish(code, signal))
  })
}
