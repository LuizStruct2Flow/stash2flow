// Applies the migrations that build the schema of the index, the ledger and
// the credentials of the API's clients, so the database can be rebuilt from
// the repository. Connects through the standard PGHOST, PGPORT, PGUSER,
// PGPASSWORD and PGDATABASE variables, like every other program of the app.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

const migrations = ['0001-initial.sql', '0002-api-clients.sql'].map((file) =>
  fileURLToPath(new URL(`migrations/${file}`, import.meta.url)),
)

const client = new Client()
await client.connect()
try {
  for (const migration of migrations) {
    await client.query(await readFile(migration, 'utf8'))
  }
} finally {
  await client.end()
}
console.log('The schema of the index, the ledger and the clients of the API is applied.')
