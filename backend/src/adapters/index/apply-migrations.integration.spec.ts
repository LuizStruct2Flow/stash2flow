// Proof of the promise of apply-migrations.ts: every migration is applied
// exactly once, in order, and recorded in the database, so applying the schema
// a second time does not fail on 0001, and a database built before 0002
// existed gains it. Connects through the standard PGHOST, PGPORT, PGUSER,
// PGPASSWORD and PGDATABASE variables, creates and drops its own schema with
// a random name and never touches other data. When no database is reachable,
// it says so and is reported as skipped; it never passes silently.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { applyMigrations } from './apply-migrations.ts'

const migration0001 = fileURLToPath(new URL('migrations/0001-initial.sql', import.meta.url))

let unavailable: string | undefined
try {
  const probe = new Client()
  await probe.connect()
  await probe.end()
} catch (error) {
  unavailable =
    error instanceof Error ? error.message : 'the database gave an error that is not an Error'
  console.log(
    `PostgreSQL is not reachable (${unavailable}); the apply-migrations suite is skipped.`,
  )
}

/** Hands a client on its own freshly created schema to the body and drops it afterwards. */
async function withOwnSchema(body: (client: Client, schema: string) => Promise<void>) {
  const client = new Client()
  await client.connect()
  const schema = `migrations_${randomBytes(8).toString('hex')}`
  try {
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}", public`)
    await body(client, schema)
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await client.end()
  }
}

const appliedNames = async (client: Client): Promise<string[]> => {
  const { rows } = await client.query<{ name: string }>(
    'SELECT name FROM schema_migrations ORDER BY seq',
  )
  return rows.map((row) => row.name)
}

test('apply-migrations', { skip: unavailable ?? false }, async (t) => {
  await t.test('applying the schema twice applies each migration once, in order', async () => {
    await withOwnSchema(async (client) => {
      await applyMigrations(client)
      await applyMigrations(client) // the second run must not fail on 0001
      assert.deepEqual(await appliedNames(client), ['0001-initial.sql', '0002-api-clients.sql'])
      // 0002 is really there: a client of the API can be kept.
      await client.query(`INSERT INTO api_client (name, digest) VALUES ('collector', 'digest-1')`)
    })
  })

  await t.test('a database with 0001 alone gains 0002', async () => {
    await withOwnSchema(async (client) => {
      // A database built before the second migration: 0001 applied, nothing recorded.
      await client.query(await readFile(migration0001, 'utf8'))
      await applyMigrations(client)
      assert.deepEqual(await appliedNames(client), ['0001-initial.sql', '0002-api-clients.sql'])
      await client.query(`INSERT INTO api_client (name, digest) VALUES ('collector', 'digest-1')`)
    })
  })
})
