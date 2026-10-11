import type { Asset } from '../domain/asset.ts'
import type { Baseline, Source } from '../domain/source.ts'

export interface Index {
  keepSource(source: Source): Promise<void>
  source(sourceId: string): Promise<Source | undefined>
  sources(): Promise<Source[]>
  keepAsset(asset: Asset): Promise<void>
  assets(): Promise<Asset[]>
  keepBaseline(sourceId: string, baseline: Baseline): Promise<void>
  baseline(sourceId: string): Promise<Baseline | undefined>
}
