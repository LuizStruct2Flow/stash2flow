// The credentials of the API's clients (docs/concept/sources.md#credentials-of-the-apis-clients).
// What the server keeps to recognise a client's credential: only a digest of
// the credential, never the credential itself. The port stores digests; the
// use-case computes them, so no adapter ever sees a credential in full.

export interface ApiClient {
  name: string
  /** When the client last called the API, if it has called at all. */
  lastCalled?: string
}

export interface ClientCredentials {
  /** Keeps the digest of a client's credential, replacing an earlier one and lifting a withdrawal. */
  keepDigest(client: string, digest: string): Promise<void>
  /** The client whose live credential has this digest, or undefined when none has. */
  clientForDigest(digest: string): Promise<string | undefined>
  /** Every client, with when it last called the API. */
  clients(): Promise<ApiClient[]>
  /** Records when a client last called the API. */
  noteCall(client: string, at: string): Promise<void>
  /** Withdraws a client's credential: the API refuses it until a new one is made. */
  withdraw(client: string): Promise<void>
}
