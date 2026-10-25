// Applies the migrations that build the schema of the index, the ledger and
// the credentials of the API's clients, so the database can be rebuilt from
// the repository. Every migration is recorded in the schema_migrations table
// as it is applied, so each one runs exactly once, in order: applying the
// schema a second time does not fail on 0001, and a database built before a
// later migration existed gains only what it misses. The tables of 0001 and
// 0002 are created IF NOT EXISTS, so a database that predates the recording
// is adopted rather than failed on its first new run.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Client } from 'pg'

/** The migrations, in the order they are applied. */
export const migrations = ['0001-initial.sql', '0002-api-clients.sql']

export async function applyMigrations(client: Client): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    seq BIGINT GENERATED ALWAYS AS IDENTITY,
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)
  const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations')
  const applied = new Set(rows.map((row) => row.name))
  for (const file of migrations) {
    if (applied.has(file)) continue
    const sql = await readFile(
      fileURLToPath(new URL(`migrations/${file}`, import.meta.url)),
      'utf8',
    )
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }
}
