/**
 * tests/code-root/code-root.spec.ts — BUG-066.
 *
 * THE DEFECT. `.githooks/pre-push` resolved a STATE root and never a CODE root,
 * so a tree whose code was not where the hook looked returned rc=0 with
 * `PASSED · 0 stages · 39 skipped`, and a real `git push` was accepted.
 *
 * WHAT THE HOOK NOW DOES. `BP_CODE_ROOT` is the work-tree root, read with
 * `pwd -P` (git guarantees a hook runs there, and no exported GIT_DIR can move
 * a syscall — BUG-077), exported, absolute and physical. No readable renderer
 * REFUSES the push, and a root with no `tests/` is announced. The mid-move
 * `scaffolding/` ranking this suite used to pin was removed when TASK-021
 * dropped the move.
 *
 * MUTATION RECIPE (R6) — red observed, not predicted. See the commit body.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { scenario, REPO_ROOT, type Scenario } from '../harness/index.js'

/**
 * A stub renderer that reports where it was found and then ENDS the hook.
 *
 * `exit 0` inside a sourced file exits the sourcing shell, so the hook stops
 * the instant it resolves its code root — before it reads stdin, shells out to
 * git, or runs a single stage. That is what makes these cases sub-second and
 * hermetic while still driving the REAL hook rather than an extract of it.
 */
const stub = (label: string) =>
  `# stub renderer for tests/code-root\n` +
  `echo "FOUND=${label}"\n` +
  `echo "BP_CODE_ROOT=$BP_CODE_ROOT"\n` +
  // A CHILD process, so the value it prints proves the export rather than mere
  // assignment — this stub itself is sourced and would see it either way.
  `sh -c 'echo "CHILD_ROOT=$BP_CODE_ROOT"'\n` +
  `exit 0\n`

type Layout = {
  /** directories to create, relative to the tree root */
  dirs?: string[]
  /** renderer stubs to plant: path prefix -> label */
  renderers?: Array<{ at: string; label: string }>
}

/** Build a tree and run the real working-tree `.githooks/pre-push` inside it. */
async function runHook(
  s: Scenario,
  name: string,
  layout: Layout,
): Promise<{
  code: number | null
  output: string
  found: string
  codeRoot: string
  childRoot: string
}> {
  const root = await s.workspace.dir(name)

  // The file UNDER TEST is the working tree's, not HEAD's: a spec that read
  // HEAD would go green on a change that has not been made yet.
  const hook = await readFile(join(REPO_ROOT, '.githooks/pre-push'), 'utf8')
  await s.fs.write(`${name}/.githooks/pre-push`, hook, { mode: 0o755 })

  for (const d of layout.dirs ?? []) await s.fs.mkdirp(`${name}/${d}`)
  for (const r of layout.renderers ?? []) {
    const under = r.at === '.' ? name : `${name}/${r.at}`
    await s.fs.write(`${under}/scripts/lib/pipeline.sh`, stub(r.label))
  }

  const res = await s.run('sh', [`${root}/.githooks/pre-push`, 'origin', 'git@example:x.git'], {
    cwd: root,
    timeoutMs: 60_000,
  })
  const found = /FOUND=(\S+)/.exec(res.output)?.[1] ?? ''
  const codeRoot = /BP_CODE_ROOT=(\S*)/.exec(res.output)?.[1] ?? ''
  const childRoot = /CHILD_ROOT=(\S*)/.exec(res.output)?.[1] ?? ''
  return {
    code: res.code,
    output: res.output,
    found,
    codeRoot: codeRoot.replace(root, '<tree>'),
    childRoot: childRoot.replace(root, '<tree>'),
  }
}

describe('BUG-066 — the pre-push hook resolves a CODE root', () => {
  it('#1 the tree resolves to the repository root, exported to a child process', async () => {
    await scenario('code-root-1', async (s) => {
      // Everything downstream of the source — pipeline.sh's lib dir,
      // pre-push-project's guards, run-ts-suites' root argument, dod-gate's
      // suite scan — reads this variable. The CHILD process proves the export,
      // and the absolute form is what survives run-ts-suites' cd into tests/.
      const r = await runHook(s, 'flat', {
        dirs: ['tests'],
        renderers: [{ at: '.', label: 'root' }],
      })
      expect(r.found, r.output).toBe('root')
      expect(r.codeRoot, r.output).toBe('<tree>')
      expect(r.childRoot, `BP_CODE_ROOT did not reach a child process\n${r.output}`).toBe(
        '<tree>',
      )
    })
  })

  it('#2 a renderer with no suite tree is used, and SAYS so', async () => {
    await scenario('code-root-2', async (s) => {
      // Nothing here can run the suites. The renderer is kept — so the stage
      // guards fail by their own names rather than the hook dying anonymously —
      // but the missing suite tree must be announced, because a short run is
      // exactly the signal the founder watches for.
      const r = await runHook(s, 'split', { renderers: [{ at: '.', label: 'root' }] })
      expect(r.found, r.output).toBe('root')
      expect(r.output, 'a code root with no tests/ was accepted silently').toMatch(/no tests\//)
    })
  })

  it('#3 no renderer REFUSES the push and names where it looked', async () => {
    await scenario('code-root-3', async (s) => {
      // The entire row exists because a gate reported success having run
      // nothing. A no-match must therefore block, not skip: rc != 0, no
      // "PASSED", and a message an operator can act on.
      const r = await runHook(s, 'empty', { dirs: ['tests'] })

      expect(r.code, `the hook allowed a push with no code root\n${r.output}`).not.toBe(0)
      expect(r.output, 'a gate that cannot find its code must not report success').not.toMatch(
        /PASSED/,
      )
      expect(r.output).toMatch(/no code root/)
      expect(r.output, 'the refusal names no path — nothing to act on').toMatch(
        /scripts\/lib\/pipeline\.sh/,
      )
    })
  })
})
