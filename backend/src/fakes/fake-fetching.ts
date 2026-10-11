import type { Asset } from '../domain/asset.ts'
import type { Source } from '../domain/source.ts'
import type { Fetching } from '../ports/fetching.ts'

export class FakeFetching implements Fetching {
  totalSize = 0
  assetsToFetch: Asset[] = []
  calls: string[] = []
  writes = 0

  async sourceTotalSize(_source: Source): Promise<number> {
    this.calls.push('totalSize')
    return this.totalSize
  }
  async fetch(_source: Source): Promise<Asset[]> {
    this.calls.push('fetch')
    return structuredClone(this.assetsToFetch)
  }
}
