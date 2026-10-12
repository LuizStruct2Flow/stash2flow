import type { ClientBase } from 'pg'
import type { AssetRecord } from '../../domain/asset.ts'
import type { Ledger } from '../../ports/ledger.ts'
import type { PostgresIndex } from './postgres-index.ts'

/**
 * The ledger on PostgreSQL, the way the server's ledger works: it puts what
 * it takes straight onto the index and records each run's start and finish.
 * A batch delivered twice changes nothing, because asset records are stored
 * under the asset's identity.
 */
export class PostgresLedger implements Ledger {
  private readonly index: PostgresIndex
  private readonly client: ClientBase

  constructor(index: PostgresIndex, client: ClientBase) {
    this.index = index
    this.client = client
  }

  async takeAssetRecords(records: AssetRecord[]): Promise<void> {
    for (const record of records) await this.index.keepAsset(record)
  }

  async startRun(sourceId: string, startedAt: string): Promise<void> {
    await this.client.query(`INSERT INTO run (source_id, started_at) VALUES ($1, $2)`, [
      sourceId,
      startedAt,
    ])
  }

  async finishRun(sourceId: string, finishedAt: string): Promise<void> {
    const result = await this.client.query(
      `UPDATE run SET finished_at = $2
       WHERE id = (SELECT min(id) FROM run WHERE source_id = $1 AND finished_at IS NULL)`,
      [sourceId, finishedAt],
    )
    if (result.rowCount === 0) throw new Error('The run has not started.')
  }
}
