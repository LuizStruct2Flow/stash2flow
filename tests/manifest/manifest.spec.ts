/**
 * tests/manifest/manifest.spec.ts — BUG-005, and BUG-074.
 *
 * WHAT THIS SUITE IS. Not a test of product behaviour: a META-CONTROL. It
 * derives the suite set from the filesystem, then asserts every suite is
 * invoked by the gate and by CI, and that `.gitattributes`'s declared export
 * boundary matches what `git archive` actually produces. The reasoning for each
 * check lives beside it in `manifest.ts`, which is where the check is.
 *
 * WHY EVERY CHECK HAS A FIXTURE CASE. The live cases at the bottom run over the
 * real repo, where everything passes — and a control that has only ever been
 * seen passing proves nothing about what it would say over a broken tree. That
 * is TASK-018-RULES R6, and it is not hypothetical here: `a2bp-contamination`'s
 * headline assertion was dead for months, printing its failure 28 times and
 * still exiting 0. So every check below is first shown RED, on a synthetic tree
 * carrying exactly the defect it exists to catch, with the baseline asserted
 * green in the same file so a red case cannot be red for some other reason.
 *
 * EQUIVALENCE RECORD (R6, and the migration's own evidence).
 *
 * "Ported" is a claim, so it was measured rather than reviewed. Twenty-one
 * perturbed trees — the ones below, plus the real repo — were built once and
 * BOTH implementations run over each: the retiring `tests/manifest/test.sh`,
 * wired into the fixture as an ordinary suite, and `inspect()`. The per-check
 * verdict SETS were compared mechanically. They agreed on all twenty-two
 * inputs.
 *
 * Three differences exist and are recorded rather than smoothed over:
 *
 *   - BUG-074, the one behavioural divergence, and it is a defect in the SHELL
 *     version. It could only discover a bridge whose `source` line was
 *     INDENTED, so an unindented one made #4 fail for the wrong reason and made
 *     #2c skip that bridge entirely — fail-OPEN, which is the half that
 *     matters. Two cases below pin the fix. Every source line in this repo's
 *     hooks happens to be indented, which is why it stayed latent.
 *   - `#9` / `#9a` / `#9b` DO NOT EXIST HERE, and cannot. The shell version
 *     re-ran itself with node/npm/npx/tsc/vitest poisoned and asserted it
 *     invoked none of them, so that a project with no toolchain still got a
 *     truthful answer out of its own coverage control. A vitest spec cannot
 *     assert that about itself. What stands in its place is
 *     `scripts/run-ts-suites.sh` BLOCKING rather than skipping when `npx` or
 *     `tests/node_modules` is absent: no answer and no push, instead of a wrong
 *     answer believed. That is weaker, and saying so is the point.
 *   - The shell version interpolated suite names into regexes unescaped, so a
 *     suite named `a.b` would have matched `axb` in #4/#5. Ported escaped. No
 *     suite name in this repo or in any fixture carries a metacharacter, so no
 *     verdict differed; noted because a silent tightening is still a change.
 */

import { describe, it, expect, vi, type TestContext } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { inspect, bareSkips, type CheckResult } from './manifest.js'
import { notGithubActions, skipNote, skipVisibly } from '../helpers/project-config.js'
import { baselineTree, materialize, BP_ONLY_SUITE, SUITES, TS_SUITE } from './fixture.js'

/** The ids of the checks that FAILED — the verdict, in one comparable shape. */
const red = (checks: CheckResult[]): string[] => checks.filter((c) => !c.ok).map((c) => c.id)

/** The failure text for one check, for asserting the message names the culprit. */
const why = (checks: CheckResult[], id: string): string =>
  checks.find((c) => c.id === id && !c.ok)?.message ?? `(#${id} did not fail)`

/**
 * Build a perturbed tree and inspect it.
 *
 * `mutate` receives the healthy file map and the post-commit overlay. Returning
 * nothing and mutating in place keeps each case's perturbation to the one or
 * two lines that ARE the perturbation.
 */
async function inspectFixture(
  s: Scenario,
  name: string,
  mutate: (files: Map<string, string>, postCommit: Map<string, string | null>) => void = () => {},
): Promise<CheckResult[]> {
  const files = await baselineTree()
  const postCommit = new Map<string, string | null>()
  mutate(files, postCommit)
  const root = await materialize(s, name, files, postCommit)
  return inspect(root, s.run)
}

describe('BUG-005 — every runner on disk is invoked, and the export boundary behaves as declared', () => {
  it('#0 the healthy fixture passes every check — without which no case below means anything', async () => {
    await scenario('manifest-baseline', async (s) => {
      const checks = await inspectFixture(s, 'bp')

      expect(red(checks), checks.map((c) => `${c.ok ? 'ok' : 'FAIL'} ${c.message}`).join('\n')).toEqual([])
      // NON-VACUITY OF THE FIXTURE ITSELF. Every check passes trivially over a
      // tree with no suites in it, which is the exact failure mode this whole
      // suite exists to refuse — so the baseline has to be seen doing work.
      expect(checks.map((c) => c.id)).toEqual(['#1', '#1b', '#2b', '#2c', '#4', '#5', '#5b', '#7', '#7b'])
      expect(why(checks, 'nothing')).toBe('(#nothing did not fail)')
    })
  })

  it('a missing scripts/lib/suites.sh REFUSES to judge, rather than passing over zero suites', async () => {
    await scenario('manifest-nolib', async (s) => {
      // The vacuity #7 exists to catch, one step earlier and with the right
      // culprit named: with no derivation every assertion passes trivially, and
      // #7 would blame the tree rather than the absent file.
      const checks = await inspectFixture(s, 'bp', (files) => {
        files.delete('scripts/lib/suites.sh')
      })

      expect(red(checks)).toEqual(['suites-lib'])
      expect(why(checks, 'suites-lib')).toContain('blueprint pull scripts/lib/suites.sh')
    })
  })

  it('#1 a runner sitting directly in tests/ belongs to no suite, so it executes nowhere', async () => {
    await scenario('manifest-1', async (s) => {
      const checks = await inspectFixture(s, 'bp', (files) => {
        // A spec, since TASK-047: the orphan is a runner of the only kind there
        // is. It still belongs to no suite, so nothing invokes it, no export rule
        // covers it, and it would execute nowhere while looking like a test.
        files.set('tests/orphan.spec.ts', 'export const orphan = true\n')
      })

      expect(red(checks)).toEqual(['#1'])
      expect(why(checks, '#1')).toContain('tests/orphan.spec.ts')
    })
  })

  it('TASK-086: a derived project may own a runner at the tests/ root, the only place DoD §2 counts; the blueprint still may not', async () => {
    await scenario('manifest-task-086', async (s) => {
      const toplevel = (files: Map<string, string>) =>
        files.set('tests/foo.spec.ts', 'export const foo = true\n')

      // DERIVED: no .blueprint-root. DoD §2 counts only top-level titles here,
      // so #1 must accept the file and say why rather than pass in silence.
      const derived = await inspectFixture(s, 'derived', (files) => {
        toplevel(files)
        files.delete('.blueprint-root')
      })
      expect(red(derived)).toEqual([])
      expect(derived.find((c) => c.id === '#1')?.message).toContain('tests/foo.spec.ts')

      // BLUEPRINT: the guard is narrowed, not deleted.
      const bp = await inspectFixture(s, 'bp', toplevel)
      expect(red(bp)).toEqual(['#1'])
      expect(why(bp, '#1')).toContain('tests/foo.spec.ts')
    })
  })

  it('#1b a shared helper no suite sources is dead code the helpers exemption would hide', async () => {
    await scenario('manifest-1b', async (s) => {
      // A helper is exempt from being a suite because it is SOURCED rather than
      // run. That exemption is a place to hide code unless something asserts
      // the sourcing actually happens.
      const checks = await inspectFixture(s, 'bp', (files) => {
        files.set('tests/helpers/nobody-sources-me.sh', 'true\n')
      })

      expect(red(checks)).toEqual(['#1b'])
      expect(why(checks, '#1b')).toContain('nobody-sources-me.sh')
    })
  })

  it('#2b a suite declared blueprint-only that nevertheless SHIPS is caught (BUG-028)', async () => {
    await scenario('manifest-2b-shipped', async (s) => {
      // The tier is read from the working tree; the archive is HEAD. Adding the
      // line after the commit is how "declared blueprint-only, ships anyway"
      // becomes expressible — and it is also the real shape, since the
      // manifest runs at pre-push over a boundary someone has just edited.
      const checks = await inspectFixture(s, 'bp', (files, post) => {
        post.set('.gitattributes', `${files.get('.gitattributes') ?? ''}tests/s01/   export-ignore\n`)
      })

      expect(red(checks)).toEqual(['#2b'])
      expect(why(checks, '#2b')).toContain('s01')
      expect(why(checks, '#2b')).toContain('NOT COMMITTED')
    })
  })

  it('#2b a suite that ships its directory but NOT its runner is hollow, and the derived gate skips it silently', async () => {
    await scenario('manifest-2b-hollow', async (s) => {
      const checks = await inspectFixture(s, 'bp', (files) => {
        // A sibling file so the DIRECTORY still arrives — `grep "^tests/s02/"`
        // used to call that a healthy boundary while the recipient received a
        // suite directory with no runner in it and ran nothing from it.
        files.set('tests/s02/README.md', 'a sibling that ships\n')
        files.set('.gitattributes', `${files.get('.gitattributes') ?? ''}tests/s02/s02.spec.ts   export-ignore\n`)
      })

      expect(red(checks)).toEqual(['#2b'])
      expect(why(checks, '#2b')).toContain('s02(0/1 spec)')
    })
  })

  it('#2b a suite with no blueprint-only line whose files never arrive is a silent cut for every project but this one', async () => {
    await scenario('manifest-2b-withheld', async (s) => {
      // `tests/s03/**` is NOT a tier declaration — the derivation requires a
      // directory-level `tests/<suite>/ export-ignore`. So the suite is `both`
      // and nothing of it ships: caught by a broad pattern elsewhere in the
      // file is exactly the accident this branch is for.
      const checks = await inspectFixture(s, 'bp', (files) => {
        files.set('.gitattributes', `${files.get('.gitattributes') ?? ''}tests/s03/**   export-ignore\n`)
      })

      expect(red(checks)).toEqual(['#2b'])
      expect(why(checks, '#2b')).toContain('s03')
    })
  })

  it('#2b + #2c specs that ship while the whole TS toolchain does not are runners the recipient cannot execute (BUG-073)', async () => {
    await scenario('manifest-2b-unrunnable', async (s) => {
      const checks = await inspectFixture(s, 'bp', (files) => {
        files.set(
          '.gitattributes',
          `${files.get('.gitattributes') ?? ''}` +
            'tests/package.json   export-ignore\n' +
            'tests/package-lock.json   export-ignore\n' +
            'tests/tsconfig.json   export-ignore\n' +
            'tests/vitest.config.ts   export-ignore\n' +
            'tests/harness/   export-ignore\n',
        )
      })

      expect(red(checks)).toEqual(['#2b', '#2c'])
      expect(why(checks, '#2b')).toContain(`${TS_SUITE}(1 spec)`)
      expect(why(checks, '#2c')).toContain('BUG-073')
    })
  })

  it('#2c a toolchain that ships in PART is worse than none — the CI job is MANAGED and runs npm ci (BUG-061)', async () => {
    await scenario('manifest-2c-partial', async (s) => {
      // package-lock.json ALONE once shipped for the whole of phase 1, because
      // nothing listed it and the check computed the toolchain from a
      // hand-written subset that also omitted it. Here the omission is
      // inverted — one file withheld — and the partial-ship tally catches it
      // either way, which is the property that closes the class.
      const checks = await inspectFixture(s, 'bp', (files) => {
        files.set(
          '.gitattributes',
          `${files.get('.gitattributes') ?? ''}tests/package-lock.json   export-ignore\n`,
        )
      })

      expect(red(checks)).toEqual(['#2b', '#2c'])
      expect(why(checks, '#2c')).toContain('ships in PART')
      expect(why(checks, '#2c')).toContain('tests/package-lock.json')
    })
  })

  it('#2c the harness arriving in PART leaves every shipped spec importing a module that is not there', async () => {
    await scenario('manifest-2c-harness', async (s) => {
      // The toolchain check is satisfied by ONE file under tests/harness/ — a
      // one-file proxy for a whole directory, which is the shape BUG-061 walked
      // through. Both sides are read off the filesystem so a harness file added
      // tomorrow is covered with nothing to remember.
      const checks = await inspectFixture(s, 'bp', (files) => {
        files.set(
          '.gitattributes',
          `${files.get('.gitattributes') ?? ''}tests/harness/canary.ts   export-ignore\n`,
        )
      })

      expect(red(checks)).toEqual(['#2c'])
      expect(why(checks, '#2c')).toContain('tests/harness/canary.ts')
    })
  })

  it('#2c a toolchain that ships with NO spec to run means every project pays npm ci for nothing', async () => {
    await scenario('manifest-2c-runner-alone', async (s) => {
      // The phase-2 mirror image, and it is deliberately not symmetric with the
      // phase-1 pass: the invariant is an IFF — the toolchain ships BECAUSE a
      // shipping suite is TypeScript. Reachable by an ordinary edit, and
      // without this branch #2c would print "phase 2 is whole" over a toolchain
      // that ships for nothing, which is a check going green for the wrong
      // reason.
      const checks = await inspectFixture(s, 'bp', (files) => {
        // EVERY suite's spec is withheld, not one. With a single runner
        // convention every suite owns a spec, so withholding one leaves the rest
        // shipping and the condition this case exists to produce never arises —
        // which is how it went green after TASK-047 while asserting nothing.
        //
        // WITHHELD, NOT DELETED: deleting the specs would leave the suites with
        // no runner, so they would not be suites at all and #7's vacuity floor
        // would fire instead. A directory-level export-ignore is also the tier
        // declaration, so #2b is satisfied — nothing may ship from these suites
        // and nothing does — leaving #2c alone to report a toolchain that ships
        // for nothing.
        const ignored = [...SUITES, TS_SUITE].map((x) => `tests/${x}/   export-ignore\n`).join('')
        files.set('.gitattributes', `${files.get('.gitattributes') ?? ''}${ignored}`)
      })

      expect(red(checks)).toEqual(['#2c'])
      expect(why(checks, '#2c')).toContain('NO *.spec.ts')
    })
  })

  // RETIRED WITH TASK-047, recorded rather than silently absent: "a suite whose
  // gate stage is DELETED is named, and the suites still wired in are not" was
  // a perturbation on PER-SUITE invocation lines (`gateFor(SUITES.filter(…))`).
  // With one blanket vitest run proving every suite, there is no single suite's
  // line to remove — dropping the run drops them all, which is the case below
  // and #4-nobridge. The property is not weakened; its subject is gone.

  it('#4 COMMENTING OUT the vitest stage stops every suite running, and is not readable as an invocation (Codex R2-F1b)', async () => {
    await scenario('manifest-4-commented', async (s) => {
      // Membership was once checked with an unanchored grep for the path, so
      // `sed -i '/tests\\/pipeline/s/^/#/' .githooks/pre-push*` left this
      // passing "every suite is invoked by the gate" while the suite had
      // stopped running. Comments are stripped before anything is matched, and
      // that stripping is what this still pins — now against the one line that
      // carries every suite.
      const checks = await inspectFixture(s, 'bp', (files) => {
        const g = files.get('.githooks/pre-push-project') ?? ''
        files.set('.githooks/pre-push-project', g.replace('  ts_suites_stage', '#  ts_suites_stage'))
      })

      expect(red(checks)).toEqual(['#4'])
      expect(why(checks, '#4')).toContain('no vitest stage in .githooks/pre-push*')
    })
  })

  it('#4 a PATH-FILTERED vitest run in the bridge proves nothing about the suites it does not name', async () => {
    await scenario('manifest-4-filtered', async (s) => {
      // Link 3 of the chain. `vitest run tsone` must not be readable as "every
      // suite is invoked" — that is the whole distinction the classifier draws.
      const checks = await inspectFixture(s, 'bp', (files) => {
        const b = files.get('scripts/run-ts-suites.sh') ?? ''
        files.set('scripts/run-ts-suites.sh', b.replace('npx vitest run', 'npx vitest run tsone'))
      })

      expect(red(checks)).toEqual(['#4'])
      expect(why(checks, '#4')).toContain(`${TS_SUITE}(no vitest stage in .githooks/pre-push*)`)
    })
  })

  it('#4 removing the bridge the hook sources breaks the chain even though the stage text is untouched', async () => {
    await scenario('manifest-4-nobridge', async (s) => {
      // Link 2. An absent bridge is pipe_skipped at runtime — a skip carries a
      // reason and is still not running, so it must FAIL a blocking suite
      // rather than pass it.
      const checks = await inspectFixture(s, 'bp', (files) => {
        files.delete('scripts/run-ts-suites.sh')
      })

      expect(red(checks)).toEqual(['#4'])
      expect(why(checks, '#4')).toContain(TS_SUITE)
    })
  })

  it('#4 and #5 narrowing the vitest include glob is a coverage cut every other link stays green through', async () => {
    await scenario('manifest-4-include', async (s) => {
      // Link 4. The config sits inside tests/, which is vitest's root, so a
      // tests-prefixed glob matches nothing at all — and the gate, the bridge
      // and the spec file are all still exactly where they were.
      const checks = await inspectFixture(s, 'bp', (files) => {
        files.set(
          'tests/vitest.config.ts',
          "export default { test: { include: ['tests/**/*.spec.ts'] } }\n",
        )
      })

      expect(red(checks)).toEqual(['#4', '#5'])
      expect(why(checks, '#4')).toContain('include no longer covers')
      expect(why(checks, '#5')).toContain('include no longer covers')
    })
  })

  it('#5 suites the workflow never runs are caught even when the gate runs them (A-15)', async () => {
    await scenario('manifest-5', async (s) => {
      // `drift-in-blueprint` was found running in NEITHER; `a2bp-e2e` was
      // gate-only, so CI carried no backstop. The two checks are independent
      // for that reason, and this perturbs ONLY the workflow — the gate below
      // still runs everything, so a #5 that merely echoed #4 would stay green.
      //
      // TASK-047: this used to drop ONE suite from the workflow's per-suite
      // `bash tests/<s>/test.sh` lines. A blanket run has no per-suite line to
      // drop, so the expressible perturbation is removing the run itself, and
      // then every suite is unrun in CI. Same property, coarser subject.
      const checks = await inspectFixture(s, 'bp', (files) => {
        const wf = files.get('.github/workflows/security.yml') ?? ''
        files.set('.github/workflows/security.yml', wf.replace('npx vitest run', 'echo skipping tests'))
      })

      expect(red(checks)).toEqual(['#5'])
      expect(why(checks, '#5')).toContain('no vitest step in the workflow')
    })
  })

  describe('TASK-054 — the release tier: CI runs every suite, the gate every non-release suite', () => {
    /** s01 becomes release-tier, and the bridge excludes the release glob. */
    const releaseTree = (files: Map<string, string>, exclude = "--exclude='**/*.release.spec.*'") => {
      files.delete('tests/s01/s01.spec.ts')
      files.set('tests/s01/s01.release.spec.ts', 'export const s01 = true\n')
      const b = files.get('scripts/run-ts-suites.sh') ?? ''
      files.set('scripts/run-ts-suites.sh', b.replace('npx vitest run', `npx vitest run ${exclude}`))
    }

    it('a gate excluding the release glob, with CI running everything, passes every check', async () => {
      await scenario('manifest-release-ok', async (s) => {
        const checks = await inspectFixture(s, 'bp', (files) => releaseTree(files))
        expect(red(checks), checks.map((c) => c.message).join('\n')).toEqual([])
      })
    })

    it('#5 CI excluding the release glob too leaves the release suite running nowhere', async () => {
      await scenario('manifest-release-ci', async (s) => {
        const checks = await inspectFixture(s, 'bp', (files) => {
          releaseTree(files)
          const wf = files.get('.github/workflows/security.yml') ?? ''
          files.set('.github/workflows/security.yml', wf.replace('npx vitest run', "npx vitest run --exclude '**/*.release.spec.*'"))
        })
        expect(red(checks)).toEqual(['#5'])
        expect(why(checks, '#5')).toContain('s01(release tier')
        expect(why(checks, '#5')).not.toContain('s02')
      })
    })

    it('#4 a gate exclude naming anything but the release glob is a narrowed run, so omitting a suite still fails', async () => {
      await scenario('manifest-release-other', async (s) => {
        const checks = await inspectFixture(s, 'bp', (files) => releaseTree(files, "--exclude='**/s02/**'"))
        expect(red(checks)).toEqual(['#4'])
        expect(why(checks, '#4')).toContain('s02(no vitest stage')
        expect(why(checks, '#4')).not.toContain('s01(')
      })
    })
  })

  it('#5b a workflow GitHub cannot PARSE runs nothing, while #5 still finds every suite in its text (BUG-115)', async () => {
    await scenario('manifest-5b-parse', async (s) => {
      // The exact defect: an unquoted `run:` value containing `: `. GitHub
      // rejected the whole file and ran zero jobs on every push for four days,
      // and #5 stayed green because the text still said `npx vitest run`.
      // So #5 must stay green here too. That is the blind spot being shown.
      const checks = await inspectFixture(s, 'bp', (files) => {
        const wf = (files.get('.github/workflows/security.yml') ?? '').trimEnd()
        files.set(
          '.github/workflows/security.yml',
          `${wf}\n      - run: echo "Restore it with: blueprint pull tests/"\n`,
        )
      })

      expect(red(checks)).toEqual(['#5b'])
      expect(why(checks, '#5b')).toContain('.github/workflows/security.yml does not parse')
    })
  })

  it('#5b valid YAML that is not a runnable Actions shape is caught too: the class, not the one character', async () => {
    await scenario('manifest-5b-shape', async (s) => {
      const checks = await inspectFixture(s, 'bp', (files) => {
        const wf = files.get('.github/workflows/security.yml') ?? ''
        files.set(
          '.github/workflows/security.yml',
          wf.replace('on: push\n', '').replace('  ts-tests:\n    runs-on: ubuntu-latest\n', '  ts-tests:\n'),
        )
      })

      expect(red(checks)).toEqual(['#5b'])
      expect(why(checks, '#5b')).toContain('has no `on:` trigger')
      expect(why(checks, '#5b')).toContain('job ts-tests has no runs-on')
    })
  })

  it('#7 a derivation finding almost no suites fails, because every check above would pass over it', async () => {
    await scenario('manifest-7', async (s) => {
      const checks = await inspectFixture(s, 'bp', (files) => {
        // The gate and the workflow are NOT rebuilt here any more: they name no
        // suite, so deleting the specs is the whole perturbation (TASK-047).
        for (const s2 of SUITES.slice(2)) files.delete(`tests/${s2}/${s2}.spec.ts`)
        files.delete(`tests/${TS_SUITE}/${TS_SUITE}.spec.ts`)
      })

      // #2c goes red too, and legitimately: the toolchain ships with no spec
      // left to run. #7 is the one being demonstrated.
      expect(red(checks)).toContain('#7')
      expect(why(checks, '#7')).toContain('derived only 3 suites')
    })
  })

  it('#7b unbalanced markers make pull CLOBBER the file instead of merging it (BUG-052)', async () => {
    await scenario('manifest-7b', async (s) => {
      // The counts are of SUBSTRINGS, so a sentence explaining "put your rows
      // after BLUEPRINT:END" counts as an END. Both managed marker files in the
      // real repo were in that state for their whole lives, so neither had ever
      // been marker-merged and every derived project's own gate guards were
      // being replaced on every pull.
      const checks = await inspectFixture(s, 'bp', (files) => {
        const g = files.get('.githooks/pre-push-project') ?? ''
        files.set('.githooks/pre-push-project', `${g}\n# put your own guards after BLUEPRINT:END\n`)
      })

      expect(red(checks)).toEqual(['#7b'])
      expect(why(checks, '#7b')).toContain('.githooks/pre-push-project(1 BEGIN/2 END)')
    })
  })

  it('BUG-074 a bridge sourced at column 0 is still discovered, so #2c does not silently skip it', async () => {
    await scenario('manifest-bug074', async (s) => {
      // THE DEFECT THE PORT REMOVED, kept as a case because nothing else would
      // notice it coming back. The retired shell control stripped a discovered
      // `source` line with a pattern that required whitespace BEFORE the dot,
      // so an unindented `. ./scripts/run-ts-suites.sh` was never resolved to a
      // file. Two consequences, and the second is the dangerous one: #4 failed
      // for the wrong reason, and #2c's ships-⟺-managed check skipped that
      // bridge with nothing said. Measured against both implementations on this
      // exact tree during the migration — shell red on #4, this one green.
      const checks = await inspectFixture(s, 'bp', (files) => {
        files.set(
          '.githooks/pre-push-project',
          (files.get('.githooks/pre-push-project') ?? '').replace(
            '  . ./scripts/run-ts-suites.sh',
            '. ./scripts/run-ts-suites.sh',
          ),
        )
      })

      // Nothing about this gate is broken: the bridge is sourced, called, and
      // still holds the blanket run.
      expect(red(checks)).toEqual([])
    })
  })

  it('a suite ships nothing but its runner arrives — the blueprint-only tier is honoured in the healthy tree', async () => {
    await scenario('manifest-bponly', async (s) => {
      // The positive half of #2b, which no perturbation above exercises: the
      // declared blueprint-only suite must be ABSENT from the archive while
      // still being derived, invoked and counted. If the fixture's
      // export-ignore silently stopped working every #2b case would still pass.
      const files = await baselineTree()
      const root = await materialize(s, 'bp', files)
      const listing = await s.run(
        'sh',
        ['-c', 'git -C "$1" archive --format=tar HEAD | tar -t', 'sh', root],
        { cwd: root },
      )

      expect(listing.stdout).toContain(`tests/${SUITES[0]}/${SUITES[0]}.spec.ts`)
      expect(listing.stdout).not.toContain(`tests/${BP_ONLY_SUITE}/`)
    })
  })
})

describe('TASK-044 — #5 and #5b judge GitHub Actions only when the project runs it', () => {
  /**
   * A workflow both checks fail: it names no suite (#5) and has no jobs (#5b).
   * So a check that passes over it did not look, and one that is red did.
   */
  const inert = (files: Map<string, string>) => {
    files.set('.github/workflows/security.yml', 'on: push\njobs: {}\n')
  }

  it('#5/#5b a declared non-GitHub CI SKIPS both checks, naming the CI, rather than passing them', async () => {
    await scenario('manifest-ci-other', async (s) => {
      // storm2flow runs AWS CodePipeline. The managed security.yml is inert there,
      // so certifying it certifies a pipeline that never runs.
      const checks = await inspectFixture(s, 'bp', (files) => {
        inert(files)
        files.set('project_config_paths.md', '# Paths\n\n- BP_CI: `aws-codepipeline`\n')
      })

      expect(red(checks)).toEqual([])
      // Still ANSWERED, as skips: a check that vanished is the BUG-005 shape.
      expect(checks.map((c) => c.id)).toEqual(['#1', '#1b', '#2b', '#2c', '#4', '#5', '#5b', '#7', '#7b'])
      expect(checks.filter((c) => c.skipped).map((c) => c.id)).toEqual(['#5', '#5b'])
      for (const id of ['#5', '#5b']) {
        expect(checks.find((c) => c.id === id)?.skipped, `${id} did not name the declared CI`).toContain(
          'aws-codepipeline',
        )
      }
    })
  })

  it.each([
    ['declares github-actions (the blueprint)', '# Paths\n\n- BP_CI: `github-actions`\n'],
    ['declares nothing (today)', null],
  ])('#5/#5b a project that %s still has its workflow judged', async (tag, config) => {
    await scenario(`manifest-ci-${config === null ? 'none' : 'github'}`, async (s) => {
      const checks = await inspectFixture(s, 'bp', (files) => {
        inert(files)
        if (config !== null) files.set('project_config_paths.md', config)
      })

      expect(red(checks), tag).toEqual(['#5', '#5b'])
      expect(checks.filter((c) => c.skipped)).toEqual([])
    })
  })

  it.each([
    ['- BP_CI: `aws-codepipeline`\n', 'aws-codepipeline'],
    ['- BP_CI: `github-actions`\n', null],
    ['- BP_CI: ``\n', null],
    ['# nothing declared\n', null],
  ])('notGithubActions over %j names the CI only when it is not GitHub', async (config, named) => {
    await scenario('manifest-ci-decl', async (s) => {
      const root = await s.workspace.dir('p')
      await s.fs.write('p/project_config_paths.md', config)
      const why = await notGithubActions(root)
      if (named === null) expect(why).toBeNull()
      else expect(why).toContain(named)
    })
  })

  it('skipVisibly prints the SKIP-NOTE the gate surfaces, THEN skips — a skip, not a pass', () => {
    const said: string[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation((m: string) => void said.push(m))
    let skippedWith: string | undefined
    const ctx = {
      task: { name: 'a case' },
      skip: (note: string) => {
        skippedWith = note
        throw new Error('skipped')
      },
    } as unknown as TestContext
    try {
      expect(() => skipVisibly(ctx, 'the declared CI is x')).toThrow('skipped')
    } finally {
      warn.mockRestore()
    }
    expect(said).toEqual(['SKIP-NOTE: a case: the declared CI is x'])
    expect(skippedWith).toBe('the declared CI is x')
  })

  it('a newline in the title or the reason still emits ONE line, with the reason intact', () => {
    // Alexey, finding 7. The gate keeps the LINES carrying the marker and deletes
    // the rest of the run's output, so a notice split across two physical lines
    // loses everything after the first — which is the reason. A wrapped test
    // title alone is enough to push the reason onto the unmarked second line.
    const said: string[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation((m: string) => void said.push(m))
    try {
      skipNote('a case\nwith a wrapped title', 'the declared CI is aws-codepipeline\nso the workflow is inert')
    } finally {
      warn.mockRestore()
    }

    expect(said).toHaveLength(1)
    expect(said[0], 'the notice spans more than one physical line').not.toContain('\n')
    expect(said[0]).toContain('a case with a wrapped title')
    expect(said[0]).toContain('the declared CI is aws-codepipeline so the workflow is inert')
  })
})

describe('TASK-047 — one runner convention, no exceptions', () => {
  it('#live every runner under tests/ is a *.spec.ts or *.spec.tsx', async () => {
    await scenario('manifest-live-extensions', async (s) => {
      // Founder decision, 2026-09-16: "migrate the tests to be spec driven ts
      // tests, we don't need exceptions". The gate accepted five runner
      // extensions while only *.spec.ts ever executed, so what it COUNTED and
      // what it RAN were two sets — and a suite in the gap is one the gate
      // vouches for and vitest never runs.
      //
      // `.spec.tsx` IS THE SAME CONVENTION, NOT AN EXCEPTION: `.tsx` is
      // TypeScript, and a JSX component test cannot be written as `.ts` — so a
      // literal single-extension rule would strand every React project, which is
      // the opposite of what "no exceptions" is for.
      //
      // Derived through scripts/lib/suites.sh, the same library the gate uses,
      // rather than by walking the tree here: a second derivation would assert
      // something about its own `find` instead of about what runs. That library
      // must therefore discover BOTH extensions, or a `.spec.tsx` runner is
      // undiscovered and this assertion passes vacuously over it.
      const script = ['set -u', '. "$1/scripts/lib/suites.sh" || exit 1', 'bp_suite_runners "$1"'].join('\n')
      const r = await s.run('sh', ['-c', script, 'sh', REPO_ROOT], { cwd: REPO_ROOT })
      expect(r.code, r.output).toBe(0)

      const paths = r.stdout
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => l.split('\t')[1] ?? '')

      // Non-vacuity first: an empty derivation would pass the assertion below
      // while proving nothing, which is the BUG-005 shape this suite exists for.
      expect(paths.length, 'the derivation found no runners, so this proves nothing').toBeGreaterThan(20)

      expect(
        paths.filter((p) => !p.endsWith('.spec.ts') && !p.endsWith('.spec.tsx')),
        'these runners are neither *.spec.ts nor *.spec.tsx, so the gate counts what vitest cannot run',
      ).toEqual([])
    })
  })
})

describe('TASK-068 / N025 — a bare ctx.skip can never land', () => {
  it('bareSkips flags a zero-argument .skip and ignores reasons, comments and strings', () => {
    // Alexey's review, as a unit: the match is on the PARSED call. A bare
    // `ctx.skip(` in a comment or a string is prose about the rule, not a
    // call, and must not trip it; every accepted form carries an argument.
    const source = [
      '// a bare ctx.skip( in a comment is prose, not a call',
      "const mention = 'ctx.skip( in a string is data, not a call'",
      'export const cases = {',
      '  bare: async (ctx) => {',
      '    if (x) ctx.skip()',
      "    if (y) await ctx.skip('') !== undefined && ctx.skip( /* empty */ )",
      '  },',
      "  reasoned: async (ctx) => ctx.skip('the declared CI is x'),",
      "  visible: async (ctx) => skipVisibly(ctx, 'the declared CI is x'),",
      '}',
    ].join('\n')

    expect(bareSkips(source, 'tests/x.spec.ts')).toEqual(['tests/x.spec.ts:5', 'tests/x.spec.ts:6'])
  })

  it('#live no runner under tests/ calls a bare skip — every skip states why', async () => {
    await scenario('manifest-bare-skip', async (s) => {
      // TASK-068 (audit row N025). DoD §3 rule 7: a check that cannot judge
      // this project skips OUT LOUD via skipVisibly/skipNote, and a bare
      // ctx.skip( reads as a pass while a behaviour goes unchecked in
      // silence. This case refuses that shape landing again.
      //
      // Runners are derived through scripts/lib/suites.sh — the same library
      // the gate uses — rather than by walking the tree here: a second
      // derivation would assert something about its own glob instead of about
      // what runs. Non-vacuity is the derivation count itself.
      const script = ['set -u', '. "$1/scripts/lib/suites.sh" || exit 1', 'bp_suite_runners "$1"'].join('\n')
      const r = await s.run('sh', ['-c', script, 'sh', REPO_ROOT], { cwd: REPO_ROOT })
      expect(r.code, r.output).toBe(0)

      const paths = r.stdout
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => l.split('\t')[1] ?? '')
      expect(paths.length, 'the derivation found no runners, so this proves nothing').toBeGreaterThan(20)

      const offenders: string[] = []
      for (const p of paths) offenders.push(...bareSkips(await readFile(join(REPO_ROOT, p), 'utf8'), p))

      expect(
        offenders,
        'a bare ctx.skip( hides a case with no stated reason — use skipVisibly(ctx, reason) so the gate prints why (DoD §3 rule 7)',
      ).toEqual([])
    })
  })
})

describe('BUG-005 — THE REAL TREE', () => {
  it('#live every check passes over this checkout, over a non-vacuous suite set', async (ctx) => {
    await scenario('manifest-live', async (s) => {
      // Read-only over the real tree: the whole point is to fail the push when
      // the gate, CI and the export boundary have come apart, so pointing it at
      // a fixture would make it a restatement of the cases above that guards
      // nothing.
      const checks = await inspect(REPO_ROOT, s.run)
      const report = checks.map((c) => `${c.ok ? '  ok — ' : 'FAIL: '}${c.message}`).join('\n')

      expect(red(checks), report).toEqual([])
      // TASK-044: a check that did not judge this tree says so in the gate.
      for (const c of checks) if (c.skipped) skipNote(`${ctx.task.name} (${c.id})`, c.skipped)

      // THE CHECK IDS THAT MUST HAVE BEEN ANSWERED — because "everything
      // passed" and "nothing was asked" render identically, which is BUG-066's
      // shape and the thing this whole suite exists to refuse.
      //
      // THE SET DEPENDS ON WHICH TREE THIS IS, and that is not a loophole: #2b
      // and #2c police an EXPORT BOUNDARY, which only a blueprint has. A
      // derived project has no `.blueprint-root`, so those two do not apply and
      // must not be demanded — the shell version this replaces skipped them the
      // same way, and demanding them downstream is precisely the BUG-028 class
      // (a blueprint-only obligation shipped to projects that cannot meet it).
      // What IS demanded either way is that the answer be complete FOR THIS
      // TREE, so a blueprint quietly reporting six checks fails here.
      const inBlueprint = await s.run('sh', ['-c', 'test -f "$1/.blueprint-root"', 'sh', REPO_ROOT], {
        cwd: REPO_ROOT,
      })
      const expected =
        inBlueprint.code === 0
          ? ['#1', '#1b', '#2b', '#2c', '#4', '#5', '#5b', '#7', '#7b']
          : ['#1', '#1b', '#4', '#5', '#5b', '#7', '#7b']
      expect(checks.map((c) => c.id), report).toEqual(expected)

      // And #2b's own precondition is reachable rather than merely assumed: an
      // unreadable archive reports "#2b could not archive HEAD" and would have
      // been caught above, so its ABSENCE from the red list means the archive
      // was genuinely read.
      expect(checks.find((c) => c.id === '#2b')?.message ?? '').not.toContain('could not archive')
    })
  })
})
