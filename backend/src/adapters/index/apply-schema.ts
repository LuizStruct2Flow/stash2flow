// Applies the migrations that build the schema of the index, the ledger and
// the credentials of the API's clients, so the database can be rebuilt from
// the repository. Connects through the standard PGHOST, PGPORT, PGUSER,
// PGPASSWORD and PGDATABASE variables, like every other program of the app.
import { Client } from 'pg'
import { applyMigrations } from './apply-migrations.ts'

const client = new Client()
await client.connect()
try {
  await applyMigrations(client)
} finally {
  await client.end()
}
console.log('The schema of the index, the ledger and the clients of the API is applied.')
