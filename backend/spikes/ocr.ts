// Spike 3: OCR text from made-up scanned pages, two candidates callable from TypeScript.
// Run: node backend/spikes/ocr.ts   (after node backend/spikes/fixtures.ts)
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { CACHE, FIXTURES, LANGS, type Lang, charAccuracy, ollamaPost, timed } from './lib.ts'

const run = promisify(execFile)

async function tesseract(png: string, lang: Lang): Promise<string> {
  const { stdout } = await run('tesseract', [png, 'stdout', '-l', lang], {
    env: { ...process.env, TESSDATA_PREFIX: join(CACHE, 'tessdata') },
  })
  return stdout
}

async function vision(png: string): Promise<string> {
  // ponytail: page downscaled to 1024 px wide so the vision model's image token count stays small.
  const img = await sharp(png).resize(1024).jpeg({ quality: 90 }).toBuffer()
  const res = await ollamaPost('/api/chat', {
    model: 'qwen2.5vl:7b',
    stream: false,
    options: { temperature: 0 },
    messages: [
      {
        role: 'user',
        content:
          'Transcribe all the text on this page exactly as written. Output only the text, nothing else.',
        images: [img.toString('base64')],
      },
    ],
  })
  return (res.message as { content: string }).content
}

const candidates: Record<string, (png: string, lang: Lang) => Promise<string>> = {
  tesseract: tesseract,
  'qwen2.5vl:7b': (png) => vision(png),
}

for (const [name, fn] of Object.entries(candidates)) {
  let pages = 0
  let seconds = 0
  for (const lang of LANGS) {
    const accs: number[] = []
    for (const i of [0, 1]) {
      const png = join(FIXTURES, `page-${lang}-${i}.png`)
      const truth = readFileSync(join(FIXTURES, `page-${lang}-${i}.txt`), 'utf8')
      const { value, seconds: s } = await timed(() => fn(png, lang))
      accs.push(charAccuracy(truth, value))
      pages++
      seconds += s
    }
    console.log(
      `${name} ${lang}: accuracy ${((100 * (accs[0] + accs[1])) / 2).toFixed(1)} % (${accs.map((a) => (100 * a).toFixed(1)).join(', ')})`,
    )
  }
  console.log(
    `${name}: ${pages} pages in ${seconds.toFixed(1)} s = ${((pages / seconds) * 3600).toFixed(0)} pages/hour`,
  )
}
