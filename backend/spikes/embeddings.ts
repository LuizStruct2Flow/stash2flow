// Spikes 4 and 5: embedding speed (text via Ollama bge-m3, photos via CLIP in Node) and cross-language search.
// Run: node backend/spikes/embeddings.ts   (after node backend/spikes/fixtures.ts)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AutoProcessor,
  CLIPVisionModelWithProjection,
  RawImage,
  env,
} from '@huggingface/transformers'
import { FIXTURES, LANGS, MODELS, ollamaPost, timed } from './lib.ts'

const perHour = (n: number, s: number) => (n / s) * 3600
const row = (name: string, n: number, s: number) =>
  console.log(
    `${name}: ${n} items in ${s.toFixed(1)} s = ${perHour(n, s).toFixed(0)} items/hour, 100,000 items = ${(100000 / perHour(n, s)).toFixed(1)} h`,
  )

const embedText = async (input: string[]): Promise<number[][]> =>
  ((await ollamaPost('/api/embed', { model: 'bge-m3', input })) as { embeddings: number[][] })
    .embeddings

// --- text speed: 48 made-up page texts (about 60 words each), batches of 8 -------------------
const pages = LANGS.flatMap((l) =>
  [0, 1].map((i) => readFileSync(join(FIXTURES, `page-${l}-${i}.txt`), 'utf8')),
)
const texts = Array.from({ length: 48 }, (_, i) => `${pages[i % 6]}\nCopy ${i}`)
await embedText(texts.slice(0, 2)) // load the model before timing
const t = await timed(async () => {
  for (let i = 0; i < texts.length; i += 8) await embedText(texts.slice(i, i + 8))
})
row('bge-m3 text (Ollama)', texts.length, t.seconds)

// --- photo speed: CLIP ViT-B/32 in Node ------------------------------------------------------
env.cacheDir = MODELS
const modelId = 'Xenova/clip-vit-base-patch32'
const load = await timed(async () => ({
  processor: await AutoProcessor.from_pretrained(modelId),
  model: await CLIPVisionModelWithProjection.from_pretrained(modelId, { dtype: 'fp32' }),
}))
console.log(`CLIP model load (includes download on first run): ${load.seconds.toFixed(1)} s`)
const { processor, model } = load.value
const files = ['photo-a.png', 'photo-b.png', 'photo-a-q30.jpg', 'photo-a-small.png']
const images = await Promise.all(files.map((f) => RawImage.read(join(FIXTURES, f))))
const batch = Array.from({ length: 32 }, (_, i) => images[i % 4])
await model(await processor(batch.slice(0, 2))) // warm-up
const c = await timed(async () => {
  for (let i = 0; i < batch.length; i += 8) await model(await processor(batch.slice(i, i + 8)))
})
row('CLIP image (transformers.js, fp32, CPU)', batch.length, c.seconds)

// --- cross-language query --------------------------------------------------------------------
const docs = JSON.parse(readFileSync(join(FIXTURES, 'docs.json'), 'utf8')) as {
  id: string
  text: string
}[]
const [q, ...d] = await embedText([
  'rental agreement for an apartment, monthly rent',
  ...docs.map((x) => x.text),
])
const dot = (a: number[], b: number[]) =>
  a.reduce((s, v, i) => s + v * b[i], 0) / Math.hypot(...a) / Math.hypot(...b)
console.log('query: "rental agreement for an apartment, monthly rent"')
for (const [score, id] of d
  .map((v, i) => [dot(q, v), docs[i].id] as const)
  .sort((a, b) => b[0] - a[0]))
  console.log(`  ${score.toFixed(3)}  ${id}`)
