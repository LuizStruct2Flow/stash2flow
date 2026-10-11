import type { Ledger } from '../ports/ledger.ts'

export class FakeLedger implements Ledger {
  starts: string[] = []
  finishes: string[] = []
  async startRun(sourceId: string, _startedAt: string): Promise<void> {
    this.starts.push(sourceId)
  }
  async finishRun(sourceId: string, _finishedAt: string): Promise<void> {
    this.finishes.push(sourceId)
  }
}
