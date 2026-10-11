import type { AssetRecord } from '../domain/asset.ts'

export interface Ledger {
  takeAssetRecords(records: AssetRecord[]): Promise<void>
  startRun(sourceId: string, startedAt: string): Promise<void>
  finishRun(sourceId: string, finishedAt: string): Promise<void>
}
