/**
 * tests/marker-merge/marker-merge.spec.ts — BP-7, and the BUG-034 that lives
 * inside it.
 *
 * `marker_aware_merge` is the one place `blueprint pull` can DELETE a derived
 * project's own content. Everything else pull does is additive or a whole-file
 * copy of a file the project already agreed is managed; this one reads a file
 * the project half-owns and writes a new version of it. So the assertion is
 * byte-exact rather than "contains" — a merge that drops one line of the
 * project's half has done the damage, and a substring check would not see it.
 *
 * PORTED FROM tests/marker-merge/test.sh, WHICH STAYS IN THE GATE until the
 * central retirement pass. The three fixture files are REUSED rather than
 * re-authored: they are the oracle, and re-typing an oracle is how a port
 * proves the wrong thing.
 *
 * ONE DELIBERATE DIVERGENCE FROM THE SHELL SUITE, and it is a speed-up with a
 * verdict-equivalence proof rather than a shortcut. The shell version built its
 * fixture blueprint with `git archive HEAD | tar -x` — a full copy of the real
 * repo, which is what BUG-049 measured at 133 MB of leaked debris across 23
 * runs. It did that only so that `docs/mocks/README.md` (a real MANAGED_FILES
 * entry) would exist upstream. A two-file fixture blueprint gives the CLI the
 * same answer for that path: every OTHER managed entry lands in the
 * missing-in-blueprint list, which `pull <one file>` never consults.
 * (Since TASK-021 the managed set is derived from the fixture itself, so there
 * is no missing-in-blueprint list to land in.)
 * Measured equivalence: both implementations agree on all six perturbed trees
 * in the population below.
 *
 * EQUIVALENCE RECORD (R6, and the migration's own evidence).
 *
 * "Ported" is a claim, so it was measured. Six perturbed trees were built and
 * BOTH implementations run over each — the retiring `tests/marker-merge/test.sh`
 * and this spec — with the per-case verdict sets compared mechanically. The red
 * sets below are OBSERVED, not predicted.
 *
 *   Mutant M1: `marker_aware_merge` returns 1 unconditionally, forcing the
 *     whole-file-copy fallback — the BP-7 defect verbatim.
 *     shell #1 · spec #1 · AGREE.
 *   Mutant M2: drop `in_inside { next }` from the awk, so the project's STALE
 *     region content survives beside the blueprint's.
 *     shell #1 · spec #1 · AGREE.
 *   Mutant M3: delete the `[ "$bp_begin" -ne "$proj_begin" ]` arm of the
 *     structural guard.
 *     shell PASSES · spec #2 · THE PORT IS STRICTER, and #2 is why it exists.
 *   Mutant M4: make that guard `return 0` instead of `return 1`.
 *     shell PASSES · spec #2 · THE PORT IS STRICTER.
 *   Control M5: the healthy tree. Both PASS.
 *   Control M6: the three fixtures with their markers inverted. Both FAIL — on
 *     the byte comparison, because the oracle was inverted too. This is a
 *     fixture-corruption control (neither implementation is blind to its own
 *     data changing), NOT the BUG-034 probe. See below for that.
 *   Control L1: a comment elsewhere in the tree that MENTIONS both marker
 *     strings without using them. Both PASS — the merge is not tricked by prose,
 *     which is the shape BUG-052 came from one file over.
 *
 * M3 AND M4 ARE THE JUSTIFICATION FOR ADDING #2, stated because a tightening
 * needs one: the shell suite exercised only the happy path, so the structural
 * guard it carries had never been observed firing, and BOTH of its arms could be
 * deleted with the suite still green. That is R6's own case — a guard seen only
 * not-firing proves nothing — and it is one arm away from BUG-034.
 *
 * BUG-034 IS FIXED BY TASK-026, and arrives with its reproducer as this
 * paragraph used to promise. A file whose END precedes its BEGIN had counts 1
 * and 1, passed every arm of the old guard, and reached an awk that tracked the
 * region backwards while pull reported the project's content preserved. Now
 * `bp_marker_structure` validates ORDER and balance before anything is written,
 * and a file that fails on either side is refused: exit 4, nothing written, no
 * backup. The merge is reached only on well-formed pairs, the precondition under
 * which its region tracking is correct.
 *
 * TASK-026 MUTATION RECORD (R6) — observed, not predicted. Each mutant applied to
 * scripts/blueprint (then the shell CLI) alone, the suite run, the file restored. BUG-113's cases are
 * left out of the BUG-034 red sets: they were red for their own unfixed reason.
 *   BUG-112 reproducer's parent (substring detection)  → red #3 #4
 *   M1 the structure scan never reports `bad`          → red #5 #5b #6
 *   M2 an unclosed region is not detected              → red #6
 *   M3 the ORDER check removed (a stray END is ignored) → red #5b ONLY. #5's
 *      inverted file also leaves a region open, so M2's arm still refuses it;
 *      #5b exists because nothing else could see this mutant.
 *   M4 a refused pull exits 0                          → red #5 #5b #6
 *   With BUG-113 fixed, each mutant alone:
 *   M5 marker detection reverts to a substring          → red #3 #4
 *   M6 the trailing-punctuation arm removed, so the SHIPPED hook line
 *      (`# BLUEPRINT:BEGIN — …`) stops matching         → red #7 #8 #9. The
 *      BUG-113 fixtures use that shape on purpose; they are what stops the
 *      marker rule being tightened past every derived project's real hook.
 *   M7 drift compares the blueprint's whole file again   → red #7 only
 *   M8 pull's selection does the same                   → red #8 only
 *   M9 pull's preview diffs the blueprint's whole file  → red #9 only
 *   M10 drift folds a refused file into "drifted"        → red #10 only
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'

const CLI = join(REPO_ROOT, 'scripts/blueprint.mts')
const FIXTURES = join(REPO_ROOT, 'tests/marker-merge')

async function initRepo(s: Scenario, dir: string) {
  await s.run('git', ['init', '-q', '-b', 'main', '.'], { cwd: dir })
  await s.run('git', ['config', 'user.email', 't@local'], { cwd: dir })
  await s.run('git', ['config', 'user.name', 't'], { cwd: dir })
  await s.run('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir })
  await s.run('git', ['add', '-A'], { cwd: dir })
  await s.run('git', ['commit', '-q', '-m', 'fixture'], { cwd: dir })
}

/**
 * A blueprint holding ONE marker-bearing managed file, plus the suite directory
 * `tests/` is a managed DIRECTORY whose expansion is fail-closed (BUG-029), so a
 * fixture blueprint with no suites at HEAD is refused before pull does anything.
 */
async function fixtureBlueprint(s: Scenario, tag: string, upstreamFile: string) {
  const bp = await s.workspace.dir(tag, 'bp')
  await s.fs.copyIn(join(FIXTURES, upstreamFile), join(bp, 'docs/mocks/README.md'))
  await s.fs.write(join(bp, 'tests/fixture/test.sh'), 'echo fixture\n')
  await initRepo(s, bp)
  return bp
}

/** A derived project whose copy of the managed file is `projectFile`. */
async function derivedProject(
  s: Scenario,
  tag: string,
  bp: string,
  projectFile: string,
) {
  const proj = await s.workspace.dir(tag, 'proj')
  await s.fs.copyIn(join(FIXTURES, projectFile), join(proj, 'docs/mocks/README.md'))
  const sha = (await s.run('git', ['rev-parse', 'HEAD'], { cwd: bp })).stdout.trim()
  await s.fs.write(
    join(proj, '.blueprint-source'),
    [
      'config_version   = 2',
      `blueprint_remote = ${bp}`,
      `bootstrap_sha    = ${sha}`,
      'bootstrap_date   = 2026-01-01',
      '',
    ].join('\n'),
  )
  await initRepo(s, proj)
  return proj
}

describe('BP-7 — `blueprint pull` replaces the marker region and keeps the project half byte-identical', () => {
  it('#1 the merge produces the expected file byte-for-byte', async () => {
    await scenario('marker-merge-1', async (s) => {
      const bp = await fixtureBlueprint(s, 'a', 'fixture-blueprint.md')
      const proj = await derivedProject(s, 'a', bp, 'fixture-project-before.md')

      // NON-VACUITY, FIRST. The oracle is a third file on disk; if it ever
      // matched the project's BEFORE state, this case would pass without pull
      // having done anything at all — and it would keep passing after the merge
      // was deleted entirely. The shell suite asserted only the final diff and
      // could not tell those apart.
      const before = await readFile(join(FIXTURES, 'fixture-project-before.md'), 'utf8')
      const expected = await readFile(
        join(FIXTURES, 'fixture-project-after-expected.md'),
        'utf8',
      )
      const upstream = await readFile(join(FIXTURES, 'fixture-blueprint.md'), 'utf8')
      expect(expected, 'the oracle equals the pre-pull state — the case is vacuous').not.toBe(before)
      expect(expected, 'the oracle equals the blueprint copy — a whole-file cp would pass').not.toBe(upstream)

      const r = await s.run('node', [CLI, 'pull', 'docs/mocks/README.md', '--yes'], { cwd: proj })
      expect(r.code, r.output).toBe(0)

      const landed = await readFile(join(proj, 'docs/mocks/README.md'), 'utf8')
      expect(landed).toBe(expected)
    })
  })

  it('#2 a region-count mismatch is refused into a backup rather than merged', async () => {
    await scenario('marker-merge-2', async (s) => {
      // The structural guard's whole purpose: when the two files do not agree
      // on how many regions there are, the awk cannot align them, so pull must
      // fall back to a whole-file copy AND leave the project's version
      // recoverable. Without the backup this path is indistinguishable from the
      // BP-7 defect it replaces.
      //
      // Added by the port. The shell suite exercised only the happy path, so
      // nothing asserted that the guard it carries does anything — and a guard
      // that has only ever been seen not firing is the R6 case exactly.
      const bp = await s.workspace.dir('b', 'bp')
      await s.fs.write(
        join(bp, 'docs/mocks/README.md'),
        [
          'project keeps this',
          '<!-- BLUEPRINT:BEGIN -->',
          'region one from the blueprint',
          '<!-- BLUEPRINT:END -->',
          '<!-- BLUEPRINT:BEGIN -->',
          'region two from the blueprint',
          '<!-- BLUEPRINT:END -->',
          '',
        ].join('\n'),
      )
      await s.fs.write(join(bp, 'tests/fixture/test.sh'), 'echo fixture\n')
      await initRepo(s, bp)

      const projBody = [
        'MY OWN CONTENT, which must survive somewhere',
        '<!-- BLUEPRINT:BEGIN -->',
        'stale',
        '<!-- BLUEPRINT:END -->',
        '',
      ].join('\n')
      const proj = await s.workspace.dir('b', 'proj')
      await s.fs.write(join(proj, 'docs/mocks/README.md'), projBody)
      const sha = (await s.run('git', ['rev-parse', 'HEAD'], { cwd: bp })).stdout.trim()
      await s.fs.write(
        join(proj, '.blueprint-source'),
        [
          'config_version   = 2',
          `blueprint_remote = ${bp}`,
          `bootstrap_sha    = ${sha}`,
          'bootstrap_date   = 2026-01-01',
          '',
        ].join('\n'),
      )
      await initRepo(s, proj)

      const r = await s.run('node', [CLI, 'pull', 'docs/mocks/README.md', '--yes'], { cwd: proj })
      expect(r.code, r.output).toBe(0)
      expect(r.output).toMatch(/marker structure mismatch/)

      // The project's bytes are recoverable, exactly, from the backup.
      const backup = await readFile(join(proj, 'docs/mocks/README.md.bp-bak'), 'utf8')
      expect(backup).toBe(projBody)
      // And the file itself is now the blueprint's — both regions present, so a
      // silently-dropped region cannot hide here either.
      const landed = await readFile(join(proj, 'docs/mocks/README.md'), 'utf8')
      expect(landed).toContain('region one from the blueprint')
      expect(landed).toContain('region two from the blueprint')
    })
  })
})

/**
 * A blueprint and a derived project, each holding ONE managed file at `path`.
 * The project also carries the fixture suite, so a default `pull` has nothing
 * else to deliver and "nothing to pull" means what it says.
 */
async function pair(s: Scenario, tag: string, path: string, bpText: string, projText: string) {
  const bp = await s.workspace.dir(tag, 'bp')
  await s.fs.write(join(bp, path), bpText)
  await s.fs.write(join(bp, 'tests/fixture/test.sh'), 'echo fixture\n')
  await initRepo(s, bp)

  const proj = await s.workspace.dir(tag, 'proj')
  await s.fs.write(join(proj, path), projText)
  await s.fs.write(join(proj, 'tests/fixture/test.sh'), 'echo fixture\n')
  const sha = (await s.run('git', ['rev-parse', 'HEAD'], { cwd: bp })).stdout.trim()
  await s.fs.write(
    join(proj, '.blueprint-source'),
    [
      'config_version   = 2',
      `blueprint_remote = ${bp}`,
      `bootstrap_sha    = ${sha}`,
      'bootstrap_date   = 2026-01-01',
      '',
    ].join('\n'),
  )
  await initRepo(s, proj)
  return { bp, proj }
}

/** The whole-file fallback's fingerprints. None may appear on a clean pull. */
const FALLBACK = /marker structure mismatch|backing up|backup at/

describe('BUG-112 — a marker is a LINE, not a substring anywhere in the file', () => {
  it('BUG-112 #3 prose that names the markers does not make a file marker-bearing', async () => {
    await scenario('marker-merge-3', async (s) => {
      // CLAUDE.md carried exactly this: one BEGIN and two END mentions in prose,
      // so every pull of it took the whole-file fallback and left a .bp-bak.
      const prose = (v: string) =>
        '# Guide\n' +
        'Between `BLUEPRINT:BEGIN` and `BLUEPRINT:END` the blueprint owns it.\n' +
        "Everything after `BLUEPRINT:END` is the project's.\n" +
        `${v}\n`
      const { proj } = await pair(s, 'p', 'CLAUDE.md', prose('v2'), prose('v1'))

      const r = await s.run('node', [CLI, 'pull', 'CLAUDE.md', '--yes'], { cwd: proj })

      expect(r.code, r.output).toBe(0)
      expect(r.output).not.toMatch(FALLBACK)
      expect(await s.fs.exists(join(proj, 'CLAUDE.md.bp-bak')), r.output).toBe(false)
      expect(await readFile(join(proj, 'CLAUDE.md'), 'utf8')).toBe(prose('v2'))
    })
  })

  it('BUG-112 #4 code that SEARCHES for the markers is not a marker — the CLI pulls itself cleanly', async () => {
    await scenario('marker-merge-4', async (s) => {
      // scripts/blueprint.mts is a managed file whose own code greps for the
      // tokens and one of whose comments starts with one. Under substring
      // detection every pull of the CLI took the fallback — and on the day its
      // counts happened to balance, the awk would have "merged" the CLI into
      // itself.
      //
      // TASK-081 §9 D (founder decision, "Option 1"): scripts/blueprint.mts
      // never spells the joined token `BLUEPRINT:` + `BEGIN` as one
      // contiguous string — its marker-search regex is built from separate
      // constants (BP_MARKER_LEAD/BP_MARKER_BEGIN_ERE) precisely so no
      // shipped file can ever trip BUG-112's class of bug again. That makes
      // the ORIGINAL sanity check (a literal `BLUEPRINT:BEGIN` substring)
      // false for the ported file by design, not by accident — the
      // regression is now structurally impossible for any shipped file
      // rather than merely tested against. The kind-aware check below still
      // proves the fixture is "code that deals with the markers", using
      // whichever shape that code currently has.
      const rel = 'scripts/blueprint.mts'
      const cli = await readFile(join(REPO_ROOT, rel), 'utf8')
      expect(cli, 'the fixture is vacuous: the ported CLI no longer deals with the markers at all').toContain(
        'BP_MARKER_LEAD',
      )
      const { proj } = await pair(s, 'c', rel, cli, cli + '# an older local copy\n')

      const r = await s.run('node', [CLI, 'pull', rel, '--yes'], { cwd: proj })

      expect(r.code, r.output).toBe(0)
      expect(r.output).not.toMatch(FALLBACK)
      expect(await s.fs.exists(join(proj, `${rel}.bp-bak`)), r.output).toBe(false)
      expect(await readFile(join(proj, rel), 'utf8')).toBe(cli)
    })
  })
})

const HOOK = '.githooks/pre-push-project'

/**
 * A marker file in the exact shape the blueprint SHIPS: the BEGIN line carries
 * trailing text after an em dash. The shipped form rather than a bare
 * `# BLUEPRINT:BEGIN`, deliberately — a marker rule tightened past it would stop
 * recognising every derived project's real hook, and only a fixture in this
 * shape can see that.
 */
const region = (body: string, tail = '') =>
  `#!/bin/sh\n# BLUEPRINT:BEGIN — blueprint-managed. Put YOUR guards below the end marker.\n${body}\n# BLUEPRINT:END\n${tail}`

describe('BUG-034 — markers out of order are refused, never merged', () => {
  it('BUG-034 #5 inverted project markers: pull refuses, writes nothing, and exits non-zero', async () => {
    await scenario('marker-merge-5', async (s) => {
      const inverted = '#!/bin/sh\n# BLUEPRINT:END\necho FOOTER-TO-KEEP\n# BLUEPRINT:BEGIN\necho stale\n'
      const { proj } = await pair(s, 'i', HOOK, region('echo managed-v2'), inverted)

      const r = await s.run('node', [CLI, 'pull', HOOK, '--yes'], { cwd: proj })

      // The defect printed "project outside-marker content preserved" and exited
      // 0 over a file it had rearranged. A refusal must be visible to a script.
      expect(r.code, r.output).not.toBe(0)
      expect(r.output).toMatch(/refuse/)
      expect(r.output).not.toMatch(/preserved/)
      expect(await readFile(join(proj, HOOK), 'utf8')).toBe(inverted)
      expect(await s.fs.exists(join(proj, `${HOOK}.bp-bak`)), r.output).toBe(false)
    })
  })

  it('BUG-034 #5b an END with no open region is refused even when a later region closes', async () => {
    await scenario('marker-merge-5b', async (s) => {
      // #5's inverted file also ends with a region left open, so a scan that
      // ignored a stray END would still refuse it — for the wrong reason. This
      // one closes, 1 BEGIN / 2 END, and ORDER is the only thing that sees it: a
      // scan skipping the stray END calls it one well-formed region and merges.
      const stray =
        '#!/bin/sh\n# BLUEPRINT:END\necho FOOTER-TO-KEEP\n# BLUEPRINT:BEGIN\necho stale\n# BLUEPRINT:END\n'
      const { proj } = await pair(s, 's', HOOK, region('echo managed-v2'), stray)

      const r = await s.run('node', [CLI, 'pull', HOOK, '--yes'], { cwd: proj })

      expect(r.code, r.output).not.toBe(0)
      expect(r.output).toMatch(/refuse/)
      expect(await readFile(join(proj, HOOK), 'utf8')).toBe(stray)
      expect(await s.fs.exists(join(proj, `${HOOK}.bp-bak`)), r.output).toBe(false)
    })
  })

  it('BUG-034 #6 a BEGIN with no END is refused too, not copied over the project', async () => {
    await scenario('marker-merge-6', async (s) => {
      const unbalanced = '#!/bin/sh\n# BLUEPRINT:BEGIN\necho stale\necho PROJECT-GUARD\n'
      const { proj } = await pair(s, 'u', HOOK, region('echo managed-v2'), unbalanced)

      const r = await s.run('node', [CLI, 'pull', HOOK, '--yes'], { cwd: proj })

      expect(r.code, r.output).not.toBe(0)
      expect(r.output).toMatch(/refuse/)
      expect(await readFile(join(proj, HOOK), 'utf8')).toBe(unbalanced)
    })
  })
})

/** drift's per-file lines for one list marker. Colour is off with no tty. */
function listed(output: string, mark: '~' | '+' | '!' | '✗'): string[] {
  return output
    .split('\n')
    .filter((l) => l.trimStart().startsWith(mark + ' '))
    .map((l) => (l.trim().slice(mark.length + 1).split(' — ')[0] ?? '').trim())
}

describe("BUG-113 — drift, pull's selection and pull's preview give ONE answer for a marker file", () => {
  it('BUG-113 #7 drift does not report project-owned lines after the end marker', async () => {
    await scenario('marker-merge-7', async (s) => {
      const same = await pair(s, 'd', HOOK, region('echo managed'), region('echo managed', 'echo PROJECT-FOOTER\n'))
      const clean = await s.run('node', [CLI, 'drift'], { cwd: same.proj })
      expect(clean.code, clean.output).toBe(0)
      expect(listed(clean.output, '~'), clean.output).not.toContain(HOOK)

      // NON-VACUITY: the same file with a changed REGION is still reported, so
      // the case above is drift judging the file, not drift skipping it.
      const moved = await pair(s, 'e', HOOK, region('echo managed-v2'), region('echo managed-v1', 'echo PROJECT-FOOTER\n'))
      const drifted = await s.run('node', [CLI, 'drift'], { cwd: moved.proj })
      expect(listed(drifted.output, '~'), drifted.output).toContain(HOOK)
    })
  })

  it('BUG-113 #8 a pull whose only difference is project-owned selects nothing', async () => {
    await scenario('marker-merge-8', async (s) => {
      const text = region('echo managed', 'echo PROJECT-FOOTER\n')
      const { proj } = await pair(s, 'n', HOOK, region('echo managed'), text)

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: proj })

      expect(r.code, r.output).toBe(0)
      expect(r.output).toContain('Nothing to pull')
      expect(await readFile(join(proj, HOOK), 'utf8')).toBe(text)
    })
  })

  it('BUG-113 #9 the preview shows the region change and never the project footer as deleted', async () => {
    await scenario('marker-merge-9', async (s) => {
      const { proj } = await pair(s, 'v', HOOK, region('echo managed-v2'), region('echo managed-v1', 'echo PROJECT-FOOTER\n'))

      const r = await s.run('node', [CLI, 'pull', HOOK, '--yes'], { cwd: proj })

      expect(r.code, r.output).toBe(0)
      expect(r.output).toContain('+echo managed-v2')
      // The defect previewed the footer as removed while the merge kept it — a
      // preview of damage that does not happen trains people to ignore previews.
      expect(r.output).not.toContain('-echo PROJECT-FOOTER')
      expect(await readFile(join(proj, HOOK), 'utf8')).toBe(region('echo managed-v2', 'echo PROJECT-FOOTER\n'))
    })
  })

  it('BUG-113 #10 drift names a file pull would refuse — it is neither clean nor merely drifted', async () => {
    await scenario('marker-merge-10', async (s) => {
      const inverted = '#!/bin/sh\n# BLUEPRINT:END\necho FOOTER\n# BLUEPRINT:BEGIN\necho stale\n'
      const { proj } = await pair(s, 'r', HOOK, region('echo managed'), inverted)

      const r = await s.run('node', [CLI, 'drift'], { cwd: proj })

      expect(r.output).not.toContain('All blueprint-managed files match')
      expect(listed(r.output, '✗'), r.output).toContain(HOOK)
      expect(listed(r.output, '~'), r.output).not.toContain(HOOK)
    })
  })
})
