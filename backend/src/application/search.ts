import { textMatches } from '../domain/asset.ts'
import type { Index } from '../ports/index.ts'

export interface Match {
  sourceAssetId: string
  sourceLink?: string
}

export async function search(index: Index, words: string): Promise<Match[]> {
  const assets = await index.assets()
  return assets
    .filter((asset) => textMatches(asset.ocrText?.join(' ') ?? '', words))
    .map((asset) => ({ sourceAssetId: asset.sourceAssetId, sourceLink: asset.sourceLink }))
}
