/**
 * tests/helpers/tty.ts — BUG-054's fix, factored out of
 * tests/pull-behaviour/pull-behaviour.spec.ts so TASK-081's differential
 * harness (tests/blueprint-port/blueprint-port.release.spec.ts) can drive the
 * SAME interactive-prompt path on both the shell CLI and the ported one,
 * rather than reinventing it.
 */
import { expect } from 'vitest'
import type { Scenario } from '../harness/index.js'
import type { RunResult } from '../harness/process.js'

/**
 * Run a command WITH a controlling terminal and a NON-interactive stdin.
 *
 * util-linux takes `-qec CMD FILE`; BSD/macOS takes `-q FILE CMD ...`. Which
 * one is present is probed rather than assumed, and a host with neither FAILS
 * rather than skipping — R7, and a skip here is how a BUG-054 case reported
 * green for two fixes in a row.
 *
 * The inner `</dev/null` is the whole point: without it the child inherits the
 * pty as stdin, `[ -t 0 ]` is true, and this exercises the interactive path.
 *
 * `env`, additive on top of the scenario's own scrubbed base env — TASK-081's
 * differential harness needs `PWD` set explicitly for the PORTED CLI (its
 * `logicalPwd()` reads `process.env.PWD`, never `process.cwd()`; bash
 * recomputes `$PWD` from `getcwd()` at startup regardless, so this is a no-op
 * for the shell CLI — see blueprint-port.release.spec.ts's `runOld`/`runNew`).
 */
export async function withCttyNoStdin(
  s: Scenario,
  cwd: string,
  command: string,
  env?: Record<string, string>,
): Promise<RunResult> {
  const opts = env === undefined ? { cwd } : { cwd, env }
  const utilLinux = await s.run('script', ['-qec', 'true', '/dev/null'], opts)
  const args = utilLinux.code === 0 ? ['-qec', command, '/dev/null'] : ['-q', '/dev/null', '/bin/sh', '-c', command]
  const r = await s.run('script', args, opts)
  expect(
    r.output,
    'neither `script` calling convention worked, so no case here supplied a ' +
      'controlling terminal — which is BUG-054 exactly, not a reason to skip',
  ).not.toMatch(/script: (invalid|unrecognized) option|usage: script/i)
  return r
}

/**
 * Run a command WITH a controlling terminal, feeding `input` as the bytes a
 * real operator would type — TASK-081's y/N/q differential rows (drift's
 * fast-forward offer, pull's per-file and per-retirement prompts), which need
 * an actual ANSWER to reach the CLI's `read`, not merely a TTY that is
 * present-but-empty (withCttyNoStdin's own subject).
 *
 * Piped into `script`'s OWN stdin, deliberately — `script` relays whatever it
 * reads on its own stdin into the pty it allocates for the child, which is
 * exactly the byte stream the child's `read -r`/`readLineFromStdin()` sees on
 * its (real, `[ -t 0 ]`-true) fd 0. There is no inner `</dev/null` this time:
 * that redirect is what makes the child's stdin non-interactive, and this
 * helper's whole point is the opposite.
 */
/** POSIX single-quote wrap — `'` becomes `'\''`. Used here rather than
 * `JSON.stringify` because the string this wraps is handed to a SHELL
 * argument (`script -qec <this>`), and a double-quoted form would let a
 * literal `$` or backtick inside `command` be reinterpreted by the outer
 * `sh -c` before `script` ever sees it. */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

export async function withCttyAnswer(
  s: Scenario,
  cwd: string,
  command: string,
  input: string,
  env?: Record<string, string>,
): Promise<RunResult> {
  const opts = env === undefined ? { cwd } : { cwd, env }
  const utilLinux = await s.run('script', ['-qec', 'true', '/dev/null'], opts)
  const scriptInvocation =
    utilLinux.code === 0
      ? `script -qec ${shQuote(command)} /dev/null`
      : `script -q /dev/null /bin/sh -c ${shQuote(command)}`
  // `input` goes through `printf '%s'`, never an argv slot of `script`
  // itself — it is BYTES FOR THE PTY, and piping is what makes `script`
  // relay them into the child's real (isatty-true) stdin rather than trying
  // to interpret them as one of its own options.
  const wrapped = `printf '%s' ${shQuote(input)} | ${scriptInvocation}`
  const r = await s.run('sh', ['-c', wrapped], opts)
  expect(
    r.output,
    'neither `script` calling convention worked, so no case here supplied a ' +
      'controlling terminal — which is BUG-054 exactly, not a reason to skip',
  ).not.toMatch(/script: (invalid|unrecognized) option|usage: script/i)
  return r
}
