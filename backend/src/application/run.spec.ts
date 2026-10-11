import assert from 'node:assert/strict'
import test from 'node:test'
import { FakeClock } from '../fakes/fake-clock.ts'
import { FakeFetching } from '../fakes/fake-fetching.ts'
import { FakeFileReading } from '../fakes/fake-file-reading.ts'
import { FakeIndex } from '../fakes/fake-index.ts'
import { FakeLedger } from '../fakes/fake-ledger.ts'
import { FakeOcr } from '../fakes/fake-ocr.ts'
import { FakeSignIn } from '../fakes/fake-sign-in.ts'
import { FakeStash } from '../fakes/fake-stash.ts'
import { FakeTokenStore } from '../fakes/fake-token-store.ts'
import { runSource } from './run.ts'

test('a first run reports total size before fetching, keeps local copies and records the baseline', async () => {
  const fetching = new FakeFetching()
  fetching.totalSize = 5
  fetching.assetsToFetch = [
    {
      sourceId: 'source-1',
      sourceAssetId: 'asset-1',
      name: 'one.pdf',
      size: 5,
      sha256: 'sha-1',
      bytes: new Uint8Array([1]),
    },
  ]
  const index = new FakeIndex()
  await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'one@example.com' })
  const tokenStore = new FakeTokenStore()
  await tokenStore.keepCredential('source-1', {
    value: 'credential-1',
    state: 'valid',
    account: 'one@example.com',
  })
  const stash = new FakeStash()
  const ledger = new FakeLedger()
  const result = await runSource({
    sourceId: 'source-1',
    fetching,
    ledger,
    index,
    stash,
    tokenStore,
    signIn: new FakeSignIn(),
    fileReading: new FakeFileReading(),
    ocr: new FakeOcr(),
    clock: new FakeClock(),
  })
  assert.deepEqual(fetching.calls.slice(0, 2), ['totalSize', 'fetch'])
  assert.equal(result.started, true)
  if (!result.started) return
  assert.deepEqual(result.baseline, { assets: 1, bytes: 5 })
  assert.equal(stash.localCopies.size, 1)
  assert.equal(fetching.writes, 0)
})

test('a run does not start for a missing credential', async () => {
  const index = new FakeIndex()
  await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'one@example.com' })
  const result = await runSource({
    sourceId: 'source-1',
    fetching: new FakeFetching(),
    ledger: new FakeLedger(),
    index,
    stash: new FakeStash(),
    tokenStore: new FakeTokenStore(),
    signIn: new FakeSignIn(),
    fileReading: new FakeFileReading(),
    ocr: new FakeOcr(),
    clock: new FakeClock(),
  })
  assert.deepEqual(result, { started: false, needsUserToSignInAgain: true })
})

test('a run renews an expired credential without the user', async () => {
  const index = new FakeIndex()
  await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'one@example.com' })
  const tokenStore = new FakeTokenStore()
  await tokenStore.keepCredential('source-1', {
    value: 'expired',
    state: 'expired',
    account: 'one@example.com',
    canRenewWithoutUser: true,
  })
  const signIn = new FakeSignIn()
  signIn.nextRenewedCredential = { value: 'renewed', state: 'valid', account: 'one@example.com' }
  const result = await runSource({
    sourceId: 'source-1',
    fetching: new FakeFetching(),
    ledger: new FakeLedger(),
    index,
    stash: new FakeStash(),
    tokenStore,
    signIn,
    fileReading: new FakeFileReading(),
    ocr: new FakeOcr(),
    clock: new FakeClock(),
  })
  assert.equal(result.started, true)
  assert.equal((await tokenStore.credentialFor('source-1')).value, 'renewed')
})
