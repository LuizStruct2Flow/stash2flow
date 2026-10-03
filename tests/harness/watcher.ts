/**
 * tests/harness/watcher.ts — a long-lived subject, held as a handle.
 *
 * WHAT THIS IS FOR. Three of the mic suites test scripts whose behaviour IS
 * whether and when they exit: `scripts/wait-mic.sh` exists to turn "the mic
 * moved" into an exit event (FEATURE-005), and `signal-watch.mts` runs
 * until it dispatches. `s.run()` cannot express either — it awaits completion,
 * so the only way to bound a subject that may never finish is to wrap it in
 * `timeout` and discard the status.
 *
 * WHY DISCARDING THE STATUS IS THE DEFECT AND NOT A DETAIL. That is exactly
 * what cost `tests/signal-dispatch` 125.4 s and got it excluded from the gate:
 * `run_watch` started an infinite watcher under `timeout N` and threw the
 * timeout status away, so every case burned its whole bound no matter when its
 * assertion became decidable. The six bounds summed to 125 s of scaffolding
 * measuring nothing. Holding the process as a handle is what lets a case stop
 * as soon as its assertion is DECIDABLE — which is the property TASK-018 must
 * preserve, not merely the runtime it produced.
 *
 * AND IT IS WHAT MAKES R4 SATISFIABLE AT ALL. "Never wait a fixed amount of
 * time; wait for a condition" needs the condition to be observable. `exited`,
 * `code`, `signal` and `output` are those conditions, so a spec polls
 * `vi.waitFor(() => expect(w.exited).toBe(true))` instead of sleeping past a
 * guess. The one case shape that genuinely cannot be polled — "this did NOT
 * happen" — still needs a bound, and `settled()` is the sanctioned way to
 * express it: a bound counted in the SUBJECT'S OWN units (poll intervals it has
 * demonstrably completed), which load cannot shorten.
 *
 * OWNERSHIP IS UNCHANGED. The process comes from the scenario's registry, so
 * teardown reaps it and a survivor FAILS the test. `stop()` is therefore not
 * optional housekeeping; it is how a spec that starts a watcher finishes
 * honestly. This module adds ergonomics, never an exemption.
 */

import { expect, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import type { Scenario } from './index.js'

export interface Watcher {
  /** Everything the subject has written so far, stdout and stderr interleaved as received. */
  output(): string
  /** Has it exited on its own? */
  readonly exited: boolean
  /** Exit code, once exited. `null` when it died from a signal. */
  readonly code: number | null
  /** The signal that killed it, if any. */
  readonly signal: NodeJS.Signals | null

  /**
   * Wait until the subject exits by itself.
   *
   * The bound is a BACKSTOP, not the pacing: it is reached only when the
   * subject has failed to do the thing the case exists to observe, and the
   * failure message says so rather than reading as a flake.
   */
  awaitExit(reason: string, timeoutMs?: number): Promise<void>

  /**
   * Assert the subject is STILL RUNNING, then stop it.
   *
   * The negative half of every watcher case, and the one that cannot be polled
   * for — "no handoff happened" is the absence of an event. Two properties make
   * it sound rather than a sleep with better manners:
   *
   *   * the bound is supplied by the caller in the SUBJECT'S OWN units (a
   *     condition it has provably reached, such as N completed poll
   *     intervals), so a slow machine makes the subject do FEWER iterations and
   *     cannot manufacture a pass;
   *   * a subject that exited EARLY is reported as the specific defect it is —
   *     a phantom event — and a subject that DIED is distinguished from one that
   *     was still waiting, which is the distinction `tests/wait-mic` encodes by
   *     demanding exit status 124 rather than merely "non-zero".
   */
  assertStillRunning(label: string): void

  /**
   * Stop the subject and wait until its whole PROCESS GROUP is gone. Idempotent.
   *
   * THE GROUP, NOT THE CHILD, and that distinction is the whole reason this is a
   * method rather than one `kill` call. `wait-mic.sh` spends almost all of its
   * life blocked in a `sleep` CHILD, so the handle's `close` event can fire
   * while that grandchild is still winding down. The scenario's own teardown
   * then finds a live group and FAILS the test for a leak the spec had already
   * asked to be cleaned up — which is exactly the orphan-at-ppid-1 shape the
   * registry exists to catch, arriving as a false positive. Observed on five of
   * this suite's thirteen cases before this waited properly.
   *
   * So the promise is "the group is gone", which is the fact the teardown
   * checks, and SIGKILL follows SIGTERM if the group does not take the hint.
   */
  stop(): Promise<void>
}

/**
 * Start `command` in the background and return a handle on it.
 *
 * `cwd` defaults to the workspace root, which is inside no git tree — the same
 * default `s.runScript` uses, and the reason a fixture's `git rev-parse` cannot
 * wander into the real repository.
 */
export function startWatcher(
  s: Scenario,
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Watcher {
  // BUG-119: spread, so a caller's option is forwarded rather than rebuilt away.
  const child: ChildProcess = s.background(command, args, {
    ...options,
    cwd: options.cwd ?? s.workspace.root,
  })

  let output = ''
  child.stdout?.on('data', (d: Buffer) => {
    output += d.toString('utf8')
  })
  child.stderr?.on('data', (d: Buffer) => {
    output += d.toString('utf8')
  })

  let exited = false
  let code: number | null = null
  let signal: NodeJS.Signals | null = null
  const closed = new Promise<void>((resolve) => {
    child.on('close', (c, sig) => {
      exited = true
      code = c
      signal = sig
      resolve()
    })
  })

  const handle: Watcher = {
    output: () => output,
    get exited() {
      return exited
    },
    get code() {
      return code
    },
    get signal() {
      return signal
    },

    async awaitExit(reason, timeoutMs = 30_000) {
      await vi.waitFor(
        () => {
          expect(
            exited,
            `${reason}\n--- subject output ---\n${output}`,
          ).toBe(true)
        },
        { timeout: timeoutMs, interval: 25 },
      )
    },

    assertStillRunning(label) {
      // THE STATUS IS PART OF THE ASSERTION. `tests/wait-mic` demands 124 — the
      // timeout killing a waiter that was STILL WAITING — and not merely a
      // non-zero exit, because its first version accepted any failure and a
      // waiter that crashed on startup passed three negative cases while doing
      // nothing at all. Here the equivalent is stronger and needs no exit code:
      // a subject that has not exited AT ALL cannot have crashed.
      expect(
        { exited, code, signal },
        `${label}\nThe subject exited instead of continuing to wait. ` +
          `An exit is read by the operator as the event this case says did NOT ` +
          `happen — a phantom handoff, which is worse than the blindness the ` +
          `feature replaces: silence is merely uninformed, a false event makes ` +
          `the agent act.\n--- subject output ---\n${output}`,
      ).toEqual({ exited: false, code: null, signal: null })
    },

    async stop() {
      const pid = child.pid
      if (pid === undefined) return

      const groupAlive = (): boolean => {
        try {
          process.kill(-pid, 0)
          return true
        } catch {
          // kill(0) refused: no such group, so it is not alive.
          return false
        }
      }

      if (!exited) {
        try {
          process.kill(-pid, 'SIGTERM')
        } catch {
          // No group to signal: fall back to the single pid.
          try {
            child.kill('SIGTERM')
          } catch {
            // Already gone between the check and the signal.
          }
        }
        await closed
      }

      // The leader has closed; its `sleep` may not have. Escalate rather than
      // assume, and do it by POLLING the group rather than pausing for a
      // plausible interval (R4) — a fixed pause here is the same guess the
      // shell suite made with `sleep 0.5`, and it would be wrong in the
      // direction that fails the test.
      if (!groupAlive()) return
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // Gone between the check and the SIGKILL, which is the outcome wanted.
        return
      }
      await vi.waitFor(
        () => {
          expect(
            groupAlive(),
            `process group ${pid} survived SIGTERM and SIGKILL`,
          ).toBe(false)
        },
        { timeout: 5_000, interval: 10 },
      )
    },
  }

  return handle
}

/**
 * Wait until a condition the SUBJECT produces is true.
 *
 * A thin, named wrapper over `vi.waitFor` so that "wait for a condition" (R4)
 * is one call with a message attached, and so a grep for the sanctioned wait
 * finds every site. The message matters more than the wrapper: a poll that
 * times out must say which fact never became true, or it reads as a flake and
 * gets its bound raised instead of investigated.
 */
export async function until(
  fact: string,
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 30_000,
): Promise<void> {
  await vi.waitFor(
    async () => {
      expect(await condition(), `timed out waiting until ${fact}`).toBe(true)
    },
    { timeout: timeoutMs, interval: 25 },
  )
}
