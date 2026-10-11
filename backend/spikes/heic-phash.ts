// Spikes 1 and 2: HEIC decoding from Node, and a 64-bit perceptual hash that is the same everywhere.
// Run: node backend/spikes/heic-phash.ts   (after node backend/spikes/fixtures.ts)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import decode from 'heic-decode'
import sharp from 'sharp'
import { FIXTURES, timed } from './lib.ts'

type Raw = { data: Uint8Array | Uint8ClampedArray; width: number; height: number }

/** Classic DCT phash: 32x32 grey, 2-D DCT, top-left 8x8 block against its median, 64 bits. */
export async function phash(raw: Raw): Promise<bigint> {
  const grey = await sharp(Buffer.from(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength), {
    raw: { width: raw.width, height: raw.height, channels: 4 },
  })
    .flatten({ background: '#fff' })
    .greyscale()
    .resize(32, 32, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer()
  const N = 32
  const cos = Array.from({ length: 8 }, (_, u) =>
    Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))),
  )
  const low: number[] = []
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let s = 0
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) s += grey[y * N + x] * cos[u][x] * cos[v][y]
      low.push(s)
    }
  }
  const sorted = low.slice(1).sort((a, b) => a - b) // median without the DC term
  const median = (sorted[31] + sorted[32]) / 2
  return low.reduce((h, c, i) => (c > median ? h | (1n << BigInt(i)) : h), 0n)
}

export const hamming = (a: bigint, b: bigint): number =>
  (a ^ b).toString(2).replaceAll('0', '').length

async function rawOf(file: string): Promise<Raw> {
  const buf = readFileSync(join(FIXTURES, file))
  if (file.endsWith('.heic')) {
    const img = await decode({ buffer: buf })
    return { data: img.data, width: img.width, height: img.height }
  }
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

async function main() {
  // 1. Which libraries decode HEIC here?
  const heic = readFileSync(join(FIXTURES, 'photo-a.heic'))
  try {
    await sharp(heic).raw().toBuffer()
    console.log('sharp: decoded HEIC (unexpected)')
  } catch (e) {
    console.log('sharp: FAILED:', (e as Error).message)
  }
  const d = await timed(() => decode({ buffer: heic }))
  console.log(
    `heic-decode (libheif-js, WASM): OK ${d.value.width}x${d.value.height} in ${d.seconds.toFixed(2)} s`,
  )

  // 2. phash and distances
  const names = [
    'photo-a.png',
    'photo-a-small.png',
    'photo-a-q30.jpg',
    'photo-a.heic',
    'photo-b.png',
  ]
  const hashes = new Map<string, bigint>()
  for (const n of names) hashes.set(n, await phash(await rawOf(n)))
  for (const [n, h] of hashes) console.log(n.padEnd(20), h.toString(16).padStart(16, '0'))
  const ref = hashes.get('photo-a.png')!
  for (const n of names.slice(1))
    console.log(`distance photo-a.png vs ${n}: ${hamming(ref, hashes.get(n)!)}`)
  console.log(
    `distance photo-a.heic vs photo-b.png: ${hamming(hashes.get('photo-a.heic')!, hashes.get('photo-b.png')!)}`,
  )
}

if (import.meta.filename === process.argv[1]) await main()
