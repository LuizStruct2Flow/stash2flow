// A throwaway certificate authority and a server certificate signed by it, for
// the scenarios that run the real API over HTTPS. Generated at test time with
// the installed openssl into a directory under .scratch/, which the test
// removes. A private key is never committed, not even a made-up one.
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scratch = fileURLToPath(new URL('../../../.scratch/', import.meta.url))

export interface TestCert {
  /** The PEM of the certificate authority, to verify the server with. */
  ca: string
  serverCert: string
  serverKey: string
  remove(): Promise<void>
}

export async function makeTestCert(): Promise<TestCert> {
  const dir = await mkdtemp(join(scratch, 'test-cert-'))
  const caCert = join(dir, 'ca.crt')
  const caKey = join(dir, 'ca.key')
  const serverCert = join(dir, 'server.crt')
  const serverKey = join(dir, 'server.key')
  const signingRequest = join(dir, 'server.csr')
  const extensions = join(dir, 'server.ext')
  const run = (args: string[]): Promise<void> =>
    new Promise((resolve, reject) => {
      execFile('openssl', args, (error) => (error ? reject(error) : resolve()))
    })
  try {
    await run([
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      caKey,
      '-out',
      caCert,
      '-days',
      '1',
      '-nodes',
      '-subj',
      '/CN=stash2flow made-up test ca',
    ])
    await run([
      'req',
      '-newkey',
      'rsa:2048',
      '-keyout',
      serverKey,
      '-out',
      signingRequest,
      '-nodes',
      '-subj',
      '/CN=localhost',
    ])
    await writeFile(extensions, 'subjectAltName=DNS:localhost,IP:127.0.0.1\n')
    await run([
      'x509',
      '-req',
      '-in',
      signingRequest,
      '-CA',
      caCert,
      '-CAkey',
      caKey,
      '-CAcreateserial',
      '-out',
      serverCert,
      '-days',
      '1',
      '-extfile',
      extensions,
    ])
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  return {
    ca: caCert,
    serverCert,
    serverKey,
    remove: () => rm(dir, { recursive: true, force: true }),
  }
}
