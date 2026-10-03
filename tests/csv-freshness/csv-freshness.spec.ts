/**
 * tests/csv-freshness/csv-freshness.spec.ts
 *
 * See csv-freshness.ts for what "matches" means and the measured numbers
 * behind making the real-tree case a hard failure rather than a report.
 */

import { describe, it, expect } from 'vitest'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { skipVisibly } from '../helpers/project-config.js'
import { checkFreshness, parseCsv } from './csv-freshness.js'

const exists = (p: string): Promise<boolean> => access(p).then(() => true, () => false)

const HEADER = 'ID,SOURCE,LINE,DISPOSITION,VERIFIED,STILL_CURRENT,CURRENT_LOCATION,NOTE'

function row(fields: Record<string, string>): string {
  const cols = HEADER.split(',')
  return cols
    .map((c) => {
      const v = fields[c] ?? ''
      return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v
    })
    .join(',')
}

async function fixture(
  s: Scenario,
  rows: Array<Record<string, string>>,
  files: Record<string, string> = {},
): Promise<{ csvPath: string; repoRoot: string }> {
  const csvPath = await s.fs.write('audit.csv', [HEADER, ...rows.map(row)].join('\n') + '\n')
  for (const [rel, content] of Object.entries(files)) {
    await s.fs.write(rel, content)
  }
  return { csvPath, repoRoot: s.workspace.root }
}

describe('csv-freshness — parseCsv', () => {
  it('#1 a quoted field with an embedded comma and an escaped quote round-trips', () => {
    const table = parseCsv('a,b\n1,"two, three ""quoted"""\n')
    expect(table).toEqual([
      ['a', 'b'],
      ['1', 'two, three "quoted"'],
    ])
  })
})

describe('csv-freshness — row identity and location', () => {
  it('#1 a live row whose CURRENT_LOCATION file and line still exist is not flagged', async () => {
    await scenario('csv-fresh-ok', async (s) => {
      const { csvPath, repoRoot } = await fixture(
        s,
        [{ ID: 'A001', DISPOSITION: 'ALREADY-OK', CURRENT_LOCATION: 'doc.md:2' }],
        { 'doc.md': 'line one\nline two\nline three\n' },
      )
      const result = await checkFreshness(csvPath, repoRoot)

      expect(result.needsReview).toEqual([])
      expect(result.unlocatable).toEqual([])
    })
  })

  it('#1 a row citing a file that no longer exists is NEEDS_REVIEW — THE PLANTED BAD POINTER', async () => {
    await scenario('csv-fresh-file-gone', async (s) => {
      const { csvPath, repoRoot } = await fixture(s, [
        { ID: 'A002', DISPOSITION: 'ALREADY-OK', CURRENT_LOCATION: 'gone.md:2' },
      ])
      const result = await checkFreshness(csvPath, repoRoot)

      expect(result.needsReview).toHaveLength(1)
      expect(result.needsReview[0]).toMatchObject({ id: 'A002', kind: 'file-missing' })
    })
  })

  it('#1 a row citing a line the file has shrunk below is NEEDS_REVIEW', async () => {
    await scenario('csv-fresh-line-gone', async (s) => {
      const { csvPath, repoRoot } = await fixture(
        s,
        [{ ID: 'A003', DISPOSITION: 'ALREADY-OK', CURRENT_LOCATION: 'doc.md:99' }],
        { 'doc.md': 'only one line\n' },
      )
      const result = await checkFreshness(csvPath, repoRoot)

      expect(result.needsReview).toHaveLength(1)
      expect(result.needsReview[0]).toMatchObject({ id: 'A003', kind: 'line-out-of-range' })
    })
  })

  it('#1 a DELETED row citing a gone file is not checked — disposition excludes it', async () => {
    await scenario('csv-fresh-deleted-skip', async (s) => {
      const { csvPath, repoRoot } = await fixture(s, [
        { ID: 'A004', DISPOSITION: 'DELETED', CURRENT_LOCATION: 'gone.md:5' },
      ])
      const result = await checkFreshness(csvPath, repoRoot)

      expect(result.needsReview).toEqual([])
      expect(result.liveRows).toBe(0)
    })
  })

  it('#1 a live row with no DISPOSITION is flagged — every live row must have one', async () => {
    await scenario('csv-fresh-missing-disposition', async (s) => {
      const { csvPath, repoRoot } = await fixture(s, [{ ID: 'A005', DISPOSITION: '', CURRENT_LOCATION: '' }])
      const result = await checkFreshness(csvPath, repoRoot)

      expect(result.missingDisposition).toEqual(['A005'])
    })
  })

  it('#1 two rows sharing one ID break row identity', async () => {
    await scenario('csv-fresh-dup-id', async (s) => {
      const { csvPath, repoRoot } = await fixture(s, [
        { ID: 'A006', DISPOSITION: 'ALREADY-OK', CURRENT_LOCATION: 'doc.md:1' },
        { ID: 'A006', DISPOSITION: 'ALREADY-OK', CURRENT_LOCATION: 'doc.md:1' },
      ])
      await s.fs.write('doc.md', 'x\n')
      const result = await checkFreshness(csvPath, repoRoot)

      expect(result.duplicateIds).toEqual(['A006'])
    })
  })

  it('#1 a section-only citation (no line number) is unlocatable, not a defect', async () => {
    await scenario('csv-fresh-section-only', async (s) => {
      const { csvPath, repoRoot } = await fixture(s, [
        { ID: 'A007', DISPOSITION: 'ALREADY-OK', CURRENT_LOCATION: 'doc.md §2' },
      ])
      const result = await checkFreshness(csvPath, repoRoot)

      expect(result.needsReview).toEqual([])
      expect(result.unlocatable).toEqual(['A007'])
    })
  })

  it('#1 a multi-location citation checks every segment', async () => {
    await scenario('csv-fresh-multi', async (s) => {
      const { csvPath, repoRoot } = await fixture(
        s,
        [{ ID: 'A008', DISPOSITION: 'ALREADY-OK', CURRENT_LOCATION: 'a.md:1; b.md:99' }],
        { 'a.md': 'x\n', 'b.md': 'x\n' },
      )
      const result = await checkFreshness(csvPath, repoRoot)

      expect(result.needsReview).toHaveLength(1)
      expect(result.needsReview[0]).toMatchObject({ id: 'A008', file: 'b.md', kind: 'line-out-of-range' })
    })
  })
})

describe('csv-freshness — THE REAL TREE', () => {
  it('every live row of docs/done/TASK-022-anchor-rules/TASK-022-rule-enforcement.csv cites a location that still exists', async (ctx) => {
    // BLUEPRINT-ONLY, same `.blueprint-root` marker doc-sync-list.spec.ts's
    // own THE REAL TREE case uses: TASK-022's audit is this repo's own
    // self-review, not something a derived project inherits — the CSV lives
    // under docs/done/TASK-022-anchor-rules/, which does not ship (caught by
    // bootstrap-gate #2/#3: ENOENT on a fresh bootstrap).
    if (!(await exists(join(REPO_ROOT, '.blueprint-root')))) {
      skipVisibly(ctx, 'not the blueprint checkout — TASK-022-rule-enforcement.csv is this repo\'s own audit and does not ship')
    }

    const csvPath = `${REPO_ROOT}/docs/done/TASK-022-anchor-rules/TASK-022-rule-enforcement.csv`
    const result = await checkFreshness(csvPath, REPO_ROOT)

    // Non-vacuity floor. Measured 2026-09-24: 373 total, 338 live.
    expect(result.totalRows, 'the CSV parsed too few rows — the parser is probably broken').toBeGreaterThan(300)
    expect(result.liveRows).toBeGreaterThan(300)

    expect(result.duplicateIds, result.duplicateIds.join(', ')).toEqual([])
    expect(result.missingDisposition, result.missingDisposition.join(', ')).toEqual([])

    // Measured 2026-09-24: 5 rows (3 section-only citations, 2 rows with no
    // CURRENT_LOCATION at all — both ALREADY-OK, pointing at a mechanism
    // rather than a doc line). Not a defect; update this number if the CSV's
    // citation style changes, the way every other measured floor in this
    // suite is updated when its population does.
    expect(result.unlocatable, result.unlocatable.join(', ')).toHaveLength(5)

    // The hard gate: every row with a numeric line citation is structurally
    // current today (0 of 333). A red result here names a real defect — the
    // audit row's cited location moved or shrank — never a vacuous check.
    expect(
      result.needsReview,
      result.needsReview
        .map((r) => `${r.id}: ${r.file}:${r.line} (${r.kind}), cited as "${r.location}"`)
        .join('\n'),
    ).toEqual([])
  })
})
