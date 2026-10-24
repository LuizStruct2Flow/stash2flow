import assert from 'node:assert/strict'
import test from 'node:test'
import { unzipSync, zipSync } from 'fflate'
import { decode, officeText } from './office-text.ts'

const utf8 = (text: string) => new TextEncoder().encode(text)

test('decode reads the five entities and numeric references, and expands nothing else', () => {
  assert.equal(decode('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;'), `a & b <c> "d" 'e'`)
  assert.equal(decode('&#233; &#xE9; &#x1F600;'), 'é é \u{1F600}')
  assert.equal(decode('&unknown; &#0; &#x110000;'), '&unknown; &#0; &#x110000;')
  assert.equal(decode('&amp;lt;'), '&lt;')
})

test('a word-processor document gives one line per paragraph, with tabs and breaks kept', () => {
  const body =
    '<w:p><w:r><w:t>First</w:t></w:r><w:r><w:t xml:space="preserve"> line</w:t></w:r></w:p>' +
    '<w:p><w:pPr/><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C &amp; D</w:t></w:r></w:p>'
  const bytes = zipSync({
    'word/document.xml': utf8(`<w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`),
  })
  assert.deepEqual(officeText('docx', bytes), { text: 'First line\nA\tB\nC & D' })
  assert.equal(officeText('DOCM', bytes).text, 'First line\nA\tB\nC & D')
})

test('a word-processor document without a body is an error, not an empty text', () => {
  assert.throws(() => officeText('docx', zipSync({ 'word/styles.xml': utf8('<x/>') })), /no body/)
})

test('the modification time is the one the document says', () => {
  const bytes = zipSync({
    'word/document.xml': utf8('<w:document xmlns:w="w"/>'),
    'docProps/core.xml': utf8(
      '<cp:coreProperties><dcterms:modified xsi:type="dcterms:W3CDTF">2024-02-03T04:05:06Z</dcterms:modified></cp:coreProperties>',
    ),
  })
  assert.equal(officeText('docx', bytes).modificationTime, '2024-02-03T04:05:06Z')
})

test('a spreadsheet gives its sheets in order, one line per row, cells apart by a tab', () => {
  const sheet = (rows: string) => utf8(`<worksheet><sheetData>${rows}</sheetData></worksheet>`)
  const bytes = zipSync({
    'xl/sharedStrings.xml': utf8(
      '<sst><si><t>Rent</t></si>' +
        '<si><r><t>Rich </t></r><r><t>text</t></r><rPh sb="0"><t>HINT</t></rPh></si></sst>',
    ),
    'xl/worksheets/sheet10.xml': sheet(
      '<row><c r="A1" t="inlineStr"><is><t>Tenth</t></is></c></row>',
    ),
    'xl/worksheets/sheet2.xml': sheet(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>850</v></c><c r="C1"/></row>' +
        '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="str"><v>a &amp; b</v></c></row>' +
        '<row r="3"><c r="A3"/></row>',
    ),
  })
  assert.equal(officeText('xlsx', bytes).text, 'Rent\t850\nRich text\ta & b\n\nTenth')
})

test('a presentation gives its slides in order, a paragraph to a line, a blank line between slides', () => {
  const slide = (paragraphs: string) =>
    utf8(`<p:sld xmlns:p="p" xmlns:a="a"><p:txBody>${paragraphs}</p:txBody></p:sld>`)
  const bytes = zipSync({
    'ppt/slides/slide10.xml': slide('<a:p><a:r><a:t>Tenth</a:t></a:r></a:p>'),
    'ppt/slides/slide2.xml': slide(
      '<a:p><a:r><a:t>Two</a:t></a:r><a:br/><a:r><a:t>still two</a:t></a:r></a:p><a:p><a:r><a:t>Next</a:t></a:r></a:p>',
    ),
  })
  assert.equal(officeText('pptx', bytes).text, 'Two\nstill two\nNext\n\nTenth')
})

test('an entry that is not the text is never unpacked: a macro is not even inflated', () => {
  // The macro's compressed bytes are broken on purpose: inflating them fails.
  const macro = utf8('Sub AutoOpen()\n'.repeat(100))
  const bytes = zipSync({
    'word/document.xml': utf8(
      '<w:document xmlns:w="w"><w:p><w:r><w:t>Text</w:t></w:r></w:p></w:document>',
    ),
    'word/vbaProject.bin': macro,
  })
  const at = Buffer.from(bytes).indexOf('word/vbaProject.bin') + 'word/vbaProject.bin'.length
  bytes.fill(0xff, at, at + 4)
  assert.throws(() => unzipSync(bytes), 'the control: unpacking everything does fail')
  assert.equal(officeText('docx', bytes).text, 'Text')
})

test('an entry that unpacks to more than 64 MiB is refused', () => {
  const bytes = zipSync({
    'word/document.xml': utf8('<w:document xmlns:w="w"/>'),
    'word/media/huge.bin': new Uint8Array(65 * 1024 * 1024),
  })
  assert.throws(() => officeText('docx', bytes), /too big/)
})

test('a file that is not a zip, and a type that is not read, are errors', () => {
  assert.throws(() => officeText('docx', utf8('not a zip file')))
  assert.throws(() => officeText('doc', utf8('x')), /"doc" is not read/)
  assert.throws(() => officeText('xls', utf8('x')), /"xls" is not read/)
})
