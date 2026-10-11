import { Given, Then, When } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { addSource, bind } from '../../src/application/credentials.ts'
import { notBuilt } from '../support/not-built.ts'
import {
  keepSourceWithCredential,
  processCurrentAsset,
  resetSlice2,
  runCurrentSource,
  slice2,
} from './slice-2.ts'

Given(
  'the user has an account at the provider behind the location {string}',
  async (location: string) => {
    resetSlice2()
    slice2.source = { id: 'source-1', location, account: 'user@example.com' }
    slice2.signIn.nextCredential = {
      value: 'credential',
      state: 'valid',
      account: 'user@example.com',
    }
    await bind(slice2.tokenStore, location, 'binding')
  },
)
When('the user adds a source with the command', async () => {
  assert.ok(slice2.source)
  await addSource(slice2.index, slice2.tokenStore, slice2.signIn, slice2.source)
})
Then("the command takes the user through the provider's sign-in once", () =>
  assert.equal(slice2.signIn.calls, 1),
)
Then('the app stores access to the source that is read-only', async () => {
  assert.equal(slice2.signIn.permissions, 'read-only')
  assert.equal((await slice2.tokenStore.credentialFor('source-1')).state, 'valid')
})
Given('a source whose last run finished a day ago', async () => {
  resetSlice2()
  await keepSourceWithCredential()
})
Then('the run starts', () => assert.equal(slice2.runResult?.started, true))
Given('a source holding some assets', async () => {
  resetSlice2()
  await keepSourceWithCredential()
  slice2.assets = [
    {
      sourceId: 'source-1',
      sourceAssetId: 'asset-1',
      name: 'asset.unknown',
      size: 1,
      sha256: 'sha-1',
      bytes: new Uint8Array([1]),
    },
  ]
})
// The Fetching port has reading operations only, and a run holds nothing but that port.
// Were an operation that writes ever added, the fake would record it in `calls` and this fails.
Then('nothing has been written to the source', () =>
  assert.deepEqual(slice2.fetching.calls, ['totalSize', 'fetch']),
)
Given('a source that has never had a run', async () => {
  resetSlice2()
  await keepSourceWithCredential()
  slice2.fetching.totalSize = 42
})
When('the user starts the first run of the source', runCurrentSource)
Then('the run reports the total size of the source', () =>
  assert.equal(slice2.runResult?.started && slice2.runResult.totalSize, 42),
)
Then("the report comes before any asset's bytes are fetched", () =>
  assert.deepEqual(slice2.fetching.calls.slice(0, 2), ['totalSize', 'fetch']),
)
Given('an asset that the server indexes fully', async () => {
  resetSlice2()
  await keepSourceWithCredential()
  slice2.assets = [
    {
      sourceId: 'source-1',
      sourceAssetId: 'asset-1',
      name: 'asset.unknown',
      size: 1,
      sha256: 'sha-1',
      bytes: new Uint8Array([1]),
    },
  ]
})
When('the run finishes', runCurrentSource)
Then("the server holds a local copy of the asset's bytes in the stash", () =>
  assert.equal(slice2.stash.localCopies.size, 1),
)
Given('the same bytes in two assets from two sources', () => {
  resetSlice2()
  slice2.assets = [
    {
      sourceId: 'source-1',
      sourceAssetId: 'asset-1',
      name: 'one.unknown',
      size: 1,
      sha256: 'same',
      bytes: new Uint8Array([1]),
    },
    {
      sourceId: 'source-2',
      sourceAssetId: 'asset-2',
      name: 'two.unknown',
      size: 1,
      sha256: 'same',
      bytes: new Uint8Array([1]),
    },
  ]
})
When('a run of each source finishes', async () => {
  const all = slice2.assets
  for (const asset of all) {
    await keepSourceWithCredential('valid', asset.sourceId)
    slice2.assets = all.filter((other) => other.sourceId === asset.sourceId)
    await runCurrentSource()
  }
})
Then('the stash holds one local copy of those bytes', () =>
  assert.equal(slice2.stash.localCopies.size, 1),
)
Given('a file whose name a Mac wrote in another normal form', () => {
  resetSlice2()
  slice2.assets = [
    {
      sourceId: 'source-1',
      sourceAssetId: 'asset-1',
      name: 'Certida\u0303o.unknown',
      size: 1,
      sha256: 'sha-1',
    },
  ]
})
When('the run stores the asset', processCurrentAsset)
Then('the name of the asset is stored in NFC', async () =>
  assert.equal((await slice2.index.assets())[0]?.name, 'Certidão.unknown'),
)
Given('a first run of a source that was interrupted after some assets', () => notBuilt())
When('the user starts the run again', () => notBuilt())
Then('the run continues from its checkpoint', () => notBuilt())
Then('the assets before the checkpoint are not fetched again', () => notBuilt())
Given('a source whose first run has finished', () => notBuilt())
Given('nothing in the source has changed', () => notBuilt())
When('the user starts a second run of the source', () => notBuilt())
Then('no pipeline step runs for any asset', () => notBuilt())
Given('an asset that has been read', () => notBuilt())
Given('the source now shows a newer date for it', () => notBuilt())
Given('its sha256 is the same', () => notBuilt())
Then('the date of the asset is updated', () => notBuilt())
Then('no pipeline step runs for the asset again', () => notBuilt())
Given('its bytes have changed in the source', () => notBuilt())
Then('the asset goes through the pipeline again', () => notBuilt())
Given('the asset has been removed from its source', () => notBuilt())
Then('the row of the asset is still in the index', () => notBuilt())
Then('the asset has deleted_at set', () => notBuilt())
Given('a source holding two assets, the first of which fails', () => notBuilt())
Then('the failure of the first asset is recorded in the errors of the run', () => notBuilt())
Then('the second asset is processed', () => notBuilt())
Given('a run that has recorded an error', () => notBuilt())
When('the user asks to see the run', () => notBuilt())
Then('the user sees the state of the run', () => notBuilt())
Then('the user sees its error', () => notBuilt())
Given('a batch of asset records sent to the ledger', () => notBuilt())
When('the ledger has not stored every asset record of the batch', () => notBuilt())
Then('the cursor of the source has not moved', () => notBuilt())
When('the ledger has stored every asset record of the batch', () => notBuilt())
Then('the cursor of the source moves to the end of the batch', () => notBuilt())
Given('a source of the location {string} that the server can reach', (_0: string) => notBuilt())
Then('the server fetches the assets of the folder', () => notBuilt())
Then('the server is the reader of the source', () => notBuilt())
Given('a folder on a network storage device', () => notBuilt())
When('the user adds a source with the command and the address of the folder', () => notBuilt())
Then('the source is added', () => notBuilt())
Then('the user is not taken through any sign-in', () => notBuilt())
Given('every source of the user', () => notBuilt())
When('the user starts a run of each source', () => notBuilt())
Then('every run finishes', () => notBuilt())
Given('a source whose last finished run was 30 days ago', () => notBuilt())
When('the scheduler looks at the source', () => notBuilt())
Then('a run of the source starts by itself', () => notBuilt())
Given('a source that has no finished run', () => notBuilt())
Then('no run of the source starts by itself', () => notBuilt())
Given('a source whose last finished run was 20 days ago', () => notBuilt())
Given('a later run of the source failed', () => notBuilt())
When('10 more days pass', () => notBuilt())
Given('two sources whose last finished run was 29 days ago', () => notBuilt())
When('the user starts a run of the first source and it finishes', () => notBuilt())
When('1 more day passes', () => notBuilt())
Then('a run of the second source starts by itself', () => notBuilt())
Given('a Mac with a collector whose run was due while the Mac was asleep', () => notBuilt())
When('the Mac wakes', () => notBuilt())
Then('the run of the collector starts', () => notBuilt())
Given('a run that found 3 new assets, 2 new duplicates and 1 error', () => notBuilt())
Then('the summary notification reports 3 new assets, 2 new duplicates and 1 error', () =>
  notBuilt(),
)
