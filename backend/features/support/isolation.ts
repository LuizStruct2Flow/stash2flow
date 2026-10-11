// How the guardian is isolated on Linux: a bubblewrap sandbox with no network
// and a read-only view that holds node, the system libraries, this package and
// nothing else. Shared by the proof (isolation.spec.ts) and the measurement
// (spikes/isolation.ts). Harness code: never imported by src/.
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

export const run = promisify(execFile)
export const BACKEND = fileURLToPath(new URL('../../', import.meta.url))
export const PROBE = fileURLToPath(new URL('./isolation-probe.ts', import.meta.url))

/** What the probe reports for each thing the guardian must not reach. */
export type Probe = Record<'network' | 'database' | 'tokens' | 'program', string>

/** Why bwrap cannot sandbox on this machine, or null when it can. */
export async function bwrapRefusal(): Promise<string | null> {
  try {
    await run('bwrap', ['--unshare-all', '--ro-bind', '/', '/', '--', '/bin/true'])
    return null
  } catch (e) {
    const { code, stderr } = e as NodeJS.ErrnoException & { stderr?: string }
    return code === 'ENOENT' ? 'bwrap is not installed' : `bwrap cannot start: ${stderr?.trim()}`
  }
}

/**
 * bwrap's arguments to run `node <args>` isolated: every namespace unshared
 * (so no network at all), the environment cleared, and a view of the file
 * system made only of the node binary, the system libraries and this package.
 * No /bin, /usr/bin, /etc or home: a program or a secret that is not mounted
 * does not exist in there.
 */
export function bwrap(nodeArgs: string[]): string[] {
  return [
    '--unshare-all',
    '--die-with-parent',
    '--new-session',
    '--clearenv',
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
    '--ro-bind',
    process.execPath,
    process.execPath,
    '--ro-bind',
    BACKEND,
    BACKEND,
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--',
    process.execPath,
    ...nodeArgs,
  ]
}
