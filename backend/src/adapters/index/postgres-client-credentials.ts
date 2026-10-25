import type { ClientBase, QueryResultRow } from 'pg'
import type { ApiClient, ClientCredentials } from '../../ports/client-credentials.ts'

/**
 * The credentials of the API's clients on PostgreSQL: a digest of each
 * client's credential, never the credential itself, with whether it is
 * withdrawn and when the client last called the API. One client, set to the
 * schema of the app; the contract suite sets its own schema instead and drops
 * it after.
 */
export class PostgresClientCredentials implements ClientCredentials {
  private readonly client: ClientBase

  constructor(client: ClientBase) {
    this.client = client
  }

  async keepDigest(client: string, digest: string): Promise<void> {
    await this.client.query(
      `INSERT INTO api_client (name, digest, withdrawn)
       VALUES ($1, $2, FALSE)
       ON CONFLICT (name) DO UPDATE SET digest = EXCLUDED.digest, withdrawn = FALSE`,
      [client, digest],
    )
  }

  async clientForDigest(digest: string): Promise<string | undefined> {
    const result = await this.client.query(
      `SELECT name FROM api_client WHERE digest = $1 AND NOT withdrawn`,
      [digest],
    )
    const row = result.rows[0] as ClientRow | undefined
    return row?.name
  }

  async clients(): Promise<ApiClient[]> {
    const result = await this.client.query(
      `SELECT name, last_called_at FROM api_client ORDER BY name`,
    )
    return result.rows.map((raw) => {
      const row = raw as ClientRow
      return {
        name: row.name,
        ...(row.last_called_at !== null ? { lastCalled: row.last_called_at.toISOString() } : {}),
      }
    })
  }

  async noteCall(client: string, at: string): Promise<void> {
    await this.client.query(`UPDATE api_client SET last_called_at = $2 WHERE name = $1`, [
      client,
      at,
    ])
  }

  async withdraw(client: string): Promise<void> {
    await this.client.query(`UPDATE api_client SET withdrawn = TRUE WHERE name = $1`, [client])
  }
}

interface ClientRow extends QueryResultRow {
  name: string
  last_called_at: Date | null
}
