// Proof that the guardian's isolation bites. The probe is run twice against the
// same stand-ins (a throwaway listener, a file in place of the token store, a
// system program): plainly it reaches all of them, under bwrap none of them.
// The plain run is what shows the second result comes from the sandbox and not
// from a broken probe.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { BACKEND, PROBE, type Probe, bwrap, bwrapRefusal, run } from './isolation.ts'

/** An address of this machine that is not loopback, when it has one. */
const lan =
  Object.values(networkInterfaces())
    .flat()
    .find((i) => i?.family === 'IPv4' && !i.internal)?.address ?? '127.0.0.1'

const listener = createServer()
let scratch = ''
let args: string[] = []

before(async () => {
  await new Promise<void>((resolve) => listener.listen(0, '0.0.0.0', resolve))
  const { port } = listener.address() as AddressInfo
  mkdirSync(join(BACKEND, '..', '.scratch'), { recursive: true })
  scratch = mkdtempSync(join(BACKEND, '..', '.scratch', 'isolation-'))
  const tokens = join(scratch, 'tokens')
  writeFileSync(tokens, 'made-up token store\n')
  args = [PROBE, String(port), lan, tokens]
})

after(() => {
  listener.close()
  rmSync(scratch, { recursive: true, force: true })
})

const probe = async (file: string, argv: string[]): Promise<Probe> =>
  JSON.parse((await run(file, argv)).stdout)

describe('the guardian in isolation', () => {
  it('reaches the network, the database, the tokens and a program when run plainly', async () => {
    assert.deepEqual(await probe(process.execPath, args), {
      network: 'reached',
      database: 'reached',
      tokens: 'reached',
      program: 'reached',
    })
  })

  it('reaches none of them under bwrap', async (t) => {
    // A machine where bwrap cannot sandbox at all has not proven anything: say so, loudly.
    const refusal = await bwrapRefusal()
    if (refusal) return t.skip(`${refusal}: the isolation is NOT proven here`)
    // The sandbox has a loopback of its own with nothing listening on it, so the
    // database port refuses; the machine's own address is not routable at all.
    assert.deepEqual(await probe('bwrap', bwrap(args)), {
      network: 'ENETUNREACH',
      database: 'ECONNREFUSED',
      tokens: 'ENOENT',
      program: 'ENOENT',
    })
  })
})
