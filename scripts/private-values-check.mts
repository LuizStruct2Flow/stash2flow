// scripts/private-values-check.mts — FEATURE-001, slice 1.
//
// The repository is public, and no tracked file may carry anything about one
// installation: no account addresses, no personal names, no folder names from
// the sources, no machine names, no real document titles
// (docs/concept/principles.md#public-repository). Until now that was a manual
// grep before each push (docs/PUBLISHING.md §2). This is the machine check.
//
// THE VALUES LIVE IN ONE UNTRACKED FILE, `.private-values` at the repository
// root: one value per line, `#` comments and blank lines ignored. It is
// gitignored, so it never ships; `.private-values.example` is the tracked
// template with invented values.
//
// WHAT IS JUDGED, for every range the push publishes:
//   (a) every tracked file as of the commit being pushed (the range's tip);
//   (b) the message of every commit in the range;
//   (c) every line a commit in the range ADDED — a value written in one commit
//       and removed in the next is absent from the tip and still lands in the
//       public history, so (a) alone would let it through.
// Letter case is ignored. A value made of letters only matches whole words
// (so a name does not fire inside a longer word); anything else (an address,
// a path, a title with spaces) matches as a substring.
//
// WHAT IS PRINTED NEVER INCLUDES A VALUE IN FULL: gate output ends up in logs
// and feeds. A hit names the file and line, or the commit, plus the value's
// line in the list and a mask (first and last character).
//
// A MISSING LIST IS NOT A PASS. It is reported as NOT CHECKED and exits 0, so a
// checkout that has no list by design (a contributor's clone, CI) is not
// blocked; the gate renders it as a skip, which on the founder's machine is the
// fault to notice. A list that exists but holds no value is refused: the
// machine meant to check and checked nothing. A value too short is refused when
// the list is read, because it would match everywhere: under four characters,
// or under three for a value made of letters only, which is matched as a whole
// word and so fires only on that word (a short first name, an abbreviation).
//
// Usage:
//   node scripts/private-values-check.mts [--repo DIR] --range SELECTOR [--range SELECTOR …]
// SELECTOR is what .githooks/pre-push's push_log_opts prints: `BASE..TIP` for
// an updated ref, a bare sha for a new branch (its whole history). Exit 1 on
// any hit or a refused list, 2 on usage.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LIST = '.private-values'
const MIN_LENGTH = 4
const MIN_LENGTH_WORD = 3 // letters only: matched as a whole word, so it does not fire everywhere

interface Value {
  readonly line: number
  readonly text: string
  readonly regex: RegExp
}

function usage(): never {
  console.error('usage: node scripts/private-values-check.mts [--repo DIR] --range SELECTOR [--range SELECTOR …]')
  process.exit(2)
}

function parseArgs(argv: string[]): { repo: string; ranges: string[] } {
  let repo = '.'
  const ranges: string[] = []
  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1]
    if (value === undefined) usage()
    if (argv[i] === '--repo') repo = value
    else if (argv[i] === '--range') ranges.push(value)
    else usage()
  }
  return { repo, ranges }
}

function git(repo: string, args: string[], input?: string): Buffer {
  return execFileSync('git', ['-C', repo, ...args], {
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'inherit'],
    maxBuffer: 1024 * 1024 * 1024,
    ...(input === undefined ? {} : { input }),
  })
}

function mask(text: string): string {
  return `${text[0]}***${text[text.length - 1]}`
}

/** Read the list. Returns null when there is no list to read. */
function readList(repo: string): Value[] | null {
  const path = join(repo, LIST)
  if (!existsSync(path)) return null
  const values: Value[] = []
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((raw, i) => {
      const text = raw.trim()
      if (text === '' || text.startsWith('#')) return
      const lettersOnly = /^\p{L}+$/u.test(text)
      const min = lettersOnly ? MIN_LENGTH_WORD : MIN_LENGTH
      if (text.length < min) {
        console.error(
          `private-values-check: ${LIST}:${i + 1} is ${text.length} character(s) long; ` +
            `${min} is the minimum for a value ${lettersOnly ? 'of letters only' : 'with digits or signs'}, ` +
            `a shorter value would match everywhere. Refused.`,
        )
        process.exit(1)
      }
      const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = lettersOnly
        ? new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu')
        : new RegExp(escaped, 'iu')
      values.push({ line: i + 1, text, regex })
    })
  if (values.length === 0) {
    console.error(`private-values-check: ${LIST} holds no value, so nothing was checked. Refused: fill it or delete it.`)
    process.exit(1)
  }
  return values
}

/** The commit whose tree ships: TIP of `BASE..TIP`, or the bare sha. */
function tipOf(selector: string): string {
  const tip = selector.split(/\.{2,3}/).pop() ?? ''
  if (tip === '') {
    console.error(`private-values-check: cannot tell the tip of range ${selector}. Refusing to guess.`)
    process.exit(1)
  }
  return tip
}

function main(): void {
  const { repo, ranges } = parseArgs(process.argv.slice(2))
  if (ranges.length === 0) usage()

  const values = readList(repo)
  if (values === null) {
    console.log(
      `private-values-check: NOT CHECKED — no ${LIST} in this checkout. ` +
        `A clone without one is fine; on the machine that holds the private values it is a fault: ` +
        `cp ${LIST}.example ${LIST} and fill it.`,
    )
    return
  }

  const hits = new Set<string>()
  const hit = (where: string, v: Value) => hits.add(`${where}  ${LIST}:${v.line} (${mask(v.text)})`)
  const judge = (where: string, text: string) => {
    for (const v of values) if (v.regex.test(text)) hit(where, v)
  }
  let files = 0
  let commits = 0
  let added = 0

  for (const range of ranges) {
    const tip = tipOf(range)
    const short = tip.slice(0, 7)

    // (a) every tracked file at the tip, one cat-file process for the tree.
    // ponytail: the whole tree is held in memory; stream cat-file if a tree ever outgrows RAM.
    const paths = git(repo, ['ls-tree', '-r', '-z', '--name-only', tip]).toString('utf8').split('\0').filter(Boolean)
    const blobs = git(repo, ['cat-file', '--batch'], paths.map((p) => `${tip}:${p}\n`).join(''))
    let offset = 0
    for (const path of paths) {
      const headerEnd = blobs.indexOf(0x0a, offset)
      const header = blobs.subarray(offset, headerEnd).toString('utf8').split(' ')
      if (header[1] === 'missing') {
        console.error(`private-values-check: ${tip}:${path} is missing from the object store. Refusing to read nothing as clean.`)
        process.exit(1)
      }
      const size = Number(header[2])
      const content = blobs.subarray(headerEnd + 1, headerEnd + 1 + size)
      offset = headerEnd + 1 + size + 1
      files++
      if (content.includes(0)) continue // binary: no text to judge
      content
        .toString('utf8')
        .split('\n')
        .forEach((line, i) => judge(`${path}:${i + 1} (at ${short})`, line))
    }

    // (b) every commit message, (c) every added line, from one log each.
    for (const record of git(repo, ['log', '-z', '--format=%H%n%B', range]).toString('utf8').split('\0')) {
      if (record === '') continue
      const nl = record.indexOf('\n')
      commits++
      judge(`commit ${record.slice(0, 7)} message`, record.slice(nl + 1))
    }
    for (const record of git(repo, ['log', '-p', '-m', '-U0', '--no-color', '--format=%x00%H', range])
      .toString('utf8')
      .split('\0')) {
      if (record === '') continue
      const sha = record.slice(0, 7)
      let path = ''
      let lineNo = 0
      for (const line of record.split('\n')) {
        if (line.startsWith('+++ b/')) path = line.slice(6)
        else if (line.startsWith('@@')) lineNo = Number(/\+(\d+)/.exec(line)?.[1] ?? 0)
        else if (line.startsWith('+') && !line.startsWith('+++')) {
          added++
          judge(`commit ${sha} ${path}:${lineNo}`, line.slice(1))
          lineNo++
        }
      }
    }
  }

  const tally = `checked ${files} tracked file(s) at the tip, ${commits} commit message(s) and ${added} added line(s) in ${ranges.join(' ')}`
  if (hits.size > 0) {
    console.log(`private-values-check: ${hits.size} hit(s). Nothing about one installation may reach the public repository.`)
    for (const h of hits) console.log(`  ${h}`)
    console.log(`  ${tally}`)
    process.exit(1)
  }
  console.log(`private-values-check: no hits; ${tally} against ${values.length} value(s). PASS.`)
}

main()
