// Shared helpers for the slice-1 spikes. Spike code only: never imported by backend/src.
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Everything generated or downloaded lives outside the repository. */
export const CACHE = join(homedir(), '.cache', 'stash2flow-spikes')
export const FIXTURES = join(CACHE, 'fixtures')
export const MODELS = join(CACHE, 'models')

export const LANGS = ['por', 'deu', 'eng'] as const
export type Lang = (typeof LANGS)[number]

export const OLLAMA = 'http://127.0.0.1:11434'

export async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; seconds: number }> {
  const t = performance.now()
  const value = await fn()
  return { value, seconds: (performance.now() - t) / 1000 }
}

/** Character accuracy: 1 - Levenshtein / length of the reference, whitespace-normalised. */
export function charAccuracy(reference: string, got: string): number {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  const a = norm(reference)
  const b = norm(got)
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return Math.max(0, 1 - prev[b.length] / a.length)
}

export async function ollamaPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${OLLAMA}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`ollama ${path}: ${res.status} ${await res.text()}`)
  return (await res.json()) as Record<string, unknown>
}
