// scripts/lib/dod-gate.mts — TASK-067 port of the shell library dod-gate.sh,
// which TASK-088 deleted.
//
// PLAN-BUG-147-dod-gate-port.md ("Option C") is the design this file
// implements: one CLI, one subcommand per function of the original shell
// library. Its callers (.githooks/pre-push-project and the security.yml DoD
// step) run `node scripts/lib/dod-gate.mts <subcommand>` directly.
//
// WHY THIS EXISTS — see the original dod-gate.sh history for the
// full policy rationale (docs/DoD.md §7, the FEATURE-002 argument, BUG-040,
// BUG-130, BUG-139, BUG-140, TASK-039, TASK-047, BUG-147). This file's job is
// to preserve that policy byte-for-byte while moving it off shell; it is not
// the place to relitigate any of those decisions.
//
// NOTE PROTOCOL (DOD_GATE_NOTE_FILE, PLAN-TASK-088 §6 Q1). A stage's notes ride
// along on the caller's result line, and the caller owns that line, so the
// caller says where a note goes through one variable:
//   - set and non-empty (a buffered pipeline run): the path of the stage's note
//     file; each note's raw text is appended to it, with no separator — what
//     pipe_note does when buffered;
//   - set but empty (an unbuffered run, and CI): each note prints as
//     `     note: …` on stdout — what pipe_note does unbuffered;
//   - unset (a bare CLI run): each note prints as `note: …`.
//
// Usage errors and internal failures exit >1 (2), never 1 — status 1 is
// reserved for a DoD policy verdict (rows/bugtests/signal all return 0/1).

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync, appendFileSync, lstatSync } from 'node:fs'
import { join } from 'node:path'

// --- the extension rule (tests/dod-gate #17 cross-checks this against
// tests/vitest.config.ts's `include` and scripts/lib/suites.sh's discovery
// patterns) -------------------------------------------------------------
// TASK-047 — the evidence set and the run set are ONE SET for the directory
// tests/vitest.config.ts itself governs (the shipped tests/): only a
// `*.spec.ts` or `*.spec.tsx` counts there, because that is what the runner
// executes. `.tsx` is the same TypeScript spec with JSX syntax, not an
// exception.
const TS_SPEC_EXTS = ['.spec.ts', '.spec.tsx']

// BUG-147 — every OTHER root is the project's OWN, run by the project's own
// runner, never by tests/vitest.config.ts — that config was never going to
// execute anything found there, TypeScript or not. A JavaScript project
// (storm2flow: vitest over `*.spec.js`, no TypeScript anywhere in it) counts
// these on such a root for the same reason `.tsx` counts above — the SAME
// spec convention, in the project's own language, not an exception to it.
// `*.test.*` and prose still count nowhere, on ANY root (TASK-047 #18,
// unchanged by this).
const PROJECT_ONLY_SPEC_EXTS = ['.spec.js', '.spec.jsx', '.spec.mjs', '.spec.cjs']

interface Note {
  text: string
}

class Notes {
  private items: Note[] = []
  push(text: string) {
    this.items.push({ text })
  }
  all(): Note[] {
    return this.items
  }
}

function flushNotes(notes: Notes) {
  const file = process.env.DOD_GATE_NOTE_FILE
  for (const n of notes.all()) {
    if (file === undefined) process.stdout.write(`note: ${n.text}\n`)
    else if (file === '') process.stdout.write(`     note: ${n.text}\n`)
    else appendFileSync(file, n.text)
  }
}

// --- dod_items_in_push -------------------------------------------------

function splitIFS(s: string): string[] {
  return s.split(/\s+/).filter((x) => x.length > 0)
}

function gitLogSubjects(range: string, cwd: string): string[] {
  try {
    const out = execFileSync('git', ['log', '--format=%s', range], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (out.length === 0) return []
    return out.replace(/\n$/, '').split('\n')
  } catch {
    // Matches the shell's `git log ... 2>/dev/null` inside a bare `for`
    // statement: a bad/unreadable range is swallowed, not propagated.
    return []
  }
}

function subjectLibPath(): string {
  const codeRoot = process.env.BP_CODE_ROOT ?? '.'
  return join(codeRoot, 'scripts/lib/commit-subject.sh')
}

function mapSubjectsToItems(subjects: string[], lib: string): string[] {
  if (subjects.length === 0) return []
  const script = `. "$1"\nwhile IFS= read -r line; do commit_subject_item "$line"; done\n`
  try {
    const res = execFileSync('sh', ['-c', script, 'sh', lib], {
      input: subjects.join('\n') + '\n',
      encoding: 'utf8',
    })
    return res.length ? res.replace(/\n$/, '').split('\n').filter(Boolean) : []
  } catch {
    // commit-subject.sh missing/unreadable: matches the shell's own degraded
    // behaviour (an undefined function fails the loop body, not the caller) —
    // an empty item list downstream, not a thrown error here.
    return []
  }
}

// Locale-aware sort -u — an explicit `sort` child rather than a JS
// reimplementation, so ordering/uniqueness inherit the ambient locale exactly
// as the shell's own `sort -u` did (see the plan's "range-list argument" note).
function sortUnique(items: string[]): string[] {
  if (items.length === 0) return []
  const res = execFileSync('sort', ['-u'], { input: items.join('\n') + '\n', encoding: 'utf8' })
  return res.length ? res.replace(/\n$/, '').split('\n').filter(Boolean) : []
}

function itemsInPush(rangeList: string): string[] {
  const cwd = process.cwd()
  const lib = subjectLibPath()
  const ranges = splitIFS(rangeList)
  let subjects: string[] = []
  for (const r of ranges) subjects = subjects.concat(gitLogSubjects(r, cwd))
  return sortUnique(mapSubjectsToItems(subjects, lib))
}

// commit-subject.sh must be readable, or every downstream item list is
// silently empty (BUG-040's shape). Stage subcommands check this before
// calling itemsInPush; the bare `items` subcommand does not (matches the
// original: only dod_stage_rows/dod_stage_bugtests called _dg_need_parser).
function needParser(): string[] | undefined {
  const lib = subjectLibPath()
  if (existsSync(lib)) return undefined
  return [`cannot read ${lib}, so this push's items are unknown.`, 'Run: blueprint pull scripts/lib/commit-subject.sh']
}

// --- dod_find_row --------------------------------------------------------

const LIFECYCLE = ['backlog', 'doing', 'waiting-acceptance', 'done'] as const

function stripZeroPad(n: string): string {
  return n.replace(/^0+/, '')
}

function splitItem(item: string): { type: string; num: string } {
  const dash = item.indexOf('-')
  const type = dash === -1 ? item : item.slice(0, dash)
  const lastDash = item.lastIndexOf('-')
  const num = lastDash === -1 ? '' : item.slice(lastDash + 1)
  return { type, num: stripZeroPad(num) }
}

function readFileOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    // Absence is the probed state throughout this file (a lifecycle file, a
    // config file, a BUGS.md that may not exist yet) — callers compare
    // against undefined, matching the shell's `[ -f ... ] || continue`.
    return undefined
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Returns the lifecycle state, 'cancelled', or undefined (not found).
function findRow(item: string): string | undefined {
  const { type, num } = splitItem(item)
  for (const state of LIFECYCLE) {
    for (const base of ['BUGS.md', 'BACKLOG.md']) {
      const f = `docs/${state}/${base}`
      const content = readFileOrUndefined(f)
      if (content === undefined) continue
      const re = new RegExp(`^\\| \\*\\*${escapeRegExp(type)}-0*${escapeRegExp(num)}\\*\\*`, 'm')
      if (re.test(content)) return state
    }
  }
  const findings = readFileOrUndefined('docs/config/findings.md')
  if (findings !== undefined) {
    const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(type)}-0*${escapeRegExp(num)}([^0-9]|$)`, 'm')
    if (re.test(findings)) return 'cancelled'
  }
  return undefined
}

// --- dod_stage_rows --------------------------------------------------------

function stageRows(rangeList: string, notes: Notes): { rc: number; out: string[] } {
  const need = needParser()
  if (need) return { rc: 1, out: need }

  const items = itemsInPush(rangeList)
  if (items.length === 0) return { rc: 0, out: ['no item-bearing commits in this push (merge/revert/root only)'] }

  const missing: string[] = []
  const elsewhere: string[] = []
  const cancelled: string[] = []
  for (const i of items) {
    const where = findRow(i)
    if (where === undefined) {
      missing.push(i)
      continue
    }
    if (where === 'doing') continue
    if (where === 'cancelled') cancelled.push(i)
    else elsewhere.push(`${i}(${where})`)
  }
  if (cancelled.length) notes.push(`cancelled, recorded in docs/config/findings.md:${cancelled.map((x) => ` ${x}`).join('')}`)
  if (elsewhere.length) notes.push(`rows outside doing/:${elsewhere.map((x) => ` ${x}`).join('')}`)

  if (missing.length) {
    return {
      rc: 1,
      out: [
        `These items have NO backlog row anywhere:${missing.map((x) => ` ${x}`).join('')}`,
        '',
        "DoD §1b rule 1 — all work refers to a backlog item. If this work has",
        'no item, it is not ready to push: add a row under docs/backlog/,',
        'promote it to docs/doing/, and reference it.',
      ],
    }
  }
  return { rc: 0, out: [`items: ${items.join(' ')}`] }
}

// --- dod_test_roots --------------------------------------------------------

function testRoots(): { rc: number; out: string[]; roots?: string[] } {
  const cfg = 'project_config_paths.md'
  const codeRoot = process.env.BP_CODE_ROOT ?? '.'
  const defaultRoot = [`${codeRoot}/tests`]
  const content = readFileOrUndefined(cfg)
  if (content === undefined) return { rc: 0, out: [], roots: defaultRoot }

  const candidateRe = /^[ \t]*([-*+|][ \t]*)?BP_TEST_ROOTS[ \t]*[:=|]/
  const lines = content.split('\n')
  const count = lines.filter((l) => candidateRe.test(l)).length
  if (count === 0) return { rc: 0, out: [], roots: defaultRoot }
  if (count > 1) {
    return {
      rc: 1,
      out: [
        `project_config_paths.md has ${count} lines that declare BP_TEST_ROOTS (more than one).`,
        'Keep exactly one declaration — the gate will not guess which is current.',
        'A malformed line counts: it still says which roots were meant.',
      ],
    }
  }

  const strict = /^- BP_TEST_ROOTS: `([^`]*)`[ \t]*$/m
  const m = strict.exec(content)
  const decl = m ? (m[1] ?? '') : ''
  if (decl.replace(/\s/g, '').length === 0) {
    return {
      rc: 1,
      out: [
        'the BP_TEST_ROOTS declaration in project_config_paths.md is malformed.',
        'Expected one backtick-quoted, space-separated list of directories,',
        'as a top-level bullet with a single space after the dash and colon:',
        '  - BP_TEST_ROOTS: `backend/src frontend/e2e`',
        'Refusing rather than defaulting to tests/, which holds the blueprint\'s suites.',
      ],
    }
  }
  if (/[*?[\]]/.test(decl)) {
    return {
      rc: 1,
      out: [
        `BP_TEST_ROOTS contains a glob metacharacter: ${decl}`,
        'Roots are literal paths. A glob expands to whatever is on disk, which',
        'is how docs/ and scripts/ became searchable.',
      ],
    }
  }
  return { rc: 0, out: [], roots: splitIFS(decl) }
}

// --- dod_stage_bugtests ------------------------------------------------

function realpathOrUndefined(p: string): string | undefined {
  try {
    return realpathSync(p)
  } catch {
    // A path that does not exist (or is not resolvable) is "not a directory"
    // to every caller here, matching the shell's `cd -P "$p" 2>/dev/null`.
    return undefined
  }
}

function isDirWithinOrEqual(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent}/`)
}

interface PlanEntry {
  root: string
  rp: string
  mode: 'full' | 'shallow'
  // BUG-147: true when this root resolves at or below the directory
  // tests/vitest.config.ts itself governs — independent of shallow/full mode
  // (the blueprint's own `tests/` root is searched in FULL mode and must
  // still stay TypeScript-only).
  tsGoverned: boolean
}

// depth-limited (maxDepth=1) or unbounded recursive file walk, skipping
// symlinks entirely — `find` without `-L` does not follow them, and
// `-type f` on a symlink never matches (it tests the link's own type).
//
// BUG-147 differential (roots/symlinked-resolves): a DECLARED ROOT that is
// itself a symlink must also never be entered. `find "$root" -type f ...`
// with no `-H`/`-L` never dereferences a symlink given as its OWN starting
// argument — physical mode applies there too, not only to symlinks met
// during traversal — so `find linked-tests -type f` prints nothing even
// though `linked-tests -> real-tests` and `real-tests/x.spec.ts` exists.
// `readdirSync` has no such refusal: it follows the path it is given
// regardless of whether that path is itself a symlink, so an unguarded walk
// would search a symlinked root the old shell never searched — a real
// content-search divergence measured directly, not the accepted CI
// note-position exception. The old shell's `cd -P` containment check still
// RESOLVES the same root for the outside/never/shipped comparisons: only
// the file search itself must stay blind to it.
function walkFiles(dir: string, maxDepth: number | undefined, exts: string[]): string[] {
  try {
    if (lstatSync(dir).isSymbolicLink()) return []
  } catch {
    // Unreadable/raced-away root — same as `find`'s own silent skip.
    return []
  }
  const out: string[] = []
  function walk(d: string, depth: number) {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      // Unreadable directory — same as `find`'s own silent skip of one it
      // cannot enter; not a reason to abort the whole bug-test search.
      return
    }
    for (const name of entries) {
      const p = join(d, name)
      let st
      try {
        st = lstatSync(p)
      } catch {
        // Raced away between readdir and lstat, or unreadable — skip this
        // one entry, exactly as `find` moves on rather than aborting.
        continue
      }
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        if (maxDepth === undefined || depth < maxDepth) walk(p, depth + 1)
        continue
      }
      if (st.isFile() && exts.some((e) => name.endsWith(e))) out.push(p)
    }
  }
  walk(dir, 1)
  return out
}

function fileNamesBugInTitle(path: string, num: string): boolean {
  const content = readFileOrUndefined(path)
  if (content === undefined) return false
  const re = new RegExp(`(it|describe)(\\.[A-Za-z]+)?\\([^)]*BUG-0*${escapeRegExp(num)}\\b`)
  return content.split('\n').some((line) => re.test(line))
}

function stageBugtests(rangeList: string, notes: Notes): { rc: number; out: string[] } {
  const need = needParser()
  if (need) return { rc: 1, out: need }

  const items = itemsInPush(rangeList)
  const bugs = items.filter((i) => i.startsWith('BUG-')).map((i) => i.slice(4))
  if (bugs.length === 0) return { rc: 0, out: ['no BUG items in this push'] }

  const rl = testRoots()
  if (rl.rc !== 0) {
    return {
      rc: 1,
      out: [
        ...rl.out,
        '',
        "DoD §2 — the gate cannot tell where this project's tests live, so it",
        'cannot check that every BUG in this push has one.',
      ],
    }
  }
  const rootList = rl.roots ?? []

  const proj = realpathOrUndefined(process.cwd()) ?? process.cwd()
  const neverNames = ['docs', '.git', 'scripts', '.githooks']
  const nevers = neverNames.map((n) => ({ name: n, rp: realpathOrUndefined(n) })).filter((x) => x.rp !== undefined) as {
    name: string
    rp: string
  }[]

  const codeRoot = process.env.BP_CODE_ROOT ?? '.'
  const isBlueprint = existsSync('.blueprint-root')
  const shipped = isBlueprint ? undefined : realpathOrUndefined(join(codeRoot, 'tests'))
  // BUG-147: independent of the shipped/blueprint-repo distinction above,
  // `tests/` is ALWAYS the directory tests/vitest.config.ts governs — the
  // blueprint's own copy when this IS the blueprint, the shipped copy
  // otherwise. A root resolving into it stays TypeScript-only below no
  // matter which search mode it uses; every other root is the project's own.
  const tsDir = realpathOrUndefined(join(codeRoot, 'tests'))

  const plan: PlanEntry[] = []
  const searched: string[] = []
  const skipped: string[] = []

  for (const root of rootList) {
    if (root.length === 0) continue
    const rp = realpathOrUndefined(root)
    if (rp === undefined) {
      skipped.push(`${root}(not a directory)`)
      continue
    }
    if (!isDirWithinOrEqual(rp, proj)) {
      skipped.push(`${root}(outside the project)`)
      continue
    }
    let why = ''
    let mode: 'full' | 'shallow' = 'full'
    if (shipped !== undefined) {
      if (rp === shipped) {
        mode = 'shallow'
      } else {
        if (rp.startsWith(`${shipped}/`)) why = 'inside tests/'
        if (shipped.startsWith(`${rp}/`)) why = 'contains tests/'
      }
    }
    if (!why) {
      for (const x of nevers) {
        if (rp === x.rp) {
          why = `is ${x.name}/`
          break
        }
        if (x.rp.startsWith(`${rp}/`)) {
          why = `contains ${x.name}/`
          break
        }
        if (rp.startsWith(`${x.rp}/`)) {
          why = `inside ${x.name}/`
          break
        }
      }
    }
    if (why) {
      skipped.push(`${root}(${why})`)
      continue
    }
    const tsGoverned = tsDir !== undefined && isDirWithinOrEqual(rp, tsDir)
    plan.push({ root, rp, mode, tsGoverned })
    searched.push(mode === 'shallow' ? `${root}(top level only)` : root)
  }
  if (skipped.length) notes.push(`not searched:${skipped.map((x) => ` ${x}`).join('')}`)

  const untested: string[] = []
  const parked: string[] = []
  const tested: string[] = []
  const justified: string[] = []

  for (const nRaw of bugs) {
    const n = stripZeroPad(nRaw)
    const where = findRow(`BUG-${n}`)
    if (where === 'backlog' || where === 'cancelled') {
      parked.push(`BUG-${n}`)
      continue
    }

    let hit = false
    for (const entry of plan) {
      const maxDepth = entry.mode === 'shallow' ? 1 : undefined
      const exts = entry.tsGoverned ? TS_SPEC_EXTS : [...TS_SPEC_EXTS, ...PROJECT_ONLY_SPEC_EXTS]
      // BUG-147 differential: walk the DECLARED path (`entry.root`), not the
      // realpath-resolved `entry.rp`. `entry.rp` has already dereferenced a
      // symlinked root, which is exactly the string walkFiles' own top-level
      // lstat guard needs to still see AS a symlink — see that function's
      // header.
      const files = walkFiles(entry.root, maxDepth, exts)
      if (files.some((f) => fileNamesBugInTitle(f, n))) {
        hit = true
        break
      }
    }
    if (hit) {
      tested.push(`BUG-${n}`)
      continue
    }

    let markerHit = false
    for (const mf of ['docs/backlog/BUGS.md', 'docs/doing/BUGS.md', 'docs/waiting-acceptance/BUGS.md', 'docs/done/BUGS.md']) {
      const content = readFileOrUndefined(mf)
      if (content === undefined) continue
      const re = new RegExp(`^\\| \\*\\*BUG-0*${escapeRegExp(n)}\\*\\*.*\\*\\*No regression test:\\*\\*[ \\t]*[^ \\t|]`, 'm')
      if (re.test(content)) {
        markerHit = true
        break
      }
    }
    if (markerHit) justified.push(`BUG-${n}`)
    else untested.push(`BUG-${n}`)
  }

  if (parked.length) notes.push(`parked, no fix to test yet:${parked.map((x) => ` ${x}`).join('')}`)

  if (untested.length) {
    const out = [
      `No test TITLE and no row justification under the searched roots names:${untested.map((x) => ` ${x}`).join('')}`,
      `  searched:${searched.length ? searched.map((x) => ` ${x}`).join('') : ' nothing'}`,
    ]
    if (skipped.length) out.push(`  not searched:${skipped.map((x) => ` ${x}`).join('')}`)
    out.push(
      '',
      "DoD §2 — every bug fix carries a regression test whose TITLE names the",
      "bug (a comment does not count), so 'it is fixed' is checkable later by",
      'something other than trust. A bug that genuinely has no test — it does',
      "not reproduce, or similar — carries '**No regression test:** <reason>'",
      'on its own row instead. Declare where this project\'s tests live in',
      'project_config_paths.md:  - BP_TEST_ROOTS: `backend/src frontend/e2e`',
      "Outside the blueprint, tests/ holds the blueprint's suites and never counts.",
    )
    return { rc: 1, out }
  }

  const out: string[] = []
  if (tested.length) out.push(`regression tests found for:${tested.map((x) => ` ${x}`).join('')}`)
  if (justified.length) out.push(`no regression test, justified on the row for:${justified.map((x) => ` ${x}`).join('')}`)
  if (tested.length === 0 && justified.length === 0) out.push('every BUG in this push is parked — nothing to test yet')
  return { rc: 0, out }
}

// --- dod_stage_signal --------------------------------------------------

function runSh(script: string, args: string[]): { rc: number; stdout: string; stderr: string } {
  const res = spawnSync('sh', ['-c', script, 'sh', ...args], { encoding: 'utf8' })
  return { rc: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

function stageSignal(): { rc: number; out: string[] } {
  const codeRoot = process.env.BP_CODE_ROOT ?? '.'
  const stateDirLib = join(codeRoot, 'scripts/lib/state-dir.sh')
  let sig = ''
  let stateRoot = ''
  if (existsSync(stateDirLib)) {
    const script = `. "$1"\n: "\${BP_CODE_ROOT:=\$(pwd)}"\nBP_STATE_ROOT="\$(bp_state_root)" || exit 1\nsig="\$(agent_signal_file 2>/dev/null)"\nprintf '%s\\n%s\\n' "\$sig" "\$BP_STATE_ROOT"\n`
    const res = runSh(script, [stateDirLib])
    if (res.rc !== 0) {
      const out = res.stderr.replace(/\n$/, '').split('\n').filter((l) => l.length > 0)
      return { rc: 1, out: out.length ? out : ['baton resolution failed'] }
    }
    const lines = res.stdout.split('\n')
    sig = lines[0] ?? ''
    stateRoot = lines[1] ?? ''
  }

  if (!sig || !existsSync(sig)) {
    return { rc: 1, out: [`no live baton at ${sig || '<unresolved>'} — seed it with scripts/signal-set.sh`] }
  }

  const content = readFileSync(sig, 'utf8')
  for (const row of ['Holder', 'State', 'Task']) {
    if (!new RegExp(`^\\| ${row} \\|`, 'm').test(content)) {
      return {
        rc: 1,
        out: [`the live baton is missing its '${row}' row: ${sig}`, 'Publish it with scripts/signal-set.sh — never by hand.'],
      }
    }
  }

  const hm = /^\| Holder \| (.*) \|[ \t]*$/m.exec(content)
  const holder = (hm?.[1] ?? '').trim()
  if (!holder) {
    return {
      rc: 1,
      out: [`the live baton's Holder row is empty: ${sig}`, 'Publish a persona name with scripts/signal-set.sh — never by hand.'],
    }
  }

  const out: string[] = []
  if (holder !== 'Nobody') {
    const rosterLib = join(codeRoot, 'scripts/lib/roster.sh')
    if (existsSync(rosterLib)) {
      const fileCheck = runSh(`. "$1"\nbp_roster_file "$2" >/dev/null 2>&1\n`, [rosterLib, stateRoot])
      if (fileCheck.rc === 0) {
        const backingCheck = runSh(`. "$1"\nbp_roster_backing_for_name "$2" "$3" >/dev/null 2>&1\n`, [rosterLib, stateRoot, holder])
        if (backingCheck.rc !== 0) {
          return {
            rc: 1,
            out: [
              `the live baton's Holder '${holder}' names nobody on the roster: ${sig}`,
              "AGENT_SIGNAL.md says Holder is a persona name from AGENT_ROSTER.md, or 'Nobody' when nobody holds the mic.",
            ],
          }
        }
      } else {
        out.push(`no AGENT_ROSTER.md found — skipped the roster check for Holder '${holder}'`)
      }
    }
  }

  const cwd = process.cwd()
  const rel = sig.startsWith(`${cwd}/`) ? sig.slice(cwd.length + 1) : sig
  out.push(`baton well-formed: ${rel}`)
  return { rc: 0, out }
}

// --- dod_stage_judgement -------------------------------------------------

function stageJudgement(notes: Notes): { rc: number; out: string[] } {
  notes.push('§D docs in sync · §F cross-provider review · §H self-audit — judgement, not checked here')
  return {
    rc: 0,
    out: [
      'These three cannot be verified mechanically and are NOT claimed to be:',
      '  §D  user-facing docs match the change',
      "  §F  an agent of the OTHER provider reviewed it (DoD §1b rule 4)",
      '  §H  self-audit',
    ],
  }
}

// --- main ------------------------------------------------------------------

function usageError(msg: string): never {
  process.stderr.write(`internal error: ${msg}\n`)
  process.exit(2)
}

function main(): void {
  const [sub, arg1] = process.argv.slice(2)
  const notes = new Notes()
  let result: { rc: number; out: string[] }

  switch (sub) {
    case 'rows':
      if (arg1 === undefined) usageError('rows needs one range-list argument')
      result = stageRows(arg1, notes)
      break
    case 'bugtests':
      if (arg1 === undefined) usageError('bugtests needs one range-list argument')
      result = stageBugtests(arg1, notes)
      break
    case 'signal':
      result = stageSignal()
      break
    case 'judgement':
      result = stageJudgement(notes)
      break
    case 'items':
      if (arg1 === undefined) usageError('items needs one range-list argument')
      result = { rc: 0, out: itemsInPush(arg1) }
      break
    case 'find-row': {
      if (arg1 === undefined) usageError('find-row needs one item argument')
      const where = findRow(arg1)
      result = where === undefined ? { rc: 1, out: [] } : { rc: 0, out: [where] }
      break
    }
    case 'test-roots': {
      const r = testRoots()
      result = { rc: r.rc, out: r.rc === 0 ? r.roots ?? [] : r.out }
      break
    }
    default:
      usageError(`unknown subcommand '${sub ?? ''}' — expected one of: rows, bugtests, signal, judgement, items, find-row, test-roots`)
  }

  if (result.out.length) process.stdout.write(`${result.out.join('\n')}\n`)
  flushNotes(notes)
  process.exit(result.rc)
}

main()
