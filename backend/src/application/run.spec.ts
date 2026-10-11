import assert from 'node:assert/strict'
import test from 'node:test'
import type { Asset } from '../domain/asset.ts'
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

const limits = { pageLimit: 10, sizeLimit: 100 }

async function world(assets: Asset[] = []) {
  const index = new FakeIndex()
  await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'one@example.com' })
  const tokenStore = new FakeTokenStore()
  await tokenStore.keepCredential('source-1', {
    value: 'credential-1',
    state: 'valid',
    account: 'one@example.com',
  })
  const fetching = new FakeFetching()
  fetching.assetsToFetch = assets
  return {
    index,
    tokenStore,
    fetching,
    ledger: new FakeLedger(index),
    stash: new FakeStash(),
    signIn: new FakeSignIn(),
    fileReading: new FakeFileReading(),
    ocr: new FakeOcr(),
    clock: new FakeClock(),
    limits,
  }
}

const pdf = (extra: Partial<Asset> = {}): Asset => ({
  sourceId: 'source-1',
  sourceAssetId: 'asset-1',
  name: 'one.pdf',
  size: 1,
  sha256: 'sha-1',
  ext: 'pdf',
  bytes: new Uint8Array([1]),
  ...extra,
})

test('a first run reports total size before fetching, keeps local copies and records the baseline', async () => {
  const w = await world([pdf({ size: 5, ext: 'unknown' })])
  w.fetching.totalSize = 5
  const result = await runSource({ sourceId: 'source-1', ...w })
  assert.deepEqual(w.fetching.calls, ['totalSize', 'fetch'])
  assert.equal(result.started, true)
  if (!result.started) return
  assert.deepEqual(result.baseline, { assets: 1, bytes: 5 })
  assert.equal(w.stash.localCopies.size, 1)
})

test('a run hands asset records without bytes to the ledger and does not keep assets on the index itself', async () => {
  const w = await world([pdf({ ext: 'unknown' })])
  w.ledger = new FakeLedger(new FakeIndex())
  await runSource({ sourceId: 'source-1', ...w })
  assert.equal(w.ledger.batches.length, 1)
  const [record] = w.ledger.batches[0] ?? []
  assert.equal(record?.sourceAssetId, 'asset-1')
  assert.equal('bytes' in (record ?? {}), false)
  assert.deepEqual(await w.index.assets(), [])
})

test('a run refuses an asset beyond the page limit the user set', async () => {
  const w = await world([pdf({ pages: 11 })])
  const result = await runSource({ sourceId: 'source-1', ...w })
  assert.equal(result.started, true)
  assert.equal(w.fileReading.assets.length, 0)
  assert.equal((await w.index.assets()).length, 0)
})

test('a run refuses an asset beyond the size limit the user set', async () => {
  const w = await world([pdf({ size: 101 })])
  await runSource({ sourceId: 'source-1', ...w })
  assert.equal(w.fileReading.assets.length, 0)
})

test('a run records when the credential was last used', async () => {
  const w = await world()
  w.clock.value = '2026-03-04T05:06:07.000Z'
  await runSource({ sourceId: 'source-1', ...w })
  assert.equal((await w.tokenStore.credentialFor('source-1')).lastUsed, '2026-03-04T05:06:07.000Z')
})

test('a run does not start for a missing credential', async () => {
  const w = await world()
  w.tokenStore = new FakeTokenStore()
  const result = await runSource({ sourceId: 'source-1', ...w })
  assert.deepEqual(result, { started: false, needsUserToSignInAgain: true })
  assert.equal((await w.tokenStore.credentialFor('source-1')).lastUsed, undefined)
})

test('a run renews an expired credential without the user', async () => {
  const w = await world()
  await w.tokenStore.keepCredential('source-1', {
    value: 'expired',
    state: 'expired',
    account: 'one@example.com',
    canRenewWithoutUser: true,
  })
  w.signIn.nextRenewedCredential = { value: 'renewed', state: 'valid', account: 'one@example.com' }
  const result = await runSource({ sourceId: 'source-1', ...w })
  assert.equal(result.started, true)
  assert.equal((await w.tokenStore.credentialFor('source-1')).value, 'renewed')
})
