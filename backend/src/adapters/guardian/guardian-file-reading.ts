import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Asset } from '../../domain/asset.ts'
import type { FileReading, FileReadingResult } from '../../ports/file-reading.ts'
import { runIsolated } from './sandbox.ts'

const BACKEND = fileURLToPath(new URL('../../../', import.meta.url))
const HERE = fileURLToPath(new URL('./', import.meta.url))
const READING_PROCESS = fileURLToPath(new URL('./reading-process.ts', import.meta.url))

export interface GuardianFileReadingOptions {
  /** A reading that takes longer is ended and fails. */
  timeoutMs?: number
  /** More data than this coming back ends the reading as an error. */
  maxOutputBytes?: number
  /** The program that reads, for a test to replace: it is given to the isolation too. */
  readingProcess?: string
}

/**
 * The file-reading port, as the guardian does it: each asset is read by a
 * process of its own under Bubblewrap (see sandbox.ts), which is given node,
 * this folder and the three reading libraries, and the bytes of the one asset
 * on its standard input. Nothing else exists in there. What comes back is
 * data; a reading that fails, hangs or crashes is an error.
 */
export class GuardianFileReading implements FileReading {
  private readonly timeoutMs: number
  private readonly maxOutputBytes: number
  private readonly readingProcess: string

  constructor(options: GuardianFileReadingOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 60_000
    this.maxOutputBytes = options.maxOutputBytes ?? 256 * 1024 * 1024
    this.readingProcess = options.readingProcess ?? READING_PROCESS
  }

  async read(asset: Asset): Promise<FileReadingResult> {
    if (!asset.bytes) throw new Error(`The asset ${asset.name} has no bytes to read.`)
    if (!asset.ext) throw new Error(`The asset ${asset.name} has no file extension to read by.`)
    const output = await runIsolated({
      isolation: {
        readOnly: [
          process.execPath,
          `${BACKEND}package.json`,
          HERE,
          `${BACKEND}node_modules/pdfjs-dist`,
          `${BACKEND}node_modules/@napi-rs`,
          `${BACKEND}node_modules/fflate`,
          // A stand-in for the reading (a test's) is given along with its folder.
          ...(this.readingProcess.startsWith(HERE) ? [] : [dirname(this.readingProcess)]),
        ],
        // The canvas library looks up a home directory, which does not exist in there.
        env: { HOME: '/tmp' },
      },
      program: process.execPath,
      args: [this.readingProcess, asset.ext],
      input: asset.bytes,
      timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
    })
    try {
      return JSON.parse(output.toString('utf8')) as FileReadingResult
    } catch {
      // The syntax error says nothing a caller can use: name what happened instead.
      throw new Error(`The reading of ${asset.name} gave back something that is not data.`)
    }
  }
}
