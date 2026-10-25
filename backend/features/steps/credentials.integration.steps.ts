// The slice-2 scenario of credentials.feature about printing: no command and
// no log prints a credential in full. Printing is owned by the command-line
// and log adapters, so the scenario makes a credential with the real make
// command, lists and withdraws with the real commands, and calls the real API
// with the credential, reading every line every one of them printed, on the
// command line, the error line, the log and the log of the API.
import { Given, Then } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { HttpsApiClient } from '../../src/adapters/api/https-api-client.ts'
import { startApiServer } from '../../src/adapters/api/https-api.ts'
import {
  listCommand,
  makeCredentialCommand,
  withdrawCredentialCommand,
} from '../../src/adapters/cli/stash-commands.ts'
import type { Io } from '../../src/adapters/cli/stash-commands.ts'
import { noteCall, recogniseClient } from '../../src/application/api-clients.ts'
import { search } from '../../src/application/search.ts'
import { FakeClientCredentials } from '../../src/fakes/fake-client-credentials.ts'
import { FakeClock } from '../../src/fakes/fake-clock.ts'
import { makeTestCert } from '../support/test-cert.ts'
import { keepSourceWithCredential, resetSlice2, slice2 } from './slice-2.ts'

Given('a source with a credential', async () => {
  resetSlice2()
  await keepSourceWithCredential('valid')
})

Then('no command and no log prints the credential in full', async () => {
  const clientCredentials = new FakeClientCredentials()
  const outLines: string[] = []
  const errLines: string[] = []
  const logLines: string[] = []
  const io: Io = {
    out: (line) => outLines.push(line),
    err: (line) => errLines.push(line),
    log: (line) => logLines.push(line),
  }

  // Making a credential is the one moment it is shown, on the command line only.
  assert.equal(await makeCredentialCommand({ clientCredentials, client: 'command line' }, io), 0)
  const credential = outLines.at(-1) ?? ''
  assert.notEqual(credential, '')
  assert.equal(
    outLines.filter((line) => line === credential).length,
    1,
    `the credential is shown once:\n${outLines.join('\n')}`,
  )
  assert.ok(
    ![...errLines, ...logLines].join('\n').includes(credential),
    'the credential is not shown on the error line or the log.',
  )

  // Listing shows the source with the state of its credential and the client,
  // without the credential.
  assert.equal(
    await listCommand(
      { clientCredentials, index: slice2.index, tokenStore: slice2.tokenStore },
      io,
    ),
    0,
  )
  const listed = outLines.join('\n')
  assert.ok(listed.includes('source-1'), `the list shows the source:\n${listed}`)
  assert.ok(listed.includes('valid'), `the list shows the state of the credential:\n${listed}`)

  // A call through the API with the credential: the log of the API must not hold it.
  const cert = await makeTestCert()
  const apiLog: string[] = []
  const api = await startApiServer(
    { host: '127.0.0.1', port: 0, certPath: cert.serverCert, keyPath: cert.serverKey },
    {
      recogniseClient: (value) => recogniseClient(clientCredentials, value),
      noteCall: (client, at) => noteCall(clientCredentials, client, at),
      search: (words) => search(slice2.index, words),
    },
    new FakeClock(),
    (line) => apiLog.push(line),
  )
  try {
    const client = new HttpsApiClient(`https://127.0.0.1:${api.port}`, credential, {
      ca: await readFile(cert.ca, 'utf8'),
    })
    await client.search('anything')
  } finally {
    await api.close()
    await cert.remove()
  }

  // Withdrawing does not print the credential either.
  assert.equal(
    await withdrawCredentialCommand({ clientCredentials, client: 'command line' }, io),
    0,
  )

  // The one moment stands alone: nothing anywhere printed the credential again.
  const printed = [...outLines, ...errLines, ...logLines, ...apiLog].join('\n')
  assert.equal(
    printed.split(credential).length - 1,
    1,
    `the credential appears exactly once, only when it was made:\n${printed}`,
  )
})
