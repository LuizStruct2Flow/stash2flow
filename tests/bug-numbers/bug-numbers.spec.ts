/**
 * tests/bug-numbers/bug-numbers.spec.ts — BUG-071.
 *
 * Parallelism class: mockable (#1–#5 own a scenario workspace; #6 only READS
 * the real lifecycle tables and mutates nothing).
 *
 * A BUG NUMBER IS ALLOCATED BY READING "THE HIGHEST IN USE" OUT OF A BUGS.md,
 * WHICH IS RACY UNTIL IT IS COMMITTED. Three collisions in two days:
 *
 *   - BUG-052 and BUG-053 each carried TWO rows in docs/doing/BUGS.md, pushed
 *     and unnoticed for a day. Both pairs sat in the SAME file, which is why
 *     #2 below exists — a cross-file-only check would have missed the case
 *     that actually happened.
 *   - BUG-057 went to two different defects filed in parallel.
 *   - BUG-066 and BUG-067 were re-issued by a second session working from a
 *     copy of the table that predated the first session's push, which also
 *     dropped BUG-068's row.
 *
 * IT IS NOT COSMETIC. The commit convention and DoD §2's regression-test check
 * both key off the number: `dod_stage_bugtests` greps tests/ for
 * `BUG-0*<n>\b`, so a duplicate makes §2 satisfiable by the WRONG test — a bug
 * with no test passes because its twin has one.
 *
 * WRITING THE RULE DOWN HAD ALREADY FAILED. BUG-062's row states the mechanism
 * verbatim — "the next number is not a per-file maximum, it is the maximum
 * across docs/{doing,backlog,waiting-acceptance,done}/BUGS.md, and it is racy
 * until it is committed" — and both duplicates above landed after it. A rule
 * that must be remembered at the moment the author is busy is the wrong shape
 * of fix (BUG-004, BUG-014, the no-chain hook).
 *
 * THERE IS NO LEGITIMATE MID-PROMOTION DUPLICATE, and that was checked rather
 * than assumed. Promotion is a MOVE of the row — backlog/ → doing/ →
 * waiting-acceptance/ → done/ — so a number in two lifecycle states is either
 * a half-completed move or a collision, and both want fixing. Nothing in
 * AGENTS.md §"Documentation Structure" or docs/DoD.md §1 describes a window in
 * which a row is meant to exist in two places at once.
 *
 * NO ALLOCATOR SCRIPT WAS BUILT ALONGSIDE. Two agents can both run an
 * allocator before either commits, and an allocator cannot see the other's
 * uncommitted intent — it would hand out the same number with more ceremony
 * and a stronger claim to be right. The gate is the first moment all the
 * intent is visible in one place.
 *
 * MUTATION RECIPE (TASK-018-RULES R6). Each mutant was APPLIED and the suite
 * RUN; the red set is what was observed, not what was expected.
 *
 *   Mutant A: drop the `^\|` anchor from ROW_START (a row becomes a mention).
 *     Red: #3, #6. AND #3 ONLY AFTER THE FIXTURE WAS FIXED — on the first run
 *     mutant A went red on #6 alone, because #3's mentions were plain text
 *     while ROW_START also requires `**`. So the NAMED guard did not catch it
 *     and only the real tables did, which would have left a derived project
 *     whose prose happens not to bold a number with no guard at all. The
 *     fixture's mentions are bold now. This is the one thing running the
 *     mutant bought that reading the test could not.
 *   Mutant B: `places.length > 1` -> `>= 1` in duplicateNumbers.
 *     Red: #1, #2, #3, #5, #6. Every non-duplicate becomes a duplicate.
 *   Mutant C: readTables treats an unreadable table as absent (`if (code)
 *     continue`, swallowing everything that is not ENOENT).
 *     Red: #4 only. #4 is the only thing standing between this check and the
 *     F-002 class — six checks found today inferring a property from a proxy
 *     satisfiable without it, every one failing toward "pass".
 *   Mutant D: LIFECYCLE_STATES narrowed to ['doing'].
 *     Red: #1, #4, #5. #2 survives it, which is the point: cross-file and
 *     same-file detection are independent and both are needed.
 *   Mutant E: ROW_START loses its `\*\*` so it matches any pipe-prefixed line.
 *     Red: #1, #2, #3, #5. The prose fixture's `| a table row that is not a
 *     bug row |` is what catches it. #6 survives — the real tables have no
 *     such line today, which is exactly why the fixture carries one.
 */

import { describe, it, expect } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'

/** The four lifecycle states a bug row can legitimately sit in. */
const LIFECYCLE_STATES = ['backlog', 'doing', 'waiting-acceptance', 'done'] as const

/**
 * A ROW, NOT A MENTION.
 *
 * These tables quote other bug numbers constantly in prose — BUG-062's row
 * alone names half a dozen — so only a line that OPENS a table row for that
 * number counts. Anything looser is unusable noise, and a check that floods
 * gets muted, which leaves you exactly as blind as having none.
 */
const ROW_START = /^\|\s*\*\*(BUG-\d+)\*\*/

interface RowLocation {
  readonly id: string
  /** Repo-relative, so the failure message is something you can act on. */
  readonly file: string
  /** 1-based, for the same reason. */
  readonly line: number
}

function rowsIn(file: string, text: string): RowLocation[] {
  const out: RowLocation[] = []
  text.split('\n').forEach((line, i) => {
    const id = ROW_START.exec(line)?.[1]
    if (id) out.push({ id, file, line: i + 1 })
  })
  return out
}

/**
 * Read every lifecycle bug table under `docsRoot`.
 *
 * ABSENT IS LEGITIMATE; UNREADABLE IS NOT — and the distinction is deliberate
 * rather than convenient. `scripts/new-project.sh` seeds a derived project
 * with docs/backlog/BUGS.md ALONE, so demanding all four would fail every
 * bootstrapped project on its first push, which is BUG-028's class exactly.
 * But a table that EXISTS and cannot be read is this check failing, and it
 * says so instead of scanning what it could reach and reporting ok.
 */
async function readTables(docsRoot: string): Promise<RowLocation[]> {
  const rows: RowLocation[] = []
  for (const state of LIFECYCLE_STATES) {
    const rel = `docs/${state}/BUGS.md`
    const abs = join(docsRoot, state, 'BUGS.md')
    let text: string
    try {
      text = await readFile(abs, 'utf8')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') continue
      throw new Error(
        `Could not read ${rel} (${code}), so a duplicate bug number in it ` +
          `would be invisible. This check fails rather than scanning the ` +
          `tables it can reach and reporting a clean result over less.`,
        { cause: err },
      )
    }
    rows.push(...rowsIn(rel, text))
  }
  return rows
}

/** id -> every place a row opens with it, for ids with more than one place. */
function duplicateNumbers(rows: RowLocation[]): Map<string, RowLocation[]> {
  const byId = new Map<string, RowLocation[]>()
  for (const r of rows) byId.set(r.id, [...(byId.get(r.id) ?? []), r])
  const dups = new Map<string, RowLocation[]>()
  for (const [id, places] of byId) if (places.length > 1) dups.set(id, places)
  return dups
}

/** NAME BOTH LOCATIONS, so the reader can act without grepping four files. */
function describeDuplicates(dups: Map<string, RowLocation[]>): string {
  return [...dups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([id, places]) =>
        `${id} opens ${places.length} rows — ` +
        places.map((p) => `${p.file}:${p.line}`).join(' and '),
    )
    .join('\n')
}

/** Build a docs/ tree of lifecycle tables inside the scenario's workspace. */
async function fixtureDocs(
  s: Scenario,
  tables: Partial<Record<(typeof LIFECYCLE_STATES)[number], string>>,
): Promise<string> {
  const docs = await s.fs.mkdirp('docs')
  for (const [state, body] of Object.entries(tables)) {
    await s.fs.mkdirp(`docs/${state}`)
    await s.fs.write(`docs/${state}/BUGS.md`, body as string)
  }
  return docs
}

const HEADER = '| # | Bug | Severity | Status | Detail |\n|---|---|---|---|---|\n'
const row = (id: string, what: string) => `| **${id}** | ${what} | S2 | OPEN | — |\n`

describe('BUG-071 — one bug number, one row', () => {
  it('#1 the same number in two lifecycle states is reported, naming every file and line', async () => {
    await scenario('bug-numbers-1', async (s) => {
      const docs = await fixtureDocs(s, {
        backlog: HEADER + row('BUG-100', 'parked here'),
        doing: HEADER + row('BUG-101', 'unrelated') + row('BUG-100', 'a DIFFERENT defect'),
      })

      const dups = duplicateNumbers(await readTables(docs))

      expect([...dups.keys()]).toEqual(['BUG-100'])
      const message = describeDuplicates(dups)
      // Both ends, with line numbers. A message naming one of them sends the
      // reader looking for the other by hand, on a number that is by
      // definition ambiguous.
      expect(message).toContain('docs/backlog/BUGS.md:3')
      expect(message).toContain('docs/doing/BUGS.md:4')
    })
  })

  it('#2 the same number twice in ONE table is reported — the case that actually happened', async () => {
    await scenario('bug-numbers-2', async (s) => {
      // Both BUG-052 rows and both BUG-053 rows sat in docs/doing/BUGS.md
      // together. A check that only compared files against each other would
      // have been green through the entire incident that prompted it.
      const docs = await fixtureDocs(s, {
        doing:
          HEADER +
          row('BUG-052', 'the marker-aware merge has never run') +
          row('BUG-053', 'a blueprint-tier row is not an obligation downstream') +
          row('BUG-052', 'a spawned agent is labelled by agent type'),
      })

      const dups = duplicateNumbers(await readTables(docs))

      expect([...dups.keys()]).toEqual(['BUG-052'])
      expect(describeDuplicates(dups)).toBe(
        'BUG-052 opens 2 rows — docs/doing/BUGS.md:3 and docs/doing/BUGS.md:5',
      )
    })
  })

  it('#3 a mention is not a row, however many times it is mentioned', async () => {
    await scenario('bug-numbers-3', async (s) => {
      // THE MENTIONS ARE BOLD, and that is the whole point of the fixture.
      // With plain-text mentions this case survives dropping the `^\|`
      // anchor — measured, mutant A went red only on #6, i.e. only against
      // the real tables, which means a derived project whose prose happened
      // not to bold a number would have had no guard at all. A row cell
      // routinely says `**BUG-052** is anchored in code`, so bold is the
      // realistic shape as well as the dangerous one.
      const docs = await fixtureDocs(s, {
        doing:
          HEADER +
          row('BUG-200', 'cites **BUG-201** and BUG-201 again, and **BUG-200** in its own prose') +
          'Prose about **BUG-201**, BUG-201, **BUG-200** and BUG-200 outside any table.\n' +
          '| a table row that is not a bug row | **BUG-201** | BUG-201 |\n' +
          row('BUG-201', 'the only other row'),
      })

      const rows = await readTables(docs)

      // Two rows, not the eleven mentions.
      expect(rows.map((r) => `${r.id}@${r.line}`)).toEqual(['BUG-200@3', 'BUG-201@6'])
      expect(duplicateNumbers(rows).size).toBe(0)
    })
  })

  it('#4 a table that exists and cannot be read FAILS, rather than being scanned past', async () => {
    await scenario('bug-numbers-4', async (s) => {
      const docs = await fixtureDocs(s, {
        backlog: HEADER + row('BUG-300', 'readable'),
        doing: HEADER + row('BUG-300', 'a duplicate hiding behind the unreadable one'),
      })
      // A DIRECTORY named BUGS.md, not a chmod: `readFile` fails with EISDIR
      // for every uid, so this case cannot quietly become vacuous when the
      // suite runs as root — which is how a container CI runs it.
      await s.fs.mkdirp('docs/waiting-acceptance/BUGS.md')

      await expect(readTables(docs)).rejects.toThrow(
        /Could not read docs\/waiting-acceptance\/BUGS\.md \(EISDIR\)/,
      )
    })
  })

  it('#5 a table that is simply ABSENT is not a failure — a bootstrapped project has three', async () => {
    await scenario('bug-numbers-5', async (s) => {
      // new-project.sh seeds docs/backlog/BUGS.md and nothing else. Treating
      // absence as failure would fail every derived project on its first push
      // on a file it never wrote — BUG-028, BUG-061, same shape.
      const docs = await fixtureDocs(s, { backlog: HEADER + row('BUG-001', 'the only one') })

      const rows = await readTables(docs)

      expect(rows.map((r) => r.id)).toEqual(['BUG-001'])
      expect(duplicateNumbers(rows).size).toBe(0)
    })
  })

  it('#6 THE REAL TABLES — no bug number in this repo is carried by more than one row', async () => {
    // Read-only over the live docs/ tree, so no scenario workspace: this case
    // exists to fail the push, and pointing it at a fixture would make it a
    // fifth restatement of #1–#5 that guards nothing.
    const docsRoot = join(REPO_ROOT, 'docs')
    const rows = await readTables(docsRoot)

    // NON-VACUITY, and it is not a row-count floor: a freshly bootstrapped
    // project legitimately has zero rows. What must hold everywhere is that
    // the four state directories are the ones on disk — if a lifecycle folder
    // is renamed, this check goes quiet rather than red, and quiet is how
    // BUG-063 and F-002's six instances all failed.
    const present = (await readdir(docsRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
    for (const state of LIFECYCLE_STATES) {
      expect(present, `docs/${state}/ is gone — this check no longer looks where bugs live`)
        .toContain(state)
    }

    const dups = duplicateNumbers(rows)
    expect(describeDuplicates(dups), 'duplicate bug numbers').toBe('')
  })
})
