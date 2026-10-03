/**
 * tests/git-isolation/git-isolation.spec.ts — BUG-014.
 *
 * A test suite must never write into the repository it is run from. Reproduced
 * in seconds, before the fix:
 *
 *     GIT_DIR=/tmp/victim/.git bash tests/marker-merge/test.sh
 *     # victim HEAD: bdac8b5 -> ef24387   ← the fixture's commit, in the wrong repo
 *
 * THIS SUITE HAS A DISSOLUTION DATE, and saying so is part of porting it.
 *
 * Its whole subject is SHELL SUITES: files that must each remember one `unset`
 * line. Under TASK-018 that population shrinks to zero, and the property moves
 * into the type system — `tests/harness/env.ts` refuses to start a scenario while
 * a forbidden variable is present, and there is no primitive a spec can call to
 * get an unsandboxed environment (R3). So this suite goes the way
 * `tests/manifest` #4 and #5 go in TASK-018-TARGET §4: not satisfied by the
 * migration, DISSOLVED by it. Until then it is the only thing standing between
 * twenty shell fixtures and the operator's real `.git`.
 *
 * WHICH IS WHY THE MAGIC NUMBERS ARE GONE, and this is the one behavioural change
 * in the port. The shell version hardcoded two floors, and the PROSE HERE WAS
 * WRONG ABOUT BOTH until 2026-09-11 — corrected below, with what was measured:
 *
 *   `[ "$found" -lt 15 ]`      → 20 git-driving members today, `git-isolation`'s
 *                                own runner among them. Retiring `state-dir`,
 *                                `commit-msg-gate` and `commit-subjects` leaves
 *                                17, so the floor needs three FURTHER removals
 *                                to bite. MEASURED: six non-anchor removals
 *                                (a2bp-build, a2bp-contamination, a2bp-e2e,
 *                                a2bp-inputs, baton-durability, dod-gate) →
 *                                "#3 only 14 git-driving suites found". The
 *                                earlier "retires four of them, leaving 16, ONE
 *                                retirement from red" arithmetic was wrong; the
 *                                conclusion it supported — that a count floor
 *                                goes red on a healthy tree under this migration
 *                                — is not.
 *   `[ "$_gi_n" -ge 3 ]`       → NOT the floor that breaks first. It CANNOT
 *                                break at all: it word-counts the hardcoded
 *                                literal `GI_ANCHORS="marker-merge gate-arming
 *                                commit-subjects"`, which is never derived from
 *                                disk, so `_gi_n` is 3 over every possible tree
 *                                including an empty one. MEASURED, by deleting
 *                                `tests/commit-subjects/test.sh` and running the
 *                                real runner: what goes red is `#1`'s
 *                                `[ ! -f "$s" ]` ("#1 tests/commit-subjects/
 *                                test.sh not found") and `#3`'s `missing_anchor`
 *                                branch ("#3 discovery MISSED suites #1 proves
 *                                drive git: commit-subjects"). The ordering
 *                                constraint the old text drew from this floor
 *                                stands unchanged — an anchor retirement IS
 *                                immediately red — but it is enforced two lines
 *                                elsewhere, and a reader sent to line 109 finds
 *                                a line that cannot fail.
 *
 * Both were correct when written and both are now booby traps under the very
 * migration they sit inside. They are replaced by the half that would actually
 * have caught BUG-047 — every anchor still ON DISK must be found by the
 * predicate — plus, when the population empties, an explicit assertion that
 * every anchor became a SPEC. That end-state branch used to assert the `.sh`
 * population was empty and was itself red at the end state, on
 * `tests/helpers/proc-cwd.sh`, which is alive; see #3's own comment. A vacuous
 * pass is acceptable here ONLY because it is the intended end state, and it is
 * asserted as such rather than arrived at silently.
 *
 * EQUIVALENCE RECORD (TASK-018-RULES R6).
 *
 * ELEVEN trees — ten perturbed and the real `tests/` directory — were built once
 * and BOTH implementations run over each: the retiring
 * `tests/git-isolation/test.sh`, copied into the fixture and run with the fixture
 * as its ROOT, and `scanGitIsolation()` + `hookUnsetsGitDir()`. Verdicts for #2
 * and #3 were compared on every tree; #1 only on the real one, since it EXECUTES
 * the anchors and a fixture's stub is not the suite.
 *
 * **They agreed on ten of eleven trees. The eleventh is the deliberate divergence
 * above:** a tree with six git-driving suites, all correctly unsetting GIT_DIR and
 * including every anchor. The shell reports #3 FAILED — "only 6 git-driving suites
 * found — discovery is broken" — and the port reports #3 passed. That is the tree
 * the retirement wave produces, nothing about it is broken, and the shell verdict
 * on it is wrong.
 *
 * One further difference, recorded: the shell's one-level glob under `tests/`
 * would also reach `tests/node_modules/<pkg>/*.sh` if any dependency shipped
 * one. The port excludes `node_modules` explicitly. No such file exists today —
 * verified — so no verdict differed.
 *
 * R6 NEGATIVE PROOF — per CASE, not per case GROUP.
 *
 * The record above compares VERDICT SETS between the shell suite and this
 * port. Three Codex reviews of neighbouring groups refused certification on
 * the same point: agreeing on `#3` does not say which of the cases NAMED `#3`
 * can be made red. So every `it()` here was put to the narrower question —
 * is there a perturbation OBSERVED to turn it red — and the answer is
 * recorded in docs/waiting-acceptance/TASK-018-R6-isolation/outputs/gap.txt, which names
 * the mutant(s) per case. The denominator comes from the runner rather than
 * from a grep, so the `it.each` tables are expanded rather than counted once.
 *
 * Fourteen cases, fourteen with an observed red. One is worth naming here:
 * emptying DECLARED_ANCHORS turns `#3 THE REAL TREE` red, so the anchor half
 * that REPLACED the two magic-number floors is proven load-bearing rather
 * than merely argued for. `#1` is evidenced ONE ANCHOR AT A TIME — each is
 * its own case and a red on one says nothing about the others.
 *
 * One mutant nothing kills, recorded because a green run cannot show it:
 * loosening UNSETS_GIT_DIR to a bare /GIT_DIR/ turns no case red. Comments
 * are stripped before the predicate runs, so the false positives it would
 * admit are already gone; what is untested is a CODE line that merely
 * mentions the variable, and the documented refusal of `unset -v GIT_DIR`.
 */

import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import {
  DECLARED_ANCHORS,
  hookUnsetsGitDir,
  scanGitIsolation,
  type GitIsolationScan,
} from './git-isolation.js'

const TESTS_DIR = join(REPO_ROOT, 'tests')
const PRE_PUSH = join(REPO_ROOT, '.githooks/pre-push')

/** A victim repository standing in for the developer's real checkout. */
async function newVictim(s: Scenario, name: string): Promise<{ dir: string; head: string; config: string }> {
  const repo = await s.gitRepo(name)
  await s.fs.write(join(name, 'base.txt'), 'base\n')
  await repo.commitAll('base')
  const head = await s.run('git', ['rev-parse', 'HEAD'], { cwd: repo.dir })
  const config = await s.run('git', ['config', '--list', '--local'], { cwd: repo.dir })
  return {
    dir: repo.dir,
    head: head.stdout.trim(),
    config: config.stdout.split('\n').sort().join('\n'),
  }
}

async function scanTree(
  s: Scenario,
  name: string,
  suites: Record<string, string>,
): Promise<GitIsolationScan> {
  const testsDir = await s.workspace.dir(name, 'tests')
  for (const [rel, content] of Object.entries(suites)) {
    await s.fs.write(join(name, 'tests', rel), content)
  }
  return scanGitIsolation(testsDir)
}

/** A shell suite that drives git and defends itself. */
const GUARDED = '#!/bin/sh\nunset GIT_DIR GIT_WORK_TREE\ngit init -q "$1"\n'
/** One that drives git and does not. */
const NAKED = '#!/bin/sh\ngit init -q "$1"\n'

describe('BUG-014 — a test fixture cannot write into the repository under test', () => {
  it.each([...DECLARED_ANCHORS])(
    '#1 %s leaves the GIT_DIR repository untouched — proven by EXECUTION',
    async (anchor) => {
      await scenario(`gi-1-${anchor}`, async (s) => {
        const runner = join(TESTS_DIR, anchor, 'test.sh')
        const present = await s.run('test', ['-f', runner], { cwd: s.workspace.root })
        if (present.code !== 0) {
          // The anchor has become a spec. NOT a coverage loss, and worth being
          // precise about why: this case proves a SHELL SUITE defends itself
          // against an inherited GIT_DIR, and a spec CANNOT fail to —
          // tests/harness/env.ts refuses to start a scenario while the variable
          // is present, so there is nothing left to remember (R3).
          //
          // Asserted rather than skipped: R7 says a skipped test fails the
          // build, and "the runner is gone BECAUSE a spec replaced it" is a real
          // claim that can be wrong. A deleted suite with no spec is a coverage
          // cut, and this is where it surfaces.
          const spec = await s.run('test', ['-f', join(TESTS_DIR, anchor, `${anchor}.spec.ts`)], {
            cwd: s.workspace.root,
          })
          expect(
            spec.code,
            `${anchor}/test.sh is gone and tests/${anchor}/${anchor}.spec.ts does not ` +
              `exist — the suite was deleted rather than ported, which is a silent ` +
              `coverage cut`,
          ).toBe(0)
          return
        }

        const victim = await newVictim(s, `victim-${anchor}`)

        // GIT_DIR ALONE — which is what git actually hands a pre-push hook, and
        // what reproduced the incident. Setting GIT_WORK_TREE as well changes the
        // behaviour and the fixture stops landing in the victim, so a test that
        // set both would pass against the unfixed code and prove nothing.
        await s.run('bash', [runner], {
          cwd: REPO_ROOT,
          env: { GIT_DIR: join(victim.dir, '.git') },
          timeoutMs: 240_000,
        })

        const headAfter = await s.run('git', ['rev-parse', 'HEAD'], { cwd: victim.dir })
        const configAfter = await s.run('git', ['config', '--list', '--local'], {
          cwd: victim.dir,
        })

        expect(
          headAfter.stdout.trim(),
          `${anchor} wrote a commit into the repo GIT_DIR pointed at`,
        ).toBe(victim.head)
        expect(
          configAfter.stdout.split('\n').sort().join('\n'),
          `${anchor} rewrote the local git config of the repo GIT_DIR pointed at — ` +
            `setting core.hooksPath on a real repo IS the A-22 / BUG-004 failure, ` +
            `produced by a test`,
        ).toBe(victim.config)
      })
    },
  )

  it('#2 the pre-push hook unsets GIT_DIR before running anything', async () => {
    // Layer one of the fix, and the one that covers suites written after this
    // check: the hook is where the variables enter.
    expect(
      await hookUnsetsGitDir(PRE_PUSH),
      'the pre-push hook does not unset GIT_DIR — every suite it runs inherits it',
    ).toBe(true)
  })

  it('#3 BUG-088: THE REAL TREE — every git-driving shell suite unsets GIT_DIR itself, and once that population empties every declared anchor owns a spec', async () => {
    const scan = await scanGitIsolation(TESTS_DIR)

    expect(
      scan.naked,
      `suites drive git without unsetting GIT_DIR: ${scan.naked.join(' ')}`,
    ).toEqual([])

    // NON-VACUITY HAS TWO HALVES, because a count can only detect an EMPTY
    // control, never an under-inclusive one. The old floor (`found -lt 15`) sat
    // comfortably at 20 members for as long as the predicate was blind — it was
    // passing at four times its own threshold on the day both offenders were
    // outside the set. The anchors are the half that would have failed.
    const anchorsOnDisk = DECLARED_ANCHORS.filter((a) =>
      scan.considered.includes(`${a}/test.sh`),
    )
    for (const anchor of anchorsOnDisk) {
      expect(
        scan.members,
        `#3 discovery MISSED ${anchor}, which #1 proves by execution drives git. ` +
          `The predicate has narrowed and this check is no longer the control it ` +
          `claims to be (BUG-047).`,
      ).toContain(`${anchor}/test.sh`)
    }

    // The population, reported rather than floored. When it reaches zero this
    // suite has dissolved and should be deleted along with its shell twin; until
    // then the number is the honest measure of what is still at risk.
    if (scan.members.length === 0) {
      // THE END STATE, STATED POSITIVELY — as "the migration COMPLETED", not as
      // "the directory is empty".
      //
      // This branch used to assert `scan.considered` was empty, and MEASURED,
      // that is red at the end state for a file that is alive and correct:
      // `scanGitIsolation` walks `tests/<dir>/*.sh` and `tests/helpers/` is a
      // directory under `tests/`, so `helpers/proc-cwd.sh` is CONSIDERED. It
      // drives no git, so it is not a member — population zero, terminal branch
      // taken, and the assertion fires on a live shell helper. It would also
      // have fired on any runner deliberately RETAINED, which is a decision the
      // founder gets to make without this control calling it a defect.
      //
      // What the dissolution actually claims is that every anchor's hazard moved
      // into the type system rather than being dropped, so that is what is
      // asserted: each declared anchor now owns a spec. It survives both a live
      // shell helper and a deliberately-retained runner.
      //
      // THE LIST FIRST, because at the end state this branch is the only thing
      // this suite says about the real tree, and a `for` over an empty list is a
      // green that asserted nothing. The `else` branch is guarded by
      // `anchorsOnDisk.length`, which an empty DECLARED_ANCHORS already fails;
      // this branch needs its own, or the two halves are not equally honest.
      expect(
        DECLARED_ANCHORS.length,
        'DECLARED_ANCHORS is empty, so this branch would pass over nothing',
      ).toBeGreaterThan(0)
      for (const anchor of DECLARED_ANCHORS) {
        expect(
          existsSync(join(TESTS_DIR, anchor, `${anchor}.spec.ts`)),
          `no git-driving shell suite remains, but tests/${anchor}/${anchor}.spec.ts ` +
            `does not exist — ${anchor} was DELETED rather than ported, so the hazard ` +
            `this control existed for left with no successor. This suite dissolves ` +
            `once every anchor is a spec (TASK-018-TARGET §4), not before.`,
        ).toBe(true)
      }
    } else {
      expect(
        anchorsOnDisk.length,
        `${scan.members.length} git-driving shell suite(s) remain and NONE of the ` +
          `declared anchors is on disk — the predicate is then unchecked, which is ` +
          `exactly the state BUG-047 was found in`,
      ).toBeGreaterThan(0)
    }
  })

  it('#3 a suite that drives git and forgets its unset line is named', async () => {
    await scenario('gi-3-naked', async (s) => {
      const scan = await scanTree(s, 'bp', {
        'a/test.sh': GUARDED,
        'b/test.sh': NAKED,
        // A suite that drives no version control at all. The word must not be
        // written even in prose INSIDE code, because the predicate matches a
        // bare `git` token wherever it sits — over-inclusion is the safe
        // direction and `echo no git here` is genuinely a member. Learned by
        // running it: the first version of this fixture used that exact string
        // and the case failed for being right.
        'c/test.sh': '#!/bin/sh\necho nothing to see\n',
      })

      expect(scan.members).toEqual(['a/test.sh', 'b/test.sh'])
      expect(scan.naked).toEqual(['b/test.sh'])
    })
  })

  it('#3 BUG-047 half one — `git -C … init` is FOUND, though it has no "git init" substring', async () => {
    await scenario('gi-3-git-c', async (s) => {
      // `commit-subjects:195` was exactly this line while that suite was provably
      // rewriting a victim repository's config, and the old predicate
      // (`grep -q 'git init'`) could not see it.
      const scan = await scanTree(s, 'bp', {
        'a/test.sh': '#!/bin/sh\ngit -C "$T6" init -q\n',
        'b/test.sh': GUARDED,
      })

      expect(scan.members).toContain('a/test.sh')
      expect(scan.naked).toEqual(['a/test.sh'])
    })
  })

  it('#3 BUG-087 — the `new-project.sh` arm of the predicate cannot fire on a real call site', async () => {
    await scenario('gi-3-newproject', async (s) => {
      // BUG-047 added `new-project.sh` to the predicate to catch the
      // `bootstrap-identity` class: a suite that drives git WITHOUT typing `git`,
      // because scripts/new-project.sh does it for them — and which left
      // `chore(bootstrap): initialize …` as a commit in a victim repository.
      //
      // THE ARM CANNOT MATCH ANY PATH-QUALIFIED INVOCATION, and never could. The
      // prefix guard excludes `[A-Za-z0-9_./-]` before the token, and `/` is in
      // that set, so `.../scripts/new-project.sh` is rejected before the name is
      // even considered. Every suite in this repo invokes it by path. Probed
      // directly against the shell regex before this case was written: three
      // realistic spellings, none matched; only a bare `new-project.sh …` does,
      // which nothing writes.
      //
      // It has never caught anything either: at `d24b472`, the commit that added
      // the arm, `bootstrap-identity` was in the member set via a `git config`
      // line on :54 — the OTHER arm. So the control passed while the half added
      // for the case that motivated it was inert. That is the BUG-074 shape
      // exactly, and it is filed as BUG-087 rather than fixed here, because
      // widening a predicate under a migration changes a verdict.
      const scan = await scanTree(s, 'bp', {
        'a/test.sh': '#!/bin/sh\nbash "$ROOT/scripts/new-project.sh" --name x\n',
        'b/test.sh': GUARDED,
      })

      expect(scan.members).not.toContain('a/test.sh')
      expect(scan.naked).toEqual([])

      // The one spelling that does match, so the arm is proven present rather
      // than merely absent — otherwise this case could not tell a dead arm from
      // a deleted one.
      const bare = await scanTree(s, 'bare', {
        'a/test.sh': '#!/bin/sh\nnew-project.sh --name x\n',
      })
      expect(bare.members).toEqual(['a/test.sh'])
    })
  })

  it('#3 BUG-047 half two — a suite whose only "git" is in a COMMENT is NOT a member', async () => {
    await scenario('gi-3-comment', async (s) => {
      // `branch-guard`'s header said "this suite runs `git init`" while its code
      // was `git -C "$1" init -q -b main`. Membership of a safety control was
      // being decided by what comments SAY rather than by what code DOES, which
      // is the BUG-035 shape. A file that only mentions git needs no unset line,
      // and reporting it teaches people to ignore the control.
      const scan = await scanTree(s, 'bp', {
        'a/test.sh': '#!/bin/sh\n# this suite runs git init in a fixture\ntrue\n',
        'b/test.sh': GUARDED,
      })

      expect(scan.members).toEqual(['b/test.sh'])
      expect(scan.naked).toEqual([])
      expect(scan.considered).toContain('a/test.sh')
    })
  })

  it('#3 the unset line is read from CODE too — a commented-out unset does not count', async () => {
    await scenario('gi-3-commented-unset', async (s) => {
      // The asymmetry BUG-047 names: the unset check already stripped comments
      // and the DISCOVERY did not. Both halves are stripped here, so a file that
      // documents its unset without performing it is a finding.
      const scan = await scanTree(s, 'bp', {
        'a/test.sh': '#!/bin/sh\n# unset GIT_DIR — see BUG-014\ngit init -q x\n',
      })

      expect(scan.members).toEqual(['a/test.sh'])
      expect(scan.naked).toEqual(['a/test.sh'])
    })
  })

  it('#3 a NON-test.sh runner in a suite folder is covered — the glob is *.sh', async () => {
    await scenario('gi-3-extra-runner', async (s) => {
      // `staleness/drift-integration.sh` is a real instance: a second runner in a
      // suite folder, discovered because the glob is `tests/*/*.sh` rather than
      // `tests/*/test.sh`. A narrower glob would leave it free to corrupt a repo.
      const scan = await scanTree(s, 'bp', {
        'a/test.sh': GUARDED,
        'a/drift-integration.sh': NAKED,
      })

      expect(scan.naked).toEqual(['a/drift-integration.sh'])
    })
  })

  it('#2 a pre-push hook whose unset is COMMENTED OUT does not count', async () => {
    await scenario('gi-2-commented', async (s) => {
      await s.fs.write('bp/pre-push', '#!/bin/sh\n# unset GIT_DIR\nexec true\n')
      expect(await hookUnsetsGitDir(s.workspace.path('bp', 'pre-push'))).toBe(false)

      await s.fs.write('bp/good', '#!/bin/sh\nunset GIT_DIR GIT_WORK_TREE\nexec true\n')
      expect(await hookUnsetsGitDir(s.workspace.path('bp', 'good'))).toBe(true)
    })
  })

  it('#2 a MISSING pre-push hook is a failure, not an absence to shrug at', async () => {
    await scenario('gi-2-missing', async (s) => {
      // Fails closed: a hook that is not there unsets nothing, and every suite
      // the gate runs inherits the variable.
      expect(await hookUnsetsGitDir(s.workspace.path('bp', 'nope'))).toBe(false)
    })
  })

  it('#3 THE DIVERGENCE — a small, fully-guarded population passes here and FAILS in the shell twin', async () => {
    await scenario('gi-3-post-retirement', async (s) => {
      // This is the tree the TASK-018 retirement wave produces: six git-driving
      // shell suites, every one of them correct, every anchor present. The shell
      // control reports "only 6 git-driving suites found — discovery is broken"
      // and fails the push. Nothing is broken; twenty-nine suites became specs.
      //
      // Measured, not predicted: the shell suite was run against exactly this
      // tree and did fail on it.
      const suites: Record<string, string> = {}
      for (const anchor of DECLARED_ANCHORS) suites[`${anchor}/test.sh`] = GUARDED
      suites['a2bp-e2e/test.sh'] = GUARDED
      suites['dod-gate/test.sh'] = GUARDED
      suites['staleness/test.sh'] = GUARDED

      const scan = await scanTree(s, 'bp', suites)

      expect(scan.members).toHaveLength(6)
      expect(scan.naked).toEqual([])
      // And the anchor half still bites, which is what makes the floor
      // unnecessary rather than merely inconvenient.
      for (const anchor of DECLARED_ANCHORS) {
        expect(scan.members).toContain(`${anchor}/test.sh`)
      }
    })
  })
})
