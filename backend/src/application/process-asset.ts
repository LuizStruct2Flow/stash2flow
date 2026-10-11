import { bestAssetDate, nameInNfc, type Asset, type AssetRecord } from '../domain/asset.ts'
import type { FileReading } from '../ports/file-reading.ts'
import type { Ocr } from '../ports/ocr.ts'

const recordedOnly = new Set(['zip', 'tar', 'gz', 'exe', 'unknown'])
const image = new Set(['jpg', 'jpeg', 'png', 'heic', 'tiff', 'gif'])
const office = new Set(['doc', 'docx', 'odt', 'xls', 'xlsx', 'ods'])

export async function processAsset(input: {
  asset: Asset
  fileReading: FileReading
  ocr: Ocr
  pageLimit: number
  sizeLimit: number
}): Promise<AssetRecord | undefined> {
  const asset = { ...input.asset, name: nameInNfc(input.asset.name) }
  // The record is what the ledger takes: the bytes stay with the stash.
  const record: AssetRecord = { ...asset }
  delete (record as Asset).bytes
  if (asset.size > input.sizeLimit || (asset.pages ?? 0) > input.pageLimit) return undefined
  const ext = asset.ext?.toLowerCase() ?? 'unknown'
  if (recordedOnly.has(ext) || (!image.has(ext) && ext !== 'pdf' && !office.has(ext))) {
    return { ...record, listedForUserAsNotCovered: true }
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
  return { ...record, ...date, ocrText, textLayerUsed }
}
