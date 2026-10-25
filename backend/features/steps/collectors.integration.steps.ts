// The slice-2 scenarios of collectors.feature, against the real API adapter:
// the API of the server, served over HTTPS only, refusing a call without
// valid credentials and letting each client of the API in with a credential
// of its own. Behind the API sit the fakes, so the scenarios run in the gate
// without a database.
import { After, Given, Then, When } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as http from 'node:http'
import * as https from 'node:https'
import type { ApiServer } from '../../src/adapters/api/https-api.ts'
import { startApiServer } from '../../src/adapters/api/https-api.ts'
import { makeCredential, noteCall, recogniseClient } from '../../src/application/api-clients.ts'
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

Given('the API of the server', async () => {
  apiLog.length = 0
  refusedStatuses = []
  await startApi()
})

When('a call is made to the API without valid credentials', async () => {
  const { api, ca } = mustWorld()
  refusedStatuses = [
    (await callSearch(api.port, ca)).status, // no credential at all
    (await callSearch(api.port, ca, 'a-credential-that-was-never-made')).status,
  ]
})

Then('the API refuses the call', async () => {
  assert.deepEqual(refusedStatuses, [401, 401])
  // A refused call records no client: none was recognised.
  assert.deepEqual(await mustWorld().clientCredentials.clients(), [])
  for (const line of apiLog) assert.ok(!line.includes('a-credential-that-was-never-made'))
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
