// Spike 6: with what can the guardian be isolated on this server, without
// administrator rights? Runs features/support/isolation-probe.ts under each
// candidate and prints what each one really blocked and what it costs to start.
// Run: node spikes/isolation.ts   (from backend/)
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { BACKEND, PROBE, type Probe, bwrap, run } from '../features/support/isolation.ts'

const ROUNDS = 5
// A container with no network: no node image is on this machine, so the host's
// node binary is mounted into a Debian image that is already here.
const IMAGE = 'postgres:17.11-bookworm'

const lan =
  Object.values(networkInterfaces())
    .flat()
    .find((i) => i?.family === 'IPv4' && !i.internal)?.address ?? '127.0.0.1'

const listener = createServer()
await new Promise<void>((resolve) => listener.listen(0, '0.0.0.0', resolve))
const { port } = listener.address() as AddressInfo
mkdirSync(join(BACKEND, '..', '.scratch'), { recursive: true })
const scratch = mkdtempSync(join(BACKEND, '..', '.scratch', 'isolation-'))
const tokens = join(scratch, 'tokens')
writeFileSync(tokens, 'made-up token store\n')
const args = [PROBE, String(port), lan, tokens]

const candidates: Record<string, [string, string[]]> = {
  'none (plain node)': [process.execPath, args],
  'node --permission': [process.execPath, ['--permission', `--allow-fs-read=${BACKEND}`, ...args]],
  'unshare --user --net': ['unshare', ['--user', '--net', '--', process.execPath, ...args]],
  bwrap: ['bwrap', bwrap(args)],
  'docker --network none': [
    'docker',
    [
      '--context',
      'default',
      'run',
      '--rm',
      '--network',
      'none',
      '-v',
      `${process.execPath}:/node:ro`,
      '-v',
      `${BACKEND}:${BACKEND}:ro`,
      IMAGE,
      '/node',
      ...args,
    ],
  ],
}

const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]

console.log('| Mechanism | network | database port | token file | program | start-up (median ms) |')
console.log('| --- | --- | --- | --- | --- | --- |')
for (const [name, [file, argv]] of Object.entries(candidates)) {
  const ms: number[] = []
  let result: Probe | undefined
  let failure = ''
  for (let i = 0; i < ROUNDS; i++) {
    const t = performance.now()
    try {
      result = JSON.parse((await run(file, argv)).stdout)
    } catch (e) {
      const { code, stderr } = e as NodeJS.ErrnoException & { stderr?: string }
      failure = code === 'ENOENT' ? 'not installed' : (stderr?.trim().split('\n')[0] ?? String(e))
      break
    }
    ms.push(performance.now() - t)
  }
  const cell = (v: string) => (v === 'reached' ? 'reached' : `blocked (${v})`)
  console.log(
    result && !failure
      ? `| ${name} | ${cell(result.network)} | ${cell(result.database)} | ${cell(result.tokens)} | ${cell(result.program)} | ${median(ms).toFixed(0)} |`
      : `| ${name} | fails: ${failure} | | | | |`,
  )
}

listener.close()
rmSync(scratch, { recursive: true, force: true })
