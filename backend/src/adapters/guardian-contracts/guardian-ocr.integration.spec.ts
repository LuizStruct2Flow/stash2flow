// The contract of the OCR port, and of a PDF without a text layer going through
// the file-reading port and then the OCR port. The same suite runs against the
// fakes and against the guardian's real adapters, on pictures made here.
// Where bwrap cannot sandbox, or Tesseract is missing, the real ones are not
// run, and the suite says so.
import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import type { Asset } from '../../domain/asset.ts'
import { FakeFileReading } from '../../fakes/fake-file-reading.ts'
import { FakeOcr } from '../../fakes/fake-ocr.ts'
import type { FileReading } from '../../ports/file-reading.ts'
import type { Ocr } from '../../ports/ocr.ts'
import { GuardianFileReading } from '../guardian/guardian-file-reading.ts'
import { GuardianOcr, tesseractRefusal } from '../guardian/guardian-ocr.ts'
import { pagePictureOf, pdfOfPictures } from '../guardian/made-up-documents.ts'
import { bwrapRefusal } from '../guardian/sandbox.ts'

const squash = (text: string) => text.replaceAll(/\s+/g, ' ').trim()

interface World {
  ocr: Ocr
  reading: FileReading
  /** The fake has to be told what a picture says; Tesseract reads it by itself. */
  says(picture: string, text: string): void
  /** The fake has to be told what the pages of a PDF are; the real reading renders them. */
  rendersPages(count: number): void
}

const pages = [
  ['Invoice 4711 for the rent', 'Rechnung Nummer 99'],
  ['Second page of the lease', 'Page two of two'],
]

async function ocrContract(t: TestContext, make: () => World): Promise<void> {
  await t.test('gives the text of a page picture', async () => {
    const world = make()
    const picture = pagePictureOf(pages[0])
    world.says(picture, pages[0].join('\n'))
    assert.equal(squash(await world.ocr.read(picture)), squash(pages[0].join(' ')))
  })

  await t.test(
    'reads the pages of a PDF without a text layer, one text for each page',
    async () => {
      const world = make()
      world.rendersPages(pages.length)
      const bytes = pdfOfPictures(pages)
      const asset: Asset = {
        sourceId: 'source-1',
        sourceAssetId: 'asset-1',
        name: 'scan.pdf',
        ext: 'pdf',
        size: bytes.length,
        sha256: 'made-up',
        bytes,
      }
      const read = await world.reading.read(asset)
      assert.equal(read.textLayer, undefined)
      assert.equal(read.pagePictures?.length, pages.length)
      pages.forEach((lines, i) => world.says(read.pagePictures![i], lines.join('\n')))
      const texts = await Promise.all(read.pagePictures!.map((picture) => world.ocr.read(picture)))
      assert.deepEqual(
        texts.map(squash),
        pages.map((lines) => lines.join(' ')),
      )
    },
  )
}

test('OCR contract: the fakes', async (t) => {
  await ocrContract(t, () => {
    const ocr = new FakeOcr()
    const reading = new FakeFileReading()
    return {
      ocr,
      reading,
      says: (picture, text) => ocr.textByPage.set(picture, text),
      rendersPages: (count) => {
        reading.next = {
          pages: count,
          pagePictures: Array.from({ length: count }, (_, i) => `picture-${i + 1}`),
        }
      },
    }
  })
})

test('OCR contract: the guardian, in isolation', async (t) => {
  const refusal = (await bwrapRefusal()) ?? tesseractRefusal()
  // A machine without the isolation or without Tesseract has not proven anything: say so, loudly.
  if (refusal) return t.skip(`${refusal}: the guardian's OCR is NOT proven here`)
  await ocrContract(t, () => ({
    ocr: new GuardianOcr(),
    reading: new GuardianFileReading(),
    says: () => {},
    rendersPages: () => {},
  }))
})

test('the guardian: OCR of what is not a picture is an error, a blank page is an empty text', async (t) => {
  const refusal = (await bwrapRefusal()) ?? tesseractRefusal()
  if (refusal) return t.skip(`${refusal}: the guardian's OCR is NOT proven here`)
  const ocr = new GuardianOcr()
  await assert.rejects(ocr.read(Buffer.from('not a picture').toString('base64')), /failed/)
  assert.equal(await ocr.read(pagePictureOf([])), '')
})
