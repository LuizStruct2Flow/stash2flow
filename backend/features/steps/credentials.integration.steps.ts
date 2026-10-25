// The slice-2 scenario of credentials.feature about printing: no command and
// no log prints a credential in full. Printing is owned by the command-line
// and log adapters, so the scenario runs the real list command of the command
// line stash against the world's fakes and reads every line it printed.
import { Given, Then } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { listCommand } from '../../src/adapters/cli/stash-commands.ts'
import type { Io } from '../../src/adapters/cli/stash-commands.ts'
import { FakeClientCredentials } from '../../src/fakes/fake-client-credentials.ts'
import { keepSourceWithCredential, resetSlice2, slice2 } from './slice-2.ts'

Given('a source with a credential', async () => {
  resetSlice2()
  await keepSourceWithCredential('valid')
})

Then('no command and no log prints the credential in full', async () => {
  const outLines: string[] = []
  const errLines: string[] = []
  const logLines: string[] = []
  const io: Io = {
    out: (line) => outLines.push(line),
    err: (line) => errLines.push(line),
    log: (line) => logLines.push(line),
  }
  const exitCode = await listCommand(
    {
      clientCredentials: new FakeClientCredentials(),
      index: slice2.index,
      tokenStore: slice2.tokenStore,
    },
    io,
  )
  assert.equal(exitCode, 0)
  const printed = [...outLines, ...errLines, ...logLines].join('\n')
  assert.ok(printed.includes('source-1'), `the list shows the source:\n${printed}`)
  assert.ok(printed.includes('valid'), `the list shows the state of the credential:\n${printed}`)
  assert.ok(!printed.includes('credential-private'))
})
