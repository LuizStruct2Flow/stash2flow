import type { AssetRecord } from '../domain/asset.ts'
import type { Index } from '../ports/index.ts'
import type { Ledger } from '../ports/ledger.ts'

/** Like the server's ledger, it puts what it takes straight onto the index. */
export class FakeLedger implements Ledger {
  starts: string[] = []
  finishes: string[] = []
  private readonly index: Index
  constructor(index: Index) {
    this.index = index
  }
  async takeAssetRecords(records: AssetRecord[]): Promise<void> {
    for (const record of records) await this.index.keepAsset(record)
  }
  async startRun(sourceId: string, _startedAt: string): Promise<void> {
    this.starts.push(sourceId)
  }
  async finishRun(sourceId: string, _finishedAt: string): Promise<void> {
    this.finishes.push(sourceId)
  }
}
