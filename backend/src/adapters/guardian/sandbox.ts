// How the guardian is isolated on Linux: a Bubblewrap sandbox with no network
// and a read-only view made only of the files it is given. The one place that
// builds it: the guardian's adapters start their programs through it, and the
// proof in features/support/isolation.spec.ts runs the same arguments.
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const probe = promisify(execFile)

/** Why bwrap cannot sandbox on this machine, or null when it can. */
export async function bwrapRefusal(): Promise<string | null> {
  try {
    await probe('bwrap', ['--unshare-all', '--ro-bind', '/', '/', '--', '/bin/true'])
    return null
  } catch (e) {
    const { code, stderr } = e as NodeJS.ErrnoException & { stderr?: string }
    return code === 'ENOENT' ? 'bwrap is not installed' : `bwrap cannot start: ${stderr?.trim()}`
  }
}

export interface Isolation {
  /** Files and directories the program is given, read-only, at the same path. */
  readOnly: string[]
  /** The whole environment of the program: nothing else is passed in. */
  env?: Record<string, string>
}

/**
 * bwrap's arguments to run `program args` isolated: every namespace unshared
 * (so no network at all), the environment cleared, and a view of the file
 * system made only of the system libraries and what is given. No /bin,
 * /usr/bin, /etc or home: a program or a secret that is not given does not
 * exist in there. The one writable place is a throwaway memory file system
 * under /tmp.
 */
export function bwrap(isolation: Isolation, program: string, args: string[]): string[] {
  return [
    '--unshare-all',
    '--die-with-parent',
    '--new-session',
    '--clearenv',
    ...Object.entries(isolation.env ?? {}).flatMap(([name, value]) => ['--setenv', name, value]),
    '--ro-bind',
    '/usr/lib',
    '/usr/lib',
    '--ro-bind',
    '/usr/lib64',
    '/usr/lib64',
    '--symlink',
    'usr/lib',
    '/lib',
    '--symlink',
    'usr/lib64',
    '/lib64',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    // Before the files given, so that a file given under /tmp is not hidden by it.
    '--tmpfs',
    '/tmp',
    ...isolation.readOnly.flatMap((path) => ['--ro-bind', path, path]),
    '--chdir',
    '/tmp',
    '--',
    program,
    ...args,
  ]
}

export interface IsolatedRun {
  isolation: Isolation
  program: string
  args: string[]
  /** What the program reads on its standard input: the bytes of one asset. */
  input: Uint8Array
  timeoutMs: number
  /** More output than this ends the run as an error. */
  maxOutputBytes: number
}

/**
 * Runs the program isolated and gives back what it wrote to its standard
 * output. A program that fails, hangs, crashes or writes too much ends as an
 * error: never an empty result.
 */
export function runIsolated(run: IsolatedRun): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('bwrap', bwrap(run.isolation, run.program, run.args), {
      // bwrap is found as usual; --clearenv empties what the program in there sees.
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let outBytes = 0
    let failure: Error | undefined
    const fail = (e: Error) => {
      failure ??= e
      child.kill('SIGKILL')
    }
    const timer = setTimeout(
      () => fail(new Error(`The reading did not finish within ${run.timeoutMs} ms.`)),
      run.timeoutMs,
    )
    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length
      if (outBytes > run.maxOutputBytes) fail(new Error('The reading gave back too much.'))
      else out.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (err.length < 64) err.push(chunk)
    })
    // The program may exit before it has read all its input: its exit code says why.
    child.stdin.on('error', () => {})
    child.stdin.end(run.input)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`The reading could not start: ${e.message}`))
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (failure) return reject(failure)
      if (code === 0) return resolve(Buffer.concat(out))
      const said = Buffer.concat(err).toString('utf8').trim().slice(-500)
      const how = signal ?? 'exit ' + code
      reject(new Error(`The reading failed (${how}): ${said}`))
    })
  })
}
