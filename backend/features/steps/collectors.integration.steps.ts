// The slice-2 scenarios of collectors.feature, against the real API adapter:
// the API of the server, served over HTTPS only, refusing a call without
// valid credentials and letting each client of the API in with a credential
// of its own. Behind the API sit the fakes, so the scenarios run in the gate
// without a database.
import { After, Given, Then, When } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as http from 'node:http'
import * as https from 'node:https'
import type { ApiServer } from '../../src/adapters/api/https-api.ts'
import { startApiServer } from '../../src/adapters/api/https-api.ts'
import { runStash } from '../../src/adapters/cli/stash-commands.ts'
import type { Io } from '../../src/adapters/cli/stash-commands.ts'
import {
  makeCredential,
  noteCall,
  recogniseClient,
  withdrawCredential,
} from '../../src/application/api-clients.ts'
import { search } from '../../src/application/search.ts'
import { FakeClientCredentials } from '../../src/fakes/fake-client-credentials.ts'
import { FakeClock } from '../../src/fakes/fake-clock.ts'
import { FakeIndex } from '../../src/fakes/fake-index.ts'
import { makeTestCert, type TestCert } from '../support/test-cert.ts'

interface ApiWorld {
  index: FakeIndex
  clientCredentials: FakeClientCredentials
  api: ApiServer
  ca: string
  cert: TestCert
}

let world: ApiWorld | undefined
const apiLog: string[] = []

async function startApi(): Promise<ApiWorld> {
  const cert = await makeTestCert()
  const index = new FakeIndex()
  const clientCredentials = new FakeClientCredentials()
  const api = await startApiServer(
    { host: '127.0.0.1', port: 0, certPath: cert.serverCert, keyPath: cert.serverKey },
    {
      recogniseClient: (credential) => recogniseClient(clientCredentials, credential),
      noteCall: (client, at) => noteCall(clientCredentials, client, at),
      search: (words) => search(index, words),
    },
    new FakeClock(),
    (line) => apiLog.push(line),
  )
  world = { index, clientCredentials, api, ca: await readFile(cert.ca, 'utf8'), cert }
  return world
}

function mustWorld(): ApiWorld {
  if (!world) throw new Error('The API of the server is not started.')
  return world
}

/** One call of a client of the API, as the clients make it: over HTTPS, the credential in the authorization header. */
function callSearch(port: number, ca: string, credential?: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {}
    if (credential !== undefined) headers.authorization = `Bearer ${credential}`
    const request = https.request(
      {
        host: '127.0.0.1',
        port,
        path: '/search?words=tax',
        method: 'GET',
        headers,
        agent: new https.Agent({ ca }),
      },
      (response) => {
        response.resume()
        response.on('end', () => resolve({ status: response.statusCode ?? 0 }))
      },
    )
    request.on('error', reject)
    request.end()
  })
}

let refusedStatuses: number[] = []
let withdrawnCredential: string | undefined

Given('the API of the server', async () => {
  apiLog.length = 0
  refusedStatuses = []
  withdrawnCredential = undefined
  await startApi()
})

When('a call is made to the API without valid credentials', async () => {
  const { api, ca, clientCredentials } = mustWorld()
  // Without valid credentials: none at all, one that was never made, and one
  // that was made and then withdrawn.
  withdrawnCredential = await makeCredential(clientCredentials, 'a client')
  await withdrawCredential(clientCredentials, 'a client')
  refusedStatuses = [
    (await callSearch(api.port, ca)).status, // no credential at all
    (await callSearch(api.port, ca, 'a-credential-that-was-never-made')).status,
    (await callSearch(api.port, ca, withdrawnCredential)).status,
  ]
})

Then('the API refuses the call', async () => {
  assert.deepEqual(refusedStatuses, [401, 401, 401])
  // A refused call records no call: the withdrawn client exists but never called.
  assert.deepEqual(await mustWorld().clientCredentials.clients(), [{ name: 'a client' }])
  for (const line of apiLog) {
    assert.ok(!line.includes('a-credential-that-was-never-made'))
    if (withdrawnCredential !== undefined) assert.ok(!line.includes(withdrawnCredential))
  }
})

interface Authenticated {
  client: string
  credential: string
  status: number
}

const clientsOfTheApi = ['collector', 'command line', 'browser']
let authenticated: Authenticated[] = []

Given('a collector, the command line and the browser', async () => {
  apiLog.length = 0
  authenticated = []
  await startApi()
})

When('each of them authenticates with the API', async () => {
  const { api, ca, clientCredentials } = mustWorld()
  for (const client of clientsOfTheApi) {
    const credential = await makeCredential(clientCredentials, client)
    const { status } = await callSearch(api.port, ca, credential)
    authenticated.push({ client, credential, status })
  }
})

Then('each of them uses a credential of its own', async () => {
  const { clientCredentials } = mustWorld()
  for (const { client, credential, status } of authenticated) {
    assert.equal(status, 200)
    assert.equal(await recogniseClient(clientCredentials, credential), client)
  }
})

Then('no two of them share a credential', () => {
  const credentials = authenticated.map((entry) => entry.credential)
  assert.equal(new Set(credentials).size, credentials.length)
  for (const { credential } of authenticated) {
    for (const line of apiLog) assert.ok(!line.includes(credential))
  }
})

let plainHttpAnswered = false

When('a call is made to the API over plain HTTP', async () => {
  plainHttpAnswered = await answeredOverPlainHttp(mustWorld().api.port)
})

Then('the API does not answer the call', () => {
  assert.equal(plainHttpAnswered, false)
})

const scratchDir = fileURLToPath(new URL('../../../.scratch/', import.meta.url))

interface SearchRun {
  code: number
  out: string[]
  err: string[]
}
let searchRun: SearchRun | undefined

// The command line is configured from the environment only; the certificate
// the command line trusts is the file STASH_API_CA names.
When(
  'the command line searches through the API, trusting the certificate the configuration names',
  async () => {
    const { api, cert, clientCredentials, index } = mustWorld()
    const credential = await makeCredential(clientCredentials, 'command line')
    await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'user@example.com' })
    await index.keepAsset({
      sourceId: 'source-1',
      sourceAssetId: 'asset-1',
      name: 'receipt.pdf',
      size: 10,
      sha256: 'sha-1',
      ocrText: ['the tax receipt'],
    })
    const dir = await mkdtemp(join(scratchDir, 'stash-search-'))
    const credentialFile = join(dir, 'credential')
    await writeFile(credentialFile, `${credential}\n`)
    const previous = {
      STASH_API: process.env.STASH_API,
      STASH_API_CREDENTIAL_FILE: process.env.STASH_API_CREDENTIAL_FILE,
      STASH_API_CA: process.env.STASH_API_CA,
    }
    process.env.STASH_API = `https://127.0.0.1:${api.port}`
    process.env.STASH_API_CREDENTIAL_FILE = credentialFile
    process.env.STASH_API_CA = cert.ca
    const out: string[] = []
    const err: string[] = []
    const io: Io = {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      log: (line) => err.push(line),
    }
    try {
      const code = await runStash(['search', 'tax'], io)
      searchRun = { code, out, err }
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
      await rm(dir, { recursive: true, force: true })
    }
  },
)

Then('the command line gets the matches of the search', () => {
  const run = searchRun
  assert.ok(run, 'the command line did not run.')
  assert.equal(run.code, 0, `the command line failed:\n${run.err.join('\n')}`)
  assert.deepEqual(run.out, ['asset-1'])
})

/** True when an answer comes back that an HTTP client can read; the API is HTTPS only, so none must. */
function answeredOverPlainHttp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(
      { host: '127.0.0.1', port, path: '/search?words=tax', timeout: 3000 },
      (response) => {
        response.resume()
        resolve(true)
      },
    )
    request.on('error', () => resolve(false))
    request.on('timeout', () => {
      request.destroy()
      resolve(false)
    })
  })
}

After(async () => {
  if (world) {
    await world.api.close()
    await world.cert.remove()
    world = undefined
  }
})
