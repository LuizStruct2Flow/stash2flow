// How the guardian is isolated on Linux, for the proof (isolation.spec.ts) and
// the measurement (spikes/isolation.ts). The sandbox itself is the guardian's
// own (src/adapters/guardian/sandbox.ts): this file only gives it the view the
// probe needs, which is node and this package. Harness code: never imported by src/.
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { bwrap as sandbox } from '../../src/adapters/guardian/sandbox.ts'

export { bwrapRefusal } from '../../src/adapters/guardian/sandbox.ts'
export const run = promisify(execFile)
export const BACKEND = fileURLToPath(new URL('../../', import.meta.url))
export const PROBE = fileURLToPath(new URL('./isolation-probe.ts', import.meta.url))

/** What the probe reports for each thing the guardian must not reach. */
export type Probe = Record<'network' | 'database' | 'tokens' | 'program', string>

/** bwrap's arguments to run `node <args>` isolated, with a view of node and this package. */
export function bwrap(nodeArgs: string[]): string[] {
  return sandbox({ readOnly: [process.execPath, BACKEND] }, process.execPath, nodeArgs)
}
