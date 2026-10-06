/**
 * tests/contamination-push-scan/contamination-push-scan.spec.ts — TASK-079
 * (TASK-062-16), audit row C168.
 *
 * THE FINDING. C168 was written as if `.githooks/pre-push` had a contamination
 * call site to extend. Measured, it has none: the contamination scan
 * (scripts/lib/contamination.mts) ran only from `scripts/blueprint.mts`'s a2bp
 * path, so nothing scanned a push for the BUG-002 / A-09 shapes — a host home
 * path, a foreign per-project state dir, an operator's specifics landing in a
 * managed file and publishing to every downstream project on the next
 * `blueprint pull`. The founder chose the CI-only route (PLAN-TASK-062
 * §"Founder decisions" #3, 2026-09-22): the `contamination` job in
 * .github/workflows/security.yml runs scripts/contamination-push-scan.mts over
 * the pushed diff, and the release job's needs-list keeps a red result from
 * advancing `released`.
 *
 * THE PROPERTY THAT MATTERS MOST IS REUSE. The job's value is that it applies
 * contamination.mts's OWN checker to the pushed diff — not a forked copy of its
 * patterns, which would drift silently (the audit CSV's re-open condition).
 * Case #1 is a TEXT PROXY for that: it pins that the script imports
 * contamination.mts and that three of the checker's regexes are absent from it.
 * A re-spelled fork would pass it. The real coverage is the red/green case,
 * which drives the actual checker through the script and would go green on a
 * fork only if the fork reproduced the checker's verdicts.
 *
 * A GitHub job cannot be run locally, so the fixture cases below drive the
 * checker EXACTLY the way the job's step does — `node
 * scripts/contamination-push-scan.mts --range/--before/--after` — over a
 * fixture repo, with the plant shown red and its removal shown green.
 *
 * SCOPE, stated so the fixture cases read as intent and not omission: the job
 * runs only in the blueprint's own repository (guarded on `github.repository`,
 * so a derived project sees it SKIPPED, not green — #2), the script itself
 * skips, announced, where `.blueprint-root` is absent (#3), and only files
 * that SHIP are judged: a path whose `export-ignore` attribute is set reaches
 * no derived project and cannot contaminate one (#8). A derived project's push
 * publishes nothing (a2bp's own scan is its pre-publication stop), and scanning
 * a project's whole diff would block its own files for naming their own project.
 *
 * The fixture plants below carry `a2bp-allow` markers because this suite SHIPS
 * (tests/contamination-push-scan/ is not export-ignore'd), so the scan judges
 * this file's own added lines on the push that lands it.
 */

import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { REPO_ROOT, scenario } from '../harness/index.js'

const SUBJECT_ROOT = process.env.BP_SUBJECT_ROOT ?? REPO_ROOT
const SCRIPT = join(SUBJECT_ROOT, 'scripts/contamination-push-scan.mts')

async function workflow(): Promise<string> {
  return readFile(join(REPO_ROOT, '.github/workflows/security.yml'), 'utf8')
}

describe('TASK-079 — the pushed diff is scanned by contamination.mts’s own checker', () => {
  it('#1 the script IMPORTS contamination.mts and carries none of its patterns itself', async () => {
    const text = await readFile(SCRIPT, 'utf8')
    expect(text).toContain("from './lib/contamination.mts'")
    // The checker's regexes. If any of these appears in the script, the
    // patterns have been forked and will drift — the audit's re-open trigger.
    expect(text).not.toMatch(/\?\(Users\|home\)|\(Users\|home\)/)
    expect(text).not.toMatch(/\$HOME\|~/)
    expect(text).not.toMatch(/_CONTAMINATION_KNOWN_DOTDIRS\s*=/)
  })

  it('#2 the workflow wires the job to the script and gates released on it', async () => {
    const text = await workflow()
    const job = text.match(/^ {2}contamination:\n(?:(?: {4}.*| {2} {2}.*)\n?)+/m)
    expect(job, 'security.yml has a contamination job').not.toBeNull()
    expect(job?.[0]).toContain('node scripts/contamination-push-scan.mts')
    expect(text).toMatch(/needs: \[[^\]]*\bcontamination\b[^\]]*\]/)
    // Job-level repository guard, the release job's precedent: in a derived
    // project the job renders SKIPPED, never a green check that scanned nothing.
    const guard = job?.[0].match(/^ {4}if: (.*)$/m)?.[1] ?? ''
    expect(guard, 'the contamination job is not guarded to this repository').toMatch(
      /github\.repository\s*==\s*'[^']+'/,
    )
    expect(guard, 'a workflow_dispatch run has no range to scan').not.toContain("!= 'schedule'")
  })

  it('#3 a derived project checkout skips, announced, and never blocks', async () => {
    await scenario('cps-derived', async (s) => {
      const repo = await s.gitRepo('acme-flow', { initialCommit: true })
      await s.fs.write('acme-flow/README.md', 'see /home/alice/notes\n') // a2bp-allow: fixture plant, not a live path
      await repo.commitAll('add readme')
      // No .blueprint-root: contamination publishes only from the blueprint.
      const r = await s.run('node', [SCRIPT, '--repo', repo.dir, '--range', 'HEAD~1..HEAD'], {
        cwd: repo.dir,
      })
      expect(r.code).toBe(0)
      expect(r.output).toContain('SKIP')
      expect(r.output).toContain('.blueprint-root')
    })
  })

  it('TASK-079: a planted contaminated line fails the pushed-diff scan, and removing it passes', async () => {
    await scenario('cps-red-green', async (s) => {
      const repo = await s.gitRepo('bp', { initialCommit: true })
      await s.fs.write('bp/.blueprint-root', 'blueprint\n')
      await s.fs.write('bp/README.md', 'generic docs\n')
      await repo.commitAll('base')

      // RED — the plant, driven exactly as the job drives it.
      await s.fs.write('bp/README.md', 'generic docs\nsee /home/alice/secret-notes for details\n') // a2bp-allow: fixture plant, not a live path
      await repo.commitAll('plant a host path')
      const red = await s.run('node', [SCRIPT, '--repo', repo.dir, '--range', 'HEAD~1..HEAD'], {
        cwd: repo.dir,
      })
      expect(red.code).toBe(1)
      expect(red.output).toContain('BLOCK')
      expect(red.output).toContain('host home path')
      expect(red.output).toContain('README.md')
      // The verdict says what it judged.
      expect(red.output).toContain('scanned 1 file(s), 1 added line(s)')

      // GREEN — the plant removed. That commit ADDS no line, so the pass
      // judged nothing and says so: "scanned 0" cannot be read as "clean".
      await s.fs.write('bp/README.md', 'generic docs\n')
      await repo.commitAll('remove the plant')
      const green = await s.run('node', [SCRIPT, '--repo', repo.dir, '--range', 'HEAD~1..HEAD'], {
        cwd: repo.dir,
      })
      expect(green.code).toBe(0)
      expect(green.output).toContain('PASS')
      expect(green.output).toContain('scanned 0 file(s), 0 added line(s)')
      expect(green.output).toContain('::warning::')
    })
  })

  it('#5 the a2bp-allow override works exactly as on the a2bp path: justified suppresses, bare does not', async () => {
    await scenario('cps-allow', async (s) => {
      const repo = await s.gitRepo('bp', { initialCommit: true })
      await s.fs.write('bp/.blueprint-root', 'blueprint\n')
      await s.fs.write(
        'bp/README.md',
        'generic\n/home/alice/x — a2bp-allow: incident record, not a live path\n',
      )
      await repo.commitAll('justified marker')
      const ok = await s.run('node', [SCRIPT, '--repo', repo.dir, '--range', 'HEAD~1..HEAD'], {
        cwd: repo.dir,
      })
      expect(ok.code).toBe(0)

      await s.fs.write('bp/README.md', 'generic\n/home/alice/x — a2bp-allow:\n')
      await repo.commitAll('bare marker')
      const bare = await s.run('node', [SCRIPT, '--repo', repo.dir, '--range', 'HEAD~1..HEAD'], {
        cwd: repo.dir,
      })
      expect(bare.code).toBe(1)
    })
  })

  it('#6 the residual-name class has no operand on a blueprint push: counted in one line, never blocking, never printed per hit', async () => {
    await scenario('cps-demote', async (s) => {
      // The repo's own basename IS "acme-flow": on the blueprint's own pushes
      // the name class would flag the repo's docs for naming themselves.
      const repo = await s.gitRepo('acme-flow', { initialCommit: true })
      await s.fs.write('acme-flow/.blueprint-root', 'blueprint\n')
      await s.fs.write('acme-flow/README.md', 'mentions acme-flow by name\nand acme-flow again\n')
      await repo.commitAll('name the repo')
      const r = await s.run('node', [SCRIPT, '--repo', repo.dir, '--range', 'HEAD~1..HEAD'], {
        cwd: repo.dir,
      })
      expect(r.code).toBe(0)
      expect(r.output).toContain('2 residual-name hit(s) demoted')
      // Measured before this: 86 of 100 log lines over one real push range
      // were per-hit `|BLOCK|` lines of this class, burying the real findings.
      expect(r.output).not.toContain('|BLOCK|')
      // The other classes stand unfiltered in the same mode.
      await s.fs.write('acme-flow/TOOLS.md', 'state lives in ~/.other-project/state/\n') // a2bp-allow: fixture plant, not a live path
      await repo.commitAll('plant a foreign state dir')
      const foreign = await s.run('node', [SCRIPT, '--repo', repo.dir, '--range', 'HEAD~1..HEAD'], {
        cwd: repo.dir,
      })
      expect(foreign.code).toBe(1)
      expect(foreign.output).toContain('literal per-project state dir')
    })
  })

  it('#7 push-event range semantics: new branch scans the tip with a warning, a rollback scans nothing', async () => {
    await scenario('cps-ranges', async (s) => {
      const repo = await s.gitRepo('bp', { initialCommit: true })
      await s.fs.write('bp/.blueprint-root', 'blueprint\n')
      await s.fs.write('bp/README.md', 'see /home/alice/notes\n') // a2bp-allow: fixture plant, not a live path
      await repo.commitAll('tip with a plant')
      const zero = '0000000000000000000000000000000000000000'
      const after = (await repo.git(['rev-parse', 'HEAD'])).stdout.trim()
      const before = (await repo.git(['rev-parse', 'HEAD~1'])).stdout.trim()

      const newBranch = await s.run(
        'node',
        [SCRIPT, '--repo', repo.dir, '--before', zero, '--after', after],
        { cwd: repo.dir },
      )
      expect(newBranch.output).toContain('new branch push')
      expect(newBranch.code).toBe(1)

      // A rollback: after is an ancestor of before — nothing new to scan.
      const rollback = await s.run(
        'node',
        [SCRIPT, '--repo', repo.dir, '--before', after, '--after', before],
        { cwd: repo.dir },
      )
      expect(rollback.code).toBe(0)
      expect(rollback.output).toContain('nothing new')
    })
  })

  it('#8 only files that ship are judged: an export-ignore’d record with a plant passes and is counted, the same plant in a shipped file blocks, and a vacuous range says so', async () => {
    await scenario('cps-export-ignore', async (s) => {
      const repo = await s.gitRepo('bp', { initialCommit: true })
      await s.fs.write('bp/.blueprint-root', 'blueprint\n')
      // The decision is .gitattributes, read the way git archive resolves it:
      // the archive at the range tip, the same listing bp_managed_files uses.
      await s.fs.write('bp/.gitattributes', 'docs/done/**  export-ignore\n')
      await repo.commitAll('base')

      // An incident record quoting a host path on purpose: ships to nobody.
      await s.fs.write('bp/docs/done/BUGS.md', '| BUG-1 | fixture at /home/alice/state | fixed |\n') // a2bp-allow: fixture plant, not a live path
      await repo.commitAll('record an incident')
      const record = await s.run('node', [SCRIPT, '--repo', repo.dir, '--range', 'HEAD~1..HEAD'], {
        cwd: repo.dir,
      })
      expect(record.code).toBe(0)
      expect(record.output).toContain('1 changed file(s) skipped')
      // Skipping the record means NOTHING was judged, and the pass says so.
      expect(record.output).toContain('scanned 0 file(s), 0 added line(s)')
      expect(record.output).toContain('::warning::')

      // The same line in a file that ships is the BUG-002 shape and blocks.
      await s.fs.write('bp/README.md', 'fixture at /home/alice/state\n') // a2bp-allow: fixture plant, not a live path
      await repo.commitAll('plant in a shipped file')
      const shipped = await s.run('node', [SCRIPT, '--repo', repo.dir, '--range', 'HEAD~1..HEAD'], {
        cwd: repo.dir,
      })
      expect(shipped.code).toBe(1)
      expect(shipped.output).toContain('::error::README.md')
      expect(shipped.output).toContain('0 changed file(s) skipped')
    })
  })

  it('#9 a trailing-slash DIRECTORY rule excludes what it contains: the shape check-attr misses, the shape this repo’s tests/<suite>/ lines use', async () => {
    await scenario('cps-dir-rule', async (s) => {
      const repo = await s.gitRepo('bp', { initialCommit: true })
      await s.fs.write('bp/.blueprint-root', 'blueprint\n')
      // `dir/  export-ignore` (no glob) sets the attribute on the DIRECTORY, so
      // `git check-attr` answers `unspecified` for every file under it — yet
      // `git archive` drops them all. Round 2 read check-attr and judged these.
      await s.fs.write('bp/.gitattributes', 'tests/only-here/  export-ignore\n')
      await repo.commitAll('base')
      await s.fs.write('bp/tests/only-here/x.spec.ts', "const fixture = '/home/alice/state'\n") // a2bp-allow: fixture plant, not a live path
      await repo.commitAll('a blueprint-only suite quotes a host path')
      const attr = await repo.git(['check-attr', 'export-ignore', 'tests/only-here/x.spec.ts'])
      expect(attr.stdout, 'the premise: check-attr does not see a directory rule').toContain('unspecified')
      const r = await s.run('node', [SCRIPT, '--repo', repo.dir, '--range', 'HEAD~1..HEAD'], {
        cwd: repo.dir,
      })
      expect(r.code).toBe(0)
      expect(r.output).toContain('1 changed file(s) skipped')
      expect(r.output).toContain('scanned 0 file(s), 0 added line(s)')
    })
  })
})
