import type { ApiClient, ClientCredentials } from '../ports/client-credentials.ts'

interface Row {
  digest: string
  withdrawn: boolean
  lastCalled?: string
}

export class FakeClientCredentials implements ClientCredentials {
  private readonly rows = new Map<string, Row>()

  async keepDigest(client: string, digest: string): Promise<void> {
    this.rows.set(client, { digest, withdrawn: false })
  }
  async clientForDigest(digest: string): Promise<string | undefined> {
    for (const [client, row] of this.rows) {
      if (!row.withdrawn && row.digest === digest) return client
    }
    return undefined
  }
  async clients(): Promise<ApiClient[]> {
    return [...this.rows.keys()].sort().map((name) => {
      const row = this.rows.get(name) as Row
      return { name, ...(row.lastCalled ? { lastCalled: row.lastCalled } : {}) }
    })
  }
  async noteCall(client: string, at: string): Promise<void> {
    const row = this.rows.get(client)
    if (row) row.lastCalled = at
  }
  async withdraw(client: string): Promise<void> {
    const row = this.rows.get(client)
    if (row) row.withdrawn = true
  }

  /** What the fake stored, for assertions in tests. */
  digestOf(client: string): string | undefined {
    return this.rows.get(client)?.digest
  }
}
