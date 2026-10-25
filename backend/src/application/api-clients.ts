// The credentials of the API's clients (docs/concept/sources.md#credentials-of-the-apis-clients):
// making a credential for a new client shows it once; the server keeps only a
// digest of the random secret, never the credential; the list shows every
// client with when it last called; withdrawing makes the API refuse the client.
import { createHash, randomBytes } from 'node:crypto'
import type { ApiClient, ClientCredentials } from '../ports/client-credentials.ts'

const secretBytes = 32

/** The digest the server keeps of a credential, to recognise it without holding it. */
export function digestOf(credential: string): string {
  return createHash('sha256').update(credential).digest('hex')
}

/** Makes a credential for a new client. It is shown once and cannot be shown again. */
export async function makeCredential(
  clientCredentials: ClientCredentials,
  client: string,
): Promise<string> {
  const credential = randomBytes(secretBytes).toString('base64url')
  await clientCredentials.keepDigest(client, digestOf(credential))
  return credential
}

/** The client the credential belongs to, or undefined when the API must refuse the call. */
export async function recogniseClient(
  clientCredentials: ClientCredentials,
  credential: string,
): Promise<string | undefined> {
  return clientCredentials.clientForDigest(digestOf(credential))
}

/** Every client of the API, with when it last called. */
export async function listClients(clientCredentials: ClientCredentials): Promise<ApiClient[]> {
  return clientCredentials.clients()
}

/** Records when a client last called the API. */
export async function noteCall(
  clientCredentials: ClientCredentials,
  client: string,
  at: string,
): Promise<void> {
  await clientCredentials.noteCall(client, at)
}

/** Withdraws a client's credential. Making a new one brings the client back. */
export async function withdrawCredential(
  clientCredentials: ClientCredentials,
  client: string,
): Promise<void> {
  await clientCredentials.withdraw(client)
}
