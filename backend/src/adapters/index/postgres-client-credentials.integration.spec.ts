// The contract of the credentials of the API's clients. The same suite runs
// against the fake and against the real PostgreSQL adapter, so the fake cannot
// drift from the real thing.
//
// The PostgreSQL side connects through the standard PGHOST, PGPORT, PGUSER,
// PGPASSWORD and PGDATABASE variables, creates and drops its own schema with
// a random name and never touches other data. When no database is reachable,
// it says so and is reported as skipped; it never passes silently.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test, { type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import type { ClientCredentials } from '../../ports/client-credentials.ts'
import { FakeClientCredentials } from '../../fakes/fake-client-credentials.ts'
import { PostgresClientCredentials } from './postgres-client-credentials.ts'

const migration = fileURLToPath(new URL('migrations/0002-api-clients.sql', import.meta.url))

let unavailable: string | undefined
try {
  const probe = new Client()
  await probe.connect()
  await probe.end()
} catch (error) {
  unavailable =
    error instanceof Error ? error.message : 'the database gave an error that is not an Error'
  console.log(
    `PostgreSQL is not reachable (${unavailable}); the contract suites against the real adapters are skipped.`,
  )
}

const digestOf = (credential: string): string =>
  createHash('sha256').update(credential).digest('hex')

interface World<A> {
  subject: A
  close(): Promise<void>
}

/** Hands the world to the body and closes it afterwards, on both sides alike. */
async function withWorld<A>(
  world: Promise<World<A>>,
  body: (subject: A) => Promise<void>,
): Promise<void> {
  const opened = await world
  try {
    await body(opened.subject)
  } finally {
    await opened.close()
  }
}

const noClose = async () => {}

/** Runs the port contract against one client-credentials implementation. */
async function clientCredentialsContract(
  t: TestContext,
  make: () => Promise<World<ClientCredentials>>,
): Promise<void> {
  await t.test('keeps a digest and recognises the client by it', async () => {
    await withWorld(make(), async (clientCredentials) => {
      const credential = 'made-up-credential-one'
      await clientCredentials.keepDigest('collector', digestOf(credential))
      assert.equal(await clientCredentials.clientForDigest(digestOf(credential)), 'collector')
    })
  })

  await t.test('answers no client for a digest it does not hold', async () => {
    await withWorld(make(), async (clientCredentials) => {
      await clientCredentials.keepDigest('collector', digestOf('made-up-credential'))
      assert.equal(await clientCredentials.clientForDigest(digestOf('never-made')), undefined)
    })
  })

  await t.test(
    'a withdrawn credential is refused, and a new one brings the client back',
    async () => {
      await withWorld(make(), async (clientCredentials) => {
        const old = 'made-up-credential-old'
        await clientCredentials.keepDigest('command line', digestOf(old))
        await clientCredentials.withdraw('command line')
        assert.equal(await clientCredentials.clientForDigest(digestOf(old)), undefined)
        const fresh = 'made-up-credential-fresh'
        await clientCredentials.keepDigest('command line', digestOf(fresh))
        assert.equal(await clientCredentials.clientForDigest(digestOf(fresh)), 'command line')
        assert.equal(await clientCredentials.clientForDigest(digestOf(old)), undefined)
      })
    },
  )

  await t.test('one client never recognises another client’s digest', async () => {
    await withWorld(make(), async (clientCredentials) => {
      await clientCredentials.keepDigest('collector', digestOf('made-up-credential-a'))
      await clientCredentials.keepDigest('browser', digestOf('made-up-credential-b'))
      assert.equal(
        await clientCredentials.clientForDigest(digestOf('made-up-credential-a')),
        'collector',
      )
      assert.equal(
        await clientCredentials.clientForDigest(digestOf('made-up-credential-b')),
        'browser',
      )
    })
  })

  await t.test('lists every client with when it last called', async () => {
    await withWorld(make(), async (clientCredentials) => {
      await clientCredentials.keepDigest('browser', digestOf('made-up-credential-1'))
      await clientCredentials.keepDigest('collector', digestOf('made-up-credential-2'))
      assert.deepEqual(await clientCredentials.clients(), [
        { name: 'browser' },
        { name: 'collector' },
      ])
      await clientCredentials.noteCall('collector', '2026-10-25T10:00:00.000Z')
      assert.deepEqual(await clientCredentials.clients(), [
        { name: 'browser' },
        { name: 'collector', lastCalled: '2026-10-25T10:00:00.000Z' },
      ])
    })
  })

  await t.test('records when a client last called, replacing the earlier time', async () => {
    await withWorld(make(), async (clientCredentials) => {
      await clientCredentials.keepDigest('collector', digestOf('made-up-credential'))
      await clientCredentials.noteCall('collector', '2026-10-25T10:00:00.000Z')
      await clientCredentials.noteCall('collector', '2026-10-25T11:00:00.000Z')
      assert.deepEqual(await clientCredentials.clients(), [
        { name: 'collector', lastCalled: '2026-10-25T11:00:00.000Z' },
      ])
    })
  })

  await t.test('a call of an unknown client is not recorded', async () => {
    await withWorld(make(), async (clientCredentials) => {
      await clientCredentials.noteCall('no-such-client', '2026-10-25T10:00:00.000Z')
      assert.deepEqual(await clientCredentials.clients(), [])
    })
  })
}

async function fakeWorld(): Promise<World<ClientCredentials>> {
  return { subject: new FakeClientCredentials(), close: noClose }
}

/** The world of one real adapter: a fresh schema with the migration applied. */
async function postgresWorld(): Promise<World<ClientCredentials>> {
  const client = new Client()
  await client.connect()
  const schema = `contract_${randomBytes(8).toString('hex')}`
  try {
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}", public`)
    await client.query(await readFile(migration, 'utf8'))
  } catch (error) {
    await client.end()
    throw error
  }
  return {
    subject: new PostgresClientCredentials(client),
    close: async () => {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await client.end()
    },
  }
}

test('client-credentials contract: the fake', async (t) => {
  await clientCredentialsContract(t, fakeWorld)
})

test('client-credentials contract: PostgreSQL', { skip: unavailable ?? false }, async (t) => {
  await clientCredentialsContract(t, postgresWorld)
})
