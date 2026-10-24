// The text of an office document, taken out of its XML by a small piece of our
// own: .docx, .xlsx and .pptx (and their macro-enabled twins) are zip files of
// XML. Only the entries named below are unpacked, so a macro (vbaProject.bin),
// an embedded object or a picture is never even decompressed, let alone run.
import { unzipSync } from 'fflate'

export interface OfficeText {
  text: string
  /** The document's own modification time, when it says one. */
  modificationTime?: string
}

/** An entry that unpacks to more than this is refused: a zip bomb. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024

const KINDS: Record<string, 'word' | 'sheet' | 'slides'> = {
  docx: 'word',
  docm: 'word',
  xlsx: 'sheet',
  xlsm: 'sheet',
  pptx: 'slides',
  pptm: 'slides',
}

export const officeExts = Object.keys(KINDS)

const WANTED = {
  word: /^word\/document\.xml$/,
  sheet: /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/,
  slides: /^ppt\/slides\/slide\d+\.xml$/,
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** The five XML entities and numeric references; no entity is ever defined or expanded. */
export function decode(xml: string): string {
  return xml.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,4});/gi, (whole, name: string) => {
    if (name[0] !== '#') return ENTITIES[name] ?? whole
    const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

/** The text of every `<tag>` run in the XML, in order. */
function runs(xml: string, tag: string): string {
  const out: string[] = []
  for (const m of xml.matchAll(new RegExp(`<${tag}(?: [^>]*)?>([^<]*)</${tag}>`, 'g')))
    out.push(decode(m[1]))
  return out.join('')
}

/**
 * One line per paragraph (`<w:p>` or `<a:p>`); a tab or a line break inside a
 * paragraph is kept, as a run of its own.
 */
function paragraphs(xml: string, ns: 'w' | 'a'): string {
  const lines: string[] = []
  for (const p of xml.matchAll(/<([wa]):p(?: [^>]*)?>([\s\S]*?)<\/\1:p>/g)) {
    if (p[1] !== ns) continue
    const inline = p[2]
      .replace(/<([wa]):tab\b[^>]*\/>/g, '<$1:t>\t</$1:t>')
      .replace(/<([wa]):br\b[^>]*\/>/g, '<$1:t>\n</$1:t>')
    lines.push(runs(inline, `${ns}:t`))
  }
  return lines.join('\n')
}

/** The strings of xl/sharedStrings.xml: an `<si>` is one string, of its plain and rich runs. */
function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si(?: [^>]*)?>([\s\S]*?)<\/si>/g)].map((si) =>
    // Phonetic hints (<rPh>) are not part of the text.
    runs(si[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''), 't'),
  )
}

function sheetText(xml: string, strings: string[]): string {
  const rows: string[] = []
  for (const row of xml.matchAll(/<row(?: [^>]*)?>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = []
    for (const c of row[1].matchAll(/<c((?: [^>]*)?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const kind = /\bt="(\w+)"/.exec(c[1])?.[1]
      const body = c[2] ?? ''
      const value = /<v>([^<]*)<\/v>/.exec(body)?.[1]
      let text = ''
      if (kind === 's') text = strings[Number(value)] ?? ''
      else if (kind === 'inlineStr') text = runs(body, 't')
      else if (value !== undefined) text = decode(value)
      if (text !== '') cells.push(text)
    }
    if (cells.length) rows.push(cells.join('\t'))
  }
  return rows.join('\n')
}

const byNumber = (a: string, b: string) =>
  Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1])

/** The text of an office document given as its bytes, or an error naming why it cannot be read. */
export function officeText(ext: string, bytes: Uint8Array): OfficeText {
  const kind = KINDS[ext.toLowerCase()]
  if (!kind) throw new Error(`An office document of type "${ext}" is not read.`)
  const wanted = WANTED[kind]
  const entries = unzipSync(bytes, {
    filter: (file) => {
      if (file.originalSize > MAX_ENTRY_BYTES) throw new Error(`The entry ${file.name} is too big.`)
      return wanted.test(file.name) || file.name === 'docProps/core.xml'
    },
  })
  const part = (name: string) => (entries[name] ? new TextDecoder().decode(entries[name]) : '')
  const names = Object.keys(entries).filter((name) => wanted.test(name))
  let text: string
  if (kind === 'word') {
    if (!entries['word/document.xml']) throw new Error('The document has no body.')
    text = paragraphs(part('word/document.xml'), 'w')
  } else if (kind === 'slides') {
    text = names
      .toSorted(byNumber)
      .map((name) => paragraphs(part(name), 'a'))
      .join('\n\n')
  } else {
    const strings = sharedStrings(part('xl/sharedStrings.xml'))
    const sheets = names.filter((name) => name.startsWith('xl/worksheets/')).toSorted(byNumber)
    text = sheets.map((name) => sheetText(part(name), strings)).join('\n\n')
  }
  const modified = /<dcterms:modified(?: [^>]*)?>([^<]+)<\/dcterms:modified>/.exec(
    part('docProps/core.xml'),
  )?.[1]
  return { text, ...(modified ? { modificationTime: modified } : {}) }
}
