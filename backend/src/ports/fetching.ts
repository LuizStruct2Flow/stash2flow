import type { Asset } from '../domain/asset.ts'
import type { Source } from '../domain/source.ts'

export interface Fetching {
  sourceTotalSize(source: Source): Promise<number>
  fetch(source: Source): Promise<Asset[]>
}
