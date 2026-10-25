// The command line stash (docs/concept/how-it-works.md#search): `stash search
// "<words>"` goes through the API with the command line's own credential; the
// commands that make, list and withdraw a client's credential, and the list of
// the sources with the state of their credential, work on the server directly,
// because the first credential cannot come through the API. No command ever
// prints a credential in full, except the one moment a new client's credential
// is shown once.
import { readFile } from 'node:fs/promises'
import { Client } from 'pg'
import { ApiRefused, HttpsApiClient } from '../api/https-api-client.ts'
import { PostgresClientCredentials } from '../index/postgres-client-credentials.ts'
import { PostgresIndex } from '../index/postgres-index.ts'
import { EncryptedFileTokenStore, readKeyFile } from '../token-store/encrypted-file-token-store.ts'
import { listClients, makeCredential, withdrawCredential } from '../../application/api-clients.ts'
import { listSources } from '../../application/credentials.ts'
import type { Match } from '../../application/search.ts'
import type { ClientCredentials } from '../../ports/client-credentials.ts'
import type { Index } from '../../ports/index.ts'
import type { TokenStore } from '../../ports/token-store.ts'

/** Where a command writes: the command line, the error line and the log. */
export interface Io {
  out(line: string): void
  err(line: string): void
  log(line: string): void
}

export const consoleIo: Io = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  log: (line) => console.error(line),
}

export interface SearchDeps {
  api: { search(words: string): Promise<Match[]> }
  words: string
}

export async function searchCommand(deps: SearchDeps, io: Io): Promise<number> {
  let matches: Match[]
  try {
    matches = await deps.api.search(deps.words)
  } catch (error) {
    if (error instanceof ApiRefused) {
      io.err('The API refuses the call.')
      return 1
    }
    throw error
  }
  for (const match of matches) {
    io.out(match.sourceLink ? `${match.sourceAssetId} ${match.sourceLink}` : match.sourceAssetId)
  }
  return 0
}

export interface MakeCredentialDeps {
  clientCredentials: ClientCredentials
  client: string
}

export async function makeCredentialCommand(deps: MakeCredentialDeps, io: Io): Promise<number> {
  const credential = await makeCredential(deps.clientCredentials, deps.client)
  io.log(`Made a credential for the client "${deps.client}".`)
  io.out(`The credential of the client "${deps.client}" is shown once. It is not shown again.`)
  io.out(credential)
  return 0
}

export interface ListCommandDeps {
  clientCredentials: ClientCredentials
  index: Index
  tokenStore: TokenStore
}

export async function listCommand(deps: ListCommandDeps, io: Io): Promise<number> {
  const clients = await listClients(deps.clientCredentials)
  io.out('Clients of the API:')
  if (clients.length === 0) io.out('  none')
  for (const client of clients) {
    io.out(
      client.lastCalled
        ? `  ${client.name} last called ${client.lastCalled}`
        : `  ${client.name} never called`,
    )
  }
  const sources = await listSources(deps.index, deps.tokenStore)
  io.out('Sources:')
  if (sources.length === 0) io.out('  none')
  for (const source of sources) {
    io.out(
      `  ${source.id} ${source.location} ${source.account} credential ${source.credentialState}` +
        (source.lastUsed ? ` last used ${source.lastUsed}` : ''),
    )
  }
  return 0
}

export interface WithdrawCredentialDeps {
  clientCredentials: ClientCredentials
  client: string
}

export async function withdrawCredentialCommand(
  deps: WithdrawCredentialDeps,
  io: Io,
): Promise<number> {
  await withdrawCredential(deps.clientCredentials, deps.client)
  io.out(
    `Withdrew the credential of the client "${deps.client}". Making a new credential for it brings it back.`,
  )
  io.log(`Withdrew the credential of the client "${deps.client}".`)
  return 0
}

const usage =
  'Usage: stash search "<words>" | stash credentials make <client> | stash credentials list | stash credentials withdraw <client>'

/** Runs one stash command; the wiring below reads the configuration from the environment only. */
export async function runStash(argv: string[], io: Io): Promise<number> {
  try {
    if (argv[0] === 'search' && argv.length === 2 && argv[1] !== undefined) {
      const credential = await readFile(requiredEnv('STASH_API_CREDENTIAL_FILE'), 'utf8').then(
        (file) => file.trim(),
      )
      const api = new HttpsApiClient(requiredEnv('STASH_API'), credential)
      return await searchCommand({ api, words: argv[1] }, io)
    }
    if (argv[0] === 'credentials') return await runCredentialsCommand(argv.slice(1), io)
    io.err(usage)
    return 1
  } catch (error) {
    io.err(error instanceof Error ? error.message : 'The command failed.')
    return 1
  }
}

async function runCredentialsCommand(args: string[], io: Io): Promise<number> {
  // The commands that administer credentials work on the server directly: the
  // first credential cannot come through the API. The database is reached with
  // the standard PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE variables.
  const database = new Client()
  await database.connect()
  try {
    const clientCredentials = new PostgresClientCredentials(database)
    if (args[0] === 'make' && args.length === 2 && args[1] !== undefined) {
      return await makeCredentialCommand({ clientCredentials, client: args[1] }, io)
    }
    if (args[0] === 'withdraw' && args.length === 2 && args[1] !== undefined) {
      return await withdrawCredentialCommand({ clientCredentials, client: args[1] }, io)
    }
    if (args[0] === 'list' && args.length === 1) {
      const tokenStore = new EncryptedFileTokenStore(
        requiredEnv('STASH_TOKEN_STORE'),
        await readKeyFile(requiredEnv('STASH_TOKEN_STORE_KEY')),
      )
      return await listCommand(
        { clientCredentials, index: new PostgresIndex(database), tokenStore },
        io,
      )
    }
    io.err(usage)
    return 1
  } finally {
    await database.end()
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '')
    throw new Error(`The configuration is missing the environment value ${name}.`)
  return value
}
