import type { Asset, AssetRecord } from '../domain/asset.ts'
import type { Baseline, Source } from '../domain/source.ts'
import type { Index } from '../ports/index.ts'

export class FakeIndex implements Index {
  private readonly keptSources = new Map<string, Source>()
  private readonly keptAssets = new Map<string, Asset>()
  private readonly keptBaselines = new Map<string, Baseline>()

  async keepSource(source: Source): Promise<void> {
    this.keptSources.set(source.id, structuredClone(source))
  }
  async source(sourceId: string): Promise<Source | undefined> {
    return structuredClone(this.keptSources.get(sourceId))
  }
  async sources(): Promise<Source[]> {
    return structuredClone([...this.keptSources.values()])
  }
  async keepAsset(asset: AssetRecord): Promise<void> {
    this.keptAssets.set(`${asset.sourceId}:${asset.sourceAssetId}`, structuredClone(asset))
  }
  async assets(): Promise<Asset[]> {
    return structuredClone([...this.keptAssets.values()])
  }
  async keepBaseline(sourceId: string, baseline: Baseline): Promise<void> {
    this.keptBaselines.set(sourceId, structuredClone(baseline))
  }
  async baseline(sourceId: string): Promise<Baseline | undefined> {
    return structuredClone(this.keptBaselines.get(sourceId))
  }
}
