import { Given, Then, When } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import {
  bind,
  listSources,
  removeCredential,
  signInAgain,
} from '../../src/application/credentials.ts'
import { notBuilt } from '../support/not-built.ts'
import { keepSourceWithCredential, resetSlice2, runCurrentSource, slice2 } from './slice-2.ts'

let listed: Awaited<ReturnType<typeof listSources>> = []
let refused = false

Given('the app is not bound to the provider behind the location {string}', (_location: string) =>
  resetSlice2(),
)
When('the user binds the app to the provider with a command and a binding', async () => {
  await bind(slice2.tokenStore, 'gdrive', 'binding-one')
})
When('the user binds the app to the provider with the command and another binding', async () => {
  await bind(slice2.tokenStore, 'gdrive', 'binding-two')
})
Then('the token store holds the other binding for the provider', async () => {
  assert.equal(await slice2.tokenStore.bindingFor('gdrive'), 'binding-two')
})
Given(
  'sources whose credentials are valid, expire on a date, are expired and are missing',
  async () => {
    resetSlice2()
    const states = ['valid', 'expires on a date', 'expired', 'missing'] as const
    for (const [index, state] of states.entries()) {
      const id = `source-${index}`
      await slice2.index.keepSource({ id, location: 'gdrive', account: `user${index}@example.com` })
      await slice2.tokenStore.keepCredential(id, {
        value: state === 'missing' ? '' : `credential-${index}`,
        state,
        account: `user${index}@example.com`,
      })
      // A run uses the credential of each source whose credential it can use.
      slice2.source = { id, location: 'gdrive', account: `user${index}@example.com` }
      await runCurrentSource()
    }
  },
)
When('the user lists the sources', async () => {
  listed = await listSources(slice2.index, slice2.tokenStore)
})
Then('every source is listed with the state of its credential and when it was last used', () => {
  assert.deepEqual(
    listed.map((source) => source.credentialState),
    ['valid', 'expires on a date', 'expired', 'missing'],
  )
  // Only a run that started used its credential.
  assert.deepEqual(
    listed.map((source) => source.lastUsed),
    [slice2.clock.now(), slice2.clock.now(), undefined, undefined],
  )
})

// Printing is owned by the command-line and log adapters, not the core.
Given('a source with a credential', () => notBuilt())
Then('no command and no log prints the credential in full', () => notBuilt())

Given('a source with an expired credential that can be renewed without the user', async () => {
  resetSlice2()
  await keepSourceWithCredential('expired')
  const credential = await slice2.tokenStore.credentialFor('source-1')
  await slice2.tokenStore.keepCredential('source-1', { ...credential, canRenewWithoutUser: true })
  slice2.signIn.nextRenewedCredential = {
    value: 'renewed',
    state: 'valid',
    account: 'user@example.com',
  }
})
Then("the app renews the source's credential", async () => {
  assert.equal((await slice2.tokenStore.credentialFor('source-1')).state, 'valid')
})
Given('a source whose credential is missing', async () => {
  resetSlice2()
  await keepSourceWithCredential('missing')
})
Then('the run does not start', () => assert.equal(slice2.runResult?.started, false))
Then('the source needs the user to sign in again', () =>
  assert.deepEqual(slice2.runResult, { started: false, needsUserToSignInAgain: true }),
)
Given('a source with an expired credential that cannot be renewed', async () => {
  resetSlice2()
  await keepSourceWithCredential('expired')
})
Given('a source with a missing credential and an indexed asset', async () => {
  resetSlice2()
  await keepSourceWithCredential('missing')
  await slice2.index.keepAsset({
    sourceId: 'source-1',
    sourceAssetId: 'asset-1',
    name: 'asset.pdf',
    size: 1,
    sha256: 'sha-1',
  })
  slice2.signIn.nextCredential = { value: 'signed-in', state: 'valid', account: 'user@example.com' }
})
When('the user signs in again for the source', async () => {
  await signInAgain(slice2.index, slice2.tokenStore, slice2.signIn, 'source-1')
})
Then('the source has a valid credential', async () => {
  assert.equal((await slice2.tokenStore.credentialFor('source-1')).state, 'valid')
})
Then('the source stays', async () => {
  assert.equal((await slice2.index.sources()).length, 1)
})
Then('the indexed asset stays', async () => {
  assert.equal((await slice2.index.assets()).length, 1)
})
Then('the sign-in asks the provider for its read-only permission only', () =>
  assert.equal(slice2.signIn.permissions, 'read-only'),
)
Given('a source with a missing credential', async () => {
  resetSlice2()
  await keepSourceWithCredential('missing')
  slice2.signIn.nextCredential = { value: 'signed-in', state: 'valid', account: 'user@example.com' }
})
When("the user signs in again with another account than the source's own", async () => {
  slice2.signIn.nextCredential = { value: 'other', state: 'valid', account: 'other@example.com' }
  refused = false
  try {
    await signInAgain(slice2.index, slice2.tokenStore, slice2.signIn, 'source-1')
  } catch {
    refused = true
  }
})
Then('the sign-in is refused', () => assert.equal(refused, true))
Then("the source's credential is still missing", async () => {
  assert.equal((await slice2.tokenStore.credentialFor('source-1')).state, 'missing')
})
Given('a source with a valid credential and an indexed asset', async () => {
  resetSlice2()
  await keepSourceWithCredential()
  await slice2.index.keepAsset({
    sourceId: 'source-1',
    sourceAssetId: 'asset-1',
    name: 'asset.pdf',
    size: 1,
    sha256: 'sha-1',
  })
})
When("the user removes the source's credential", async () => {
  await removeCredential(slice2.tokenStore, 'source-1')
})
Then('the source is no longer fetched', async () => {
  assert.equal((await slice2.tokenStore.credentialFor('source-1')).state, 'missing')
})
