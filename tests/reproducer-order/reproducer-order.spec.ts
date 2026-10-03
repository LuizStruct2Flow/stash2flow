/**
 * tests/reproducer-order/reproducer-order.spec.ts — TASK-077 (TASK-062-12b),
 * the order half of D100. TASK-076 (d631989) added the declared half: every
 * bug row now carries `**Reproducer: required.**` or
 * `**Reproducer: not applicable — <reason>.**` (docs/DoD.md §2 rule 4). This
 * suite reads that field — it never re-derives it, because inferring "does
 * the two-commit pattern apply here" from files, labels or prose is exactly
 * the shape `docs/config/findings.md` F-002 names.
 *
 * WHAT IS CHECKED. Over the pushed range, for every `BUG-NNN` whose row
 * declares `Reproducer: required`, a commit that could be its fix must be
 * preceded, somewhere in git-log order, by a commit that declares itself
 * that bug's reproducer.
 *
 * THE SIGNAL, STATED HONESTLY, AND WHAT IT CANNOT SEE. A commit's role is
 * read from its OWN subject line — the one thing a commit declares about
 * itself — never from its diff's semantic content and never by asking
 * whether it "looks like" a fix. Two subject-shaped facts are used:
 *
 *   1. classifySubject() reads the `BUG#NNN:` prefix docs/DoD.md §3.1
 *      specifies, and asks whether the text right after it opens with the
 *      word "reproduc-" (allowing at most one leading word, so "F1
 *      reproducer …" and "reopened, reproducer for …" both count, the way
 *      real history spells round-labelled reproducers). This is a PROSE
 *      match and it is exactly as strong as the convention is followed —
 *      measured against every `BUG#NNN:` subject in this repo's own
 *      history (`git log --pretty=%s`), it flags 47 commits and every one
 *      of them is a genuine reproducer, but a commit that broke the
 *      convention (put "reproducer" third or later, or omitted the word
 *      entirely on a real reproducer) would not be caught by this alone —
 *      see cases #1–#3 below, built from that same real history.
 *
 *   2. touchesNonDocs — a STRUCTURAL fact from `git diff-tree`, not a
 *      semantic one: did the commit change any file outside `docs/`. A
 *      product/runtime fix, by definition, changes something other than a
 *      bug table. This is what keeps a bug's own FILING commit — e.g.
 *      `c90f9b5 BUG#151: the design, the measured volatility, and a
 *      stopgap that is not a fix`, which touches only
 *      `docs/doing/BUGS.md` and a plan doc, and predates any reproducer —
 *      from being misread as an unreproduced fix. Jonathan (Kimi) reached
 *      this idea before his session ended and it is adopted here, judged
 *      rather than deferred to him: a commit that could not have changed
 *      product behaviour cannot be the fix the reproducer rule is about.
 *      The residual this does NOT close: a first-round commit that touches
 *      code before any reproducer exists (an exploratory diagnostic change,
 *      say) is still read as a candidate fix, and rightly so — there is no
 *      sound way to tell "diagnosis" from "fix" from a file list alone, so
 *      this check does not try.
 *
 * A row's declaration is read once by parseDeclarations/readDeclarations —
 * never inferred, never defaulted. `checkOrder` (the pure core, no git
 * involved) turns {declaration, commit order} into three buckets, and the
 * split is the point: `not applicable` is a legitimate exemption and prints
 * its reason via `skipNote` (a silent skip reads as a pass — DoD §3.7); a
 * row with NO Reproducer field, or no row at all, is `unjudged` and FAILS —
 * "say so explicitly rather than defaulting to either answer" (the brief,
 * quoting docs/DoD.md §2 rule 4) means neither outcome is a pass; only
 * `required` with no earlier reproducer is a `violation`.
 *
 * RED-THEN-GREEN, WITH REAL GIT LOG (case #10). A fixture repo is built with
 * `makeFixtureRepo`, a `required` row, and a fix commit with no reproducer —
 * `readHistory` + `checkOrder` over it is RED. The same repo gets a
 * reproducer commit inserted before the fix (a fresh commit ancestor of it,
 * exactly as `git log` would show for a real push) — the same pipeline over
 * it is GREEN. This is docs/DoD.md §3.1's own evidence standard: "the
 * reproducer fails before the fix, and `git log` is the evidence."
 *
 * NON-VACUITY (cases #13/#15). The live case asserts the real declaration
 * count and the real reproducer-commit count both clear a floor, so this
 * cannot pass by finding nothing to check. The blueprint's repo carries 119
 * `required` rows and 47 reproducer-shaped commits on HEAD; the floors are
 * set at roughly a third of that so ordinary bug traffic cannot trip them.
 * Those floors are the blueprint's OWN history size, so a derived project
 * would fail them by construction — they are asserted only where
 * `.blueprint-root` exists (BUG-157, case #15 pins both directions), with a
 * visible skipNote elsewhere; the order check itself still runs everywhere.
 */

import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import type { FixtureRepo } from '../harness/fixture-repo.js'
import { skipNote, skipVisibly } from '../helpers/project-config.js'

const execFileP = promisify(execFile)
const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false,
  )

/* ------------------------------------------------------------------ *
 * The declaration half — reads TASK-076's field, never re-derives it.
 * ------------------------------------------------------------------ */

export type Declaration = { kind: 'required' } | { kind: 'not-applicable'; reason: string }

/** The one spelling of a bug id. Rows pad to three digits (`**BUG-037**`),
 *  commit subjects do not (`BUG#37:`, CLAUDE.md's convention) — both meet
 *  here, so either side can key a lookup the other populates (BUG-157). */
export const bugId = (digits: string): string =>
  `BUG-${String(Number(digits)).padStart(3, '0')}`

/** A row, not a mention — same anchor bug-numbers.spec.ts uses (BUG-071). */
const ROW_START = /^\|\s*\*\*BUG-(\d+)\*\*/
const REPRO_FIELD = /\*\*Reproducer: (required|not applicable(?: — ([^*]+))?)\.\*\*/

/** null = a row exists but carries no Reproducer field (an unjudged row). */
export function parseDeclarations(text: string): Map<string, Declaration | null> {
  const out = new Map<string, Declaration | null>()
  for (const line of text.split('\n')) {
    const digits = ROW_START.exec(line)?.[1]
    if (!digits) continue
    const id = bugId(digits)
    const f = REPRO_FIELD.exec(line)
    if (!f) {
      out.set(id, null)
      continue
    }
    out.set(
      id,
      (f[1] ?? '').startsWith('required')
        ? { kind: 'required' }
        : { kind: 'not-applicable', reason: (f[2] ?? '').trim() },
    )
  }
  return out
}

const LIFECYCLE_STATES = ['backlog', 'doing', 'waiting-acceptance', 'done'] as const

/** Same absent-is-fine / unreadable-is-not split as bug-numbers.spec.ts #4/#5. */
async function readDeclarations(docsRoot: string): Promise<Map<string, Declaration | null>> {
  const out = new Map<string, Declaration | null>()
  for (const state of LIFECYCLE_STATES) {
    const rel = `docs/${state}/BUGS.md`
    let text: string
    try {
      text = await readFile(join(docsRoot, state, 'BUGS.md'), 'utf8')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') continue
      throw new Error(
        `Could not read ${rel} (${code}), so a bug row's Reproducer declaration in ` +
          `it would be invisible. This fails rather than scanning the tables it can ` +
          `reach and reporting a clean result over less.`,
        { cause: err },
      )
    }
    for (const [id, decl] of parseDeclarations(text)) out.set(id, decl)
  }
  return out
}

/* ------------------------------------------------------------------ *
 * The commit half — a role read from a commit's own subject, plus a
 * structural (not semantic) fact about what it touched.
 * ------------------------------------------------------------------ */

/** At most one leading word before "reproduc-", so "F1 reproducer …" and
 *  "reopened, reproducer for …" both count — see the file header for the
 *  real-history cases this covers and the ones it deliberately does not. */
const REPRODUCER_LEAD = /^(?:[\w()'-]+[,]?\s+)?reproduc\w*\b/i
const BUG_PREFIX = /^BUG#(\d+):\s*(.*)$/

export function classifySubject(subject: string): { bug: string; isReproducer: boolean } | null {
  const m = BUG_PREFIX.exec(subject)
  if (!m) return null
  return { bug: bugId(m[1] ?? ''), isReproducer: REPRODUCER_LEAD.test(m[2] ?? '') }
}

export interface ClassifiedCommit {
  sha: string
  subject: string
  bug: string | null
  isReproducer: boolean
  /** A structural fact (git diff-tree), never a semantic one. */
  touchesNonDocs: boolean
  /** Is this commit one the current push introduces. */
  inRange: boolean
}

/* ------------------------------------------------------------------ *
 * The pure core: commit order + declarations -> violations/unjudged/skips.
 * No git anywhere below this line.
 * ------------------------------------------------------------------ */

export interface OrderIssue {
  bug: string
  sha: string
  subject: string
  reason?: string
}

export interface OrderResult {
  violations: OrderIssue[]
  unjudged: OrderIssue[]
  skipped: OrderIssue[]
  /** In-range `required` fix commits actually evaluated — the non-vacuity signal. */
  checkedCount: number
}

/** `commits` must be oldest-first — git-log order is the evidence. */
export function checkOrder(
  commits: ClassifiedCommit[],
  declarations: Map<string, Declaration | null>,
): OrderResult {
  const seenReproducer = new Set<string>()
  const result: OrderResult = { violations: [], unjudged: [], skipped: [], checkedCount: 0 }

  for (const c of commits) {
    if (!c.bug) continue
    if (c.isReproducer) {
      seenReproducer.add(c.bug)
      continue
    }
    // Row work (filing, reopening, a lifecycle move) cannot be the fix a
    // reproducer rule is about — it changed no product/runtime behaviour.
    if (!c.touchesNonDocs) continue
    if (!c.inRange) continue

    const decl = declarations.get(c.bug)
    if (decl === undefined) {
      result.unjudged.push({
        bug: c.bug,
        sha: c.sha,
        subject: c.subject,
        reason: `no row for ${c.bug} in any docs/{backlog,doing,waiting-acceptance,done}/BUGS.md`,
      })
      continue
    }
    if (decl === null) {
      result.unjudged.push({
        bug: c.bug,
        sha: c.sha,
        subject: c.subject,
        reason: `${c.bug}'s row carries no Reproducer field (docs/DoD.md §2 rule 4)`,
      })
      continue
    }
    if (decl.kind === 'not-applicable') {
      result.skipped.push({ bug: c.bug, sha: c.sha, subject: c.subject, reason: decl.reason })
      continue
    }
    result.checkedCount++
    if (!seenReproducer.has(c.bug)) {
      result.violations.push({
        bug: c.bug,
        sha: c.sha,
        subject: c.subject,
        reason: `no earlier commit in git-log order declares itself ${c.bug}'s reproducer`,
      })
    }
  }
  return result
}

const describeIssues = (issues: OrderIssue[]): string =>
  issues.map((i) => `${i.bug} at ${i.sha} (${i.subject}) — ${i.reason ?? ''}`).join('\n')

/** NON-VACUITY (the live case's floors), extracted from #13 so a fixture root
 *  can exercise it (BUG-157 #15). Takes counts, not a repo — the caller reads
 *  the populations; this decides whether failing to find them proves nothing.
 *  BLUEPRINT-ONLY: the floors are a third of the blueprint's OWN counts (see
 *  the file header), and a derived project ships this suite with its own,
 *  smaller history — so they are asserted only where `.blueprint-root` exists
 *  (BUG-013: that marker cannot reach a derived project, so its absence is
 *  the honest signal). Elsewhere the skip is visible, never silent — a silent
 *  skip reads as a pass (DoD §3.7) — and the order check itself still runs
 *  everywhere; DoD §3.1 points at it. */
export async function assertNonVacuityFloors(
  rootDir: string,
  where: string,
  requiredCount: number,
  reproducerCommitCount: number,
): Promise<void> {
  if (!(await exists(join(rootDir, '.blueprint-root')))) {
    skipNote(
      `${where} non-vacuity floors`,
      'not the blueprint checkout — the floors are the blueprint’s own history size; the order check still runs',
    )
    return
  }
  expect(
    requiredCount,
    'no `Reproducer: required.` row was found — this proves nothing',
  ).toBeGreaterThanOrEqual(50)
  expect(
    reproducerCommitCount,
    'no reproducer-shaped commit was found in HEAD’s history — this proves nothing',
  ).toBeGreaterThanOrEqual(30)
}

/* ------------------------------------------------------------------ *
 * The git layer — reads a repo's real history into ClassifiedCommit[].
 * Used by the fixture red/green case and by the live case; nothing in
 * the pure core above ever calls git.
 * ------------------------------------------------------------------ */

type GitRunner = (args: string[]) => Promise<{ code: number | null; stdout: string }>

/** Oldest-first sha+subject pairs, using \x1f so a subject containing ':' or
 *  '|' cannot desynchronise the fields. */
async function gitLog(git: GitRunner, range?: string): Promise<{ sha: string; subject: string }[]> {
  const args = ['log', '--reverse', '--pretty=%H%x1f%s']
  if (range) args.push(range)
  const r = await git(args)
  if (r.code !== 0) return []
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf('\x1f')
      return { sha: line.slice(0, i), subject: line.slice(i + 1) }
    })
}

async function changedFiles(git: GitRunner, sha: string): Promise<string[]> {
  const r = await git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha])
  return r.code === 0 ? r.stdout.split('\n').filter(Boolean) : []
}

/**
 * Full classified history reachable from HEAD, with `inRange` set for shas
 * in `rangeShas`. `diff-tree` only runs for `BUG#NNN:` commits — the only
 * ones that can ever matter to this check — so this stays cheap even over
 * a thousand-commit repo.
 */
async function readHistory(git: GitRunner, rangeShas: Set<string>): Promise<ClassifiedCommit[]> {
  const log = await gitLog(git)
  const out: ClassifiedCommit[] = []
  for (const { sha, subject } of log) {
    const cls = classifySubject(subject)
    const files = cls ? await changedFiles(git, sha) : []
    out.push({
      sha,
      subject,
      bug: cls?.bug ?? null,
      isReproducer: cls?.isReproducer ?? false,
      touchesNonDocs: files.some((f) => !f.startsWith('docs/')),
      inRange: rangeShas.has(sha),
    })
  }
  return out
}

/* ==================================================================== *
 * Fixture data — real subjects from this repo's own history, so the
 * classifier cases are provably not synthetic best-cases.
 * ==================================================================== */

const REQUIRED = new Map<string, Declaration | null>([['BUG-900', { kind: 'required' }]])

function commit(
  bug: string | null,
  subject: string,
  opts: Partial<Pick<ClassifiedCommit, 'isReproducer' | 'touchesNonDocs' | 'inRange'>> = {},
): ClassifiedCommit {
  return {
    sha: subject.slice(0, 12).replace(/\W/g, '') || 'sha',
    subject,
    bug,
    isReproducer: opts.isReproducer ?? false,
    touchesNonDocs: opts.touchesNonDocs ?? true,
    inRange: opts.inRange ?? true,
  }
}

describe('TASK-077 — reproducer commit precedes its declared fix, in git-log order', () => {
  describe('classifySubject — the per-commit signal, against real subjects', () => {
    it('#1 "minimal reproducer (failing)" and leading-word variants are read as reproducers', () => {
      for (const s of [
        'BUG#147: minimal reproducer (failing)',
        'BUG#145: reproducer — the push after a port is refused for the port’s own shim',
        'BUG#144: F1 reproducer — a wake-time roster miss aborts under dash',
        'BUG#144: reproduce the ACTIVE-claimed stranded-mic path',
        'BUG#111: reopened, reproducer for disposeAll recording a dying group as a survivor',
      ]) {
        expect(classifySubject(s)?.isReproducer, s).toBe(true)
      }
    })

    it('#2 a FIX that merely MENTIONS "reproducer" in prose is not read as one — the false positive the naive substring check would make', () => {
      // Real commit 05ab551: fixes the reproducer's OWN fixture, landing
      // strictly between the real reproducer and the real fix. A bare
      // substring match on "reproducer" would misclassify it.
      expect(classifySubject('BUG#144: fix the reproducer’s own fixture roster')?.isReproducer).toBe(
        false,
      )
      expect(
        classifySubject(
          'BUG#129: the handover records the append-only fix and the vacuous reproducer that preceded it',
        )?.isReproducer,
      ).toBe(false)
    })

    it('#3 a lifecycle-move or non-BUG# commit is not a bug commit at all', () => {
      expect(classifySubject('BUG#144: the fix — a failed dispatch hands the mic back')?.isReproducer).toBe(
        false,
      )
      expect(classifySubject('TASK#76: a bug row states whether the reproducer-first pattern applies')).toBe(
        null,
      )
    })
  })

  describe('parseDeclarations — reads the field, never re-derives it', () => {
    const HEADER = '| # | Bug | Sev | Status | Detail |\n|---|---|---|---|---|\n'

    it('#4 required, not-applicable-with-reason, and a row missing the field entirely', () => {
      const text =
        HEADER +
        '| **BUG-800** | **Reproducer: required.** **summary** | S2 | OPEN | — |\n' +
        '| **BUG-801** | **Reproducer: not applicable — closed obsolete, never reproducible.** **s** | S3 | OPEN | — |\n' +
        '| **BUG-802** | **no Reproducer field on this row at all** | S3 | OPEN | — |\n'

      const d = parseDeclarations(text)
      expect(d.get('BUG-800')).toEqual({ kind: 'required' })
      expect(d.get('BUG-801')).toEqual({
        kind: 'not-applicable',
        reason: 'closed obsolete, never reproducible',
      })
      expect(d.get('BUG-802')).toBe(null)
      expect(d.has('BUG-803')).toBe(false) // no row at all — distinct from "row, no field"
    })
  })

  describe('checkOrder — the pure core', () => {
    it('#5 required + reproducer before the in-range fix — passes', () => {
      const r = checkOrder(
        [
          commit('BUG-900', 'BUG#900: minimal reproducer (failing)', { isReproducer: true }),
          commit('BUG-900', 'BUG#900: the fix'),
        ],
        REQUIRED,
      )
      expect(r.violations).toEqual([])
      expect(r.checkedCount).toBe(1)
    })

    it('#6 required + an in-range fix with NO reproducer anywhere — a violation, naming the fix commit', () => {
      const r = checkOrder([commit('BUG-900', 'BUG#900: the fix')], REQUIRED)
      expect(r.violations, describeIssues(r.violations)).toHaveLength(1)
      const [v] = r.violations
      expect(v?.bug).toBe('BUG-900')
      expect(v?.subject).toBe('BUG#900: the fix')
    })

    it('#7 the reproducer already landed on the base, outside the range — still passes', () => {
      // "the pushed range" only decides which FIX commits are asserted; a
      // reproducer earlier in full git-log order counts whether or not this
      // push introduced it.
      const r = checkOrder(
        [
          commit('BUG-900', 'BUG#900: minimal reproducer (failing)', {
            isReproducer: true,
            inRange: false,
          }),
          commit('BUG-900', 'BUG#900: the fix', { inRange: true }),
        ],
        REQUIRED,
      )
      expect(r.violations).toEqual([])
    })

    it('#8 a fix already on the base (not in this push) is never asserted', () => {
      const r = checkOrder([commit('BUG-900', 'BUG#900: the fix', { inRange: false })], REQUIRED)
      expect(r.violations).toEqual([])
      expect(r.checkedCount).toBe(0)
    })

    it('#9a not-applicable is a visible skip, not a violation, even with no reproducer ever', () => {
      const decl = new Map<string, Declaration | null>([
        ['BUG-901', { kind: 'not-applicable', reason: 'closed obsolete, never reproducible' }],
      ])
      const r = checkOrder([commit('BUG-901', 'BUG#901: the fix')], decl)
      expect(r.violations).toEqual([])
      expect(r.skipped).toEqual([
        {
          bug: 'BUG-901',
          sha: expect.any(String),
          subject: 'BUG#901: the fix',
          reason: 'closed obsolete, never reproducible',
        },
      ])
    })

    it('#9b a row with no Reproducer field is unjudged, not defaulted either way', () => {
      const decl = new Map<string, Declaration | null>([['BUG-902', null]])
      const r = checkOrder([commit('BUG-902', 'BUG#902: the fix')], decl)
      expect(r.violations).toEqual([])
      expect(r.unjudged).toHaveLength(1)
      expect(r.unjudged[0]?.reason).toMatch(/no Reproducer field/)
    })

    it('#9c a fix for a bug with no row anywhere is also unjudged, not defaulted either way', () => {
      const r = checkOrder([commit('BUG-903', 'BUG#903: the fix')], new Map())
      expect(r.unjudged).toHaveLength(1)
      expect(r.unjudged[0]?.reason).toMatch(/no row for BUG-903/)
    })

    it('#10 a docs-only filing commit before any reproducer is NOT a violation — Jonathan’s idea, judged and adopted', () => {
      // Real shape: c90f9b5 "BUG#151: the design, the measured volatility,
      // and a stopgap that is not a fix" touches only docs/doing/BUGS.md and
      // a plan doc, and lands before any reproducer for BUG-151 exists. A
      // check that read ANY non-reproducer BUG#NNN commit as "the fix" would
      // flag the bug's own filing commit — this proves it does not.
      const r = checkOrder(
        [commit('BUG-900', 'BUG#900: the design and a stopgap that is not a fix', { touchesNonDocs: false })],
        REQUIRED,
      )
      expect(r.violations).toEqual([])
      expect(r.unjudged).toEqual([])
      expect(r.skipped).toEqual([])
      expect(r.checkedCount).toBe(0) // never even reaches a declaration lookup
    })

    it('#14 BUG-157: an unpadded BUG#37: subject meets its padded **BUG-037** row — checked, not unjudged', () => {
      // PR #82 (superseding PR #79) reports this from a young derived project:
      // commit subjects are unpadded (BUG#37:, CLAUDE.md's convention) and rows
      // are padded (**BUG-037**). If the two sides key the id differently, the
      // fix commit finds no row and lands in unjudged — every bug numbered
      // below 100, i.e. every bug a young project files first. Latent here
      // only because every bug fixed since TASK-077 is ≥100.
      const HEADER = '| # | Bug | Sev | Status | Detail |\n|---|---|---|---|---|\n'
      const decl = parseDeclarations(
        HEADER +
          '| **BUG-037** | **Reproducer: required.** **s** | S2 | OPEN | — |\n' +
          '| **BUG-151** | **Reproducer: required.** **s** | S2 | OPEN | — |\n',
      )
      const classified = (subject: string) => {
        const c = classifySubject(subject)
        return commit(c?.bug ?? null, subject, { isReproducer: c?.isReproducer ?? false })
      }
      const r = checkOrder(
        [
          classified('BUG#37: minimal reproducer (failing)'),
          classified('BUG#37: the fix'),
          classified('BUG#151: minimal reproducer (failing)'),
          classified('BUG#151: the fix'),
        ],
        decl,
      )
      expect(r.unjudged, describeIssues(r.unjudged)).toEqual([])
      expect(r.violations, describeIssues(r.violations)).toEqual([])
      expect(r.checkedCount).toBe(2)
    })
  })

  /* ================================================================ *
   * Real git, a fixture repo — the red-then-green proof docs/DoD.md
   * §3.1 asks for: "the reproducer fails before the fix, and `git log`
   * is the evidence."
   * ================================================================ */

  async function fixtureDeclarations(s: Scenario, decl: string): Promise<Map<string, Declaration | null>> {
    const HEADER = '| # | Bug | Sev | Status | Detail |\n|---|---|---|---|---|\n'
    await s.fs.mkdirp('docs/doing')
    await s.fs.write(
      'docs/doing/BUGS.md',
      HEADER + `| **BUG-900** | ${decl} **a fixture defect** | S2 | OPEN | — |\n`,
    )
    return readDeclarations(await s.fs.mkdirp('docs'))
  }

  async function pipeline(repo: FixtureRepo, rangeShas: Set<string>, decl: Map<string, Declaration | null>) {
    return checkOrder(await readHistory((args) => repo.git(args), rangeShas), decl)
  }

  // repo.commitAll() returns the SHORT head sha (repo.head() is `--short`),
  // but git-log's %H — and therefore every ClassifiedCommit.sha — is the FULL
  // sha. The range test must key on the same spelling readHistory produces.
  async function fullSha(repo: FixtureRepo): Promise<string> {
    const r = await repo.git(['rev-parse', 'HEAD'])
    return r.stdout.trim()
  }

  it('#11 RED then GREEN over a real fixture repo — a planted fix with no reproducer fails, removing the plant passes', async () => {
    await scenario('reproducer-order-11', async (s) => {
      const decl = await fixtureDeclarations(s, '**Reproducer: required.**')
      const repo = await s.gitRepo('repo', { initialCommit: true })

      // RED: plant the fix with no reproducer anywhere.
      await s.fs.write('repo/src/thing.ts', 'export const thing = 1\n')
      await repo.commitAll('BUG#900: the fix')
      const fixSha = await fullSha(repo)

      const red = await pipeline(repo, new Set([fixSha]), decl)
      expect(red.violations, describeIssues(red.violations)).toHaveLength(1)
      expect(red.violations[0]?.sha).toBe(fixSha)

      // GREEN: land the reproducer FIRST (a fresh commit, ancestor of the
      // fix in git-log order — this repo's own history is the fixture).
      await s.fs.write('repo/src/thing.ts', 'export const thing = 1\n// repro note\n')
      await repo.commitAll('BUG#900: minimal reproducer (failing)')
      const reproSha = await fullSha(repo)
      await s.fs.write('repo/src/thing.ts', 'export const thing = 2 // fixed\n')
      await repo.commitAll('BUG#900: the real fix')
      const fix2Sha = await fullSha(repo)

      const green = await pipeline(repo, new Set([reproSha, fix2Sha]), decl)
      expect(green.violations, describeIssues(green.violations)).toEqual([])
    })
  })

  it('#12 a not-applicable row skips visibly, with its reason, over the same real pipeline', async () => {
    await scenario('reproducer-order-12', async (s) => {
      const decl = await fixtureDeclarations(
        s,
        '**Reproducer: not applicable — closed obsolete, never reproducible.**',
      )
      const repo = await s.gitRepo('repo', { initialCommit: true })
      await s.fs.write('repo/src/thing.ts', 'export const thing = 1\n')
      await repo.commitAll('BUG#900: the fix')
      const fixSha = await fullSha(repo)

      const r = await pipeline(repo, new Set([fixSha]), decl)
      expect(r.violations).toEqual([])
      expect(r.skipped).toEqual([
        {
          bug: 'BUG-900',
          sha: fixSha,
          subject: 'BUG#900: the fix',
          reason: 'closed obsolete, never reproducible',
        },
      ])
    })
  })

  /* ================================================================ *
   * THE REAL RANGE — resolved the shell-inventory way (@{u}, else
   * origin/main), never the tip's own claim about itself. Skips
   * visibly, never silently, when neither resolves.
   * ================================================================ */

  async function resolvePushBase(git: GitRunner): Promise<string | null> {
    const u = await git(['rev-parse', '--verify', '--quiet', '@{u}'])
    if (u.code === 0) return u.stdout.trim()
    const m = await git(['rev-parse', '--verify', '--quiet', 'origin/main'])
    if (m.code === 0) return m.stdout.trim()
    return null
  }

  const realGit: GitRunner = async (args) => {
    try {
      const r = await execFileP('git', args, { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 })
      return { code: 0, stdout: r.stdout }
    } catch (err) {
      const e = err as { code?: number | null; stdout?: string }
      return { code: e.code ?? 1, stdout: e.stdout ?? '' }
    }
  }

  it('#13 THE REAL RANGE — no BUG-NNN commit this push introduces lands without its declared reproducer', async (ctx) => {
    const base = await resolvePushBase(realGit)
    if (base === null) {
      skipVisibly(
        ctx,
        'neither @{u} nor origin/main resolves here, so the pushed range cannot be determined',
      )
      return
    }

    const rangeLog = await gitLog(realGit, `${base}..HEAD`)
    const rangeShas = new Set(rangeLog.map((c) => c.sha))

    const declarations = await readDeclarations(join(REPO_ROOT, 'docs'))
    const history = await readHistory(realGit, rangeShas)

    // NON-VACUITY: both populations this check draws from are real and
    // non-trivial. A renamed table or a broken classifier would show up as
    // these floors going to zero, not as a quiet pass. (Extracted into
    // assertNonVacuityFloors so #15 can run it against a fixture root.)
    const requiredCount = [...declarations.values()].filter((d) => d?.kind === 'required').length
    const reproducerCommitCount = history.filter((c) => c.isReproducer).length
    await assertNonVacuityFloors(REPO_ROOT, ctx.task.name, requiredCount, reproducerCommitCount)

    const result = checkOrder(history, declarations)
    for (const s of result.skipped) {
      skipNote(`${ctx.task.name} ${s.bug}`, `not applicable — ${s.reason}`)
    }

    expect(result.unjudged, describeIssues(result.unjudged)).toEqual([])
    expect(result.violations, describeIssues(result.violations)).toEqual([])
  })

  it('#15 BUG-157: the non-vacuity floors are the blueprint’s own size — a project without .blueprint-root must not be asserted against them', async () => {
    // The ≥50 rows / ≥30 reproducer-commit floors are a third of the
    // BLUEPRINT's own counts (see the file header); a fresh derived project
    // fails them by construction, red on its first push. This runs the very
    // assertion the live case uses against the smallest stand-ins for the
    // two checkouts:
    await scenario('reproducer-order-15', async (s) => {
      // A young derived project — small tables, and no .blueprint-root
      // marker (BUG-013: that file cannot reach a derived project, so its
      // absence is the honest signal). The floors must NOT be asserted here;
      // the order check itself still runs in such a checkout (#13's other
      // half). Counts 2 and 1 are what a young project's first bug fix
      // actually looks like.
      const young = await s.fs.mkdirp('young-proj')
      await expect(assertNonVacuityFloors(young, '#15 young derived project', 2, 1)).resolves.toBeUndefined()

      // The blueprint checkout itself — the floors stand there, so the same
      // small counts must still fail. This keeps #15 honest in both
      // directions: it proves a gate, not a deletion.
      const blueprint = await s.fs.mkdirp('blueprint-proj')
      await s.fs.write('blueprint-proj/.blueprint-root', '# marker\n')
      await expect(assertNonVacuityFloors(blueprint, '#15 blueprint', 2, 1)).rejects.toThrow(
        /proves nothing/,
      )
    })
  })
})
