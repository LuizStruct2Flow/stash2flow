// The process that reads one asset, started by the guardian inside its
// isolation: `node reading-process.ts <ext>`. The bytes of the asset come in on
// standard input, and one JSON line goes out on standard output: text, pages
// and dates, as data. It imports nothing outside this folder, because nothing
// else is given to it.
import { officeExts, officeText } from './office-text.ts'
import { readPdf } from './pdf-reading.ts'

async function read(ext: string, bytes: Uint8Array): Promise<object> {
  if (ext === 'pdf') return await readPdf(bytes)
  if (officeExts.includes(ext)) return officeText(ext, bytes)
  throw new Error(`An asset of type "${ext}" is not read in this slice.`)
}

try {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const result = await read(process.argv[2].toLowerCase(), Buffer.concat(chunks))
  process.stdout.write(JSON.stringify(result) + '\n')
} catch (e) {
  // The guardian turns a non-zero exit with this message into the error its caller sees.
  process.stderr.write((e instanceof Error ? e.message : String(e)) + '\n')
  process.exitCode = 1
}
