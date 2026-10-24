import { existsSync } from 'node:fs'
import type { Ocr } from '../../ports/ocr.ts'
import { runIsolated } from './sandbox.ts'

const TESSERACT = '/usr/bin/tesseract'
const TESSDATA = '/usr/share/tesseract-ocr/5/tessdata'

/** Why Tesseract cannot be given to the isolation on this machine, or null when it can. */
export function tesseractRefusal(): string | null {
  if (!existsSync(TESSERACT)) return `${TESSERACT} is not installed`
  const missing = ['eng', 'por', 'deu'].filter((l) => !existsSync(`${TESSDATA}/${l}.traineddata`))
  return missing.length ? `Tesseract has no language data for ${missing.join(', ')}` : null
}

export interface GuardianOcrOptions {
  /** A reading that takes longer is ended and fails. */
  timeoutMs?: number
  /** The Tesseract program, given to the isolation. */
  tesseract?: string
  /** Its language data, given to the isolation. */
  tessdata?: string
  /** Tesseract's language codes, joined with "+". */
  languages?: string
}

/**
 * The OCR port with Tesseract, started by the guardian inside the same
 * isolation as every reading: the page picture (a PNG, base64) goes in on
 * standard input, and the program is given nothing but its language data.
 */
export class GuardianOcr implements Ocr {
  private readonly timeoutMs: number
  private readonly tesseract: string
  private readonly tessdata: string
  private readonly languages: string

  constructor(options: GuardianOcrOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.tesseract = options.tesseract ?? TESSERACT
    this.tessdata = options.tessdata ?? TESSDATA
    this.languages = options.languages ?? 'eng+por+deu'
  }

  async read(pagePicture: string): Promise<string> {
    const output = await runIsolated({
      isolation: {
        readOnly: [this.tesseract, this.tessdata],
        env: { TESSDATA_PREFIX: this.tessdata, OMP_THREAD_LIMIT: '1' },
      },
      program: this.tesseract,
      args: ['stdin', 'stdout', '-l', this.languages],
      input: Buffer.from(pagePicture, 'base64'),
      timeoutMs: this.timeoutMs,
      maxOutputBytes: 16 * 1024 * 1024,
    })
    return output.toString('utf8').trim()
  }
}
