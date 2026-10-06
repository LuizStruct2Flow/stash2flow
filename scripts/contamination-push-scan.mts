// scripts/contamination-push-scan.mts — TASK-079 (TASK-062-16), audit row C168.
//
// THE FINDING THIS CLOSES. C168 was written as if `.githooks/pre-push` had a
// contamination call site that needed extending. It has none: measured, there
// is no push-time contamination scan at all — the contamination scan
// (scripts/lib/contamination.mts) runs only from `scripts/blueprint.mts`'s a2bp
// path. The ABSENCE of a push-time call site is the finding. The founder chose
// the CI-only route (PLAN-TASK-062.md §"Founder decisions" #3,
// 2026-09-22): "The existing checker scans the pushed diff, with no duplicated
// patterns and no port. Contamination on main is caught before released
// moves."
//
// REUSE, NOT A FORK. Every contamination pattern lives in
// scripts/lib/contamination.mts and nowhere else. This script extracts the
// ADDED lines of each file a push touches and hands them to the real
// `contaminationScan` — imported, not copied. A line blocked here is blocked
// by the same regex a2bp would apply, including the `a2bp-allow:
// <justification>` suppression, which works unchanged because it sits on the
// added line itself.
//
// THREE THINGS THE CALLER MUST KNOW:
//
//   1. BLUEPRINT-ONLY BY CONSTRUCTION. The job runs only in the blueprint's own
//      repository — its `if:` guards on `github.repository`, the `release`
//      job's precedent — so a derived project sees the job SKIPPED, never a
//      green check that scanned nothing. This script keeps its own
//      `.blueprint-root` check as the second mechanism: a fork that renamed the
//      repository and edited only one of the two guards still gets an
//      announced skip (exit 0), never a block on its own files for naming their
//      own project. Contamination PUBLISHES from the blueprint's `released`
//      branch; a derived project's push publishes nothing (a2bp's own scan is
//      its pre-publication stop).
//
//   2. ONLY FILES THAT SHIP ARE SCANNED. The rule this mechanises (AGENTS.md
//      §"What blueprint sync covers") is about a blueprint-MANAGED file, and a
//      path whose `export-ignore` attribute is set ships to nobody — it cannot
//      contaminate anything. This repo's own records (`docs/done/**`,
//      `docs/config/**`, the audit CSV) quote host paths ON PURPOSE, and the
//      DoD lifecycle re-adds those rows as added lines at every acceptance, so
//      scanning them would go red on every push that moves a bug. The decision
//      is `git archive` at the range tip, listed — the SAME command
//      bp_managed_files (scripts/blueprint.mts) derives the managed set with, so
//      no path list is kept here and no second reading of `.gitattributes`
//      exists to disagree with it. NOT `git check-attr`: round 2 read that,
//      and a trailing-slash directory rule (`tests/<suite>/  export-ignore`,
//      the shape ten of this repo's lines use) sets the attribute on the
//      directory, so check-attr answers `unspecified` for every file the
//      archive drops (tests/contamination-push-scan #9, tests/suite-sync #1c).
//      Skipped files are counted in the summary, never dropped silently.
//
//   3. THE RESIDUAL-NAME CLASS HAS NO OPERAND HERE. contaminationScan's third
//      BLOCK class flags a project's name that survived reverse-substitution —
//      meaningful on the a2bp path, where the name is the project's own. On a
//      push to the blueprint there is no reverse-substitution and no single
//      project name to scan for (the repo's own basename is "blueprint", a
//      word its docs use constantly — measured unusable as a pattern). The
//      checker's signature demands a name, so it runs with the repo's basename;
//      this script keys on the checker's own reason string, never blocks on
//      that class, and prints its hit COUNT as one line instead of every hit —
//      measured, the per-hit form was 86 of 100 log lines over one real push
//      range, burying the findings that do block. The host-path and
//      foreign-dot-dir classes — the BUG-002 and A-09 shapes — stand
//      unfiltered. No pattern is duplicated to do any of this.
//
// WHAT CI-ONLY DOES NOT PROTECT. A contaminated push still LANDS on main; this
// scan detects it after the push, and the `release` job's needs-list is what
// keeps it from advancing `released` — the boundary every downstream project
// pulls from. Detection before publication, never prevention of the push.
//
// Usage:
//   node scripts/contamination-push-scan.mts --range BASE..AFTER [--repo DIR]
//   node scripts/contamination-push-scan.mts --before B --after A [--repo DIR]
//
// --before/--after carries the push-event semantics (new branch, rollback,
// rewritten history) so the workflow stays a thin caller and this script stays
// driveable exactly the way the job drives it. Exit 1 on any BLOCK finding.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { contaminationScan } from './lib/contamination.mts'

/** The reason prefix contaminationScan prints for its residual-name class. */
const NAME_CLASS_REASON = 'project name survived reverse-substitution'

interface Finding {
  readonly file: string
  /** One raw `lineno|CLASS|reason|text` line from contaminationScan. */
  readonly line: string
}

interface Options {
  readonly range?: string
  readonly before?: string
  readonly after?: string
  readonly repo?: string
}

function usage(): never {
  console.error(
    'usage: node scripts/contamination-push-scan.mts --range A..B [--repo DIR]\n' +
      '       node scripts/contamination-push-scan.mts --before B --after A [--repo DIR]',
  )
  process.exit(2)
}

function parseArgs(argv: string[]): Options {
  const opts: { range?: string; before?: string; after?: string; repo?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    const value = argv[i + 1]
    if (value === undefined) usage()
    switch (key) {
      case '--range':
        opts.range = value
        break
      case '--before':
        opts.before = value
        break
      case '--after':
        opts.after = value
        break
      case '--repo':
        opts.repo = value
        break
      default:
        usage()
    }
    i++
  }
  if (opts.range === undefined && (opts.before === undefined || opts.after === undefined)) usage()
  return opts
}

function git(repo: string, args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (err) {
    const e = err as { status?: number; stdout?: string }
    return { code: e.status ?? 127, out: typeof e.stdout === 'string' ? e.stdout : '' }
  }
}

/** Push-event range semantics, mirroring the commit-subjects job's step. */
function resolveRange(repo: string, opts: Options): string | null {
  if (opts.range !== undefined) return opts.range
  const before = opts.before ?? ''
  const after = opts.after ?? ''
  // All-zeros (or empty) BEFORE means a new branch — the shell original wrote
  // this as the glob `*[!0]*`: "contains a character that is not 0".
  if (!/[^0]/.test(before)) {
    console.log('::warning::new branch push: checking the tip commit only (partial coverage)')
    return `${after}^!`
  }
  const afterInBefore = git(repo, ['merge-base', '--is-ancestor', after, before])
  if (afterInBefore.code === 0) {
    console.log('force push back to an earlier commit: nothing new to scan')
    return null
  }
  const beforeInAfter = git(repo, ['merge-base', '--is-ancestor', before, after])
  if (beforeInAfter.code !== 0) {
    console.log('::warning::force push rewrote history: checking the tip commit only (partial coverage)')
    return `${after}^!`
  }
  return `${before}..${after}`
}

/** Files the push added or modified (renames listed by their new path). */
function changedFiles(repo: string, range: string): string[] {
  const r = git(repo, ['diff', '--name-only', '-z', '--diff-filter=AMR', range])
  if (r.code !== 0) {
    console.error(`::error::git diff --name-only ${range} failed — refusing to scan nothing and call it clean`)
    process.exit(1)
  }
  // With -z a rename emits old\0new. Both entries are harmless to scan: the
  // old path's diff has no added lines, the new path's carries the content.
  return r.out.split('\0').filter((e) => e.length > 0)
}

/**
 * The commit whose tree ships: the AFTER side of `BASE..AFTER`, or the one
 * commit of `X^!` — the two shapes resolveRange produces and usage documents.
 */
function rangeTip(range: string): string {
  const tip = range.replace(/\^!$/, '').split(/\.{2,3}/).pop() ?? ''
  if (tip === '') {
    console.error(`::error::cannot tell the tip commit of range ${range} — refusing to guess what ships`)
    process.exit(1)
  }
  return tip
}

/**
 * Splits `files` into what ships and what does not (header, point 2): what
 * `git archive` lists at the range tip ships, everything else reaches nobody.
 * One archive per push, not a git call per file — a 3 MB tar listed once.
 * Not `blueprint files`: that lists HEAD, not the pushed tip, and subtracts
 * the project-owned seeds (TEMPLATE_FILES), which bootstrap still ships.
 */
function shippedFiles(repo: string, tip: string, files: string[]): { shipped: string[]; unshipped: string[] } {
  if (files.length === 0) return { shipped: [], unshipped: [] }
  let listing: string
  try {
    const tar = execFileSync('git', ['-C', repo, 'archive', '--format=tar', tip], {
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024,
    })
    listing = execFileSync('tar', ['-t'], { input: tar, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    const e = err as { status?: number; stderr?: string | Buffer }
    console.error(
      `::error::listing git archive ${tip} failed (exit ${e.status ?? 127}): ${String(e.stderr ?? '')} — refusing to guess what ships`,
    )
    process.exit(1)
  }
  const archived = new Set(listing.split('\n').filter((l) => l !== '' && !l.endsWith('/')))
  if (archived.size === 0) {
    console.error(`::error::git archive ${tip} lists no files — refusing to read an empty archive as "nothing ships"`)
    process.exit(1)
  }
  const shipped: string[] = []
  const unshipped: string[] = []
  for (const f of files) (archived.has(f) ? shipped : unshipped).push(f)
  return { shipped, unshipped }
}

/** The lines a push ADDED to one file — what the checker judges. */
function addedLines(repo: string, range: string, file: string): string[] {
  const r = git(repo, ['diff', '--unified=0', '--no-color', range, '--', file])
  if (r.code !== 0) {
    console.error(`::error::git diff ${range} -- ${file} failed — refusing to scan nothing and call it clean`)
    process.exit(1)
  }
  return r.out
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2))
  const repo =
    opts.repo ??
    (() => {
      const top = git('.', ['rev-parse', '--show-toplevel']) // bp-allow-toplevel: a CI/manual tool, never run from a git hook, so no exported GIT_DIR can redirect it
      if (top.code !== 0) {
        console.error('::error::not inside a git repository and no --repo given')
        process.exit(1)
      }
      return top.out.trim()
    })()

  if (!existsSync(join(repo, '.blueprint-root'))) {
    console.log(
      '::notice::no .blueprint-root in this checkout — this is a derived project, where a push ' +
        'publishes nothing (a2bp scans at filing time). The contamination push scan runs on the ' +
        "blueprint's own pushes, where `released` is the boundary downstream projects pull from. SKIP.",
    )
    return
  }

  const range = resolveRange(repo, opts)
  if (range === null) return

  // The checker's signature demands a name. In the blueprint checkout that is
  // the repo's own basename, and the class it feeds is counted, not blocked
  // on (header, point 3). The host path, foreign dot-dir and email classes
  // run unfiltered.
  const projName = basename(repo)
  const tmp = mkdtempSync(join(tmpdir(), 'contamination-push-scan-'))
  try {
    const blocked: Finding[] = []
    const notices: Finding[] = []
    let demoted = 0
    let scannedFiles = 0
    let scannedLines = 0
    const { shipped, unshipped } = shippedFiles(repo, rangeTip(range), changedFiles(repo, range))
    for (const file of shipped) {
      const added = addedLines(repo, range, file)
      if (added.length === 0) continue
      scannedFiles++
      scannedLines += added.length
      const contentFile = join(tmp, 'added-lines')
      writeFileSync(contentFile, `${added.join('\n')}\n`)
      // The REAL checker, for logical path `file`. A checker that cannot run
      // throws out of main() — a non-zero exit with no PASS line, never a
      // clean scan it did not make.
      for (const line of contaminationScan(contentFile, projName, file).findings) {
        const fields = line.split('|')
        const finding: Finding = { file, line }
        if (fields[2]?.startsWith(NAME_CLASS_REASON)) {
          demoted++
        } else if (fields[1] === 'BLOCK') {
          blocked.push(finding)
        } else {
          notices.push(finding)
        }
      }
    }
    for (const f of notices) console.log(`${f.file}: ${f.line}`)
    if (demoted > 0) {
      console.log(
        `${demoted} residual-name hit(s) demoted and not printed: the class has no operand on a blueprint push (see the header)`,
      )
    }
    for (const f of blocked) console.log(`::error::${f.file}: ${f.line}`)
    // The tally is what separates a clean scan of 40 files and a scan of
    // nothing at all: a zero here is announced, never read as a pass.
    // (Phrased without the word pairing that ts_scripts_no_bare_imports
    // greps for — that guard reads comments too, and a comment quoting a
    // string after it fails the gate's typecheck stage.)
    const tally =
      `scanned ${scannedFiles} file(s), ${scannedLines} added line(s) in ${range}` +
      ` (${unshipped.length} changed file(s) skipped: absent from git archive at the tip, they ship to nobody)`
    if (blocked.length > 0) {
      console.log(
        `contamination-push-scan: ${blocked.length} BLOCK finding(s); ${tally}. ` +
          'Move project-specific content out of the managed file, or mark a known-benign line ' +
          '`a2bp-allow: <why it is safe>` — the same override a2bp honours.',
      )
      process.exit(1)
    }
    if (scannedFiles === 0) console.log(`::warning::contamination-push-scan: ${tally} — nothing was judged`)
    console.log(`contamination-push-scan: no BLOCK findings; ${tally}. PASS.`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

main()
