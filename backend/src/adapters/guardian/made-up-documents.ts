// Documents the tests of the guardian's reading make for themselves: a PDF with
// a text layer, a PDF that is only a picture of text, and a .docx, .xlsx and
// .pptx, each built here out of invented text. No document from anywhere else.
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { zipSync } from 'fflate'
import { fileURLToPath } from 'node:url'

const utf8 = (text: string) => new TextEncoder().encode(text)
const escapeXml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const escapePdf = (text: string) => text.replace(/[\\()]/g, (c) => '\\' + c)

type Body = string | Uint8Array

/** A PDF from its objects, numbered from 1, with a cross-reference table. */
function pdf(objects: Body[], trailer: string): Uint8Array {
  const parts: Uint8Array[] = [utf8('%PDF-1.7\n')]
  const offsets: number[] = []
  let length = parts[0].length
  const add = (part: Uint8Array) => {
    parts.push(part)
    length += part.length
  }
  objects.forEach((body, i) => {
    offsets.push(length)
    add(utf8(`${i + 1} 0 obj\n`))
    add(typeof body === 'string' ? utf8(body) : body)
    add(utf8('\nendobj\n'))
  })
  const xref = length
  const rows = offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  add(
    utf8(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${rows}` +
        `trailer\n<< /Size ${objects.length + 1} ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  )
  return Buffer.concat(parts)
}

const stream = (dictionary: string, data: Uint8Array): Body =>
  Buffer.concat([
    utf8(`<< ${dictionary} /Length ${data.length} >>\nstream\n`),
    data,
    utf8('\nendstream'),
  ])

export interface PdfOptions {
  /** A JavaScript action the PDF would run when it is opened. */
  script?: string
  /** The modification date, as an ISO date. */
  modified?: string
}

function pdfDate(iso: string): string {
  return `(D:${iso.replaceAll(/[-T:]/g, '').slice(0, 14)}Z)`
}

/** A PDF whose pages carry the given lines as a text layer. */
export function pdfWithTextLayer(pages: string[][], options: PdfOptions = {}): Uint8Array {
  const kids = pages.map((_, i) => `${5 + 2 * i} 0 R`).join(' ')
  const action = options.script
    ? ' /OpenAction << /S /JavaScript /JS (' + escapePdf(options.script) + ') >>'
    : ''
  const objects: Body[] = [
    `<< /Type /Catalog /Pages 2 0 R${action} >>`,
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Title (Made-up document)${options.modified ? ` /ModDate ${pdfDate(options.modified)}` : ''} >>`,
  ]
  pages.forEach((lines, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`,
      stream(
        '',
        utf8(
          'BT /F1 18 Tf 72 720 Td 24 TL ' +
            lines.map((line) => `(${escapePdf(line)}) Tj T*`).join(' ') +
            ' ET',
        ),
      ),
    )
  })
  return pdf(objects, '/Root 1 0 R /Info 4 0 R')
}

let fontsRegistered = false
function canvasOfText(lines: string[]) {
  if (!fontsRegistered) {
    const fonts = fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')).replace(
      'package.json',
      'standard_fonts/LiberationSans-Regular.ttf',
    )
    GlobalFonts.registerFromPath(fonts, 'Made Up Sans')
    fontsRegistered = true
  }
  const canvas = createCanvas(1400, 120 + 90 * lines.length)
  const context = canvas.getContext('2d')
  context.fillStyle = 'white'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = 'black'
  context.font = '56px "Made Up Sans"'
  lines.forEach((line, i) => context.fillText(line, 60, 100 + 90 * i))
  return canvas
}

/** A PDF whose pages are only a picture of the given lines: it has no text layer. */
export function pdfOfPictures(pages: string[][]): Uint8Array {
  const kids = pages.map((_, i) => `${4 + 3 * i} 0 R`).join(' ')
  const objects: Body[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    '<< /Producer (made up) >>',
  ]
  pages.forEach((lines, i) => {
    const picture = canvasOfText(lines).toBuffer('image/jpeg')
    const height = 120 + 90 * lines.length
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 ${height / 2}] /Resources << /XObject << /Im1 ${5 + 3 * i} 0 R >> >> /Contents ${6 + 3 * i} 0 R >>`,
      stream(
        '/Type /XObject /Subtype /Image /Width 1400 /Height ' +
          height +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode',
        picture,
      ),
      stream('', utf8(`q 700 0 0 ${height / 2} 0 0 cm /Im1 Do Q`)),
    )
  })
  return pdf(objects, '/Root 1 0 R /Info 3 0 R')
}

/** The picture of a page of text, as the guardian hands it on: a PNG, base64. */
export function pagePictureOf(lines: string[]): string {
  return canvasOfText(lines).toBuffer('image/png').toString('base64')
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'

function core(modified?: string): Record<string, Uint8Array> {
  return modified
    ? {
        'docProps/core.xml': utf8(
          `<cp:coreProperties xmlns:cp="x" xmlns:dcterms="y"><dcterms:modified xsi:type="dcterms:W3CDTF">${modified}</dcterms:modified></cp:coreProperties>`,
        ),
      }
    : {}
}

export interface OfficeOptions {
  modified?: string
  /** Entries a macro-enabled document carries besides its text, such as vbaProject.bin. */
  extra?: Record<string, Uint8Array>
}

export function docx(paragraphs: string[], options: OfficeOptions = {}): Uint8Array {
  const body = paragraphs
    .map((p) => `<w:p><w:pPr/><w:r><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r></w:p>`)
    .join('')
  return zipSync({
    '[Content_Types].xml': utf8(CONTENT_TYPES),
    'word/document.xml': utf8(
      `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`,
    ),
    ...core(options.modified),
    ...options.extra,
  })
}

/** Rows of cells; a cell that is a string goes to the shared strings, a number stays a number. */
export function xlsx(rows: (string | number)[][], options: OfficeOptions = {}): Uint8Array {
  const strings: string[] = []
  const sheet = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">` +
        row
          .map((cell, c) => {
            const ref = `${String.fromCodePoint(65 + c)}${r + 1}`
            if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`
            strings.push(cell)
            return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`
          })
          .join('') +
        '</row>',
    )
    .join('')
  return zipSync({
    '[Content_Types].xml': utf8(CONTENT_TYPES),
    'xl/sharedStrings.xml': utf8(
      `<sst xmlns="x">${strings.map((s) => `<si><t>${escapeXml(s)}</t></si>`).join('')}</sst>`,
    ),
    'xl/worksheets/sheet1.xml': utf8(
      `<worksheet xmlns="x"><sheetData>${sheet}</sheetData></worksheet>`,
    ),
    ...core(options.modified),
    ...options.extra,
  })
}

/** Slides of paragraphs. */
export function pptx(slides: string[][], options: OfficeOptions = {}): Uint8Array {
  const entries: Record<string, Uint8Array> = { '[Content_Types].xml': utf8(CONTENT_TYPES) }
  slides.forEach((paragraphs, i) => {
    const body = paragraphs
      .map((p) => `<a:p><a:r><a:rPr/><a:t>${escapeXml(p)}</a:t></a:r></a:p>`)
      .join('')
    entries[`ppt/slides/slide${i + 1}.xml`] = utf8(
      `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    )
  })
  return zipSync({ ...entries, ...core(options.modified), ...options.extra })
}
