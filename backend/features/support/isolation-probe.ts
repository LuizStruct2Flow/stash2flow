// Run as a child process by isolation.spec.ts and spikes/isolation.ts: tries to
// reach what the guardian must not reach, and prints one JSON line with the
// outcome of each attempt: 'reached', or the error code that stopped it.
// Arguments: <port> <address of this machine for the network attempt> <token store stand-in>
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { connect } from 'node:net'

const [port, host, tokens] = process.argv.slice(2)

const code = (e: unknown) => (e as NodeJS.ErrnoException).code ?? String(e)

function attempt(fn: () => void): string {
  try {
    fn()
    return 'reached'
  } catch (e) {
    return code(e)
  }
}

function reach(address: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect({ host: address, port: Number(port) })
    socket.setTimeout(2000, () => {
      socket.destroy()
      resolve('timeout')
    })
    socket.once('connect', () => {
      socket.destroy()
      resolve('reached')
    })
    socket.once('error', (e) => resolve(code(e)))
  })
}

const outcome = {
  network: await reach(host),
  database: await reach('127.0.0.1'),
  tokens: attempt(() => readFileSync(tokens)),
  program: attempt(() => execFileSync('/bin/true')),
}
process.stdout.write(JSON.stringify(outcome) + '\n')
