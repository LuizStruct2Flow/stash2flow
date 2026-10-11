export interface Asset {
  sourceId: string
  sourceAssetId: string
  name: string
  size: number
  sha256: string
  bytes?: Uint8Array
  ext?: string
  pages?: number
  sourceLink?: string
  ocrText?: string[]
  textLayerUsed?: boolean
  /** Plain description until the app has a word for this state. */
  listedForUserAsNotCovered?: true
  assetDate?: string
  assetDateSource?: string
}

export interface AssetDates {
  dateTaken?: string
  modificationTime?: string
}

export function nameInNfc(name: string): string {
  return name.normalize('NFC')
}

function plainText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function distance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    let previous = row[0]
    row[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const current = row[rightIndex]
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        previous + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
      previous = current
    }
  }
  return row[right.length]
}

export function textMatches(text: string, words: string): boolean {
  const queryWords = plainText(words).split(/\s+/).filter(Boolean)
  const textWords = plainText(text).split(/\s+/).filter(Boolean)
  return queryWords.every((query) =>
    textWords.some((word) => word.includes(query) || distance(word, query) <= 1),
  )
}

export function bestAssetDate(
  dates: AssetDates,
): { assetDate: string; assetDateSource: string } | undefined {
  if (dates.dateTaken) return { assetDate: dates.dateTaken, assetDateSource: "photo's own data" }
  if (dates.modificationTime)
    return { assetDate: dates.modificationTime, assetDateSource: 'modification time' }
  return undefined
}
