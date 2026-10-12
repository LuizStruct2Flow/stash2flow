// Applies the migration that builds the schema of the index and the ledger,
// so the database can be rebuilt from the repository. Connects through the
// standard PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE variables, like
// every other program of the app.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

const migration = fileURLToPath(new URL('migrations/0001-initial.sql', import.meta.url))

const client = new Client()
await client.connect()
try {
  await client.query(await readFile(migration, 'utf8'))
} finally {
  await client.end()
}
console.log('The schema of the index and the ledger is applied.')
