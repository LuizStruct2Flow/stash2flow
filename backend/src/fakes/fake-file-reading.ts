import type { Asset } from '../domain/asset.ts'
import type { FileReading, FileReadingResult } from '../ports/file-reading.ts'

export class FakeFileReading implements FileReading {
  next: FileReadingResult = {}
  assets: Asset[] = []
  async read(asset: Asset): Promise<FileReadingResult> {
    this.assets.push(structuredClone(asset))
    return structuredClone(this.next)
  }
}
