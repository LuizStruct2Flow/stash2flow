import assert from 'node:assert/strict'
import test from 'node:test'
import { FakeIndex } from '../fakes/fake-index.ts'
import { FakeSignIn } from '../fakes/fake-sign-in.ts'
import { FakeTokenStore } from '../fakes/fake-token-store.ts'
import { addSource, bind, listSources, removeCredential, signInAgain } from './credentials.ts'

test('binding the app again replaces the provider binding', async () => {
  const tokenStore = new FakeTokenStore()
  await bind(tokenStore, 'provider-1', 'binding-1')
  await bind(tokenStore, 'provider-1', 'binding-2')
  assert.equal(await tokenStore.bindingFor('provider-1'), 'binding-2')
})

test('adding a source requires a binding and stores read-only access', async () => {
  const index = new FakeIndex()
  const tokenStore = new FakeTokenStore()
  const signIn = new FakeSignIn()
  signIn.nextCredential = {
    value: 'credential',
    state: 'valid',
    account: 'one@example.com',
  }
  const source = { id: 'source-1', location: 'gdrive', account: 'one@example.com' }
  await assert.rejects(addSource(index, tokenStore, signIn, source), /not bound/)
  await bind(tokenStore, 'gdrive', 'binding')
  signIn.nextCredential = {
    value: 'other',
    state: 'valid',
    account: 'other@example.com',
  }
  await assert.rejects(addSource(index, tokenStore, signIn, source), /another account/)
  signIn.nextCredential = {
    value: 'credential',
    state: 'valid',
    account: 'one@example.com',
  }
  await addSource(index, tokenStore, signIn, source)
  assert.equal(signIn.permissions, 'read-only')
  assert.deepEqual(await index.sources(), [source])
})

test('sources are listed with credential state and last use without the credential', async () => {
  const index = new FakeIndex()
  const tokenStore = new FakeTokenStore()
  await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'one@example.com' })
  await tokenStore.keepCredential('source-1', {
    value: 'private-credential',
    state: 'valid',
    account: 'one@example.com',
    lastUsed: '2026-01-01',
  })
  assert.deepEqual(await listSources(index, tokenStore), [
    {
      id: 'source-1',
      location: 'gdrive',
      account: 'one@example.com',
      credentialState: 'valid',
      lastUsed: '2026-01-01',
    },
  ])
  assert.doesNotMatch(JSON.stringify(await listSources(index, tokenStore)), /private-credential/)
})

test('signing in again refuses another account and keeps indexed assets', async () => {
  const index = new FakeIndex()
  const tokenStore = new FakeTokenStore()
  const signIn = new FakeSignIn()
  await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'one@example.com' })
  await index.keepAsset({
    sourceId: 'source-1',
    sourceAssetId: 'asset-1',
    name: 'one.pdf',
    size: 1,
    sha256: 'sha-1',
  })
  signIn.nextCredential = { value: 'credential-2', state: 'valid', account: 'two@example.com' }
  await assert.rejects(signInAgain(index, tokenStore, signIn, 'source-1'), /source's own account/)
  assert.equal((await index.assets()).length, 1)
  assert.equal(signIn.permissions, 'read-only')
})

test('signing in again stores a credential for the source account', async () => {
  const index = new FakeIndex()
  const tokenStore = new FakeTokenStore()
  const signIn = new FakeSignIn()
  await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'one@example.com' })
  signIn.nextCredential = {
    value: 'credential',
    state: 'valid',
    account: 'one@example.com',
  }
  await signInAgain(index, tokenStore, signIn, 'source-1')
  assert.equal((await tokenStore.credentialFor('source-1')).value, 'credential')
  await assert.rejects(signInAgain(index, tokenStore, signIn, 'missing'), /does not exist/)
})

test('removing a credential leaves the source and indexed assets', async () => {
  const index = new FakeIndex()
  const tokenStore = new FakeTokenStore()
  await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'one@example.com' })
  await index.keepAsset({
    sourceId: 'source-1',
    sourceAssetId: 'asset-1',
    name: 'one.pdf',
    size: 1,
    sha256: 'sha-1',
  })
  await tokenStore.keepCredential('source-1', {
    value: 'credential-1',
    state: 'valid',
    account: 'one@example.com',
    lastUsed: '2026-01-01',
  })
  await removeCredential(tokenStore, 'source-1')
  assert.deepEqual(await tokenStore.credentialFor('source-1'), {
    value: '',
    state: 'missing',
    account: 'one@example.com',
    lastUsed: '2026-01-01',
  })
  assert.equal((await index.sources()).length, 1)
  assert.equal((await index.assets()).length, 1)
})
