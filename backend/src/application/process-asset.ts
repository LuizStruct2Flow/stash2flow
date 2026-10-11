import { bestAssetDate, nameInNfc, type Asset } from '../domain/asset.ts'
import type { FileReading } from '../ports/file-reading.ts'
import type { Index } from '../ports/index.ts'
import type { Ocr } from '../ports/ocr.ts'

const recordedOnly = new Set(['zip', 'tar', 'gz', 'exe', 'unknown'])
const image = new Set(['jpg', 'jpeg', 'png', 'heic', 'tiff', 'gif'])
const office = new Set(['doc', 'docx', 'odt', 'xls', 'xlsx', 'ods'])

export async function processAsset(input: {
  asset: Asset
  fileReading: FileReading
  ocr: Ocr
  index: Index
  pageLimit: number
  sizeLimit: number
}): Promise<void> {
  const asset = { ...input.asset, name: nameInNfc(input.asset.name) }
  if (asset.size > input.sizeLimit || (asset.pages ?? 0) > input.pageLimit) return
  const ext = asset.ext?.toLowerCase() ?? 'unknown'
  if (recordedOnly.has(ext) || (!image.has(ext) && ext !== 'pdf' && !office.has(ext))) {
    await input.index.keepAsset({ ...asset, listedForUserAsNotCovered: true })
    return
  }
  const read = await input.fileReading.read(asset)
  const date = bestAssetDate(read)
  let ocrText: string[] | undefined
  let textLayerUsed = false
  if (ext === 'pdf' && read.textLayer?.length) {
    ocrText = read.textLayer
    textLayerUsed = true
  } else if (ext === 'pdf' || image.has(ext)) {
    ocrText = await Promise.all((read.pagePictures ?? []).map((page) => input.ocr.read(page)))
  } else if (office.has(ext)) {
    ocrText = read.text ? [read.text] : []
  }
  await input.index.keepAsset({ ...asset, ...date, ocrText, textLayerUsed })
}
