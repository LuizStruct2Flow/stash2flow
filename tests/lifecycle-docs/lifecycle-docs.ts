/**
 * tests/lifecycle-docs/lifecycle-docs.ts — the lifecycle documents must say
 * something true.
 *
 * WHY THIS IS SMALLER THAN IT WAS. This suite began by checking that
 * `waiting-acceptance/INDEX.md` and `BUGS.md` agreed on which items were
 * waiting — INDEX had drifted to 5 rows against 14 real ones, so nine fixes
 * were invisible to the only person who can accept them. That guard was the
 * wrong repair: two records of one fact drift BY CONSTRUCTION and a test only
 * reports it afterwards. The answer was to delete `INDEX.md`. One record cannot
 * disagree with itself, so those cases are gone.
 *
 * What remains guards things a single record still cannot enforce about itself,
 * each one a defect the FOUNDER found by reading files:
 *
 *   #3  an item's ARTEFACTS sit in the same folder as its row
 *   #4  no table carries an all-empty placeholder row
 *   #5  no empty table says where its items went
 *   #6  a bug with commits has a row SOMEWHERE (BUG-086 — new, see below)
 *   TASK-071  the canonical HANDOVER.md has no suffixed copies beside it
 *
 * #6 IS NOT A PORT. It is the gap the 2026-09-11 `lcm` pass found by hand, and
 * it is in this file because the property is exactly this suite's subject.
 * `tests/bug-numbers` guards the opposite direction — one number must not have
 * TWO rows — and nothing guarded the number having NONE. BUG-073's row was
 * dropped by a whole-file clobber (`5dd158e` rebuilt the table from a base that
 * predated the row) and stayed dropped through two further sessions while its
 * fix was on `main`, because the only thing that would have noticed was someone
 * reading the folders. Measured at `2bde427^`: two `BUG#73:` commits, zero rows.
 *
 * THE PREDICATE HAD TO BE CHOSEN CAREFULLY, and the obvious one is a
 * false-positive factory. "Every BUG-NNN mentioned anywhere has a row" reports
 * twelve numbers on a healthy tree: `BUG-099`, `BUG-123`, `BUG-200`, `BUG-999`
 * and friends are SYNTHETIC numbers inside test fixtures, which is why nobody
 * built this check. Asking git instead — "which numbers have a commit subject?"
 * — has no synthetic population at all, because a fixture never commits to this
 * repository. Zero false positives on the real tree, verified before the check
 * was written.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** The three founder-gated lifecycle states an item's artefacts may sit in. */
export const LIFECYCLE_STATES = ['doing', 'waiting-acceptance', 'done'] as const

/**
 * Every item prefix the lifecycle uses (BUG-138). `docs/DoD.md` §1b rule 8
 * ("artefacts travel with their parent item") makes no exception by item
 * type, so the scan must not either — BUG was the only prefix checked before
 * this fix, which is exactly how TASK-022's plan and six audit files sat
 * loose in `waiting-acceptance/` unnoticed (founder, 2026-09-17).
 */
export const ITEM_PREFIXES = ['BUG', 'TASK', 'FEATURE', 'SPIKE'] as const
type ItemPrefix = (typeof ITEM_PREFIXES)[number]

/** Which record file carries an item's row. A defect is a `BUG-XXX` row in
 *  `BUGS.md`; everything else — task, feature, spike — is a `BACKLOG.md` row
 *  (TASK-038, confirmed live: TASK-022/058/059 are `BACKLOG.md` rows today). */
const RECORD_FILE_FOR_PREFIX: Record<ItemPrefix, string> = {
  BUG: 'BUGS.md',
  TASK: 'BACKLOG.md',
  FEATURE: 'BACKLOG.md',
  SPIKE: 'BACKLOG.md',
}

const ITEM_PREFIX_ALT = ITEM_PREFIXES.join('|')
/** Anchored at the start — matches an artefact folder/file NAME, e.g. `BUG-104-stranded`. */
const ITEM_ID_RE = new RegExp(`^(?:${ITEM_PREFIX_ALT})-[0-9]+`)
/** Unanchored — pulls the id out of a `PLAN-<PREFIX>-NNN...md` name. */
const PLAN_ID_RE = new RegExp(`(?:${ITEM_PREFIX_ALT})-[0-9]+`)
const PLAN_NAME_RE = new RegExp(`^PLAN-(?:${ITEM_PREFIX_ALT})-[0-9]+.*\\.md$`)

export interface LifecycleScan {
  /** How many per-item artefacts were examined. The non-vacuity number. */
  readonly checked: number
  /** Lifecycle states that actually had a BUGS.md and were walked. This is
   *  the non-vacuity handle: `checked` counts CONTENT, which a freshly
   *  bootstrapped project legitimately has none of, so a floor on it is a
   *  claim about this repository — and this suite ships. */
  readonly statesScanned: number
  /** `<state>/<artefact>` for each artefact stranded away from its row. */
  readonly orphans: readonly string[]
  /** Files carrying a row of nothing but pipes. */
  readonly phantomRows: readonly string[]
  /** Files whose "(Empty …)" line names where the items went. */
  readonly forwardingNotes: readonly string[]
  /** `<state>/<id>: file1, file2` for an item whose artefacts are two or more
   *  LOOSE files (not a folder) in one state folder. DoD §1a: "an item that
   *  needs more than one file gets a folder" — one loose `PLAN-*.md` is the
   *  allowed single-file case; a second loose file beside it means the item
   *  needed a folder and didn't get one. */
  readonly looseGroups: readonly string[]
}

/** A parked-backlog row whose Category or re-open trigger is invalid. */
export interface BacklogMarkerViolation {
  readonly line: number
  readonly marker: string
  readonly reason: 'invalid marker' | 'missing re-open trigger'
}

const BACKLOG_MARKERS = new Set(['KEEP', 'DEFER', 'OBSOLETE'])

/**
 * Any suffixed handover is a second record of the same live fact. The canonical
 * `HANDOVER.md` is deliberately excluded; every `HANDOVER-*.md` entry is a
 * violation, regardless of whether its suffix looks like a date.
 */
export async function strayHandoverCopies(docsDir: string): Promise<string[]> {
  return (await entries(join(docsDir, 'doing'))).filter((name) =>
    /^HANDOVER-.*\.md$/.test(name),
  )
}

/** A `## F-NNN` finding block whose `Status:` line is absent or incomplete. */
export interface FindingStatusViolation {
  readonly id: string
  readonly reason: 'missing' | 'Deferred without a date' | 'Accepted without a sign-off'
}

const STATUS_LINE = /\*\*Status:\s*(Open|Fixed|Deferred|Accepted)([^*]*)\*\*/
const CALENDAR_DATE = /\d{4}-\d{2}-\d{2}/

/**
 * TASK-074 (audit rows D114, D075, D079). Every finding below
 * `docs/config/findings.md`'s own "Status schema" header carries a
 * `**Status: …**` line, and the schema names four values: `Open`, `Fixed`,
 * `Deferred: <date>`, `Accepted: <sign-off>`. A `Deferred` with no date or an
 * `Accepted` with no sign-off passes a bare presence check while telling the
 * next reader nothing they can act on — the same shape as a `Status:` line
 * missing outright — so both fail here, not only the absent case.
 *
 * Takes the file's content directly, not a path: the schema is a property of
 * the text, and the fixture population in the spec is text, not a tree.
 */
export function findingsMissingValidStatus(findingsMd: string): FindingStatusViolation[] {
  const violations: FindingStatusViolation[] = []

  for (const block of findingsMd.split(/\n(?=## F-\d+)/)) {
    const heading = /^## (F-\d+)/.exec(block)
    if (!heading?.[1]) continue
    const id = heading[1]

    const match = STATUS_LINE.exec(block)
    if (!match) {
      violations.push({ id, reason: 'missing' })
      continue
    }

    const [, value, rest] = match
    if (value === 'Deferred' && !CALENDAR_DATE.test(rest ?? '')) {
      violations.push({ id, reason: 'Deferred without a date' })
    } else if (value === 'Accepted' && !(rest ?? '').replace(/^:/, '').trim()) {
      violations.push({ id, reason: 'Accepted without a sign-off' })
    }
  }

  return violations
}

/**
 * Read the one parked-work table that `docs/backlog/README.md` defines as the
 * backlog: `backlog/BACKLOG.md`. `doing/BACKLOG.md` is explicitly active work,
 * so applying parked-work dispositions there would be a category error.
 */
export async function backlogMarkerViolations(docsDir: string): Promise<BacklogMarkerViolation[]> {
  const rows = (await readOrEmpty(join(docsDir, 'backlog', 'BACKLOG.md'))).split('\n')
  const violations: BacklogMarkerViolation[] = []

  for (const [index, row] of rows.entries()) {
    // Backlog rows start with their bold item id. Table separators and prose can
    // contain pipes too, but are not rows whose Category is a disposition.
    if (!/^\| \*\*[^|]+\*\* \|/.test(row)) continue
    // Markdown escapes literal pipes inside cells (`\\|`); splitting on every
    // pipe would shift the Category index for exactly the long prose rows this
    // table contains.
    const cells = row.split(/(?<!\\)\|/).map((cell) => cell.trim())
    const marker = cells[4] ?? ''
    if (!BACKLOG_MARKERS.has(marker)) {
      violations.push({ line: index + 1, marker, reason: 'invalid marker' })
    } else if (marker !== 'OBSOLETE' && !(cells[5] ?? '').trim()) {
      violations.push({ line: index + 1, marker, reason: 'missing re-open trigger' })
    }
  }

  return violations
}

const RECORD_FILES = ['BUGS.md', 'BACKLOG.md']

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    // A record file a lifecycle state does not have yet reads as no rows.
    return ''
  }
}

async function entries(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort()
  } catch {
    // A lifecycle folder that does not exist yet has no entries.
    return []
  }
}

/**
 * Is this item's disposition recorded in the folder its artefacts sit in?
 *
 * TWO legitimate records, not one. `done/BUG-001-fork-bomb` has no row in
 * `done/BUGS.md` because it was accepted on 2026-07-29 and written up in
 * `ACCEPTANCE-JESKO-2026-07-29.md` instead — and the folder is in exactly the
 * right place. Failing on it would have forced either a fabricated historical
 * row or a weakened check, and both are worse than widening it to the truth.
 */
async function recordedHere(docsDir: string, id: string, state: string): Promise<boolean> {
  const prefix = /^[A-Z]+/.exec(id)?.[0] as ItemPrefix | undefined
  const recordFile = (prefix && RECORD_FILE_FOR_PREFIX[prefix]) || 'BUGS.md'
  const rows = await readOrEmpty(join(docsDir, state, recordFile))
  if (new RegExp(`^\\| \\*\\*${id}\\*\\*`, 'm').test(rows)) return true

  for (const name of await entries(join(docsDir, state))) {
    if (!name.startsWith('ACCEPTANCE-') || !name.endsWith('.md')) continue
    const text = await readOrEmpty(join(docsDir, state, name))
    if (new RegExp(`\\b${id}\\b`).test(text)) return true
  }
  return false
}

/** Every `BUGS.md` / `BACKLOG.md` under `docsDir`, recursively. */
async function recordFiles(docsDir: string): Promise<string[]> {
  const found: string[] = []
  // No swallow: a directory this walk is handed either reads or the check
  // cannot judge, and a check that quietly covers less is the F-002 shape.
  const walk = async (d: string): Promise<void> => {
    for (const item of await readdir(d, { withFileTypes: true })) {
      const full = join(d, item.name)
      if (item.isDirectory()) await walk(full)
      else if (RECORD_FILES.includes(item.name)) found.push(full)
    }
  }
  await walk(docsDir)
  return found.sort()
}

export async function scanLifecycleDocs(docsDir: string): Promise<LifecycleScan> {
  const orphans: string[] = []
  const looseGroups: string[] = []
  let checked = 0
  let statesScanned = 0

  for (const state of LIFECYCLE_STATES) {
    // A state with no BUGS.md is not a state this repo uses — the shell version
    // skipped it, and a bootstrapped project legitimately has fewer.
    if ((await readOrEmpty(join(docsDir, state, 'BUGS.md'))) === '') continue
    statesScanned++

    const stateDir = join(docsDir, state)
    const looseById = new Map<string, string[]>()

    for (const name of await entries(stateDir)) {
      if (RECORD_FILES.includes(name)) continue
      const isPlan = PLAN_NAME_RE.test(name)
      const isArtefact = !isPlan && ITEM_ID_RE.test(name)
      if (!isArtefact && !isPlan) continue

      // A plan is named PLAN-<PREFIX>-0XX.md, an artefact folder <PREFIX>-0XX-<slug>.
      const id = (isPlan ? PLAN_ID_RE.exec(name) : ITEM_ID_RE.exec(name))?.[0]
      if (!id) continue

      checked++
      if (!(await recordedHere(docsDir, id, state))) orphans.push(`${state}/${name}`)

      if (!(await stat(join(stateDir, name))).isDirectory()) {
        const list = looseById.get(id) ?? []
        list.push(name)
        looseById.set(id, list)
      }
    }

    for (const [id, files] of looseById) {
      if (files.length >= 2) looseGroups.push(`${state}/${id}: ${files.sort().join(', ')}`)
    }
  }

  const phantomRows: string[] = []
  const forwardingNotes: string[] = []

  for (const file of await recordFiles(docsDir)) {
    const content = await readOrEmpty(file)
    for (const line of content.split('\n')) {
      // A row of nothing but pipes and whitespace — but NOT the |---|---|
      // separator. `| | | | |` renders as a REAL row, so a table carrying one
      // claims a parked item that does not exist.
      if (/^\|([ \t]*\|)+[ \t]*$/.test(line) && !phantomRows.includes(file)) {
        phantomRows.push(file)
      }
      // "*(Empty — BUG-023 landed in #32 and is in ../waiting-acceptance/)*" is
      // a forwarding note, and a forwarding note is the duplicate record one
      // size smaller: it goes stale the moment the item moves again. WHERE an
      // item is, is answered by which folder holds its row.
      if (
        /^\*\(Empty/.test(line) &&
        /(BUG|FEATURE|TASK|SPIKE|SLICE)-[0-9]+/.test(line) &&
        !forwardingNotes.includes(file)
      ) {
        forwardingNotes.push(file)
      }
    }
  }

  return { checked, statesScanned, orphans, phantomRows, forwardingNotes, looseGroups }
}

/**
 * #6 — every bug number with a commit has a row in some lifecycle folder.
 *
 * `commitSubjects` is injected rather than read here so the same function runs
 * over a fixture repository's log and over this one's. The commit convention is
 * enforced by `.githooks/commit-msg` (`BUG#20: …`), so the subject line is a
 * complete and machine-readable record of which numbers have work behind them.
 */
export function bugsWithoutRows(
  commitSubjects: readonly string[],
  rowedIds: ReadonlySet<string>,
): string[] {
  const committed = new Set<string>()
  for (const subject of commitSubjects) {
    const m = /^BUG#([0-9]+):/.exec(subject)
    if (m?.[1]) committed.add(`BUG-${m[1].padStart(3, '0')}`)
  }
  return [...committed].filter((id) => !rowedIds.has(id)).sort()
}

/**
 * Every bug id with a record: a ROW (not a mention) in any `BUGS.md` under docs/,
 * or any mention in `config/findings.md`. BUG-134: DoD §1 cancels an item by
 * deleting its row and leaving a pointer in that register, and
 * `scripts/lib/dod-gate.mts` already treats the register as a record (BUG-130).
 */
export async function rowedBugIds(docsDir: string): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const file of await recordFiles(docsDir)) {
    if (basename(file) !== 'BUGS.md') continue
    for (const line of (await readOrEmpty(file)).split('\n')) {
      const m = /^\| \*\*(BUG-[0-9]+)\*\*/.exec(line)
      if (m?.[1]) ids.add(m[1])
    }
  }
  for (const m of (await readOrEmpty(join(docsDir, 'config', 'findings.md'))).matchAll(/BUG-([0-9]+)/g)) {
    if (m[1]) ids.add(`BUG-${m[1].padStart(3, '0')}`)
  }
  return ids
}
