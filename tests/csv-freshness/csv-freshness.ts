/**
 * tests/csv-freshness/csv-freshness.ts — TASK-022's own audit, checked for
 * drift against the tree it describes.
 *
 * TASK-062, goal (d) — Alexey's half (PLAN-TASK-062.md §5,
 * "Founder decisions" #1: "Alexey's narrow freshness task comes right after
 * wave 1"). Deliberately NARROW, per Alexey's own framing: reproduce row
 * IDENTITY and LOCATION deterministically, flag a row whose cited location no
 * longer matches as `NEEDS_REVIEW`, and never derive the human-judgement
 * columns (`VERIFIED`, `STILL_CURRENT`) — this module reads them and writes
 * neither.
 *
 * WHAT "MATCHES" MEANS HERE, stated narrowly on purpose. `CURRENT_LOCATION`
 * cites a file and a line or line range (sometimes several, `;`-separated,
 * e.g. `docs/DoD.md:147-148; templates/project_config_dod.md:88-90`). A row
 * is checked, not judged: does the cited FILE still exist, and does the cited
 * LINE still exist in it (line count has not shrunk below the citation)? That
 * is the whole check — it is a structural liveness probe, not a text-content
 * comparison. A row whose file moved or shrank below its cited line is
 * unambiguously stale, no judgement required. A row whose cited lines still
 * exist but were REWRITTEN in place (same line count, different words) is
 * NOT caught here — that is exactly the content-judgement TASK-062 refuses to
 * mechanise (findings.md F-002: a proxy is not the property). Line existence
 * is the honest ceiling of what this check can prove without inventing a
 * quoted-source-text field the CSV does not carry.
 *
 * NOT EVERY LOCATION IS NUMERIC. A handful of rows cite a section instead of
 * a line (`docs/DoD.md §1b.5 and §4`), and two rows carry no
 * `CURRENT_LOCATION` at all (both `ALREADY-OK`, referring to a mechanism, not
 * a doc line). Neither is a defect this check invents evidence for — they are
 * reported as `unlocatable`, separately from `needsReview`, and are not
 * failed on. Forcing every row into a line-numbered citation is new scope,
 * not a freshness check.
 *
 * MEASURED, NOT ASSUMED (2026-09-24, this suite's own `THE REAL TREE` case):
 * 373 rows total, 338 "live" (`DISPOSITION` not `DELETED`/
 * `DELETE-AS-ASPIRATION`), every live row already carries a `DISPOSITION`
 * (0 missing), 336 of 338 carry a `CURRENT_LOCATION`, 333 of those parse to
 * at least one numeric line citation and every one of the 333 is structurally
 * current today (0 file-missing, 0 line-out-of-range), 5 are `unlocatable`
 * (3 section-only citations, 2 rows with no `CURRENT_LOCATION`). This is why
 * the structural half is a HARD-FAILING test rather than a report: it is
 * green today, on a non-trivial population, so a red result means a real
 * location went stale, not a check that was red from day one.
 *
 * The 16 rows already marked `STILL_CURRENT: STALE` by a human are a
 * DIFFERENT, wider kind of staleness (content judgement, most already
 * `DELETED` or `LABEL-UNCHECKED`) that this narrow check does not attempt —
 * and does not need to, because `STILL_CURRENT` is preserved verbatim here,
 * never derived.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface CsvRow {
  readonly [column: string]: string
}

/** A minimal RFC4180 parser: quoted fields, embedded commas, `""` escapes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const push = (): void => {
    row.push(field)
    field = ''
  }
  const endRow = (): void => {
    push()
    rows.push(row)
    row = []
  }
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += c
      i += 1
      continue
    }
    if (c === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (c === ',') {
      push()
      i += 1
      continue
    }
    if (c === '\r') {
      i += 1
      continue
    }
    if (c === '\n') {
      endRow()
      i += 1
      continue
    }
    field += c
    i += 1
  }
  if (field.length > 0 || row.length > 0) endRow()
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

export async function readCsvRows(csvPath: string): Promise<CsvRow[]> {
  const text = await readFile(csvPath, 'utf8')
  const table = parseCsv(text)
  const header = table[0]
  if (!header) return []
  return table.slice(1).map((cells) => {
    const row: Record<string, string> = {}
    header.forEach((col, idx) => {
      row[col] = cells[idx] ?? ''
    })
    return row
  })
}

const LIVE_DISPOSITIONS_EXCLUDED = new Set(['DELETED', 'DELETE-AS-ASPIRATION'])

export const isLive = (row: CsvRow): boolean => !LIVE_DISPOSITIONS_EXCLUDED.has((row['DISPOSITION'] ?? '').trim())

export interface LocationDefect {
  readonly id: string
  readonly location: string
  readonly file: string
  readonly line: number
  readonly kind: 'file-missing' | 'line-out-of-range'
}

export interface FreshnessResult {
  readonly totalRows: number
  readonly liveRows: number
  /** Row IDs that are live but have no `DISPOSITION` — a lifecycle gap. */
  readonly missingDisposition: readonly string[]
  /** Row IDs that share an `ID` with another row — identity is not stable. */
  readonly duplicateIds: readonly string[]
  /** Row IDs whose `CURRENT_LOCATION` has no numeric line to check. */
  readonly unlocatable: readonly string[]
  /** A file gone, or a cited line beyond the file's current length. */
  readonly needsReview: readonly LocationDefect[]
}

const LOCATION_SEGMENT_RE = /^([^:]+):(.+)$/
const LINE_SPEC_RE = /^(\d+)(?:-(\d+))?$/

async function lineCount(repoRoot: string, relFile: string): Promise<number> {
  try {
    const text = await readFile(join(repoRoot, relFile), 'utf8')
    // A trailing newline is not one more line; a file with no trailing
    // newline still counts its last (partial) line.
    const withoutTrailingNewline = text.endsWith('\n') ? text.slice(0, -1) : text
    return withoutTrailingNewline.length === 0 ? 0 : withoutTrailingNewline.split('\n').length
  } catch {
    // a missing file is a real finding (file-missing), not a scan error —
    // -1 is the sentinel checkFreshness reads to report it as such.
    return -1
  }
}

/**
 * Check every live row's `CURRENT_LOCATION` against `repoRoot`.
 *
 * Preserves `VERIFIED` and `STILL_CURRENT` by never reading them for a
 * verdict — they are the caller's to display, not this function's to judge.
 */
export async function checkFreshness(csvPath: string, repoRoot: string): Promise<FreshnessResult> {
  const rows = await readCsvRows(csvPath)
  const live = rows.filter(isLive)

  const seen = new Map<string, number>()
  for (const row of rows) {
    const id = (row['ID'] ?? '').trim()
    seen.set(id, (seen.get(id) ?? 0) + 1)
  }
  const duplicateIds = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id)

  const missingDisposition = live.filter((r) => !(r['DISPOSITION'] ?? '').trim()).map((r) => r['ID'] ?? '')

  const unlocatable: string[] = []
  const needsReview: LocationDefect[] = []
  const fileLineCounts = new Map<string, number>()

  for (const row of live) {
    const id = (row['ID'] ?? '').trim()
    const loc = (row['CURRENT_LOCATION'] ?? '').trim()
    if (!loc) {
      unlocatable.push(id)
      continue
    }
    let sawNumericLine = false
    for (const segment of loc.split(/;\s*/)) {
      const m = LOCATION_SEGMENT_RE.exec(segment.trim())
      if (!m) continue
      const file = (m[1] as string).trim()
      const spec = (m[2] as string).trim()
      for (const part of spec.split(',')) {
        const lm = LINE_SPEC_RE.exec(part.trim())
        if (!lm) continue
        sawNumericLine = true
        const hi = lm[2] ? Number(lm[2]) : Number(lm[1])
        let n = fileLineCounts.get(file)
        if (n === undefined) {
          n = await lineCount(repoRoot, file)
          fileLineCounts.set(file, n)
        }
        if (n === -1) {
          needsReview.push({ id, location: loc, file, line: hi, kind: 'file-missing' })
        } else if (hi > n) {
          needsReview.push({ id, location: loc, file, line: hi, kind: 'line-out-of-range' })
        }
      }
    }
    if (!sawNumericLine) unlocatable.push(id)
  }

  return {
    totalRows: rows.length,
    liveRows: live.length,
    missingDisposition,
    duplicateIds,
    unlocatable,
    needsReview,
  }
}
