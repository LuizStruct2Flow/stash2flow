/**
 * tests/commit-subjects/commit-subjects.spec.ts — TASK-002 (reopened).
 *
 * The reproducer is not synthesised. `BAD` below is the ACTUAL subject of
 * `5fe89e0`, a real commit in this repository's history that landed on `main`
 * after the gate shipped — because the gate is client-side and GitHub composes
 * the squash-merge subject from the PULL REQUEST TITLE, on its own servers. A
 * fixture that agrees with the implementation is what got us there.
 *
 * WHERE THE SHELL/TYPESCRIPT LINE IS DRAWN. The rule (`commit_subject_ok`), the
 * hook and the CI checker all STAY SHELL, for the reason TASK-018-TARGET §3.3
 * gives about the pre-push entry point and which is stronger here: `commit-msg`
 * runs on every `git commit` in every bootstrapped project, on machines that may
 * have no Node, and a hook that cannot start has checked nothing. So this spec
 * DRIVES those three files and never restates the rule — a TypeScript copy of
 * `commit_subject_ok` would be exactly the second definition this suite exists
 * to forbid, and two copies of a rule are two rules that pass their own tests
 * while disagreeing about a real commit.
 *
 * EQUIVALENCE RECORD (TASK-018-RULES R6).
 *
 * NINE trees — eight perturbed and the real repository — were built once and BOTH
 * implementations run over each: the retiring `tests/commit-subjects/test.sh`,
 * copied into the fixture and run with the fixture as its ROOT, and
 * `scanWiring()` plus this spec's shell drivers. Per-case verdicts (#1 to #6)
 * were compared mechanically. **They agreed on all nine inputs.**
 *
 * Two differences exist and are recorded rather than smoothed over:
 *
 *   - `#3`'s EXECUTABILITY TEST. The shell used `[ -x "$CHECKER" ]`, which is
 *     true for a DIRECTORY of that name; the port requires a regular file that
 *     is executable. No tree in the comparison distinguished them, and the port
 *     is the stricter. Noted because a silent tightening is still a change.
 *   - `#6`'s FAILS-CLOSED case built its repository with
 *     `git -C "$(mktemp -d)" init` and then wrote `core.hooksPath`, `user.email`
 *     and `user.name` into it — the exact lines BUG-047 caught landing in a REAL
 *     repository under an inherited `GIT_DIR`, where `init` returns 0 and creates
 *     no `.git`. That suite printed PASS while setting `core.hooksPath` on the
 *     developer's checkout, which is the A-22 failure produced BY A TEST. Here
 *     the repository comes from the harness, which scrubs the variable before any
 *     child starts, so the hazard is unrepresentable rather than remembered (R3).
 *     `tests/git-isolation` #1 names this suite as one of its three execution
 *     anchors for exactly that reason — see that spec for what happens to the
 *     anchor when this shell file retires.
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
 * Twenty-one cases, twenty-one with an observed red (TASK-021 removed the two
 * that asked whether a file is LISTED to travel: shipping is managing now). One belongs here rather
 * than next door: turning the hook's missing-library `exit 1` into `exit 0`
 * is invisible in tests/commit-msg-gate, whose own R6 case rewrites that
 * same branch in its fixture — `#6 the hook FAILS CLOSED when its rule
 * library is missing` is the only case anywhere that sees it.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { scanWiring, type WiringScan } from './commit-subjects.js'
import { notGithubActions, skipNote, skipVisibly } from '../helpers/project-config.js'
import { parseDocument } from 'yaml'

const RULE_LIB = join(REPO_ROOT, 'scripts/lib/commit-subject.sh')
const CHECKER = join(REPO_ROOT, 'scripts/check-commit-subjects.sh')
const HOOK = join(REPO_ROOT, '.githooks/commit-msg')

/**
 * The exact subject of `5fe89e0`, and of a commit that satisfies the rule.
 *
 * Written as literals so this suite states what it is protecting rather than
 * deriving it from the very history it is checking.
 */
const BAD =
  'TASK-001/002/003/005/006/007: the lifecycle rules become gates, and two defects come home from redcare (#21)'
const GOOD =
  'TASK#1: the six landed rows move to waiting-acceptance — and cost a PR to do it (#22)'

/** Ask the SHIPPED rule, in its own language. Never a reimplementation. */
async function ruleSays(s: Scenario, subject: string): Promise<boolean> {
  const r = await s.run(
    'sh',
    ['-c', `. "$1"; commit_subject_ok "$2"`, 'sh', RULE_LIB, subject],
    { cwd: s.workspace.root },
  )
  return r.code === 0
}

/** Run the CI checker over one subject on stdin, the way CI's `--stdin` mode does. */
async function checkerSays(
  s: Scenario,
  subject: string,
): Promise<{ ok: boolean; output: string }> {
  const r = await s.run('sh', ['-c', `printf '%s\\n' "$1" | sh "$2" --stdin`, 'sh', subject, CHECKER], {
    cwd: s.workspace.root,
  })
  return { ok: r.code === 0, output: `${r.stdout}${r.stderr}` }
}

describe('TASK-002 — the item rule is checked where the commit is actually made', () => {
  it('#1+#3+#4+#5+#6 the real repository is wired end to end', async (ctx) => {
    const scan = await scanWiring(REPO_ROOT)

    // #1 — ONE definition. The hook's regex living only inside the hook is what
    // forces every other checker to copy it.
    expect(scan.ruleLibPresent, 'no shared rule — a CI checker would copy the hook regex').toBe(true)
    // #3 — the checker exists, or CI has nothing to run against real commits.
    expect(scan.checkerExecutable).toBe(true)
    // #4 — the hook reaches for the shared rule and carries no copy of it.
    expect(scan.hookSourcesRule).toBe(true)
    expect(scan.hookCarriesPatternCopy, 'the hook still carries a second copy of the pattern').toBe(
      false,
    )
    // #5 — THE ASSERTION THAT MATTERS. The squash-merge subject IS the PR title,
    // so checking only the branch's commits leaves the actual defect unguarded.
    // TASK-044: that door is GitHub's. A project on another CI has no such
    // workflow to check, and says so rather than passing over an inert file.
    const notGithub = await notGithubActions(REPO_ROOT)
    if (notGithub) {
      skipNote(`${ctx.task.name} (#5)`, notGithub)
    } else {
      expect(scan.ciInvokesChecker, 'CI never invokes the checker — the rule stays local-only').toBe(
        true,
      )
      expect(scan.ciChecksPrTitle, 'CI does not check the PR title — the squash door stays open').toBe(
        true,
      )
      expect(scan.ciRerunsOnEdit, 'a title edited after a green run would bypass the check').toBe(true)
    }
    // #6 — that both files travel is no longer this suite's to check. Since
    // TASK-021 a file is managed exactly when it ships, so it travels unless an
    // export-ignore stops it, and bootstrap-contents #0 (the library) and
    // managed-references (the checker, named by the managed workflow) fail then.
  })

  it('#1 the library exposes commit_subject_ok, so the rule is reusable at all', async () => {
    await scenario('cs-1-exposes', async (s) => {
      const r = await s.run(
        'sh',
        ['-c', `. "$1"; command -v commit_subject_ok >/dev/null`, 'sh', RULE_LIB],
        { cwd: s.workspace.root },
      )
      expect(r.code, 'commit_subject_ok is not defined — nothing can reuse the rule').toBe(0)
    })
  })

  it("#2 THE REPRODUCER — 5fe89e0's actual subject is rejected, and a conforming one is not", async () => {
    await scenario('cs-2-real', async (s) => {
      expect(await ruleSays(s, GOOD), `a conforming subject was rejected: ${GOOD}`).toBe(true)
      expect(await ruleSays(s, BAD), "5fe89e0's ACTUAL subject was accepted — this is the defect").toBe(
        false,
      )
    })
  })

  it.each(["Merge branch 'x'", 'Revert "BUG#1: y"', 'fixup! BUG#1: y'])(
    '#2 exempt: %s',
    async (subject) => {
      await scenario(`cs-2-exempt-${subject.slice(0, 10)}`, async (s) => {
        expect(await ruleSays(s, subject)).toBe(true)
      })
    },
  )

  it.each(['BUG: no number', 'BUG#: no number', 'TASK#1 no colon', 'BUG#1:'])(
    '#2 names no item: %s',
    async (subject) => {
      await scenario(`cs-2-bogus-${subject.slice(0, 10)}`, async (s) => {
        expect(await ruleSays(s, subject)).toBe(false)
      })
    },
  )

  it('#3 the checker agrees with the rule, and its failure NAMES the offender', async () => {
    await scenario('cs-3', async (s) => {
      expect((await checkerSays(s, GOOD)).ok, 'the checker rejected a conforming subject').toBe(true)

      const bad = await checkerSays(s, BAD)
      expect(bad.ok, "the checker PASSED 5fe89e0's subject").toBe(false)
      // A checker that fails without saying WHICH subject was wrong sends the
      // reader back to the log to guess.
      expect(bad.output).toContain('TASK-001/002')
    })
  })

  it('#3 the checker FAILS CLOSED on no input, an empty range and an unknown mode', async () => {
    await scenario('cs-3-closed', async (s) => {
      // "Could not check" must never render as "passed" (BUG-018, twice taught).
      // Not in the shell suite — added because the checker is now the only thing
      // standing between a squash merge and `main`, and each of these is a
      // realistic CI misconfiguration: a shallow clone, a wrong base ref, a
      // renamed flag.
      const noMode = await s.run('sh', [CHECKER], { cwd: s.workspace.root })
      expect(noMode.code, 'no mode was accepted').not.toBe(0)

      const unknown = await s.run('sh', [CHECKER, '--everything'], { cwd: s.workspace.root })
      expect(unknown.code, 'an unknown mode was accepted').not.toBe(0)

      const noValue = await s.run('sh', [CHECKER, '--subject'], { cwd: s.workspace.root })
      expect(noValue.code, '--subject with no value was accepted').not.toBe(0)

      // An EMPTY stdin checks nothing, and reporting "0 violations" there is the
      // vacuous green this repo keeps having to delete.
      const empty = await s.run('sh', ['-c', `printf '' | sh "$1" --stdin`, 'sh', CHECKER], {
        cwd: s.workspace.root,
      })
      expect(empty.code, 'an empty stdin reported a pass over nothing').not.toBe(0)

      // An empty RANGE is the CI shape of the same thing.
      const repo = await s.gitRepo('repo')
      await s.fs.write(join('repo', 'f.txt'), 'x\n')
      await repo.commitAll('BUG#1: root')
      const emptyRange = await s.run('sh', [CHECKER, '--range', 'HEAD..HEAD'], { cwd: repo.dir })
      expect(emptyRange.code, 'a range containing no commits reported a pass').not.toBe(0)
    })
  })

  it('#4 the hook and the checker reach the SAME definition — no second copy anywhere', async () => {
    // No `scenario()`: this reads three repository files and writes nothing, so a
    // workspace would be theatre. R3's sandbox is for fixtures that RUN things.
    const hook = await readFile(HOOK, 'utf8')
    const checker = await readFile(CHECKER, 'utf8')

    expect(hook).toContain('commit-subject.sh')
    expect(checker).toContain('commit-subject.sh')
    // Neither may carry the pattern. Asserted on BOTH, where the shell version
    // asserted only on the hook: the checker gained the dependency in the same
    // change, so it is equally able to drift back to a private copy.
    expect(hook).not.toContain('(BUG|FEATURE|TASK)#[0-9]')
    expect(checker).not.toContain('(BUG|FEATURE|TASK)#[0-9]')

    // And the definition is genuinely in the library, not vestigially. Without
    // this the two assertions above are satisfied by a library that defines
    // nothing while both callers happen to accept everything.
    const lib = await readFile(RULE_LIB, 'utf8')
    expect(lib).toContain('(BUG|FEATURE|TASK)#[0-9]')
  })

  it('#6 the hook FAILS CLOSED when its rule library is missing', async () => {
    await scenario('cs-6', async (s) => {
      // The hook gained a dependency. A project that pulled the hook but not the
      // library has a gate that cannot load its rule — which must refuse, never
      // pass. Travelling together is the fix (both ship, so both are managed), and
      // failing closed is the backstop.
      const repo = await s.gitRepo('repo')
      await s.fs.copyIn(HOOK, join('repo', '.githooks/commit-msg'))
      await s.fs.chmod(join('repo', '.githooks/commit-msg'), 0o755)
      await s.fs.write(join('repo', 'f.txt'), 'x\n')

      // THE ROOT COMMIT LANDS BEFORE THE HOOK IS WIRED, and that ordering is
      // the whole difference between this case and the shell one it replaces.
      // The library check runs BEFORE the root-commit exemption, so a wired hook
      // with no library refuses even the first commit — and the shell version
      // discarded that failure's status, leaving it with no root commit at all.
      // Its later assertion therefore proved "the hook refuses a ROOT commit
      // without its rule" while its comment claimed a non-root one. Both are
      // true of the shipped hook; only one was being tested.
      await repo.commitAll('root')
      await s.run('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repo.dir })

      await s.fs.write(join('repo', 'g.txt'), 'y\n')
      await s.run('git', ['add', '-A'], { cwd: repo.dir })
      // No scripts/lib/commit-subject.sh in this repository at all.
      const r = await s.run('git', ['commit', '-q', '-m', 'TASK#2: valid subject, missing rule'], {
        cwd: repo.dir,
      })

      expect(r.code, 'the hook PASSED a commit while unable to load its rule').not.toBe(0)
      expect(r.stderr).toContain('commit-subject.sh')
    })
  })
})

/**
 * TASK-018-RULES R6 — the wiring checks, shown red on a tree carrying exactly
 * the defect each exists to catch.
 *
 * Every case above runs over the REAL repository, where everything passes — and
 * a control that has only ever been seen passing proves nothing about what it
 * would say over a broken tree. That is not hypothetical here:
 * `a2bp-contamination`'s headline assertion was dead for months, printing its
 * failure 28 times and still exiting 0.
 */
describe('TASK-002 R6 — each wiring check is provably able to fail', () => {
  /** A tree that is wired correctly, so a perturbation below means what it says. */
  async function healthyTree(): Promise<Record<string, string>> {
    return {
      '.githooks/commit-msg': '#!/bin/sh\n. "$root/scripts/lib/commit-subject.sh"\n',
      'scripts/lib/commit-subject.sh': await readFile(RULE_LIB, 'utf8'),
      'scripts/check-commit-subjects.sh': await readFile(CHECKER, 'utf8'),
      '.github/workflows/security.yml': [
        'on:',
        '  pull_request:',
        '    types: [opened, synchronize, reopened, edited]',
        'jobs:',
        '  subjects:',
        '    steps:',
        '      - env:',
        '          PR_TITLE: ${{ github.event.pull_request.title }}',
        '        run: bash scripts/check-commit-subjects.sh --subject "$PR_TITLE"',
        '',
      ].join('\n'),
    }
  }

  async function scanPerturbed(
    s: Scenario,
    name: string,
    mutate: (files: Record<string, string>) => void,
  ): Promise<WiringScan> {
    const files = await healthyTree()
    mutate(files)
    const root = await s.workspace.dir(name)
    for (const [rel, content] of Object.entries(files)) {
      await s.fs.write(join(name, rel), content)
      if (rel.startsWith('scripts/')) await s.fs.chmod(join(name, rel), 0o755)
    }
    return scanWiring(root)
  }

  it('the healthy fixture passes every wiring check — without which no case below means anything', async () => {
    await scenario('cs-r6-baseline', async (s) => {
      const scan = await scanPerturbed(s, 'bp', () => {})

      expect(scan.ruleLibPresent).toBe(true)
      expect(scan.checkerExecutable).toBe(true)
      expect(scan.hookSourcesRule).toBe(true)
      expect(scan.hookCarriesPatternCopy).toBe(false)
      expect(scan.ciInvokesChecker).toBe(true)
      expect(scan.ciChecksPrTitle).toBe(true)
      expect(scan.ciRerunsOnEdit).toBe(true)
    })
  })

  it('#1 goes red when the shared rule is deleted', async () => {
    await scenario('cs-r6-1', async (s) => {
      const scan = await scanPerturbed(s, 'bp', (f) => {
        delete f['scripts/lib/commit-subject.sh']
      })
      expect(scan.ruleLibPresent).toBe(false)
    })
  })

  it('#3 goes red when the checker loses its exec bit (the BUG-008 shape)', async () => {
    await scenario('cs-r6-3', async (s) => {
      const files = await healthyTree()
      const root = await s.workspace.dir('bp')
      for (const [rel, content] of Object.entries(files)) await s.fs.write(join('bp', rel), content)
      // A hook or checker that exists, is correct, and never runs because its
      // mode says it must not. BUG-008 exactly.
      await s.fs.chmod(join('bp', 'scripts/check-commit-subjects.sh'), 0o644)

      expect((await scanWiring(root)).checkerExecutable).toBe(false)
    })
  })

  it('#4 goes red when the hook carries its own copy of the pattern', async () => {
    await scenario('cs-r6-4', async (s) => {
      const scan = await scanPerturbed(s, 'bp', (f) => {
        // The drift is invisible without this check: both copies keep passing
        // their own tests while disagreeing about a real commit.
        f['.githooks/commit-msg'] =
          `#!/bin/sh\ngrep -qE '^(BUG|FEATURE|TASK)#[0-9]+: .+' <<EOF\n$1\nEOF\n`
      })
      expect(scan.hookCarriesPatternCopy).toBe(true)
      expect(scan.hookSourcesRule).toBe(false)
    })
  })

  it('#5 goes red when CI checks the BRANCH COMMITS but not the PR TITLE', async () => {
    await scenario('cs-r6-5-title', async (s) => {
      const scan = await scanPerturbed(s, 'bp', (f) => {
        // The defect `5fe89e0` walked through, expressed precisely: the checker
        // IS invoked, over the range, and the one subject that will actually
        // land goes unread. A check that looks thorough and misses the only
        // door that matters.
        f['.github/workflows/security.yml'] = [
          'on:',
          '  pull_request:',
          '    types: [opened, synchronize, reopened, edited]',
          'jobs:',
          '  subjects:',
          '    steps:',
          '      - run: bash scripts/check-commit-subjects.sh --range "$BASE..$HEAD"',
          '',
        ].join('\n')
      })

      expect(scan.ciInvokesChecker).toBe(true)
      expect(scan.ciChecksPrTitle).toBe(false)
    })
  })

  it('#5 goes red when `edited` leaves the activity types', async () => {
    await scenario('cs-r6-5-edited', async (s) => {
      const scan = await scanPerturbed(s, 'bp', (f) => {
        f['.github/workflows/security.yml'] = (f['.github/workflows/security.yml'] ?? '').replace(
          ', edited]',
          ']',
        )
      })
      // A title corrected AFTER a green run would merge unchecked, because
      // `edited` is not a default `pull_request` activity type.
      expect(scan.ciRerunsOnEdit).toBe(false)
      expect(scan.ciChecksPrTitle).toBe(true)
    })
  })

  it('#5 goes red when CI never invokes the checker at all', async () => {
    await scenario('cs-r6-5-none', async (s) => {
      const scan = await scanPerturbed(s, 'bp', (f) => {
        f['.github/workflows/security.yml'] = 'on:\n  pull_request:\njobs: {}\n'
      })
      expect(scan.ciInvokesChecker).toBe(false)
    })
  })
})

/**
 * TASK-022 — on a push to main, CI checks EVERY pushed commit, not the tip.
 *
 * The workflow's own push steps are executed, as GitHub runs a `run:` block,
 * over a three-commit fixture push whose TIP is valid and whose middle commit
 * breaks one rule. Each control is broken on its own, so one failing cannot
 * hide another that is disconnected.
 */
describe('TASK-022 — CI checks every commit of a push', () => {
  interface Step {
    name?: string
    if?: unknown
    env?: Record<string, string>
    run?: string
  }

  const EVENT: Record<string, 'before' | 'after'> = {
    '${{ github.event.before }}': 'before',
    '${{ github.event.after }}': 'after',
  }

  /** Push the fixture, then run every push-only `run:` step of the workflow. */
  async function pushRun(
    s: Scenario,
    middle: string,
    extra: Record<string, string> = {},
    event: (sha: { base: string; tip: string }) => { before: string; after: string } = (x) => ({
      before: x.base,
      after: x.tip,
    }),
  ) {
    const repo = await s.gitRepo('repo')
    const files: Record<string, string> = {
      'docs/doing/BACKLOG.md': '| **TASK-1** | fixture |\n',
      'docs/doing/BUGS.md': '| **BUG-2** | fixture |\n| **BUG-3** | fixture |\n',
      'tests/bug.spec.ts': "it('BUG-2: fixture')\n",
      ...extra,
    }
    for (const lib of ['check-commit-subjects.sh', 'lib/commit-subject.sh', 'lib/dod-gate.mts', 'lib/pipeline.sh']) {
      await s.fs.copyIn(join(REPO_ROOT, 'scripts', lib), join('repo/scripts', lib))
    }
    for (const [rel, body] of Object.entries(files)) await s.fs.write(join('repo', rel), body)
    const base = await repo.commitAll('TASK#1: base')
    await s.fs.write('repo/middle.txt', 'x\n')
    await repo.commitAll(middle)
    await s.fs.write('repo/tip.txt', 'y\n')
    const sha = event({ base, tip: await repo.commitAll('BUG#2: valid tip') })

    const wf = parseDocument(
      await readFile(join(REPO_ROOT, '.github/workflows/security.yml'), 'utf8'),
    ).toJS() as { jobs: Record<string, { steps?: Step[] }> }
    const steps = Object.values(wf.jobs)
      .flatMap((job) => job.steps ?? [])
      .filter((step) => step.if === "github.event_name == 'push'" && typeof step.run === 'string')
    expect(steps.length, 'no push-only run step in the workflow').toBeGreaterThan(0)

    let code = 0
    let output = ''
    for (const [i, step] of steps.entries()) {
      const exports = Object.entries(step.env ?? {}).map(([k, v]) => {
        const from = EVENT[v]
        if (!from) throw new Error(`step "${step.name}" env ${k}=${v} is not modelled here`)
        return `export ${k}=${sha[from]}\n`
      })
      const script = await s.fs.write(`step-${i}.sh`, step.run ?? '')
      const driver = await s.fs.write(
        `driver-${i}.sh`,
        `${exports.join('')}exec bash --noprofile --norc -eo pipefail ${JSON.stringify(script)}\n`,
      )
      const r = await s.run('sh', [driver], { cwd: repo.dir })
      output += r.output
      if (r.code !== 0) code = r.code ?? 1
    }
    return { code, output }
  }

  it('#1 a bad subject that is not the tip fails the push', async (ctx) => {
    const notGithub = await notGithubActions(REPO_ROOT)
    if (notGithub) skipVisibly(ctx, notGithub)
    await scenario('cs-t22-subject', async (s) => {
      const r = await pushRun(s, 'no item named here')
      expect(r.code, `an earlier bad subject passed CI\n${r.output}`).not.toBe(0)
      expect(r.output).toContain('got: no item named here')
    })
  })

  it('#2 an item with no row, not at the tip, fails the push', async (ctx) => {
    const notGithub = await notGithubActions(REPO_ROOT)
    if (notGithub) skipVisibly(ctx, notGithub)
    await scenario('cs-t22-row', async (s) => {
      const r = await pushRun(s, 'TASK#9: no row anywhere')
      expect(r.code, `an item with no row passed CI\n${r.output}`).not.toBe(0)
      expect(r.output).toContain('NO backlog row anywhere: TASK-9')
      // The other stage passed on the same fixture, so its failure in #3 is real.
      expect(r.output).toContain('regression tests found for: BUG-2')
    })
  })

  it('#3 a BUG with no test, not at the tip, fails the push', async (ctx) => {
    const notGithub = await notGithubActions(REPO_ROOT)
    if (notGithub) skipVisibly(ctx, notGithub)
    await scenario('cs-t22-bugtest', async (s) => {
      const r = await pushRun(s, 'BUG#3: fixed with no test')
      expect(r.code, `a BUG with no test passed CI\n${r.output}`).not.toBe(0)
      expect(r.output).toContain('No test TITLE and no row justification under the searched roots names: BUG-3')
      expect(r.output, 'the row stage failed too, so #2 proves nothing').toContain('items: BUG-2 BUG-3')
    })
  })

  it('#4 a force push is not refused: a rollback passes, a rewritten history checks the tip', async (ctx) => {
    const notGithub = await notGithubActions(REPO_ROOT)
    if (notGithub) skipVisibly(ctx, notGithub)
    await scenario('cs-t22-force', async (s) => {
      // Rollback: the new tip is an ancestor of the old one, so nothing new was pushed.
      const back = await pushRun(s, 'no item named here', {}, (x) => ({ before: x.tip, after: x.base }))
      expect(back.code, `a rollback push was refused\n${back.output}`).toBe(0)
      expect(back.output).toContain('nothing new to check')
    })
    await scenario('cs-t22-rewrite', async (s) => {
      // The old tip is not in the checkout, as after a history rewrite in a fresh clone.
      const gone = 'f'.repeat(40)
      const r = await pushRun(s, 'no item named here', {}, (x) => ({ before: gone, after: x.tip }))
      expect(r.code, `a rewritten-history push was refused\n${r.output}`).toBe(0)
      expect(r.output).toContain('checking the tip commit only')
    })
  })
})
