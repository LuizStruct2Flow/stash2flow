// Stands in for a reading library broken by a crafted file, in the scenarios of
// features/trust-and-isolation.feature. It is run as the guardian's reading
// process: the asset's bytes are an instruction ({"port", "host", "tokens"}),
// and the process obeys it by trying to reach what the guardian must not reach,
// with the same probe the proof of the isolation uses. What it reached comes
// back as the asset's text. Harness code: never imported by src/.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
const { port, host, tokens } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
  port: number
  host: string
  tokens: string
}
const probe = fileURLToPath(new URL('./isolation-probe.ts', import.meta.url))
const outcome = execFileSync(process.execPath, [probe, String(port), host, tokens], {
  encoding: 'utf8',
})
process.stdout.write(JSON.stringify({ text: outcome.trim() }) + '\n')
