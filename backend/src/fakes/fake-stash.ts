import type { Stash } from '../ports/stash.ts'

export class FakeStash implements Stash {
  localCopies = new Map<string, Uint8Array>()
  async keep(sha256: string, bytes: Uint8Array): Promise<void> {
    this.localCopies.set(sha256, structuredClone(bytes))
  }
}
