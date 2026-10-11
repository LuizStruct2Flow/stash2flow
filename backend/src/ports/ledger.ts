export interface Ledger {
  startRun(sourceId: string, startedAt: string): Promise<void>
  finishRun(sourceId: string, finishedAt: string): Promise<void>
}
