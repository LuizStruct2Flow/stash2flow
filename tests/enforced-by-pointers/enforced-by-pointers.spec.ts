/**
 * tests/enforced-by-pointers/enforced-by-pointers.spec.ts
 *
 * See enforced-by-pointers.ts for the pattern and what counts as a pointer.
 * The fixture cases prove the scanner can tell a resolving pointer from a
 * broken one; THE REAL TREE case runs it over CLAUDE.md, docs/DoD.md,
 * AGENTS.md and AGENT_SIGNAL.md against this repo's own `tests/` — TASK-062's own goal-(d)
 * deliverable, so it is fitting that this suite is itself the first thing
 * that would catch a stale one of its own pointers.
 */

import { describe, it, expect } from 'vitest'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { skipVisibly } from '../helpers/project-config.js'
import { scanEnforcedByPointers } from './enforced-by-pointers.js'

const exists = (p: string): Promise<boolean> => access(p).then(() => true, () => false)

async function specFixture(s: Scenario): Promise<{ docsFile: string; testsRoot: string }> {
  const testsRoot = await s.workspace.dir('tests')
  await s.fs.write(
    'tests/example-suite/example-suite.spec.ts',
    [
      "import { describe, it } from 'vitest'",
      "describe('a group', () => {",
      "  it('#1 the real title', () => { /* noop */ })",
      '})',
      '',
    ].join('\n'),
  )
  const docsFile = await s.fs.write(
    'docs.md',
    [
      '# doc',
      '',
      'A rule — enforced by: tests/example-suite "#1 the real title".',
      '',
      'Another rule — enforced by: `tests/example-suite` "#1 a title that was never written".',
      '',
      'A third — enforced by: `tests/no-such-suite` "anything".',
      '',
    ].join('\n'),
  )
  return { docsFile, testsRoot }
}

describe('enforced-by pointers — every `enforced by: tests/<suite> "<title>"` resolves to a real test', () => {
  it('#1 a pointer whose title matches a real it() resolves', async () => {
    await scenario('enforced-by-match', async (s) => {
      const { docsFile, testsRoot } = await specFixture(s)
      const scan = await scanEnforcedByPointers([docsFile], testsRoot)

      const good = scan.pointers.find((p) => p.title === '#1 the real title')
      expect(good?.resolved).toBe(true)
    })
  })

  it('#1 a pointer whose title matches no it() in its suite is broken — THE PLANTED BAD POINTER', async () => {
    // This is the red proof: a pointer naming a title nobody wrote must be
    // reported, not silently accepted because the suite itself exists.
    await scenario('enforced-by-bad-title', async (s) => {
      const { docsFile, testsRoot } = await specFixture(s)
      const scan = await scanEnforcedByPointers([docsFile], testsRoot)

      const bad = scan.broken.find((p) => p.title === '#1 a title that was never written')
      expect(bad).toBeDefined()
      expect(bad?.reason).toContain('example-suite')
    })
  })

  it('#1 a pointer naming a suite with no spec files at all is broken', async () => {
    await scenario('enforced-by-bad-suite', async (s) => {
      const { docsFile, testsRoot } = await specFixture(s)
      const scan = await scanEnforcedByPointers([docsFile], testsRoot)

      const bad = scan.broken.find((p) => p.suite === 'no-such-suite')
      expect(bad).toBeDefined()
      expect(bad?.reason).toContain('no spec file')
    })
  })

  it('#2 a title that WRAPS across lines in the doc still matches the real one-line it() title', async () => {
    await scenario('enforced-by-wrap', async (s) => {
      const testsRoot = await s.workspace.dir('tests')
      await s.fs.write(
        'tests/wrap-suite/wrap-suite.spec.ts',
        "import { it } from 'vitest'\nit('THE REAL RANGE — a title split across two lines in prose', () => {})\n",
      )
      const docsFile = await s.fs.write(
        'docs.md',
        'enforced by:\n  `tests/wrap-suite` "THE REAL RANGE — a title split across two\n  lines in prose".\n',
      )
      const scan = await scanEnforcedByPointers([docsFile], testsRoot)

      expect(scan.broken).toEqual([])
      expect(scan.pointers).toHaveLength(1)
    })
  })

  it('#2 "enforced by its own test runner" and "enforced by the hook" name no suite and are not pointers', async () => {
    await scenario('enforced-by-prose-only', async (s) => {
      const testsRoot = await s.workspace.dir('tests')
      const docsFile = await s.fs.write(
        'docs.md',
        [
          'Coverage thresholds are the project\'s, declared in project_config_dod.md',
          'and enforced by its own test runner.',
          '',
          'the convention is enforced by the hook rather than by withholding the verb.',
          '',
        ].join('\n'),
      )
      const scan = await scanEnforcedByPointers([docsFile], testsRoot)

      expect(scan.pointers).toEqual([])
    })
  })

  it('THE REAL TREE — every `enforced by:` pointer in CLAUDE.md, docs/DoD.md and AGENTS.md resolves', async (ctx) => {
    // BLUEPRINT-ONLY, same reasoning and same marker as
    // tests/doc-links/doc-sync-list.spec.ts's own THE REAL TREE case
    // (`.blueprint-root`, export-ignored so it never reaches a derived
    // project): a derived project's tests/ tree is a SUBSET of the
    // blueprint's — tests/gate-ci-parity, for one, is blueprint-only — while
    // its CLAUDE.md/docs/DoD.md prose ships unabridged, so a pointer this
    // suite ships to *check* would itself go unresolvable there. Caught by
    // bootstrap-gate #2/#3 the first time this suite ran inside a fresh
    // bootstrap.
    if (!(await exists(join(REPO_ROOT, '.blueprint-root')))) {
      skipVisibly(ctx, 'not the blueprint checkout — a derived project ships a subset of tests/ against the same prose')
    }

    const scan = await scanEnforcedByPointers(
      // AGENT_SIGNAL.md since TASK-084: it now carries the coordination protocol.
      [
        join(REPO_ROOT, 'CLAUDE.md'),
        join(REPO_ROOT, 'docs/DoD.md'),
        join(REPO_ROOT, 'AGENTS.md'),
        join(REPO_ROOT, 'AGENT_SIGNAL.md'),
      ],
      join(REPO_ROOT, 'tests'),
    )

    // Non-vacuity floor (BUG-005 shape): a scan that finds zero pointers
    // proves nothing. Measured 2026-09-29 (TASK-084 slice 2): 9 — 2 in
    // AGENTS.md (moved there from CLAUDE.md with the shared rules), 7 in
    // docs/DoD.md, 0 in CLAUDE.md, 0 in AGENT_SIGNAL.md (its one "enforced by"
    // hit names no suite and is correctly not a pointer). Every wave-1 task
    // this epic schedules adds one more.
    expect(
      scan.pointers.length,
      `only ${scan.pointers.length} pointer(s) found — the extractor is probably broken`,
    ).toBeGreaterThanOrEqual(9)

    expect(
      scan.broken,
      scan.broken.map((p) => `${p.file}: tests/${p.suite} "${p.title}" — ${p.reason}`).join('\n'),
    ).toEqual([])
  })
})
