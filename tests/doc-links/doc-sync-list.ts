/**
 * tests/doc-links/doc-sync-list.ts — every path NAMED in the project's
 * doc-sync list (`project_config_dod.md` §"Doc-sync list") exists in the tree.
 *
 * TASK-072 / D058. The rule the list serves (DoD §5: a user-facing change
 * updates every file on this list, in the same commit) stays judgement — which
 * files belong on the list is a human call. What is NOT judgement, and what
 * this closes, is whether a row's own PATH is real: a row naming
 * `docs-site/content/pricing.md` in a repo that ships no docs-site is not a
 * sync rule, it is a typo the size of a whole surface, and nothing caught it
 * (D058's original finding — the `{{` check proposed for this row would pass
 * vacuously, because the fiction here is the ROWS, not a leftover placeholder).
 *
 * A row is either a real surface or explicitly N/A. Only the first (`File /
 * surface`) column of each table row is read: the Audience/Trigger/Sync-rule
 * columns are free prose and may legitimately mention other paths in passing.
 *
 *   - A row whose first cell starts with `N/A` is a recorded non-surface and is
 *     never checked — that is the point of writing N/A instead of deleting the
 *     row (see the section's own preamble).
 *   - Every other backtick-quoted path in that cell is checked against the
 *     repository root (the directory holding `project_config_dod.md`).
 *   - A GLOB token (`docs/doing/PLAN-*.md`) checks that its DIRECTORY exists,
 *     not that an instance already does — `docs/done/INCIDENT-*.md` is a real,
 *     permanent naming convention on a folder that exists, even on a day this
 *     repo has written no incident report. Requiring an instance would fail a
 *     legitimate row for being dormant, the same shape TASK-062-10/-11 argue
 *     against for a vacuous CHECK, not for a real one.
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface DocSyncScan {
  /** How many named, non-N/A paths were examined. The non-vacuity number. */
  readonly checked: number
  /** How many rows were explicitly recorded N/A and skipped. */
  readonly skippedNA: number
  /** `<row first cell> -> <path>` for each path that does not resolve. */
  readonly broken: readonly string[]
}

/** Exported for the spec's own blueprint-detection (`.blueprint-root`), not just internal use. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    // Absence is the probed state.
    return false
  }
}

/** The directory a glob token's leaf lives in — everything before the segment carrying `*`. */
function globDir(token: string): string {
  const segments = token.split('/')
  const globIndex = segments.findIndex((segment) => segment.includes('*'))
  return segments.slice(0, Math.max(globIndex, 0)).join('/')
}

/** The `## Doc-sync list` section's text, or '' if the heading is not there. */
function docSyncSection(text: string): string {
  const heading = '## Doc-sync list'
  const start = text.indexOf(heading)
  if (start === -1) return ''
  const rest = text.slice(start + heading.length)
  const next = rest.search(/\n## /)
  return next === -1 ? rest : rest.slice(0, next)
}

/**
 * Scan `<repoRoot>/project_config_dod.md`'s doc-sync list. Returns the count
 * examined, the count explicitly recorded N/A, and every path that does not
 * resolve.
 */
export async function scanDocSyncList(repoRoot: string): Promise<DocSyncScan> {
  let text: string
  try {
    text = await readFile(join(repoRoot, 'project_config_dod.md'), 'utf8')
  } catch {
    // No project_config_dod.md: nothing to scan, and the live case's non-vacuity floor refuses a zero.
    return { checked: 0, skippedNA: 0, broken: [] }
  }

  let checked = 0
  let skippedNA = 0
  const broken: string[] = []

  for (const line of docSyncSection(text).split('\n')) {
    if (!/^\|.*\|$/.test(line.trim())) continue
    // Markdown escapes a literal pipe inside a cell (`\|`); splitting on every
    // unescaped pipe keeps that out of the cell boundaries.
    const cells = line.split(/(?<!\\)\|/).map((cell) => cell.trim())
    const first = cells[1] ?? ''
    if (first === '' || /^-+$/.test(first)) continue // blank row or the |---| separator
    if (/^N\/A\b/i.test(first)) {
      skippedNA++
      continue
    }

    for (const match of first.matchAll(/`([^`]+)`/g)) {
      const token = match[1] ?? ''
      if (token === '' || /^https?:\/\//.test(token)) continue
      checked++
      const target = token.includes('*') ? join(repoRoot, globDir(token)) : join(repoRoot, token)
      if (!(await pathExists(target))) broken.push(`${first} -> ${token}`)
    }
  }

  return { checked, skippedNA, broken }
}
