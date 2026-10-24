// The guardian's reading on the server, with the real adapters: each asset is
// read in a process of its own under Bubblewrap, and OCR is Tesseract started
// in the same isolation. Real adapters are allowed in an integration step file
// only (docs/concept/architecture.md#dependency-rule).
//
// Each "not run" and "not reached" claim carries a control. The isolation hides
// what a reading did, so the claim is shown twice: the same reading run plainly
// (outside the isolation) and the trace it would leave looked for, and the trace
// shown to be real by leaving it deliberately.
import { After, Given, Then, When, setDefaultTimeout } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo, type Server } from 'node:net'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { GuardianFileReading } from '../../src/adapters/guardian/guardian-file-reading.ts'
import { GuardianOcr, tesseractRefusal } from '../../src/adapters/guardian/guardian-ocr.ts'
import {
  docx,
  pdfOfPictures,
  pdfWithTextLayer,
} from '../../src/adapters/guardian/made-up-documents.ts'
import { bwrapRefusal } from '../../src/adapters/guardian/sandbox.ts'
import type { Asset } from '../../src/domain/asset.ts'
import type { FileReadingResult } from '../../src/ports/file-reading.ts'
import type { Probe } from '../support/isolation.ts'
import { readPlainly, runProgram, runScript } from '../support/plain-run.ts'
import { resetSlice2, slice2 } from './slice-2.ts'

// Reading a page costs a process, a render and Tesseract: more than a step's default 5 s.
setDefaultTimeout(60_000)

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const READING_PROCESS = fileURLToPath(
  new URL('../../src/adapters/guardian/reading-process.ts', import.meta.url),
)
const ESCAPE_ATTEMPT = fileURLToPath(new URL('../support/escape-attempt.ts', import.meta.url))
const utf8 = (text: string) => new TextEncoder().encode(text)
const squash = (text: string) => text.replaceAll(/\s+/g, ' ').trim()

interface Guardian {
  asset?: Asset
  /** A stand-in for the reading library, when the scenario needs one. */
  readingProcess?: string
  result?: FileReadingResult
  error?: Error
  scratch?: string
  /** What an engine that ran the script or the macro would have written. */
  marker?: string
  /** The script or the macro, as the document carries it. */
  trace?: string
  listener?: Server
  /** What the stand-in is told to try. */
  instruction?: { port: number; host: string; tokens: string }
}
let guardian: Guardian = {}

After(() => {
  guardian.listener?.close()
  if (guardian.scratch) rmSync(guardian.scratch, { recursive: true, force: true })
  guardian = {}
  slice2.readers = undefined
})

/** The isolation is what these scenarios are about: where it is missing they fail, saying so. */
async function requireIsolation(withTesseract = false): Promise<void> {
  const refusal = (await bwrapRefusal()) ?? (withTesseract ? tesseractRefusal() : null)
  if (refusal) throw new Error(`${refusal}: the isolation is NOT proven here.`)
}

function assetOf(ext: string, bytes: Uint8Array): Asset {
  return {
    sourceId: 'source-1',
    sourceAssetId: 'asset-1',
    name: `asset.${ext}`,
    ext,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes,
  }
}

function scratchDir(): string {
  mkdirSync(join(REPO, '.scratch'), { recursive: true })
  guardian.scratch = mkdtempSync(join(REPO, '.scratch', 'guardian-'))
  return guardian.scratch
}

/** The reading process run plainly, outside the isolation: what it would do without it. */
const readAssetPlainly = (program: string, asset: Asset) =>
  readPlainly(program, asset.ext ?? '', asset.bytes ?? new Uint8Array())

async function readInGuardian(): Promise<void> {
  await requireIsolation()
  if (!guardian.asset) throw new Error('There is no asset to read.')
  const reading = new GuardianFileReading({
    readingProcess: guardian.readingProcess,
    timeoutMs: 30_000,
  })
  try {
    guardian.result = await reading.read(guardian.asset)
  } catch (e) {
    guardian.error = e as Error
  }
}

// --- an asset from the user's own drives -----------------------------------

const PAGES = [
  ['Invoice 4711 for the rent', 'Rechnung Nummer 99'],
  ['Second page of the lease', 'Page two of two'],
]

Given("an asset from a source that is one of the user's own drives", async () => {
  await requireIsolation(true)
  resetSlice2()
  // A PDF that is only pictures of two pages: it takes the whole path, the
  // reading, the rendering of each page and Tesseract, each in the isolation.
  slice2.assets = [assetOf('pdf', pdfOfPictures(PAGES))]
  slice2.readers = { fileReading: new GuardianFileReading(), ocr: new GuardianOcr() }
})

Then('the guardian reads the asset fully', async () => {
  const [record] = await slice2.index.assets()
  assert.equal(record?.textLayerUsed, false)
  assert.deepEqual(
    record?.ocrText?.map(squash),
    PAGES.map((lines) => lines.join(' ')),
  )
})

// --- a script inside a PDF ---------------------------------------------------

/** JavaScript that, run by any engine, prints a canary and writes the marker. */
const scriptWriting = (marker: string) =>
  `process.stdout.write("SCRIPT-RAN");` +
  `process.getBuiltinModule("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`

Given('a PDF that carries a script', () => {
  guardian.marker = join(scratchDir(), 'script-ran')
  guardian.trace = scriptWriting(guardian.marker)
  guardian.asset = assetOf(
    'pdf',
    pdfWithTextLayer([['Invented lease text']], { script: guardian.trace }),
  )
})

When('the guardian reads the asset', readInGuardian)

Then('the script is not run', async () => {
  assert.ok(guardian.asset && guardian.marker && guardian.trace)
  assert.equal(guardian.error, undefined)
  assert.deepEqual(guardian.result?.textLayer, ['Invented lease text'])
  // The same reading without the isolation: it gives its data and nothing else,
  // and leaves no trace of the script.
  const plain = await readAssetPlainly(READING_PROCESS, guardian.asset)
  assert.deepEqual(JSON.parse(plain).textLayer, ['Invented lease text'])
  assert.equal(existsSync(guardian.marker), false)
  // The trace is real: an engine that ran the script would have left it.
  assert.equal(await runScript(guardian.trace), 'SCRIPT-RAN')
  assert.equal(existsSync(guardian.marker), true)
})

// --- a macro in an office document -------------------------------------------

const PARAGRAPHS = ['Invented minutes of a meeting', 'Second paragraph of the minutes']

Given('an office document that carries a macro', () => {
  guardian.marker = join(scratchDir(), 'macro-ran')
  // Not a real macro: a shell script under the name of one, whose running writes the marker.
  guardian.trace = `#!/bin/sh\necho ran > ${guardian.marker}\n`
  guardian.asset = assetOf(
    'docm',
    docx(PARAGRAPHS, { extra: { 'word/vbaProject.bin': utf8(guardian.trace) } }),
  )
})

Then('the macro is not run', async () => {
  assert.ok(guardian.asset?.bytes && guardian.marker && guardian.scratch)
  assert.equal(guardian.error, undefined)
  const plain = await readAssetPlainly(READING_PROCESS, guardian.asset)
  assert.equal(JSON.parse(plain).text, PARAGRAPHS.join('\n'))
  assert.equal(existsSync(guardian.marker), false)
  // The trace is real: the macro, taken out of the document and run, would have left it.
  const macro = join(guardian.scratch, 'vbaProject.bin')
  writeFileSync(macro, unzipSync(guardian.asset.bytes)['word/vbaProject.bin'])
  await runProgram(macro)
  assert.equal(existsSync(guardian.marker), true)
})

Then('the text of the asset is still taken out', () => {
  assert.equal(guardian.error, undefined)
  assert.equal(guardian.result?.text, PARAGRAPHS.join('\n'))
})

// --- a reading that tries to reach what it must not --------------------------

/** An address of this machine that is not loopback, when it has one. */
const lan = () =>
  Object.values(networkInterfaces())
    .flat()
    .find((i) => i?.family === 'IPv4' && !i.internal)?.address ?? '127.0.0.1'

/** A listener on every address of this machine, and a file standing in for the token store. */
async function breakingAsset(): Promise<void> {
  const listener = createServer()
  await new Promise<void>((resolve) => listener.listen(0, '0.0.0.0', resolve))
  guardian.listener = listener
  const tokens = join(scratchDir(), 'tokens')
  writeFileSync(tokens, 'made-up token store\n')
  guardian.instruction = { port: (listener.address() as AddressInfo).port, host: lan(), tokens }
  guardian.readingProcess = ESCAPE_ATTEMPT
  guardian.asset = assetOf('pdf', utf8(JSON.stringify(guardian.instruction)))
}

/** What the reading reached with the isolation, and what it reaches without it. */
async function reached(): Promise<{ isolated: Probe; plain: Probe }> {
  assert.equal(guardian.error, undefined)
  assert.ok(guardian.asset && guardian.result?.text)
  const plain = JSON.parse(await readAssetPlainly(ESCAPE_ATTEMPT, guardian.asset)) as {
    text: string
  }
  return { isolated: JSON.parse(guardian.result.text), plain: JSON.parse(plain.text) }
}

Given('an asset that makes the reading try to reach the network', breakingAsset)

Then('the guardian does not reach the network', async () => {
  const { isolated, plain } = await reached()
  assert.equal(plain.network, 'reached')
  assert.equal(isolated.network, 'ENETUNREACH')
})

Given(
  'an asset that makes the reading try to reach the credentials for the sources and the database',
  breakingAsset,
)

Then('the guardian reaches neither the credentials for the sources nor the database', async () => {
  const { isolated, plain } = await reached()
  assert.equal(plain.tokens, 'reached')
  assert.equal(plain.database, 'reached')
  assert.equal(isolated.tokens, 'ENOENT')
  assert.equal(isolated.database, 'ECONNREFUSED')
})
