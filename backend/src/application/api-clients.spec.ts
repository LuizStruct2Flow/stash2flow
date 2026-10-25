import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { FakeClientCredentials } from '../fakes/fake-client-credentials.ts'
import {
  digestOf,
  listClients,
  makeCredential,
  noteCall,
  recogniseClient,
  withdrawCredential,
} from './api-clients.ts'

test('making a credential shows it once: the port sees only its digest', async () => {
  const clientCredentials = new FakeClientCredentials()
  const credential = await makeCredential(clientCredentials, 'collector')
  assert.ok(credential.length >= 32, 'the secret is long enough')
  const stored = clientCredentials.digestOf('collector')
  assert.equal(stored, createHash('sha256').update(credential).digest('hex'))
  assert.notEqual(stored, credential)
})

test('two credentials made for two clients are never the same', async () => {
  const clientCredentials = new FakeClientCredentials()
  const one = await makeCredential(clientCredentials, 'collector')
  const two = await makeCredential(clientCredentials, 'command line')
  assert.notEqual(one, two)
  assert.equal(await recogniseClient(clientCredentials, one), 'collector')
  assert.equal(await recogniseClient(clientCredentials, two), 'command line')
})

test('a credential that was never made is not recognised', async () => {
  const clientCredentials = new FakeClientCredentials()
  await makeCredential(clientCredentials, 'collector')
  assert.equal(await recogniseClient(clientCredentials, 'made-up-credential'), undefined)
})

test('withdrawing a credential makes the API refuse it, and a new one brings the client back', async () => {
  const clientCredentials = new FakeClientCredentials()
  const credential = await makeCredential(clientCredentials, 'collector')
  await withdrawCredential(clientCredentials, 'collector')
  assert.equal(await recogniseClient(clientCredentials, credential), undefined)
  const fresh = await makeCredential(clientCredentials, 'collector')
  assert.notEqual(fresh, credential)
  assert.equal(await recogniseClient(clientCredentials, fresh), 'collector')
  // The old credential stays refused.
  assert.equal(await recogniseClient(clientCredentials, credential), undefined)
})

test('listing shows every client with when it last called', async () => {
  const clientCredentials = new FakeClientCredentials()
  await makeCredential(clientCredentials, 'browser')
  await makeCredential(clientCredentials, 'collector')
  assert.deepEqual(await listClients(clientCredentials), [
    { name: 'browser' },
    { name: 'collector' },
  ])
  await noteCall(clientCredentials, 'collector', '2026-10-25T10:00:00.000Z')
  assert.deepEqual(await listClients(clientCredentials), [
    { name: 'browser' },
    { name: 'collector', lastCalled: '2026-10-25T10:00:00.000Z' },
  ])
})

test('the digest is the sha256 of the credential', () => {
  assert.equal(
    digestOf('made-up-credential'),
    createHash('sha256').update('made-up-credential').digest('hex'),
  )
})
