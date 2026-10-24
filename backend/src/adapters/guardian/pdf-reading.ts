// The text layer and the page pictures of a PDF, with pdf.js's parsing and
// rendering API and nothing else: no viewer, no scripting manager, no scripting
// sandbox. A script or an action inside the PDF is data that is never looked at.
// The legacy build: the current one needs Promise.try, which node 22 does not have.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '@napi-rs/canvas'
import { fileURLToPath } from 'node:url'

export interface PdfReading {
  pages: number
  /** The text of each page; only when every page has some. */
  textLayer?: string[]
  /** Each page as a PNG, base64, only when the text layer cannot stand for the PDF. */
  pagePictures?: string[]
  modificationTime?: string
}

/** A page is drawn at this resolution, and never beyond this many pixels on a side. */
const DPI = 150
const MAX_SIDE = 3000

const base = (name: string) =>
  fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')).replace('package.json', name)

/** `D:20240131120000+01'00'` as an ISO date-time. */
export function pdfDate(value: string | undefined): string | undefined {
  const m = /^D:(\d{4})(\d\d)?(\d\d)?(\d\d)?(\d\d)?(\d\d)?(?:(Z)|([+-])(\d\d)'?(\d\d)?)?/.exec(
    value ?? '',
  )
  if (!m) return undefined
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', z, sign, oh, om = '00'] = m
  let zone = 'Z'
  if (sign) zone = `${sign}${oh}:${om}`
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${z ?? zone}`
}

export async function readPdf(bytes: Uint8Array): Promise<PdfReading> {
  const task = getDocument({
    data: new Uint8Array(bytes),
    // There is no isEvalSupported in this version: its build has no eval and no new Function.
    enableXfa: false,
    useSystemFonts: false,
    standardFontDataUrl: base('standard_fonts/'),
    cMapUrl: base('cmaps/'),
    wasmUrl: base('wasm/'),
    iccUrl: base('iccs/'),
  })
  try {
    const doc = await task.promise
    const textLayer: string[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      textLayer.push(
        content.items
          .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
          .join('')
          .trim(),
      )
    }
    const { info } = await doc.getMetadata()
    const reading: PdfReading = { pages: doc.numPages }
    const modificationTime = pdfDate((info as Record<string, string | undefined>).ModDate)
    if (modificationTime) reading.modificationTime = modificationTime
    if (textLayer.every((text) => text !== '')) {
      reading.textLayer = textLayer
      return reading
    }
    reading.pagePictures = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const size = page.getViewport({ scale: 1 })
      const scale = Math.min(DPI / 72, MAX_SIDE / Math.max(size.width, size.height))
      const viewport = page.getViewport({ scale })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise
      reading.pagePictures.push(canvas.toBuffer('image/png').toString('base64'))
    }
    return reading
  } finally {
    await task.destroy()
  }
}
