/**
 * tests/suite-sync/suite-sync.spec.ts — BUG-029: a derived project's test suites
 * never update.
 *
 * `tests/` was absent from MANAGED_FILES. Bootstrap seeds the suites with
 * `git archive`, and `blueprint pull` then walks MANAGED_FILES file by file and
 * never touches them again. So every derived project's suites are frozen at the
 * commit it was bootstrapped from, while the machinery they test — `blueprint`
 * itself, `signal-set.sh`, the feed, the hooks, the gate renderer — keeps being
 * pulled forward. A STALE SUITE STILL PASSES, so the gate goes green over
 * assertions about code the project no longer runs. The failure is invisible
 * because it is an ABSENCE of updates rather than an error: A-22 and BUG-004's
 * shape once more.
 *
 * TASK-021 STAGE 1 RETIRED `#7*` AND `#8`/`#8b`, recorded rather than silently
 * absent. MANAGED_FILES is gone: the managed set is derived per file from the
 * blueprint's archive, so there is no managed DIRECTORY for a2bp to prefix-match
 * (#7*) and no directory expansion to come up empty (#8, #8b). The fail-closed
 * property survives on the whole set — sync-by-address #11 drives an archive
 * that ships nothing — and #1e pins the derivation itself. The mutant record
 * below describes the list-era cases as they were measured.
 *
 * WHY A SUITE IS TWO THINGS. `.githooks/pre-push-project` is managed for the same
 * reason `tests/` is: a suite is coherent only as the files PLUS its invocation
 * in the gate. Delivering the files alone leaves `tests/manifest` #4 failing
 * every derived push on a suite the gate cannot invoke. It used to be three
 * things; TASK-020 deleted `tests/SUITES.md`, whose Tier column was a second
 * description of what the other two already say.
 *
 * PORTED FROM tests/suite-sync/test.sh, WHICH STAYS IN THE GATE until the central
 * retirement pass. Every case ID is preserved; `#7` is split into its four named
 * sub-assertions because the shell version accumulated them into one `b7` flag,
 * so a single failure named the whole case rather than the rule that broke.
 *
 * ONE DIVERGENCE, and it REMOVES a conditional rather than adding one. `#1d`
 * asked `[ -f "$ROOT/.blueprint-root" ]` and PASSED with a "(skipped — not the
 * blueprint checkout)" message otherwise. That branch existed because the
 * assertion names blueprint-tier suites that only exist here. It is unnecessary:
 * in a derived project the set is empty and the intersection is trivially empty
 * too, so the unconditional form is correct in both worlds and has no skip to
 * misread (R7).
 *
 * THIS SUITE'S OWN GROUP IS IN FLUX, and the port is careful about it. TASK-018
 * is migrating five suites in this directory's neighbourhood, including this one.
 * Nothing below asserts anything about WHICH suites exist, WHAT KIND of runner
 * they hold, or how many there are — `#1` compares the expansion against
 * `git archive` computed at run time, and `#1d`'s list is the export-ignore'd
 * set, which the migration does not touch (none of the five suites being ported
 * is export-ignore'd; all five ship). The one place a suite NAME appears is
 * `#7-absent`, which needs a name that is NOT in the fixture project — a
 * property no migration can change.
 *
 * Parallelism hazard: `#1d` is read-only against the real checkout's HEAD
 * (`git archive`, never the working tree), which is why it is safe while five
 * agents edit that working tree. Everything else builds its own fixtures.
 *
 * EQUIVALENCE RECORD (R6, and the migration's own evidence).
 *
 * "Ported" is a claim, so it was measured rather than reviewed. Fifteen perturbed
 * trees were built and BOTH implementations run over each — the retiring
 * `tests/suite-sync/test.sh` and this spec — with the per-case verdict sets
 * compared mechanically. THE VERDICTS AGREED ON ALL FIFTEEN, including every red
 * set. The sets below are OBSERVED, not predicted.
 *
 *   Mutant Q1: remove `tests/` from MANAGED_FILES — BUG-029 verbatim.
 *     shell #1 #2 #3 #5 #8 #8b #9b · spec #1 #2 #3 #5 #8 #8b #9 · AGREE (the
 *     spec folds #9b into #9, which is the one merge this port makes).
 *     Worth stating: #1b, #1c, #1d, #4, #6 and all four #7* stay GREEN over the
 *     bug this suite is named for, because they constrain HOW the directory
 *     syncs rather than THAT it does.
 *   Mutant Q2: expand with a listing that does not apply export-ignore — i.e.
 *     `git check-attr`'s answer.
 *     shell #1 #1b #2 #8b · spec #1 #1b #2 #8b · AGREE. The export-ignore'd
 *     suite is offered to the project, because a trailing-slash directory
 *     pattern does not propagate to the files under it. #1c pins WHY and stays
 *     green: it asserts the trap, not the choice.
 *   Mutant Q3: warn and carry on instead of failing closed — BUG-029's own
 *     first fix.
 *     shell #8 #8b · spec #8 #8b · AGREE. drift prints "✓ All blueprint-managed
 *     files match" and exits 0 while syncing zero suites.
 *   Mutant Q5: drop `.githooks/pre-push-project` from MANAGED_FILES.
 *     shell #5 #6 · spec #5 #6 · AGREE — the files arrive with nothing to
 *     invoke them.
 *   Mutant Q6: no marker merge, so the hook is whole-file copied.
 *     shell #6 · spec #6 · AGREE. `tests/marker-merge` owns the general case;
 *     this is the one managed file where losing the merge breaks the gate itself.
 *   Mutant Q7: match the managed-directory prefix WITHOUT the separator.
 *     shell #7 · spec #7-sibling · AGREE, and this is the mutant that justifies
 *     splitting #7: the shell banner says only "#7", when what broke is
 *     specifically that `testsuite/` was accepted.
 *   Mutant Q8: drop `_bp_inputs_under_managed_dir`, leaving the exact
 *     `grep -qxF`.
 *     shell #7 · spec #7 · AGREE — no suite could ever be back-propagated.
 *   Mutant Q9: hand `bp_should_substitute` the blueprint-side ABSOLUTE path —
 *     BUG-029 R2-S2's shape.
 *     shell #2b #3 · spec #2b #3 · AGREE, and NOT via #9, which is the case
 *     written for it. The exemption breaks for every suite at once, so #3 (a
 *     suite carrying the literal placeholder) reports it first and #9's narrower
 *     fixture never gets to speak. Recorded rather than tidied: #9 constrains
 *     the blueprint's LOCATION, which is a different axis, and no mutant tried
 *     here separates them.
 *   Control Q10: the healthy tree. Both PASS.
 *   Control L1: a sibling directory named `testsuite-lookalike/`, plus prose
 *     mentioning the markers. Both PASS — the prefix rule respects the
 *     separator and is not fooled by a neighbour.
 *
 * ROUND 2 — FIVE MORE MUTANTS. Jesko (QA-2) enumerated the case names the first
 * ten never reached: `#1c`, `#1d`, `#4`, `#7-absent` and `#7-bare` had a name and
 * no recorded way to go red, which is a name rather than evidence. Observed:
 *
 *   Mutant Q11: `bp_inputs_validate` loses its filesystem half, so a2bp would
 *     file bytes that are not in the project.
 *     shell #7 · spec #7-absent · AGREE — the same split Q7 justifies.
 *     MEASURED, AND IT TOOK TWO GOES: with only `-e`, `-d` and `-f` removed the
 *     mutant came back AGREE-PASS, because `[ ! -r ]` refuses an absent path too.
 *     Four independent reasons to refuse the same input, which is why the mutant
 *     removes all four.
 *   Mutant Q12: Q11 plus a membership prefix that ignores the separator.
 *     shell #7 · spec #7-absent #7-bare #7-sibling · AGREE-fail. `#7-bare` is
 *     guarded THREE times over (the separator, `-d`, `-f`), so no single defect
 *     makes it the distinguishing red case — recorded rather than engineered
 *     around, because "redundantly guarded" is a different fact from "unfalsifiable".
 *   Mutant Q13: expand the managed directory from the PROJECT as well as the
 *     blueprint. Not a straw man — TASK-021 already unions two listings for the
 *     scaffolding move; this points the same idea at the wrong tree.
 *     shell #4 · spec #4 · AGREE. This REPLACES the "one mutant was planned and
 *     not run" note that stood here: #4's subject is reachable by substitution
 *     after all, from the direction of what drift considers its business, and only
 *     the `pull`-deletes-files half still has no injectable form.
 *   Mutant Q14: a blueprint-tier suite loses its `export-ignore` line, so it
 *     ships to every project on the next pull. COMMITTED in the perturbed tree,
 *     because `#1d` asks `git archive HEAD` and a working-tree edit is invisible
 *     to it.
 *     shell #1d · spec #1d · AGREE.
 *   Mutant Q15: FIXTURE PERTURBATION, not a code defect — the shape `M6` uses.
 *     `#1c` asserts that `git archive` really drops an export-ignore'd file,
 *     which is the premise that makes it the only usable oracle; no mutation of
 *     THIS repository's code can falsify a property of git. So the fixture's own
 *     `.gitattributes` stops ignoring the suite, in both runners.
 *     shell #1b #1c #2 · spec #1b #1c #2 · AGREE.
 *
 * TASK-025 retargeted every fixture project from `blueprint_source` to
 * `blueprint_remote`, so drift and pull fetch the fixture blueprint instead of
 * reading its folder. Q15 re-run afterwards: spec #1b #1c #2, unchanged.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'

const CLI = join(REPO_ROOT, 'scripts/blueprint.mts')

/**
 * Copy `scripts/blueprint.mts` into a fixture blueprint's tree, as one of its
 * MANAGED files, so a fixture blueprint a project pulls from still ships
 * something that runs.
 */
async function copyCliInto(s: Scenario, bp: string) {
  await s.fs.copyIn(CLI, join(bp, 'scripts/blueprint.mts'))
}

/**
 * The blueprint-tier suites — the ones `.gitattributes` withholds from every
 * derived project because they only make sense in a blueprint.
 *
 * Duplicated from `.gitattributes` on purpose, and that is the RIGHT direction
 * for this one assertion: `tests/manifest` #7/#7b already prove the declared
 * boundary matches what `git archive` produces, so deriving this list from the
 * same file would make the check circular. What it adds is a second, independent
 * statement that these specific suites must never reach a project — so a line
 * deleted from `.gitattributes` fails HERE by name as well as there by count.
 */
const BLUEPRINT_TIER = [
  'bootstrap-contents',
  'bootstrap-identity',
  'drift-in-blueprint',
  'pull-exec-bit',
  'template-source',
  'bootstrap-gate',
]

async function git(s: Scenario, cwd: string, args: string[]) {
  return s.run('git', args, { cwd })
}

async function initRepo(s: Scenario, dir: string) {
  await git(s, dir, ['init', '-q', '-b', 'main', '.'])
  await git(s, dir, ['config', 'user.email', 't@t.io'])
  await git(s, dir, ['config', 'user.name', 'T'])
  await git(s, dir, ['config', 'commit.gpgsign', 'false'])
}

async function commitAll(s: Scenario, dir: string, message: string) {
  await git(s, dir, ['add', '-A'])
  const r = await git(s, dir, ['commit', '-q', '-m', message])
  expect(r.code, r.output).toBe(0)
}

/**
 * The blueprint's gate, invoking exactly the suites it currently ships.
 *
 * TASK-020: there is no `tests/SUITES.md` to write. A suite's membership is the
 * runner file on disk, and the only claim the blueprint makes ABOUT a suite is
 * that its gate invokes it — so the hook IS the fixture's whole declaration, and
 * dropping a suite means dropping its stage from here.
 */
function hookText(version: number, suites: string[]): string {
  return [
    '#!/bin/sh',
    '# BLUEPRINT:BEGIN',
    `blueprint_region_version=${version}`,
    ...suites.map((x) => `bash tests/${x}/test.sh`),
    '# BLUEPRINT:END',
    '',
  ].join('\n')
}

/**
 * A minimal blueprint with a `tests/` tree, one export-ignore'd suite, and a
 * marker-bearing hook.
 *
 * Minimal rather than a copy of HEAD: the property under test is how the sync CLI
 * treats a managed DIRECTORY, and a fixture small enough to read in full is the
 * one where a surprising result means what it says. `bootstrap-gate` covers the
 * real tree end to end.
 */
async function fixtureBlueprint(s: Scenario, tag: string) {
  const bp = await s.workspace.dir(tag, 'bp')
  await s.fs.write(join(bp, 'CLAUDE.md'), '# CLAUDE for {{PROJECT_NAME}}\n')
  await s.fs.write(join(bp, 'docs/DoD.md'), '# DoD\n')
  await copyCliInto(s, bp)
  await s.fs.write(join(bp, '.blueprint-root'), '')

  await s.fs.write(join(bp, 'tests/alpha/test.sh'), 'echo alpha v1\n')
  // The BUG-028 class: a suite whose FIXTURE DATA is the placeholder itself.
  await s.fs.write(join(bp, 'tests/beta/test.sh'), 'echo "literal {{PROJECT_NAME}} token"\n')
  await s.fs.write(join(bp, 'tests/bponly/test.sh'), 'echo bponly\n')
  // A directory pattern with a TRAILING SLASH — the exact shape whose
  // non-propagation to contained files makes `git check-attr` the wrong oracle.
  await s.fs.write(join(bp, '.gitattributes'), 'tests/bponly/   export-ignore\n')

  await s.fs.write(join(bp, '.githooks/pre-push-project'), hookText(1, ['alpha', 'beta']))

  // The lib tree is copied wholesale: the CLI sources ~a dozen files out of it
  // and enumerating them here would be a second, drifting copy of its own
  // requires list.
  const cp = await s.run('cp', ['-r', join(REPO_ROOT, 'scripts/lib'), join(bp, 'scripts/lib')], {
    cwd: bp,
  })
  expect(cp.code, cp.output).toBe(0)

  await initRepo(s, bp)
  await commitAll(s, bp, 'fixture blueprint')
  return bp
}

async function newProject(s: Scenario, tag: string, name: string, bp: string) {
  const p = await s.workspace.dir(tag, name)
  await s.fs.write(join(p, 'CLAUDE.md'), '# CLAUDE for proj\n')
  await s.fs.write(join(p, 'docs/DoD.md'), '# DoD\n')
  const sha = (await git(s, bp, ['rev-parse', 'HEAD'])).stdout.trim()
  await s.fs.write(
    join(p, '.blueprint-source'),
    [
      'config_version   = 2',
      `blueprint_remote = ${bp}`,
      'blueprint_branch = main',
      `bootstrap_sha    = ${sha}`,
      'bootstrap_date   = 2026-01-01',
      '',
    ].join('\n'),
  )
  await initRepo(s, p)
  await commitAll(s, p, 'init')
  return p
}

/**
 * `blueprint drift` renders `+ path` for new and `~ path` for drifted. Colour is
 * off with no tty, so the prefixes are literal.
 *
 * Reading them as one list is a trap, the same argument sync-by-address's `marked`
 * makes: `!` (missing-in-blueprint) is what a MIS-RESOLVED path
 * produces, so an assertion that only asks "is this path mentioned?" passes on
 * the failure it exists to catch.
 */
function marked(output: string, mark: '~' | '+' | '!'): string[] {
  return output
    .split('\n')
    .filter((l) => l.trimStart().startsWith(mark + ' '))
    .map((l) => l.trim().slice(2).trim())
}

/** The files `git archive HEAD tests` would actually ship out of `root`. */
async function archiveTests(s: Scenario, root: string): Promise<string[]> {
  const r = await s.run(
    'bash',
    ['-c', 'git -C "$1" archive --format=tar HEAD tests 2>/dev/null | tar -t 2>/dev/null\n', 'archive', root],
    { cwd: s.workspace.root },
  )
  return r.stdout
    .split('\n')
    .filter((l) => l.length > 0 && !l.endsWith('/'))
    .sort()
}

const drift = (s: Scenario, proj: string) => s.run('node', [CLI, 'drift'], { cwd: proj })
const pullAll = (s: Scenario, proj: string) => s.run('node', [CLI, 'pull', '--yes'], { cwd: proj })

describe('BUG-029 — a managed DIRECTORY syncs, additively, without eating project-owned files', () => {
  it('#1 the expansion equals `git archive HEAD tests` exactly', async () => {
    await scenario('suite-sync-1', async (s) => {
      const bp = await fixtureBlueprint(s, 'a')
      const p = await newProject(s, 'a', 'proj', bp)

      const r = await drift(s, p)
      const got = marked(r.output, '+')
        .filter((x) => x.startsWith('tests/'))
        .sort()
      const want = await archiveTests(s, bp)

      expect(
        got,
        'drift reported NO new tests/ files — the managed directory is not expanded at all (this IS BUG-029)',
      ).not.toEqual([])
      expect(got, 'the expanded set is not the archive listing').toEqual(want)
    })
  })

  it('#1e TASK-021: a file the blueprint ships is managed with no list naming it, and a shipped seed is not', async () => {
    await scenario('suite-sync-1e', async (s) => {
      const bp = await fixtureBlueprint(s, 'a2')
      await s.fs.write(join(bp, 'NEW-PROTOCOL.md'), '# a document no list has heard of\n')
      await s.fs.write(join(bp, 'README.md'), '# the seed a project rewrites\n')
      await commitAll(s, bp, 'a shipped document and a shipped seed')
      const p = await newProject(s, 'a2', 'proj', bp)

      const offered = marked((await drift(s, p)).output, '+')
      expect(offered, 'a file the archive ships is not managed').toContain('NEW-PROTOCOL.md')
      expect(offered, 'a project-owned seed is managed, so pull would overwrite it').not.toContain('README.md')
    })
  })

  it('#1b an export-ignore\'d suite is absent from the expansion', async () => {
    await scenario('suite-sync-1b', async (s) => {
      const bp = await fixtureBlueprint(s, 'b')
      const p = await newProject(s, 'b', 'proj', bp)

      const r = await drift(s, p)
      expect(
        marked(r.output, '+'),
        "an export-ignore'd suite was offered to the project — it cannot run there",
      ).not.toContain('tests/bponly/test.sh')
    })
  })

  it('#1c check-attr says "unspecified" for a file git archive genuinely drops', async () => {
    await scenario('suite-sync-1c', async (s) => {
      // THE TRAP, PINNED. A future reader WILL reach for `git check-attr` as the
      // obvious query. A trailing-slash directory pattern does not propagate to
      // the files under it, so check-attr reports `unspecified` for a file the
      // archive drops — `tests/manifest` #2b rejected it for the same reason, and
      // this proves the archive oracle is the only usable one.
      const bp = await fixtureBlueprint(s, 'c')

      const attr = await git(s, bp, ['check-attr', 'export-ignore', '--', 'tests/bponly/test.sh'])
      const shipped = await archiveTests(s, bp)

      if (attr.output.includes('unspecified')) {
        expect(
          shipped,
          "the archive shipped an export-ignore'd suite — the oracle itself is broken",
        ).not.toContain('tests/bponly/test.sh')
      } else {
        // The trap is gone (a newer git propagates the attribute). The archive
        // oracle is still correct, which is the property that matters, so this is
        // a pass rather than a failure — but it must be VISIBLE, because the
        // comment above it would then be stale advice.
        expect(shipped, 'the archive oracle disagrees with a check-attr that now answers').not.toContain(
          'tests/bponly/test.sh',
        )
      }
    })
  })

  it('#1d every blueprint-tier suite is absent from what pull would sync', async () => {
    await scenario('suite-sync-1d', async (s) => {
      // Against the REAL checkout's HEAD — never its working tree, which is why
      // this is safe while other agents are editing that tree. In a derived
      // project the intersection is empty because none of these suites is there,
      // so the assertion needs no "am I the blueprint?" branch.
      const shipped = await archiveTests(s, REPO_ROOT)
      const leaked = BLUEPRINT_TIER.filter((x) => shipped.some((f) => f.startsWith(`tests/${x}/`)))

      expect(
        leaked,
        "blueprint-only suites are in the set 'blueprint pull' would push to every project",
      ).toEqual([])
      // NON-VACUITY: if the archive listing were empty this would pass over
      // nothing, which is the exact shape of the bug the suite is named for.
      expect(shipped.length, 'the archive listed no suites at all — the assertion is vacuous').toBeGreaterThan(0)
    })
  })

  it('#2 pull creates the suite directories the blueprint ships', async () => {
    await scenario('suite-sync-2', async (s) => {
      const bp = await fixtureBlueprint(s, 'd')
      const p = await newProject(s, 'd', 'proj', bp)

      const r = await pullAll(s, p)
      expect(r.code, r.output).toBe(0)

      expect(
        await s.fs.exists(join(p, 'tests/alpha/test.sh')),
        'pull did not create tests/alpha/test.sh — a derived project never receives a new suite',
      ).toBe(true)
      expect(
        await s.fs.exists(join(p, 'tests/bponly/test.sh')),
        "pull delivered an export-ignore'd suite",
      ).toBe(false)
    })
  })

  it('#2b drift is clean on tests/ after the pull', async () => {
    await scenario('suite-sync-2b', async (s) => {
      const bp = await fixtureBlueprint(s, 'e')
      const p = await newProject(s, 'e', 'proj', bp)
      await pullAll(s, p)

      const r = await drift(s, p)
      const noisy = [...marked(r.output, '+'), ...marked(r.output, '~')].filter((x) =>
        x.startsWith('tests/'),
      )
      expect(noisy, 'drift still reports tests/ after a full pull').toEqual([])
    })
  })

  it('#3 a suite carrying the literal placeholder arrives byte-identical and drift stays quiet', async () => {
    await scenario('suite-sync-3', async (s) => {
      // Substituting it would rewrite the fixture DATA a suite asserts about, and
      // drift would then compare a substituted blueprint copy against a
      // substituted project copy of a file that no longer contains the token —
      // reporting drift forever on a file pull cannot make match.
      const bp = await fixtureBlueprint(s, 'f')
      const p = await newProject(s, 'f', 'proj', bp)
      await pullAll(s, p)

      const upstream = await readFile(join(bp, 'tests/beta/test.sh'), 'utf8')
      const landed = await readFile(join(p, 'tests/beta/test.sh'), 'utf8')
      expect(landed, 'a suite carrying a literal {{PROJECT_NAME}} was rewritten on the way in').toBe(upstream)
      expect(landed, 'the fixture lost its placeholder, so the case proves nothing').toContain('{{PROJECT_NAME}}')

      const r = await drift(s, p)
      expect(
        [...marked(r.output, '+'), ...marked(r.output, '~')],
        'drift reports tests/beta/test.sh as drifted after pulling it — pull cannot make it match',
      ).not.toContain('tests/beta/test.sh')
    })
  })

  it('#4 a project-authored suite is neither reported by drift nor touched by pull', async () => {
    await scenario('suite-sync-4', async (s) => {
      // The blueprint has no way to know a project wrote it, so sync must be
      // additive-only in this direction. If pull ever grows a delete path, this
      // is the case that fails.
      const bp = await fixtureBlueprint(s, 'g')
      const p = await newProject(s, 'g', 'proj', bp)
      await pullAll(s, p)

      await s.fs.write(join(p, 'tests/project-thing/test.sh'), 'echo mine\n')
      const r = await drift(s, p)
      await pullAll(s, p)

      expect(
        r.output,
        'drift reported a project-authored suite — it is not the blueprint\'s to have an opinion about',
      ).not.toContain('project-thing')
      expect(
        await s.fs.exists(join(p, 'tests/project-thing/test.sh')),
        'pull REMOVED a project-authored suite — the one failure mode worse than the bug',
      ).toBe(true)
      expect(await readFile(join(p, 'tests/project-thing/test.sh'), 'utf8')).toBe('echo mine\n')
    })
  })

  it('#5 a dropped suite is retired, unedited, while its gate stage goes', async () => {
    await scenario('suite-sync-5', async (s) => {
      // This used to pin "no delete path": the project alone cannot tell "the
      // blueprint deleted this" from "the project wrote this", and a prefix-based
      // delete would take out #4's file. TASK-021 §4.2 reads the distinction from
      // the BLUEPRINT's history instead — shipped once, not shipped now, and
      // byte-identical to a shipped version — so the unedited orphan is retired
      // and #4's project-authored suite still survives. An edited orphan stays,
      // and tests/manifest #4 still names it on the derived push.
      //
      // TASK-018 SPLIT THAT CLAIM IN TWO AND THIS SUITE KEEPS ONLY ITS HALF.
      // What suite-sync owns is what PULL does: the orphan survives, and the
      // stage that invoked it does not. That the manifest then NAMES it is
      // asserted where that check lives — tests/manifest/manifest.spec.ts, "#4 a
      // suite whose gate stage is DELETED is named, and the suites still wired in
      // are not". Both halves execute on every push; neither is inferred from the
      // other.
      const bp = await fixtureBlueprint(s, 'h')
      const p = await newProject(s, 'h', 'proj', bp)
      await pullAll(s, p)

      await git(s, bp, ['rm', '-q', '-r', 'tests/alpha'])
      await s.fs.write(join(bp, '.githooks/pre-push-project'), hookText(1, ['beta']))
      await commitAll(s, bp, 'drop alpha')
      await pullAll(s, p)

      const hook = await readFile(join(p, '.githooks/pre-push-project'), 'utf8')
      expect(
        await s.fs.exists(join(p, 'tests/alpha/test.sh')),
        'pull kept an unedited suite the blueprint dropped — retirement did not offer it',
      ).toBe(false)
      expect(
        hook,
        'the dropped suite\'s stage survived the pull — the gate would still invoke a suite the blueprint no longer ships',
      ).not.toContain('bash tests/alpha/test.sh')
      expect(
        hook,
        "the pull removed MORE than the dropped suite's stage — 'beta' is still shipped and still has to be invoked",
      ).toContain('bash tests/beta/test.sh')
    })
  })

  it('#6 the blueprint region updates and the project guards after BLUEPRINT:END survive', async () => {
    await scenario('suite-sync-6', async (s) => {
      // Managing tests/ alone delivers the files and not the invocation, at which
      // point tests/manifest #4 fails every derived push on a suite the gate
      // cannot invoke. So the hook is managed too, and the markers are what let it
      // be managed WITHOUT eating the project's own guards.
      const bp = await fixtureBlueprint(s, 'i')
      const p = await newProject(s, 'i', 'proj6', bp)
      await s.fs.write(
        join(p, '.githooks/pre-push-project'),
        hookText(1, []) + 'echo "my project guard"\n',
      )

      await s.fs.write(join(bp, '.githooks/pre-push-project'), hookText(2, ['beta']))
      await commitAll(s, bp, 'hook v2')
      await pullAll(s, p)

      const merged = await readFile(join(p, '.githooks/pre-push-project'), 'utf8')
      expect(
        merged,
        'the blueprint region did not update — the hook does not travel, so a new suite arrives with nothing to invoke it',
      ).toContain('blueprint_region_version=2')
      expect(
        merged,
        "the project's own guards after BLUEPRINT:END were destroyed by the pull",
      ).toContain('my project guard')
    })
  })
})

describe('BUG-029 R2-S2 — the substitution predicate reads the FILE path, not the blueprint location', () => {
  it('#9 a templated managed file does not report drifted right after being pulled', async () => {
    await scenario('suite-sync-9', async (s) => {
      // `substituted_blueprint_copy` was the one call site of five passing an
      // ABSOLUTE path to bp_should_substitute, so a rule with a leading component
      // matched the CHECKOUT'S OWN LOCATION. A blueprint under any directory named
      // `tests/` exempted EVERY managed file.
      //
      // THE SYMPTOM IS ON THE COMPARISON PATH, NOT IN THE PULLED BYTES, and that
      // distinction is the case. `pull_file` substitutes via
      // `substitute_placeholders "$f"`, which already gets the relative path, so
      // the file that LANDS is correct either way. What breaks is the comparison:
      // drift and pull both diff the project against `substituted_blueprint_copy`,
      // and with the exemption wrongly applied that copy still holds
      // `{{PROJECT_NAME}}` while the project holds the real name. Every templated
      // managed file then reports DRIFTED forever and every pull changes nothing.
      // The first version of this case asserted the pulled bytes, which are fine,
      // and passed against the defect.
      //
      // The fixture blueprint lives under a directory named `tests` ON PURPOSE.
      const bp = await s.workspace.dir('tests', 'bp')
      await s.fs.write(join(bp, 'CLAUDE.md'), '# CLAUDE for {{PROJECT_NAME}}\n')
      await s.fs.write(join(bp, 'docs/DoD.md'), '# DoD\n')
      await s.fs.write(join(bp, 'tests/alpha/test.sh'), 'echo alpha\n')
      await copyCliInto(s, bp)
      const cp = await s.run('cp', ['-r', join(REPO_ROOT, 'scripts/lib'), join(bp, 'scripts/lib')], { cwd: bp })
      expect(cp.code, cp.output).toBe(0)
      await initRepo(s, bp)
      await commitAll(s, bp, 'a blueprint that lives under a directory named tests')

      // The project's basename IS {{PROJECT_NAME}}, so it must be `proj9`.
      const p = await s.workspace.dir('proj9')
      await s.fs.write(join(p, 'docs/DoD.md'), '# DoD\n')
      const sha = (await git(s, bp, ['rev-parse', 'HEAD'])).stdout.trim()
      await s.fs.write(
        join(p, '.blueprint-source'),
        [
          'config_version   = 2',
          `blueprint_remote = ${bp}`,
          `bootstrap_sha    = ${sha}`,
          'bootstrap_date   = 2026-01-01',
          '',
        ].join('\n'),
      )
      await initRepo(s, p)
      await commitAll(s, p, 'init')

      await pullAll(s, p)
      const r = await drift(s, p)

      const landed = await readFile(join(p, 'CLAUDE.md'), 'utf8')
      // The BYTES: correct on both code paths, asserted so that a "fix" which
      // stops substituting altogether cannot pass the comparison assertion by
      // making both sides equally wrong.
      expect(landed, 'the pulled file still holds the raw placeholder').not.toContain('{{PROJECT_NAME')
      expect(landed, 'the project name is not in the pulled file').toContain('proj9')

      // The COMPARISON: this is the one the defect fails.
      expect(
        marked(r.output, '~'),
        `a templated managed file reports DRIFTED immediately after being pulled — ` +
          `the exemption is matching the blueprint's own location (${bp}), so drift ` +
          `compares an unsubstituted copy`,
      ).not.toContain('CLAUDE.md')

      // #9b — and the narrower rule must keep DOING its job, not merely stop
      // over-reaching: the suite under that same blueprint is still exempt.
      expect(
        await s.fs.exists(join(p, 'tests/alpha/test.sh')),
        'the suite was never pulled from a blueprint under a tests/ path',
      ).toBe(true)
      expect(
        r.output,
        'the suite reports drifted after being pulled — the tests/ exemption stopped applying',
      ).not.toContain('tests/alpha')
    })
  })
})
