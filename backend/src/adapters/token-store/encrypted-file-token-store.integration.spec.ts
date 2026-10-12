// The contract of the token store as an encrypted file. The same suite runs
// against the fake and against the real adapter, so the fake cannot drift from
// the real thing. The real side additionally proves that nothing of the store
// is ever kept in the clear and that a store opened with another key refuses
// to be read.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import type { Credential } from '../../domain/source.ts'
import type { TokenStore } from '../../ports/token-store.ts'
import { FakeTokenStore } from '../../fakes/fake-token-store.ts'
import {
  EncryptedFileTokenStore,
  readKeyFile,
  writeNewKeyFile,
} from './encrypted-file-token-store.ts'

async function tokenStoreContract(t: TestContext, make: () => TokenStore): Promise<void> {
  await t.test('keeps a binding and answers it back', async () => {
    const store = make()
    await store.keepBinding('gdrive', 'the-binding-the-user-gave')
    assert.equal(await store.bindingFor('gdrive'), 'the-binding-the-user-gave')
  })

  await t.test('answers undefined for a provider the app is not bound to', async () => {
    const store = make()
    assert.equal(await store.bindingFor('gdrive'), undefined)
  })

  await t.test('keeps a credential and answers it back', async () => {
    const store = make()
    const credential: Credential = {
      value: 'a-made-up-credential',
      state: 'expires on a date',
      account: 'user@example.com',
      expiresOn: '2026-11-01',
      lastUsed: '2026-10-01T00:00:00.000Z',
      canRenewWithoutUser: true,
    }
    await store.keepCredential('source-1', credential)
    assert.deepEqual(await store.credentialFor('source-1'), credential)
  })

  await t.test('answers a missing credential for a source it never held', async () => {
    const store = make()
    assert.deepEqual(await store.credentialFor('source-1'), {
      value: '',
      state: 'missing',
      account: '',
    })
  })

  await t.test('removing a credential keeps the source in place', async () => {
    const store = make()
    await store.keepCredential('source-1', {
      value: 'a-made-up-credential',
      state: 'valid',
      account: 'user@example.com',
      expiresOn: '2026-11-01',
      lastUsed: '2026-10-01T00:00:00.000Z',
      canRenewWithoutUser: true,
    })
    await store.removeCredential('source-1')
    assert.deepEqual(await store.credentialFor('source-1'), {
      value: '',
      state: 'missing',
      account: 'user@example.com',
      lastUsed: '2026-10-01T00:00:00.000Z',
    })
  })
}

test('token store contract: the fake', async (t) => {
  await tokenStoreContract(t, () => new FakeTokenStore())
})

test('token store contract: the encrypted file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'stash2flow-token-store-'))
  try {
    const file = join(directory, 'token-store.json')
    const keyFile = join(directory, 'token-store.key')
    await writeNewKeyFile(keyFile)
    const key = await readKeyFile(keyFile)
    let stores = 0
    await tokenStoreContract(
      t,
      () => new EncryptedFileTokenStore(join(directory, `contract-${stores++}.json`), key),
    )

    await t.test('the key file is read from the path configuration gives', async () => {
      const fromFile = await readKeyFile(keyFile)
      assert.deepEqual(fromFile, key)
      await assert.rejects(readKeyFile(join(directory, 'no-such.key')), /does not exist/)
    })

    await t.test('nothing of the store is kept in the clear', async () => {
      const store = new EncryptedFileTokenStore(file, key)
      await store.keepBinding('gdrive', 'the-binding-the-user-gave')
      await store.keepCredential('source-1', {
        value: 'a-made-up-credential',
        state: 'valid',
        account: 'user@example.com',
      })
      const atRest = await readFile(file, 'utf8')
      assert.ok(!atRest.includes('the-binding-the-user-gave'))
      assert.ok(!atRest.includes('a-made-up-credential'))
    })

    await t.test('a store is read back with the key of its key file', async () => {
      const reopened = new EncryptedFileTokenStore(file, await readKeyFile(keyFile))
      assert.equal(await reopened.bindingFor('gdrive'), 'the-binding-the-user-gave')
    })

    await t.test('a store refuses to be read with another key', async () => {
      const otherKeyFile = join(directory, 'another.key')
      await writeNewKeyFile(otherKeyFile)
      const wrongKey = new EncryptedFileTokenStore(file, await readKeyFile(otherKeyFile))
      await assert.rejects(wrongKey.bindingFor('gdrive'), /cannot be read with this key/)
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
