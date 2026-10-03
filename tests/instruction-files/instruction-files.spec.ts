/**
 * tests/instruction-files/instruction-files.spec.ts — TASK-084: the four CLI
 * providers work from one instruction file, and every half-pulled state says so.
 *
 * The layout (docs/waiting-acceptance/PLAN-TASK-084-agents-md.md §2): `AGENTS.md` holds the
 * shared rules and Codex/Kimi read it natively; `CLAUDE.md` and `GEMINI.md`
 * import it; `AGENT_SIGNAL.md` holds the coordination protocol.
 *
 * WHAT IS PINNED, AND WHY EACH IS HERE RATHER THAN IN PROSE:
 *
 *   - BYTE CAPS. Codex truncates project docs at `project_doc_max_bytes`
 *     (32768, a budget shared with the user's own `~/.codex/AGENTS.md`) and
 *     says nothing to the agent; Kimi's 32 KB warning never reaches a headless
 *     run. This is the only guard that fires for a dispatched agent. The
 *     `CLAUDE.md` and `GEMINI.md` caps stop shared rules drifting back into a
 *     file only one provider reads.
 *   - SENTINELS. A partial `blueprint pull` can land any subset of the four
 *     files. S1 (AGENTS.md's first heading, quoted by both importers' self-
 *     checks) and S2 (AGENT_SIGNAL.md's first heading, quoted by AGENTS.md's
 *     coordination bullet) are how an agent notices an old counterpart and
 *     names the file to pull. The reciprocal S1 check in AGENT_SIGNAL.md is
 *     also required by AGENTS.md: S2 already shipped in slice 1, so its heading
 *     alone cannot distinguish slice 1 from the slice-2 switch. S3 (AGENTS.md's
 *     last line) is how a provider probe notices a truncated file. A quoted
 *     sentinel that drifts from the heading it names would make every self-
 *     check fail, or none.
 *   - STALE PROTOCOL POINTERS. The coordination sections left AGENTS.md; a
 *     reference to one of them as `AGENTS.md#anchor` or `AGENTS.md §"…"` now
 *     points at a heading that is not there.
 *
 * What is NOT pinned: that an agent obeys a self-check. That is prose; the
 * per-provider probe in the plan's slice log is the evidence for it.
 *
 * Parallelism class: parallel-safe (read-only over the real checkout).
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT } from '../harness/index.js'

const S1 = 'Agent instructions — shared by the four CLI providers'
const S2 = 'Agent Signal — the mic, rotation and four-eyes review'
const S3 = 'End of the shared agent instructions.'

const REMEDY = 'move rationale or history into a linked doc under docs/ (docs/DoD.md or a recipe doc); never raise the cap'

const CAPS: ReadonlyArray<readonly [string, number]> = [
  ['AGENTS.md', 28_672],
  ['CLAUDE.md', 4_096],
  ['GEMINI.md', 512],
]

const ROOT_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'AGENT_SIGNAL.md'] as const

const read = (f: string): Promise<string> => readFile(join(REPO_ROOT, f), 'utf8')
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()
const firstLine = (s: string): string => s.split('\n')[0] ?? ''

/** The heading a self-check quotes: `…the heading "<X>"…`, wrapped or not. */
function quotedHeading(text: string, lead: RegExp): string | undefined {
  const m = new RegExp(`${lead.source}\\s+"([^"]+)"`).exec(text)
  return m?.[1] === undefined ? undefined : squash(m[1])
}

/** The numbered checks under AGENTS.md's `AGENT_SIGNAL.md` bullet, each squashed to one line. */
function signalChecks(agents: string): string[] {
  const bullet = /^- \*\*\[AGENT_SIGNAL\.md\][\s\S]*?(?=^\S)/m.exec(agents)?.[0] ?? ''
  return bullet.split(/^ +\d+\. /m).slice(1).map(squash)
}

/** GitHub's heading anchor: lower-case, punctuation dropped, spaces to hyphens. */
const slug = (h: string): string =>
  h.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-')

const headings = (md: string): string[] =>
  [...md.replace(/```[\s\S]*?```/g, '').matchAll(/^#{2,6} +(.+?) *$/gm)].map((m) => m[1] ?? '')

/**
 * Every reference in `text` to a section of AGENTS.md that exists only in
 * AGENT_SIGNAL.md. A `§"<x>"` reference matches a heading it is a prefix of,
 * because the prose abbreviates long headings (§"Who does the work").
 */
function stalePointers(text: string, agentsMd: string, signalMd: string): string[] {
  const here = headings(agentsMd)
  const moved = headings(signalMd).filter((h) => !here.includes(h))
  const found: string[] = []
  for (const m of text.matchAll(/AGENTS\.md#([\w-]+)/g)) {
    if (moved.some((h) => slug(h) === m[1]) && !here.some((h) => slug(h) === m[1])) found.push(m[0])
  }
  for (const m of text.matchAll(/AGENTS\.md[`\])]*\s*§\s*"([^"]+)"/g)) {
    const ref = squash(m[1] ?? '')
    if (moved.some((h) => h.startsWith(ref)) && !here.some((h) => h.startsWith(ref))) found.push(squash(m[0]))
  }
  return found
}

describe('TASK-084 — one instruction file for the four CLI providers', () => {
  it.each(CAPS)('%s stays within its byte cap (%i)', async (file, cap) => {
    const bytes = Buffer.byteLength(await read(file), 'utf8')
    expect(bytes, `${file} is ${bytes} bytes, over its ${cap}-byte cap — ${REMEDY}`).toBeLessThanOrEqual(cap)
  })

  it('S1: AGENTS.md opens with the heading both importers’ self-checks quote', async () => {
    expect(firstLine(await read('AGENTS.md'))).toBe(`# ${S1}`)
    for (const importer of ['CLAUDE.md', 'GEMINI.md']) {
      const text = await read(importer)
      expect(firstLine(text), `${importer} must import AGENTS.md before anything else`).toBe('@AGENTS.md')
      expect(quotedHeading(text, /must begin with the heading/), `${importer}'s self-check quotes another heading`).toBe(S1)
      expect(text, `${importer}'s self-check no longer names the file to pull`).toContain('`blueprint pull AGENTS.md`')
    }
  })

  it('S2: AGENTS.md’s coordination bullet quotes AGENT_SIGNAL.md’s first heading', async () => {
    const signal = await read('AGENT_SIGNAL.md')
    expect(firstLine(signal)).toBe(`# ${S2}`)
    expect(quotedHeading(signal, /must begin with the heading/), 'AGENT_SIGNAL.md does not reject an old AGENTS.md').toBe(S1)
    expect(signal, 'AGENT_SIGNAL.md no longer names the shared-rules file to pull').toContain('`blueprint pull AGENTS.md`')

    // Two separately numbered checks, each with its own stop: Kimi applied only
    // the first clause of the old one-sentence form (plan, slice-2 provider probe).
    const [heading, selfCheck, ...extra] = signalChecks(await read('AGENTS.md'))
    expect(extra, 'the AGENT_SIGNAL.md bullet must hold exactly two numbered checks').toEqual([])
    expect(quotedHeading(heading ?? '', /first heading must read/), 'check 1 compares AGENT_SIGNAL.md against another heading').toBe(S2)
    expect(
      quotedHeading(selfCheck ?? '', /self-check must require `AGENTS\.md`'s heading/),
      'check 2 no longer distinguishes the slice-1 AGENT_SIGNAL.md from the slice-2 switch',
    ).toBe(S1)
    for (const [n, check] of [[1, heading], [2, selfCheck]] as const) {
      expect(check, `check ${n} no longer stops and names the file to pull`).toMatch(/stop, tell the founder and run `blueprint pull AGENT_SIGNAL\.md`/)
    }
  })

  it('S3: AGENTS.md ends with the plain tail sentinel', async () => {
    const lines = (await read('AGENTS.md')).trimEnd().split('\n')
    expect(lines[lines.length - 1], 'a probe cannot tell a truncated AGENTS.md from a whole one').toBe(S3)
  })

  it('no root instruction file points at a protocol section as if it were still in AGENTS.md', async () => {
    const agents = await read('AGENTS.md')
    const signal = await read('AGENT_SIGNAL.md')

    // Non-vacuity: the detector must see both forms, or a green run means nothing.
    const planted = 'see [AGENTS.md](AGENTS.md) §"Who does the work" and AGENTS.md#the-mic-radio-over'
    expect(stalePointers(planted, agents, signal)).toHaveLength(2)
    expect(stalePointers('AGENTS.md §"Running commands"', agents, signal), 'a heading still in AGENTS.md is not stale').toEqual([])

    const stale: string[] = []
    for (const f of ROOT_FILES) {
      for (const p of stalePointers(await read(f), agents, signal)) stale.push(`${f}: ${p}`)
    }
    expect(stale, 'point these at AGENT_SIGNAL.md, where the section now lives').toEqual([])
  })
})
