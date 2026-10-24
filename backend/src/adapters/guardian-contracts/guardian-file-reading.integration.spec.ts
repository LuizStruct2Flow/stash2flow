// The contract of the file-reading port. The same suite runs against the fake
// and against the guardian's real reading, on documents the suite makes itself.
// Where bwrap cannot sandbox, the real reading is not run, and the suite says so.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import type { Asset } from '../../domain/asset.ts'
import { FakeFileReading } from '../../fakes/fake-file-reading.ts'
import type { FileReading, FileReadingResult } from '../../ports/file-reading.ts'
import { GuardianFileReading } from '../guardian/guardian-file-reading.ts'
import { docx, pdfWithTextLayer, pptx, xlsx } from '../guardian/made-up-documents.ts'
import { bwrapRefusal } from '../guardian/sandbox.ts'

const assetOf = (ext: string, bytes?: Uint8Array): Asset => ({
  sourceId: 'source-1',
  sourceAssetId: 'asset-1',
  name: `asset.${ext}`,
  ext,
  size: bytes?.length ?? 0,
  sha256: 'made-up',
  bytes,
})

interface Document {
  title: string
  asset: Asset
  /** What reading it gives; the fake is told so, the real reading finds it out. */
  expected: FileReadingResult
}

const documents: Document[] = [
  {
    title: 'a PDF with a text layer',
    asset: assetOf(
      'pdf',
      pdfWithTextLayer([['Invented lease', 'second line'], ['page two']], {
        modified: '2024-01-31T12:00:00',
      }),
    ),
    expected: {
      pages: 2,
      textLayer: ['Invented lease\nsecond line', 'page two'],
      modificationTime: '2024-01-31T12:00:00Z',
    },
  },
  {
    title: 'a .docx',
    asset: assetOf(
      'docx',
      docx(['Invented minutes', 'Second paragraph'], { modified: '2024-02-01T09:00:00Z' }),
    ),
    expected: {
      text: 'Invented minutes\nSecond paragraph',
      modificationTime: '2024-02-01T09:00:00Z',
    },
  },
  {
    title: 'an .xlsx',
    asset: assetOf(
      'xlsx',
      xlsx([
        ['Item', 'Amount'],
        ['Rent', 850],
        ['Internet', 40],
      ]),
    ),
    expected: { text: 'Item\tAmount\nRent\t850\nInternet\t40' },
  },
  {
    title: 'a .pptx',
    asset: assetOf('pptx', pptx([['Welcome', 'Invented agenda'], ['Closing']])),
    expected: { text: 'Welcome\nInvented agenda\n\nClosing' },
  },
]

interface World {
  reading: FileReading
  /** The fake has to be told what to answer; the real reading answers by itself. */
  shows(expected: FileReadingResult): void
}

async function fileReadingContract(t: TestContext, make: () => World): Promise<void> {
  for (const { title, asset, expected } of documents) {
    await t.test(`reads ${title}`, async () => {
      const world = make()
      world.shows(expected)
      const result = await world.reading.read(asset)
      assert.deepEqual(result, expected)
    })
  }
}

test('file-reading contract: the fake', async (t) => {
  await fileReadingContract(t, () => {
    const reading = new FakeFileReading()
    return { reading, shows: (expected) => (reading.next = expected) }
  })
})

test('file-reading contract: the guardian, in isolation', async (t) => {
  const refusal = await bwrapRefusal()
  // A machine where bwrap cannot sandbox has not proven anything: say so, loudly.
  if (refusal) return t.skip(`${refusal}: the guardian's reading is NOT proven here`)
  await fileReadingContract(t, () => ({ reading: new GuardianFileReading(), shows: () => {} }))
})

test('the guardian: a reading that cannot be done is an error, never an empty result', async (t) => {
  const refusal = await bwrapRefusal()
  if (refusal) return t.skip(`${refusal}: the guardian's reading is NOT proven here`)
  const reading = new GuardianFileReading()
  const garbage = new TextEncoder().encode('this is not a document')

  await t.test('a PDF that is broken', async () => {
    await assert.rejects(reading.read(assetOf('pdf', garbage)), /The reading failed/)
  })
  await t.test('an office document that is not a zip', async () => {
    await assert.rejects(reading.read(assetOf('docx', garbage)), /The reading failed/)
  })
  await t.test('the old .doc and .xls, whose text is not taken out in this slice', async () => {
    await assert.rejects(reading.read(assetOf('doc', garbage)), /"doc" is not read in this slice/)
    await assert.rejects(reading.read(assetOf('xls', garbage)), /"xls" is not read in this slice/)
  })
  await t.test('an asset with no bytes, or with no extension', async () => {
    await assert.rejects(reading.read(assetOf('pdf')), /no bytes/)
    await assert.rejects(
      reading.read({ ...assetOf('pdf', garbage), ext: undefined }),
      /no file extension/,
    )
  })
})

test('the guardian: a reading that hangs or crashes ends as an error at its time limit', async (t) => {
  const refusal = await bwrapRefusal()
  if (refusal) return t.skip(`${refusal}: the guardian's reading is NOT proven here`)
  const directory = await mkdtemp(join(tmpdir(), 'stash2flow-guardian-'))
  try {
    const standIn = async (name: string, source: string) => {
      const path = join(directory, name)
      await writeFile(path, source)
      return new GuardianFileReading({
        readingProcess: path,
        timeoutMs: 1500,
        maxOutputBytes: 1000,
      })
    }
    const bytes = new TextEncoder().encode('x')
    await t.test('hangs', async () => {
      const reading = await standIn('hangs.ts', 'setInterval(() => {}, 1000)\n')
      await assert.rejects(reading.read(assetOf('pdf', bytes)), /did not finish within 1500 ms/)
    })
    await t.test('crashes', async () => {
      const reading = await standIn('crashes.ts', 'process.kill(process.pid, "SIGSEGV")\n')
      await assert.rejects(
        reading.read(assetOf('pdf', bytes)),
        /The reading failed \((exit 139|SIGSEGV)\)/,
      )
    })
    await t.test('gives back what is not data', async () => {
      const reading = await standIn('garbles.ts', 'process.stdout.write("not json")\n')
      await assert.rejects(reading.read(assetOf('pdf', bytes)), /not data/)
    })
    await t.test('gives back too much', async () => {
      const reading = await standIn('floods.ts', 'process.stdout.write("x".repeat(5000))\n')
      await assert.rejects(reading.read(assetOf('pdf', bytes)), /too much/)
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
