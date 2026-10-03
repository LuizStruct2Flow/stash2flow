/**
 * tests/helpers/project-config.ts — what a project declares in
 * project_config_paths.md, for the suites that must respect it.
 *
 * THE SHAPE IS scripts/lib/dod-gate.mts's (TASK-039): a line
 *
 *     - NAME: `value`
 *
 * first match wins, and an empty value is undeclared. That parser is a sed line
 * inside a shell library, so it cannot be imported here; this mirrors it. Keep
 * the two in step.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TestContext } from 'vitest'

/** A declared value, or null when `root/project_config_paths.md` does not declare it. */
export async function declaration(root: string, name: string): Promise<string | null> {
  let text: string
  try {
    text = await readFile(join(root, 'project_config_paths.md'), 'utf8')
  } catch {
    // No project_config_paths.md means nothing is declared, which null says.
    return null
  }
  return new RegExp(`^- ${name}: \`(.*)\`[ \\t]*$`, 'm').exec(text)?.[1] || null
}

/**
 * TASK-044 — why a check on `.github/workflows` cannot speak for this project,
 * or null when it can.
 *
 * Undeclared means GitHub Actions, which is what every such check assumed before
 * the declaration existed. A project whose pipeline runs elsewhere (storm2flow:
 * AWS CodePipeline) still receives the managed security.yml, and it is inert
 * there, so a pass over it would certify CI that never runs.
 */
export async function notGithubActions(root: string): Promise<string | null> {
  const ci = await declaration(root, 'BP_CI')
  if (ci === null || ci === 'github-actions') return null
  return `skipped: the declared CI is ${ci} (BP_CI in project_config_paths.md), so .github/workflows is not this project's pipeline`
}

/** Whitespace runs collapsed, so a value cannot carry a line break of its own. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * Say a skip where the gate shows it.
 *
 * On a passing run scripts/run-ts-suites.sh deletes vitest's output and keeps
 * only lines carrying a marker, and vitest's JSON records no skip reason. A skip
 * that is not printed with `SKIP-NOTE:` is therefore invisible in the gate, and
 * a suite skipped in silence is the failure tests/manifest exists to refuse.
 *
 * ONE PHYSICAL LINE, ALWAYS. The gate preserves marked LINES, not notices, so a
 * newline anywhere in the title or the reason strands everything after it — in
 * practice the reason, which is the half saying why a check did not run. A
 * wrapped test title alone is enough to do it (Alexey, finding 7).
 *
 * Normalised HERE, at emission, rather than at capture: this is the one function
 * every caller routes through, including skipVisibly, while a capture-side fix
 * would have to re-derive where a notice ends — the same guess the line-wise
 * grep already makes, which is what went wrong.
 */
export function skipNote(where: string, reason: string): void {
  console.warn(`SKIP-NOTE: ${oneLine(where)}: ${oneLine(reason)}`)
}

/** Skip the whole case, visibly: vitest counts it skipped and the gate prints why. */
export function skipVisibly(ctx: TestContext, reason: string): never {
  skipNote(ctx.task.name, reason)
  return ctx.skip(reason)
}
