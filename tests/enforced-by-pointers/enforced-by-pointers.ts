/**
 * tests/enforced-by-pointers/enforced-by-pointers.ts — every `enforced by:`
 * pointer resolves to a real test title.
 *
 * TASK-062, goal (d) — Christian's half of the founder's compromise
 * (PLAN-TASK-062.md §5, "Founder decisions" #1): each wave-1 task
 * carries an `enforced by: tests/<suite> "<it title>"` pointer in the prose it
 * replaces, and a doc check asserts every pointer resolves to a real test
 * title. This is that check.
 *
 * FORMS IN USE, all matched by one pattern (`enforced by:`, case-insensitive,
 * an optional backtick-quoted `tests/<suite>`, then a double-quoted title):
 *
 *   enforced by: tests/forbidden-idiom "#live no bindingless catch …".
 *   enforced by: `tests/gate-ci-parity` "TASK-078: every local gate stage …
 *     …has a CI counterpart".
 *   **Enforced by: `tests/lifecycle-docs` "TASK-070: every parked …**
 *   (enforced by: `tests/doc-links` "THE REAL TREE\n  — every path …").
 *
 * The title is free to WRAP across lines in prose — the doc is filled to a
 * column width, the `it()` string is not. So the quoted capture is
 * whitespace-normalised (every run of whitespace, including the newline and
 * its leading indent, collapsed to one space) before comparison; the real
 * `it()`/`describe()` title is normalised the same way, which is a no-op for
 * a title that never had a line break to begin with.
 *
 * WHAT IS NOT A POINTER. `docs/DoD.md:165` ("enforced by its own test
 * runner") and `AGENT_SIGNAL.md:192` ("enforced by the hook") name no
 * `tests/<suite>`, so they do not match — correctly: there is nothing here to
 * resolve.
 *
 * SUITE -> TITLES. A suite is a directory under `tests/`; every `*.spec.ts`
 * (and `*.spec.tsx`) under it, recursively, contributes its `it()`,
 * `test()`, `it.only()`/`.skip()` and `describe()` string-literal titles to
 * one pool for the suite (`tests/doc-links` holds both `doc-links.spec.ts`
 * and `doc-sync-list.spec.ts` — TASK-062's own `doc-links` pointer is a
 * `doc-sync-list.spec.ts` title). Parsed with the TypeScript compiler's own
 * AST (already a devDependency — `tests/manifest`), not a regex, so a title
 * containing `it(` in its own text cannot be mistaken for another call.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'

/** One `enforced by:` pointer as written in a doc. */
export interface Pointer {
  readonly file: string
  readonly suite: string
  readonly title: string
}

/** A pointer plus whether it resolved. */
export interface PointerResult extends Pointer {
  readonly resolved: boolean
  /** Why it did not resolve, only set when `resolved` is false. */
  readonly reason?: string
}

export interface PointerScan {
  readonly pointers: readonly PointerResult[]
  readonly broken: readonly PointerResult[]
}

const POINTER_RE = /enforced by:\s*`?tests\/([a-zA-Z0-9._-]+)`?\s+"([\s\S]*?)"/gi

const normalise = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Every `enforced by: tests/<suite> "<title>"` pointer written in one file. */
export async function extractPointers(filePath: string): Promise<Pointer[]> {
  const text = await readFile(filePath, 'utf8')
  const pointers: Pointer[] = []
  for (const m of text.matchAll(POINTER_RE)) {
    pointers.push({ file: filePath, suite: m[1] as string, title: normalise(m[2] as string) })
  }
  return pointers
}

const SPEC_RE = /\.spec\.tsx?$/

async function collectSpecFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // absence is the probed state: a suite name a pointer invented or
    // misspelled has no directory at all, and that is a broken pointer for
    // the caller to report, not an error this scan raises itself.
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await collectSpecFiles(full)))
    else if (entry.isFile() && SPEC_RE.test(entry.name)) out.push(full)
  }
  return out
}

const TITLE_CALLEES = new Set(['it', 'test', 'describe'])

/** The string-literal callee name of `foo(...)` or `foo.bar(...)` — `foo`. */
function calleeName(expr: ts.LeftHandSideExpression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text
  }
  return undefined
}

/**
 * Every `it`/`test`/`describe` string-literal title under one suite
 * directory, or `null` if the suite has no spec files at all (a suite name
 * a pointer invented, or misspelled).
 */
export async function suiteTitles(testsRoot: string, suite: string): Promise<Set<string> | null> {
  const specFiles = await collectSpecFiles(join(testsRoot, suite))
  if (specFiles.length === 0) return null

  const titles = new Set<string>()
  for (const file of specFiles) {
    const text = await readFile(file, 'utf8')
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const name = calleeName(node.expression)
        const arg = node.arguments[0]
        if (name && TITLE_CALLEES.has(name) && arg && ts.isStringLiteralLike(arg)) {
          titles.add(normalise(arg.text))
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return titles
}

/**
 * Scan `docFiles` for `enforced by:` pointers and check each against the
 * suites under `testsRoot`. Every pointer is returned, `resolved` says
 * whether its title exists in its suite's title pool.
 */
export async function scanEnforcedByPointers(
  docFiles: readonly string[],
  testsRoot: string,
): Promise<PointerScan> {
  const pointers: PointerResult[] = []
  const titleCache = new Map<string, Set<string> | null>()

  for (const file of docFiles) {
    for (const p of await extractPointers(file)) {
      let titles = titleCache.get(p.suite)
      if (titles === undefined) {
        titles = await suiteTitles(testsRoot, p.suite)
        titleCache.set(p.suite, titles)
      }
      if (titles === null) {
        pointers.push({ ...p, resolved: false, reason: `no spec file under tests/${p.suite}` })
      } else if (titles.has(p.title)) {
        pointers.push({ ...p, resolved: true })
      } else {
        pointers.push({ ...p, resolved: false, reason: `no it()/describe() titled "${p.title}" in tests/${p.suite}` })
      }
    }
  }

  return { pointers, broken: pointers.filter((p) => !p.resolved) }
}
