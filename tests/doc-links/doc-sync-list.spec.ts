/**
 * tests/doc-links/doc-sync-list.spec.ts — every path named in the doc-sync
 * list resolves, or the scan says which does not.
 *
 * TASK-072 / D058. The mechanism half of the task: TASK-072's real work — is
 * this a real surface? is the sync rule true? — is `project_config_dod.md`
 * §"Doc-sync list" itself, judged by hand (PO, not a test). This suite proves
 * the JUDGED list's PATHS are real, and stays red against the template rows
 * that made D058's original `{{` check pass vacuously.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { skipVisibly } from '../helpers/project-config.js'
import { pathExists, scanDocSyncList } from './doc-sync-list.js'

async function scanFixture(s: Scenario, content: string): Promise<ReturnType<typeof scanDocSyncList>> {
  const root = await s.workspace.dir('bp')
  await s.fs.write('bp/project_config_dod.md', content)
  return scanDocSyncList(root)
}

/** A minimal doc-sync-list section: one real row, one glob row, one N/A row. */
function section(opts: { includeReal?: boolean } = {}): string {
  const real = opts.includeReal === false ? '' : '| `real.md` | Someone | A change | Same commit |\n'
  return (
    '## Doc-sync list (DoD §6.4)\n\n' +
    '### External (customer-facing)\n\n' +
    '| File / surface | Audience | Trigger | Sync rule |\n' +
    '|---|---|---|---|\n' +
    real +
    '| `notes/entries-*.md` | Someone | A change | Same commit |\n' +
    '| N/A — `docs-site/content/pricing.md` | — | No docs-site here | N/A |\n\n' +
    '## User-surface rules\n\nnothing to see past the heading\n'
  )
}

describe('doc-sync-list — every path named in the list exists in the tree', () => {
  it('#0+#1 a real file, a real glob directory and an acknowledged N/A: green, and seen doing work', async () => {
    await scenario('doc-sync-list-baseline', async (s) => {
      await s.fs.write('bp/real.md', '# real\n')
      await s.fs.mkdirp('bp/notes')
      const scan = await scanFixture(s, section())

      expect(scan.broken).toEqual([])
      expect(scan.checked).toBe(2) // real.md + the glob's directory token
      expect(scan.skippedNA).toBe(1)
    })
  })

  it('#0 a fixture examining nothing is a broken extractor, not a clean list', async () => {
    await scenario('doc-sync-list-vacuous', async (s) => {
      const scan = await scanFixture(s, '## Doc-sync list (DoD §6.4)\n\nno table here\n\n## Next\n')

      expect(scan.checked).toBe(0)
      expect(scan.broken).toEqual([])
    })
  })

  it('#2 a row naming a file that does not exist is reported, naming row and path', async () => {
    await scenario('doc-sync-list-missing-file', async (s) => {
      await s.fs.mkdirp('bp/notes')
      // real.md deliberately not written.
      const scan = await scanFixture(s, section())

      expect(scan.broken).toHaveLength(1)
      expect(scan.broken[0]).toContain('real.md')
    })
  })

  it('#3 a glob row whose directory does not exist is reported — the D058 shape', async () => {
    await scenario('doc-sync-list-missing-glob-dir', async (s) => {
      await s.fs.write('bp/real.md', '# real\n')
      // notes/ deliberately not created — same shape as `docs-site/content/features/*.md`
      // in a repo that ships no docs-site.
      const scan = await scanFixture(s, section())

      expect(scan.broken).toHaveLength(1)
      expect(scan.broken[0]).toContain('notes/entries-*.md')
    })
  })

  it('#4 an N/A row is never checked, even naming a path that does not exist', async () => {
    await scenario('doc-sync-list-na-skipped', async (s) => {
      await s.fs.write('bp/real.md', '# real\n')
      await s.fs.mkdirp('bp/notes')
      const scan = await scanFixture(s, section())

      expect(scan.broken).toEqual([])
      expect(scan.skippedNA).toBe(1)
    })
  })

  it('#5 no project_config_dod.md at all scans as empty, not as a crash', async () => {
    await scenario('doc-sync-list-no-file', async (s) => {
      const root = await s.workspace.dir('bp')
      const scan = await scanDocSyncList(root)

      expect(scan).toEqual({ checked: 0, skippedNA: 0, broken: [] })
    })
  })

  it(
    'RED PROOF — the pre-TASK-072 template rows fail this scan, which is the D058 defect ' +
      'itself: a `{{`-only check would have passed these rows vacuously',
    async () => {
      await scenario('doc-sync-list-pre-task-072', async (s) => {
        // Verbatim rows from project_config_dod.md as committed before TASK-072
        // (`git show HEAD~1:project_config_dod.md` at the time this was written) —
        // the seeded template's doc-sync tables, naming surfaces this repo has
        // never shipped. Recorded here rather than read live from git history so
        // the pin does not silently go stale (or vacuous) as an unrelated later
        // commit touches the file this suite reads at HEAD.
        const preTask072 =
          '## Doc-sync list (DoD §6.4)\n\n' +
          '### External (customer-facing)\n\n' +
          '| File / surface | Audience | Trigger | Sync rule |\n' +
          '|---|---|---|---|\n' +
          '| `README.md` | Visitor / future hire | Architecture / install / CLI surface change | Same commit |\n' +
          '| `docs/RELEASE-NOTES.md` *(or `docs-site/content/release-notes/YYYY-MM-DD.md`)* | Customer | Every push shipping a user-noticed change | Append-only; never edit history |\n' +
          '| `docs-site/content/features/*.md` *(Recipe B/C)* | Customer | New / removed / renamed feature | Same commit |\n' +
          '| `docs-site/content/pricing.md` *(Recipe B/C)* | Customer | Plan / tier / price change | Same commit as billing code |\n' +
          '| `frontend/public/help.html` *(Recipe A)* | Customer | New / changed user-facing feature | Same commit |\n' +
          '| `docs-site/content/legal/privacy-vYYYY-MM-DD.md` *(Recipe C)* | Customer / regulator | New data class, processor, region | Same commit + `legal-reviewed` PR label |\n' +
          '| `docs-site/content/api/*.md` + OpenAPI spec *(Recipe B/C)* | Customer / integrator | API surface change | Same commit; spec generated from code |\n\n' +
          '### Internal (team-facing)\n\n' +
          '| File / surface | Audience | Trigger | Sync rule |\n' +
          '|---|---|---|---|\n' +
          '| `docs/config/FEATURES.md` | Team / agent | New / removed / renamed feature | Same commit as the code |\n' +
          '| `docs/architecture/ADR-*.md` *(Recipe C)* | Team / new hire | Architectural decision taken or reversed | Numbered, dated, same commit as embodying code |\n' +
          '| `docs/runbooks/*.md` *(Recipe C)* | On-call / agent | New alert wired | Same PR as the alert; link in the alert payload |\n' +
          '| `docs/done/INCIDENT-YYYY-MM-DD.md` | Team / regulator | Production incident | Within 48h of resolution (DoD §6.2) |\n\n' +
          '**Promotion / removal** — see DOCUMENTATION.md.\n'

        const scan = await scanFixture(s, preTask072)

        // Every one of these rows names a surface this repo has never shipped —
        // no docs-site, no frontend/, no architecture/ or runbooks/ tree — so
        // the OLD list is red across the board, exactly as D058 found.
        expect(scan.broken.length).toBeGreaterThanOrEqual(9)
        expect(scan.broken.some((b) => b.includes('docs-site/content/pricing.md'))).toBe(true)
        expect(scan.broken.some((b) => b.includes('frontend/public/help.html'))).toBe(true)
        expect(scan.broken.some((b) => b.includes('docs-site/content/features/*.md'))).toBe(true)
        expect(scan.broken.some((b) => b.includes('docs/architecture/ADR-*.md'))).toBe(true)
        expect(scan.broken.some((b) => b.includes('docs/runbooks/*.md'))).toBe(true)
        expect(scan.broken.some((b) => b.includes('docs/done/INCIDENT-YYYY-MM-DD.md'))).toBe(true)
      })
    },
  )

  it('THE REAL TREE — every path named in the doc-sync list exists', async (ctx) => {
    // BLUEPRINT-ONLY, on purpose (bootstrap-gate #2/#3 caught the first
    // version failing this). "Every named path exists" is a property this
    // task's PO EARNED for THIS list by rewriting it row by row against this
    // tree — it is not a structural fact every checkout gets for free. A
    // freshly bootstrapped project's project_config_dod.md is still
    // templates/project_config_dod.md's SEED: real-looking Recipe A/B/C rows
    // nobody has judged against that project's tree yet, so most of them
    // legitimately do not exist there — the same shape D058 found here,
    // expected on day one rather than a regression. This suite ships
    // (tests/doc-links/ is not export-ignored) and therefore runs inside
    // every derived project's own gate too, so the assertion is scoped to
    // the one tree it is actually true of via the same positive marker
    // `drift` and `tests/manifest` use for this exact question
    // (`.blueprint-root`, export-ignored so it can never reach a derived
    // project — tests/manifest/manifest.ts's `inBlueprint` check). A derived
    // project earns this assertion the same way the blueprint did: its own
    // PO judging its own list real, the same process TASK-072 was.
    if (!(await pathExists(join(REPO_ROOT, '.blueprint-root')))) {
      skipVisibly(
        ctx,
        'not the blueprint checkout — this project has not yet judged its own doc-sync list real (see doc-sync-list.spec.ts)',
      )
    }

    // No scenario(): this reads the repository and writes nothing.
    const scan = await scanDocSyncList(REPO_ROOT)

    expect(
      scan.checked,
      `only ${scan.checked} path(s) examined — the extractor is probably broken, so a pass proves nothing`,
    ).toBeGreaterThanOrEqual(8)
    expect(scan.skippedNA).toBeGreaterThan(0)
    expect(scan.broken, scan.broken.join('\n')).toEqual([])
  })
})
