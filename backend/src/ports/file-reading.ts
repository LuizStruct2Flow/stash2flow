import type { Asset, AssetDates } from '../domain/asset.ts'

export interface FileReadingResult extends AssetDates {
  textLayer?: string[]
  pagePictures?: string[]
  text?: string
  pages?: number
}

export interface FileReading {
  read(asset: Asset): Promise<FileReadingResult>
}
