// The entry point of the server (docs/concept/domain-language.md#server): wires
// the real adapters and serves the API over HTTPS. The configuration comes
// from the environment only, nothing is hardcoded: the standard PGHOST,
// PGPORT, PGUSER, PGPASSWORD and PGDATABASE name the database (read by pg
// itself); STASH_API_HOST and STASH_API_PORT name the address; STASH_API_CERT
// and STASH_API_KEY name the certificate and the key. Run with:
// node src/server.ts
import { Client } from 'pg'
import { startApiServer } from './adapters/api/https-api.ts'
import { PostgresClientCredentials } from './adapters/index/postgres-client-credentials.ts'
import { PostgresIndex } from './adapters/index/postgres-index.ts'
import { noteCall, recogniseClient } from './application/api-clients.ts'
import { search } from './application/search.ts'

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '')
    throw new Error(`The configuration is missing the environment value ${name}.`)
  return value
}

try {
  const database = new Client()
  await database.connect()
  const clientCredentials = new PostgresClientCredentials(database)
  const index = new PostgresIndex(database)
  const clock = { now: (): string => new Date().toISOString() }
  const log = (line: string): void => console.error(line)
  const port = Number(requiredEnv('STASH_API_PORT'))
  if (!Number.isInteger(port)) throw new Error('STASH_API_PORT must be a whole number.')
  const api = await startApiServer(
    {
      host: process.env.STASH_API_HOST || undefined,
      port,
      certPath: requiredEnv('STASH_API_CERT'),
      keyPath: requiredEnv('STASH_API_KEY'),
    },
    {
      recogniseClient: (credential) => recogniseClient(clientCredentials, credential),
      noteCall: (client, at) => noteCall(clientCredentials, client, at),
      search: (words) => search(index, words),
    },
    clock,
    log,
  )
  console.log(`The API is served over HTTPS on port ${api.port}.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The server failed to start.')
  process.exit(1)
}
