/**
 * tests/forbidden-idiom/forbidden-idiom.spec.ts — BUG-076, WIDENED by BUG-077.
 *
 * THE RULE, and it is scoped to the HAZARD rather than to a subsystem:
 *
 *   No script in this repository resolves a path with
 *   `git rev-parse --show-toplevel`.
 *
 * WHY, stated as the question the command answers rather than as a list of
 * places it has hurt us. `--show-toplevel` answers *"what repository does my
 * caller's git environment point at"*. Nothing here is asking that. Every
 * consumer needs one of two other things:
 *
 *   * its CODE root — where the scripts and suites it runs live. Answered by
 *     the physical-script block (`BP_CODE_ROOT`), or by `pwd` where git's hook
 *     contract guarantees the work-tree root.
 *   * its STATE root — where the live baton, roster, logs and lifecycle docs
 *     live. Answered by `bp_state_root`, an upward filesystem walk.
 *
 * Both are answerable without git, and the git answer differs from both — under
 * a redirected `GIT_DIR` today (git exports it to every hook, and the gate runs
 * the suites from a pre-push hook: BUG-014's mechanism, A-09's consequence),
 * and under TASK-021's code/state split tomorrow, where the repository root and
 * the code root are simply different directories.
 *
 * HOW THE SCOPE GOT HERE, because the history is the argument for the shape.
 *
 * `tests/state-dir` #6c banned the idiom for *state-dir consumers* and swept
 * `scripts/agent-activity.sh` plus three dispatchers. BUG-076 found that it
 * never looked in `scripts/lib/`, where `state-dir.sh` was the one file that
 * actually contained the expression; the port widened the sweep to
 * `scripts/lib/` but kept the subsystem filter.
 *
 * BUG-077 then found `scripts/lib/feed.sh` and `scripts/lib/gate.sh` — both
 * carrying the idiom, both OUTSIDE that filter, and both faithfully green under
 * the old rule AND the port. A mutation of either implementation would have
 * shown nothing, because both were correctly out of scope. Only running 19
 * trees through both and diffing verdicts surfaced it. The scope was never
 * wrong; it was narrower than the hazard. So the filter is gone: `feed.sh` now
 * follows from the rule instead of being named by it, and so does the next file
 * nobody has thought of.
 *
 * THE ESCAPE, and why it is a comment rather than a list here. A file that
 * genuinely needs the caller's git environment marks the line
 * `bp-allow-toplevel: <why it is safe>`. A justification that lives on the line
 * cannot drift away from it, which an exemption list in this spec would.
 *
 * MATCHING THE COMMAND, NOT THE WORD "git". `bp_state_root` legitimately tests
 * for a `.git` path — that is the whole point of a filesystem walk no
 * environment variable can redirect. A guard that fired on it would be noise,
 * and this repo has already learned that a guard which flags the benign case
 * gets ignored.
 *
 * MUTATION RECIPE (R6) — observed red, not predicted:
 *   Restore `_fl_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"` in
 *   scripts/lib/feed.sh, or the `${1:-$(git rev-parse --show-toplevel ...)}`
 *   default in scripts/lib/gate.mts (the population lists `.mts` files since
 *   TASK-088, so this recipe is aimed at the gate policy itself).
 *   → this spec goes red naming the file and line. The pre-BUG-077 version
 *     stayed green on both, which is the whole reason this file changed.
 */

import { describe, it, expect } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import ts from 'typescript'
import { join } from 'node:path'
import { REPO_ROOT } from '../harness/index.js'
import { resolveConsumerFile } from '../state-dir/state-dir.js'

/**
 * `git … rev-parse … --show-toplevel` on one line.
 *
 * Deliberately tolerant of what sits between the words: `git -C "$d" rev-parse`
 * is the same hazard and is in fact WORSE, because `-C` reads as a scoping flag
 * while an exported GIT_DIR overrides it. Matching `git … rev-parse … --short`
 * or a bare `.git` path test is what the second half of #H2 pins against.
 */
const FORBIDDEN = /\bgit\b[^\n]*\brev-parse\b[^\n]*--show-toplevel/

/** An inline waiver, with its reason. A bare marker does not count. */
const WAIVED = /bp-allow-toplevel:\s*\S/

/**
 * Every executable this repository ships or runs, in one population.
 *
 * Derived from the filesystem, never from a list: a list is a second
 * description of what `scripts/` and `.githooks/` already say, and the drift
 * between them is how #6c stayed green over the one file that broke it.
 */
async function population(): Promise<string[]> {
  const out: string[] = []
  for (const dir of ['scripts', 'scripts/lib']) {
    const names = await readdir(join(REPO_ROOT, dir))
    for (const n of names) {
      if (n.endsWith('.sh') || n.endsWith('.mts')) out.push(`${dir}/${n}`)
    }
  }
  // The hooks are where the hazard is REAL rather than latent: git exports
  // GIT_DIR into exactly these processes.
  for (const n of await readdir(join(REPO_ROOT, '.githooks'))) {
    if (n.endsWith('.example')) continue
    out.push(`.githooks/${n}`)
  }
  return out.sort()
}

describe('BUG-076 / BUG-077 — nothing resolves a path with git rev-parse --show-toplevel', () => {
  it('#H the forbidden idiom is absent from scripts/, scripts/lib/ and .githooks/', async () => {
    const files = await population()
    const offenders: string[] = []

    for (const rel of files) {
      // TASK-088: a port deletes its shell file, so the population now lists
      // the `.mts` files themselves (a ported script's idiom lives there).
      // resolveConsumerFile reads an `.mts` as TypeScript, whose comments are
      // `//`, and a shell path as shell.
      const resolved = resolveConsumerFile(REPO_ROOT, rel)
      if (resolved === undefined) continue
      const body = resolved.source
      // A 'ts' consumer's comments are `//`, not `#` — following the shim to
      // scripts/signal-watch.mts (already migrated) surfaced this: its own
      // doc comment explaining why it does NOT use the idiom is line-prefixed
      // with `//`, and stripping only `#` left the idiom visible inside it,
      // a false positive the shell-only stripping never had to handle.
      const stripComment = resolved.kind === 'ts' ? /\/\/.*$/ : /#.*$/
      body.split('\n').forEach((line, i) => {
        // Comments are documentation: this very file's subjects explain in
        // prose why they do NOT use the idiom, and flagging that would train
        // people to ignore the guard.
        const code = line.replace(stripComment, '')
        if (!FORBIDDEN.test(code)) return
        if (WAIVED.test(line)) return
        offenders.push(`${resolved.rel}:${i + 1}`)
      })
    }

    expect(offenders).toEqual([])

    // Non-vacuity, per surface. The widening IS the point of this spec, so a
    // population that quietly stopped covering one of the three directories
    // would make it pass by looking at nothing — which is the defect class the
    // whole file is about.
    const count = (p: string) => files.filter((f) => f.startsWith(p)).length
    expect(count('scripts/lib/'), 'scripts/lib/ is not being scanned').toBeGreaterThanOrEqual(10)
    expect(count('scripts/'), 'scripts/ is not being scanned').toBeGreaterThanOrEqual(20)
    expect(count('.githooks/'), '.githooks/ is not being scanned').toBeGreaterThanOrEqual(3)
    expect(files, 'the sync CLI dropped out of the population').toContain('scripts/blueprint.mts')
  })

  it('#H2 the matcher fires on the command and not on the word "git"', async () => {
    // Two halves of one claim, because a guard that is merely strict is a guard
    // people delete. `bp_state_root`'s `.git` test is the SAFE expression the
    // ban exists to make possible, and it must stay unflagged.
    expect(FORBIDDEN.test('  _r="$(git rev-parse --show-toplevel 2>/dev/null)"')).toBe(true)
    expect(FORBIDDEN.test('  _r="$(git -C "$d" rev-parse --show-toplevel)"')).toBe(true)
    expect(FORBIDDEN.test('  while [ ! -e "$d/.git" ]; do')).toBe(false)
    expect(FORBIDDEN.test('  git rev-parse --short HEAD')).toBe(false)

    // And the waiver needs a reason, not a token.
    expect(WAIVED.test('x  # bp-allow-toplevel: the caller IS the repo under test')).toBe(true)
    expect(WAIVED.test('x  # bp-allow-toplevel:')).toBe(false)
  })
})

/**
 * TASK-073 / audit row C095 — a swallowed error can never land silently.
 *
 * AGENTS.md §"Observability is a main concern": every error path is captured,
 * no silent fallback, no try/catch that returns success. Whole, that is
 * judgement. The Architects' review narrowed the audit row to the ONE syntactic
 * sub-rule a check can hold: a bindingless `catch {` whose block neither
 * rethrows nor carries a comment saying why swallowing is right there. Only
 * that sub-rule is enforced here. Whether a commented swallow is CORRECT stays
 * a review question, as does a bound `catch (e)` that never reads `e`.
 *
 * The walk is over the PARSED tree (the TASK-068 pattern): a comment counts
 * only when it sits inside the catch block or trails the `catch {` line, so
 * prose three lines above a helper cannot be mistaken for its justification,
 * and only when it carries at least two words (see `reasoned` below).
 * Returns the number of bindingless clauses seen, for the non-vacuity floor.
 */
function silentCatches(source: string, file: string): { seen: number; silent: string[] } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const silent: string[] = []
  let seen = 0

  const rethrows = (n: ts.Node): boolean => ts.isThrowStatement(n) || ts.forEachChild(n, rethrows) === true

  // Every token inside the braces. A comment is leading trivia of the token
  // after it, or trailing trivia of the token before it when on the same line.
  // The comments' TEXT is what counts, pooled across the block: Jesko (Codex)
  // found that a bare `//` satisfied the first version, so two characters
  // silenced the check forever — a comment token standing in for a reason is
  // the F-002 shape one level up. The floor is two words: one word is a label
  // ("ENOENT", "ignore"), and two is the smallest thing that can relate a
  // cause to a consequence ("absence expected"). A longer floor would be an
  // arbitrary number that rejects honest terse reasons; whether the words are
  // TRUE no check can hold, and the prose says so.
  const reasoned = (block: ts.Block): boolean => {
    const tokens: ts.Node[] = []
    const collect = (n: ts.Node): void => {
      for (const c of n.getChildren(sf)) {
        tokens.push(c)
        collect(c)
      }
    }
    collect(block)
    const ranges: ts.CommentRange[] = []
    tokens.forEach((t, i) => {
      if (i > 0) ranges.push(...(ts.getLeadingCommentRanges(source, t.getFullStart()) ?? []))
      ranges.push(...(ts.getTrailingCommentRanges(source, t.getEnd()) ?? []))
    })
    const text = ranges.map((r) => source.slice(r.pos, r.end)).join(' ')
    return (text.match(/[A-Za-z0-9]+/g) ?? []).length >= 2
  }

  const visit = (n: ts.Node): void => {
    if (ts.isCatchClause(n) && n.variableDeclaration === undefined) {
      seen++
      if (!rethrows(n.block) && !reasoned(n.block)) {
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf))
        silent.push(`${file}:${line + 1}`)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return { seen, silent }
}

/** Every `.ts` / `.mts` under scripts/ and tests/, node_modules excluded. Derived, never listed. */
async function typescriptFiles(): Promise<string[]> {
  const out: string[] = []
  const walk = async (rel: string): Promise<void> => {
    for (const e of await readdir(join(REPO_ROOT, rel), { withFileTypes: true })) {
      if (e.name === 'node_modules') continue
      const p = `${rel}/${e.name}`
      if (e.isDirectory()) await walk(p)
      else if (/\.m?ts$/.test(e.name)) out.push(p)
    }
  }
  for (const dir of ['scripts', 'tests']) await walk(dir)
  return out.sort()
}

describe('TASK-073 / C095 — a bindingless catch says why it swallows, or rethrows', () => {
  it('silentCatches flags a bare swallow and accepts a rethrow, a comment, or a binding', () => {
    const source = [
      'function a() { try { f() } catch { return 1 } }', // 1: silent, returns success
      'function b() { try { f() } catch {} }', // 2: silent, empty
      'function c() { try { f() } catch { // absence is the probed state', // 3: trailing comment on the catch line
      '  return null } }',
      'function d() { try { f() } catch {', // 5: comment inside the block
      '  // ENOENT is the expected path here',
      '} }',
      'function e() { try { f() } catch { if (x) throw new Error("y") } }', // 8: rethrows, nested
      'function g() { try { f() } catch (err) { return 1 } }', // 9: bound — outside this sub-rule
      '// a catch { in a comment is prose, not a clause',
      "const s = 'catch { in a string is data'",
      'function h() { try { f() } catch { //', // 12: an EMPTY comment is two characters, not a reason
      '  return null } }',
      'function i() { try { f() } catch { /*   */ return null } }', // 14: whitespace-only, the same
      'function j() { try { f() } catch { // ENOENT', // 15: one word is a label, not a reason
      '  return null } }',
      'function k() { try { f() } catch { // not', // 17: two words pooled across two comments
      '  return null // there',
      '} }',
    ].join('\n')
    expect(silentCatches(source, 'x.ts')).toEqual({
      seen: 9,
      silent: ['x.ts:1', 'x.ts:2', 'x.ts:12', 'x.ts:14', 'x.ts:15'],
    })
  })

  it('#live no bindingless catch under scripts/ or tests/ swallows without saying why', async () => {
    const files = await typescriptFiles()
    let seen = 0
    const silent: string[] = []
    for (const rel of files) {
      const r = silentCatches(await readFile(join(REPO_ROOT, rel), 'utf8'), rel)
      seen += r.seen
      silent.push(...r.silent)
    }

    expect(
      silent,
      'a bindingless catch with no rethrow and no comment hides an error path — rethrow, report, or say in the block why swallowing is right (AGENTS.md §"Observability is a main concern")',
    ).toEqual([])

    // Non-vacuity. 72 files and 41 clauses ship to a derived project, 48 clauses live here.
    expect(files.length, 'scripts/ and tests/ are not being scanned').toBeGreaterThanOrEqual(30)
    expect(seen, 'no bindingless catch was parsed, so this proves nothing').toBeGreaterThanOrEqual(20)
  })
})
