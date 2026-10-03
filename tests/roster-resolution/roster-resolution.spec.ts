/**
 * tests/roster-resolution/roster-resolution.spec.ts — BUG-075.
 *
 * THE DEFECT. `bp_roster_file` tried `<dir>/AGENT_ROSTER.md`, then
 * `<dir>/AGENT_ROSTER.example.md`, and returned 0 either way. The live roster
 * is per-engineer and GITIGNORED; the example is TRACKED and SHIPS. So the
 * fallback turns "there is no live roster here" into a confident wrong
 * identity, at rc=0, with nothing printed.
 *
 * Measured in a post-`scaffolding/` tree, where the example is the file sitting
 * beside the code and the live roster stays at the real root:
 *
 *     post-move : Sylvia              <- the shipped example roster
 *     real root : REAL-ORCHESTRATOR   <- the live roster
 *     rc        : 0
 *
 * Every persona label in the feed, every `--whoami`, and every
 * `OVER_TO_<NAME>` handoff would then name a template persona that no
 * dispatcher watches. That is BUG-010's shape — *"renaming a persona appears to
 * do nothing"* — defeating the `--whoami` instruction that was added to prevent
 * BUG-010.
 *
 * THE FIX IS TWO HALVES, and either alone leaves the bug reachable:
 *   1. callers pass the STATE root, never their own code root (TASK-021);
 *   2. the example stops being a fallback for the live file.
 *
 * MUTATION RECIPE (R6) — observed red, not predicted:
 *   Restore the `[ -f "$src/AGENT_ROSTER.example.md" ] && { printf …; return 0; }`
 *   line in scripts/lib/roster.sh.
 *   → #2 goes red: the example is served in place of a missing live roster.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'

const LIB = join(REPO_ROOT, 'scripts', 'lib', 'roster.sh')
const EXAMPLE = join(REPO_ROOT, 'AGENT_ROSTER.example.md')

async function roster(s: Scenario, snippet: string, cwd: string) {
  return s.run('sh', ['-c', `. "${LIB}"; ${snippet}`], { cwd })
}

describe('BUG-075 — the shipped example roster is not a fallback for the live one', () => {
  it('#1 a live AGENT_ROSTER.md is used when present', async () => {
    await scenario('roster-res-1', async (s) => {
      const dir = await s.fs.mkdirp('proj')
      await s.fs.copyIn(EXAMPLE, 'proj/AGENT_ROSTER.example.md')
      const live = (await s.fs.read('proj/AGENT_ROSTER.example.md')).replace(
        /^(\|\s*Orchestrator\s*\|)[^|]*\|/m,
        '$1 REAL-ORCHESTRATOR |',
      )
      await s.fs.write('proj/AGENT_ROSTER.md', live)

      const f = await roster(s, `bp_roster_file "${dir}"`, dir)
      expect(f.stdout.trim()).toBe(join(dir, 'AGENT_ROSTER.md'))

      const who = await roster(s, `bp_roster_name_for_role "${dir}" Orchestrator`, dir)
      expect(who.stdout.trim()).toBe('REAL-ORCHESTRATOR')
    })
  })

  it('#2 a directory with ONLY the example resolves NOTHING and says so', async () => {
    // This is the whole bug. Before the fix this returned the example's path at
    // rc=0, and `--whoami` answered with a template persona name.
    await scenario('roster-res-2', async (s) => {
      const dir = await s.fs.mkdirp('scaffolding')
      await s.fs.copyIn(EXAMPLE, 'scaffolding/AGENT_ROSTER.example.md')

      const f = await roster(s, `bp_roster_file "${dir}"`, dir)
      expect(f.code).not.toBe(0)
      expect(f.stdout.trim()).toBe('')
      expect(f.stderr).toMatch(/AGENT_ROSTER\.md/)

      // and no identity is produced from the template
      const who = await roster(s, `bp_roster_name_for_role "${dir}" Orchestrator`, dir)
      expect(who.stdout.trim()).toBe('')
    })
  })

  it('#3 the example is still reachable when named explicitly as a FILE', async () => {
    // Tests legitimately read the template; what is refused is SUBSTITUTING it
    // for a missing live roster.
    await scenario('roster-res-3', async (s) => {
      const dir = await s.fs.mkdirp('x')
      const p = await s.fs.copyIn(EXAMPLE, 'x/AGENT_ROSTER.example.md')
      const f = await roster(s, `bp_roster_file "${p}"`, dir)
      expect(f.code).toBe(0)
      expect(f.stdout.trim()).toBe(p)
    })
  })

  it('#4 non-vacuity — the example really does define an Orchestrator', async () => {
    // If the shipped example carried no Orchestrator row, #2 would pass for the
    // wrong reason and this suite would be asserting nothing.
    await scenario('roster-res-4', async (s) => {
      const dir = await s.fs.mkdirp('x')
      const p = await s.fs.copyIn(EXAMPLE, 'x/AGENT_ROSTER.example.md')
      const who = await roster(s, `bp_roster_name_for_role "${p}" Orchestrator`, dir)
      expect(who.stdout.trim().length).toBeGreaterThan(0)
    })
  })
})
