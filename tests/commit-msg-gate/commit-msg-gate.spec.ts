/**
 * tests/commit-msg-gate/commit-msg-gate.spec.ts — TASK-002.
 *
 * Every commit names the backlog item it serves (DoD §1b rule 1). This suite
 * guards the HOOK that enforces it, because a rule you must remember while busy
 * is the shape this repo has rejected five times over.
 *
 * WHERE THE SHELL/TYPESCRIPT LINE IS DRAWN, and it is drawn deliberately.
 *
 * `.githooks/commit-msg` STAYS SHELL and is not ported. TASK-018-TARGET §3.3
 * makes that permanent for the pre-push entry point — "if the gate is
 * TypeScript and `npm ci` failed, you have no gate, precisely the state where
 * you most want one" — and the argument is stronger here, not weaker: git
 * invokes `commit-msg` on every `git commit` in every bootstrapped project, on
 * machines that may have no Node at all, and a hook that cannot start is a hook
 * that does not check. The same goes for `scripts/lib/commit-subject.sh`, which
 * holds THE rule and is sourced by both the hook and the CI checker.
 *
 * So this spec is a DRIVER, not a reimplementation. It never expresses the
 * subject rule in TypeScript — that would be the second copy the library exists
 * to prevent, and two copies of a rule are two rules that pass their own tests
 * while disagreeing about a real commit. Every verdict below comes from
 * executing the shipped hook.
 *
 * EQUIVALENCE RECORD (TASK-018-RULES R6).
 *
 * Because both implementations drive the SAME shell hook, running them over one
 * healthy tree proves nothing — they would agree on a hook that checked nothing.
 * So equivalence was measured over MUTANTS: EIGHT trees (seven hooks each
 * carrying one injected defect, plus the healthy baseline) were built once and
 * BOTH implementations run over each — the retiring
 * `tests/commit-msg-gate/test.sh`, copied into the fixture and run with the
 * fixture as its ROOT, and this spec's driver. Per-case verdicts (#0 to #4) were
 * compared mechanically.
 *
 * **They agreed on all eight trees**, the baseline green in both and every mutant
 * turning at least one NAMED case red in both — R6 discharged by measurement
 * rather than asserted:
 *
 *   accept-everything          → #2, #4 red in both
 *   reject-merges              → #3 red in both
 *   no-comment-skip            → #3 red in both
 *   open-on-noarg-both-guards  → #2, #3 red in both
 *   open-without-the-lib       → #2, #4 red in both
 *   accept-conventional        → #2 red in both
 *   root-commit-not-exempt     → #4 red in both
 *
 * Two things the measurement itself taught, recorded because both are the kind
 * of thing a review would not have found:
 *
 *   - THE FIXTURE HAD TO HAVE A COMMIT. The driver's first version only ran
 *     `git init`, so HEAD did not exist, THE HOOK'S ROOT-COMMIT EXEMPTION FIRED
 *     FOR EVERY MESSAGE, and the baseline itself showed #2 red while three
 *     mutants became indistinguishable from it. A suite whose fixture is an
 *     empty repository is testing the exemption and nothing else.
 *   - THE NO-ARGUMENT PATH IS DEFENDED TWICE, which is why the mutant above is
 *     named `both-guards`. See the R6 case for what that means for anyone
 *     tempted to delete the empty-message check as redundant.
 *
 * One difference, recorded rather than smoothed over: `#4` in the shell suite
 * built its repository with `git -C "$(mktemp -d)" init`, and that line is
 * precisely what BUG-047 caught writing into a REAL repository under an
 * inherited `GIT_DIR` — the fixture returned 0, created no `.git`, and the
 * config writes landed in whatever `GIT_DIR` named. Here the repository comes
 * from the harness, which scrubs the variable before any child starts, so the
 * hazard is unrepresentable rather than remembered (TASK-018-RULES R3).
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
 * Thirty-two cases, thirty-two with an observed red — and one structural
 * fact the measurement made visible. `#3 FAILS CLOSED on a missing
 * argument`, `#3 FAILS CLOSED on an unreadable message file` and `#3 an
 * empty message … is rejected` have no SINGLE-EDIT mutant: removing the
 * readability guard, and removing the empty-subject guard, each turn only
 * `#3 the no-argument path is defended TWICE` red, because the rule itself
 * refusing "" is a THIRD line of defence. All three go together or not at
 * all. Redundant defence of a fail-closed path is the correct design; the
 * consequence for R6 is that these cases are the redundantly-guarded ones
 * rather than the distinguishing ones, which is what suite-sync #7-bare
 * records about itself.
 *
 * `#4 … a repo WITHOUT it is ungated` asserts the ABSENCE of enforcement, so
 * no code mutant can reach it; its fixture is given the `core.hooksPath` it
 * exists to lack, and the case notices.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario, type RunResult } from '../harness/index.js'

const HOOK = join(REPO_ROOT, '.githooks/commit-msg')
const RULE_LIB = join(REPO_ROOT, 'scripts/lib/commit-subject.sh')

/**
 * Run the shipped hook against a message, inside the scenario's own repository.
 *
 * A REPOSITORY IS REQUIRED, not incidental. The hook resolves its rule library
 * with `git rev-parse --show-toplevel` and exempts the root commit by asking
 * whether HEAD exists, so a message checked outside a repo exercises neither
 * path. The shell suite ran the hook from the blueprint's own checkout for #1-#3
 * and only built a repo for #4; doing it in a fixture repo throughout means no
 * case can accidentally consult the real repository's HEAD.
 */
async function checkSubject(
  s: Scenario,
  repo: HookedRepo,
  message: string,
): Promise<RunResult> {
  await s.fs.write(join('repo', 'msg'), message)
  return s.run('sh', [repo.hook, join(repo.dir, 'msg')], { cwd: repo.dir })
}

interface HookedRepo {
  /** The fixture repository's root. */
  readonly dir: string
  /** The hook to invoke — the repo's own copy, so a mutant can replace it. */
  readonly hook: string
}

/**
 * A fixture repository carrying the hook, the rule library, and one commit.
 *
 * `mutate` rewrites either file before it lands, which is how the R6 block below
 * reintroduces a defect: the hook under test is always the repository's OWN
 * copy, never the blueprint's, so a mutant can exist without any possibility of
 * editing a real file. `readFile` on the real hook and `s.fs.write` into the
 * workspace is the whole mechanism — `copyIn` is the unmutated path.
 */
async function hookedRepo(
  s: Scenario,
  mutate: { hook?: (src: string) => string; lib?: (src: string) => string } = {},
): Promise<HookedRepo> {
  const repo = await s.gitRepo('repo')
  const hookRel = join('repo', '.githooks/commit-msg')
  const libRel = join('repo', 'scripts/lib/commit-subject.sh')

  if (mutate.hook) await s.fs.write(hookRel, mutate.hook(await readFile(HOOK, 'utf8')))
  else await s.fs.copyIn(HOOK, hookRel)
  await s.fs.chmod(hookRel, 0o755)

  // The rule library travels WITH the hook. A project that pulled one and not
  // the other has a gate that cannot load its rule, which must refuse — and
  // tests/commit-subjects #6 is the case that proves it does.
  if (mutate.lib) await s.fs.write(libRel, mutate.lib(await readFile(RULE_LIB, 'utf8')))
  else await s.fs.copyIn(RULE_LIB, libRel)

  await s.fs.write(join('repo', 'f.txt'), 'hello\n')
  await repo.commitAll('root')
  return { dir: repo.dir, hook: join(repo.dir, '.githooks/commit-msg') }
}

/** Replace exactly once, and fail loudly when the anchor has moved. */
function replaceOnce(src: string, find: string, replaceWith: string): string {
  const parts = src.split(find)
  if (parts.length !== 2) {
    throw new Error(
      `Mutation anchor not found exactly once in the shipped file:\n  ${find}\n` +
        `A mutant that silently applies to nothing is a green R6 case proving ` +
        `nothing — the exact failure mode a2bp-contamination had for months.`,
    )
  }
  return parts.join(replaceWith)
}

describe('TASK-002 — the commit-msg hook refuses a subject that names no backlog item', () => {
  it('#0 the hook exists and is executable — git silently ignores one that is not', async () => {
    await scenario('cmg-0', async (s) => {
      // BUG-008 is exactly this: a hook that existed, was correct, and never ran
      // because it lost its exec bit. `tests/pull-exec-bit` guards the mode
      // through a pull; this guards it on disk.
      // `s.fs` is workspace-scoped and correctly refuses a path outside it, so
      // the mode of a real repository file is read through a child rather than
      // through the fixture's own filesystem handle.
      const probe = await s.run('test', ['-x', HOOK], { cwd: s.workspace.root })
      expect(probe.code, `${HOOK} is missing or not executable`).toBe(0)
    })
  })

  it.each([
    'BUG#20: a refused pull exits non-zero',
    'FEATURE#3: the gate renders as a pipeline',
    'TASK#1: move the lcm checklist into the DoD',
    'BUG#1: single digit',
    'FEATURE#1234: many digits',
  ])('#1 ACCEPTS the required format: %s', async (subject) => {
    await scenario(`cmg-1-${subject.slice(0, 12)}`, async (s) => {
      const repo = await hookedRepo(s)
      const r = await checkSubject(s, repo, `${subject}\n`)
      expect(r.code, `rejected a VALID subject: ${subject}\n${r.stderr}`).toBe(0)
    })
  })

  it.each([
    // The conventional-commits form is REJECTED deliberately: `fix(BUG-020):`
    // does not START with the item, and the founder's rule is that it must. This
    // case exists so that is a decision on the record rather than an accident.
    'fix(BUG-020): the old conventional-commits form',
    'docs: no item at all',
    'BUG-20: hyphen instead of hash',
    'BUG#: no number',
    'BUG#20 no colon',
    '#20: no type',
    'wip',
    // A bare item with no subject names the item and says nothing about it.
    'BUG#20:',
  ])('#2 REJECTS a subject that does not name its item: %s', async (subject) => {
    await scenario(`cmg-2-${subject.slice(0, 12)}`, async (s) => {
      const repo = await hookedRepo(s)
      const r = await checkSubject(s, repo, `${subject}\n`)
      expect(r.code, `ACCEPTED an invalid subject: ${subject}`).not.toBe(0)
    })
  })

  it.each([
    ["Merge branch 'main' into topic", 'git writes them; there is no single item'],
    ['Revert "BUG#20: a refused pull exits non-zero"', 'the original named its item'],
    ['fixup! BUG#20: a refused pull', 'a rebase instruction, not a final message'],
    ['squash! BUG#20: a refused pull', 'likewise'],
    ['amend! BUG#20: a refused pull', 'likewise'],
  ])('#3 EXEMPT: %s — %s', async (subject) => {
    await scenario(`cmg-3-${subject.slice(0, 12)}`, async (s) => {
      const repo = await hookedRepo(s)
      const r = await checkSubject(s, repo, `${subject}\n`)
      expect(r.code, `an exempt subject was rejected: ${subject}\n${r.stderr}`).toBe(0)
    })
  })

  it("#3 git's comment template is skipped when finding the subject", async () => {
    await scenario('cmg-3-template', async (s) => {
      const repo = await hookedRepo(s)
      // The subject is the first NON-COMMENT, non-blank line. git appends a
      // comment block to every interactive commit, so a hook that read line 1
      // would reject every commit made without -m.
      const r = await checkSubject(
        s,
        repo,
        '# Please enter the commit message\n#\nBUG#7: after the comment block\n',
      )
      expect(r.code, `the comment template defeated subject detection\n${r.stderr}`).toBe(0)
    })
  })

  it('#3 FAILS CLOSED on an unreadable message file', async () => {
    await scenario('cmg-3-unreadable', async (s) => {
      const repo = await hookedRepo(s)
      // "Could not check" must never render as "passed" — the lesson BUG-018
      // taught twice.
      const r = await s.run('sh', [HOOK, join(repo.dir, 'does-not-exist')], { cwd: repo.dir })
      expect(r.code, 'an UNREADABLE message file was accepted — the gate fails open').not.toBe(0)
    })
  })

  it('#3 FAILS CLOSED on a missing argument', async () => {
    await scenario('cmg-3-noarg', async (s) => {
      const repo = await hookedRepo(s)
      const r = await s.run('sh', [HOOK], { cwd: repo.dir })
      expect(r.code, 'a MISSING argument was accepted — the gate fails open').not.toBe(0)
    })
  })

  it('#3 an empty message — nothing but blanks and comments — is rejected', async () => {
    await scenario('cmg-3-empty', async (s) => {
      const repo = await hookedRepo(s)
      const r = await checkSubject(s, repo, '\n\n#only comments\n')
      expect(r.code, 'an EMPTY message was accepted').not.toBe(0)
    })
  })

  it('#4 END TO END — git actually runs it, and the rejection BLOCKS rather than warns', async () => {
    await scenario('cmg-4', async (s) => {
      // #0-#3 prove the hook's logic. They do NOT prove git invokes it, which is
      // the only property that stops a bad commit. BUG-008 is exactly this gap.
      const repo = await s.gitRepo('repo')
      await s.fs.copyIn(HOOK, join('repo', '.githooks/commit-msg'))
      await s.fs.chmod(join('repo', '.githooks/commit-msg'), 0o755)
      // A real project has BOTH files — bootstrap ships the whole tracked tree —
      // so a fixture with only the hook models a repository that does not exist,
      // and the hook correctly fails closed in it.
      await s.fs.copyIn(RULE_LIB, join('repo', 'scripts/lib/commit-subject.sh'))
      await s.run('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repo.dir })

      await s.fs.write(join('repo', 'f.txt'), 'hello\n')
      await s.run('git', ['add', '-A'], { cwd: repo.dir })

      // THE ROOT COMMIT IS EXEMPT. A repo's first commit creates the repo and
      // cannot name an item, because no backlog exists yet. Not hypothetical:
      // the hook ships into every bootstrapped project and new-project.sh commits
      // the initial tree, so the first version of this gate broke bootstrap
      // outright.
      const root = await s.run(
        'git',
        ['commit', '-q', '-m', 'chore(bootstrap): initialize from the blueprint'],
        { cwd: repo.dir },
      )
      expect(
        root.code,
        `the root commit was rejected — every new project would fail on its ` +
          `first commit\n${root.stderr}`,
      ).toBe(0)

      await s.fs.write(join('repo', 'g.txt'), 'second\n')
      await s.run('git', ['add', '-A'], { cwd: repo.dir })
      const bad = await s.run('git', ['commit', '-q', '-m', 'docs: no item named'], {
        cwd: repo.dir,
      })
      expect(
        bad.code,
        'git ACCEPTED a non-root commit with no backlog item — the hook is not wired',
      ).not.toBe(0)

      const good = await s.run(
        'git',
        ['commit', '-q', '-m', 'TASK#2: wire the commit-msg gate'],
        { cwd: repo.dir },
      )
      expect(good.code, `git REJECTED a valid commit end to end\n${good.stderr}`).toBe(0)

      // Non-vacuity: exactly two commits — the rejected one must not be in. A
      // hook that printed its complaint and exited 0 would pass every assertion
      // above and fail this one.
      const count = await s.run('git', ['rev-list', '--count', 'HEAD'], { cwd: repo.dir })
      expect(
        count.stdout.trim(),
        'expected 2 commits after root + one rejection + one acceptance',
      ).toBe('2')
    })
  })

  it('#4 the hook is wired by core.hooksPath, and a repo WITHOUT it is ungated', async () => {
    await scenario('cmg-4-unwired', async (s) => {
      // The other half of BUG-008 / A-22, and the reason `arm_gate` exists:
      // `core.hooksPath` is repo-LOCAL config, so a fresh clone does not have
      // it and every hook in .githooks/ is inert. Asserted here so the #4 above
      // is known to be testing the WIRING and not merely the hook.
      const repo = await s.gitRepo('repo')
      await s.fs.copyIn(HOOK, join('repo', '.githooks/commit-msg'))
      await s.fs.chmod(join('repo', '.githooks/commit-msg'), 0o755)
      await s.fs.copyIn(RULE_LIB, join('repo', 'scripts/lib/commit-subject.sh'))
      await s.fs.write(join('repo', 'f.txt'), 'x\n')
      await repo.commitAll('root')

      await s.fs.write(join('repo', 'g.txt'), 'y\n')
      await s.run('git', ['add', '-A'], { cwd: repo.dir })
      const unwired = await s.run('git', ['commit', '-q', '-m', 'docs: no item named'], {
        cwd: repo.dir,
      })

      expect(
        unwired.code,
        'a commit with no item was refused in a repo with no core.hooksPath — ' +
          'then #4 above is not proving the wiring',
      ).toBe(0)
    })
  })
})

/**
 * TASK-018-RULES R6 — for every defect this suite exists to catch, there is a
 * recorded way to reintroduce it, and doing so must turn a NAMED case red.
 *
 * These cases exist because a passing test proves nothing about whether it still
 * catches anything. `a2bp-contamination`'s headline assertion was dead for
 * months: with the defect injected it printed the failure 28 times and still
 * exited 0. R6 says to run the mutant ONCE, at the moment a test replaces
 * something — this block does it on every run instead, which costs ~0.3 s here
 * because the mutant is a string replacement rather than a build.
 *
 * Each mutant is a one-edit rewrite of the SHIPPED hook or rule library, applied
 * to the fixture's own copy. `replaceOnce` throws when its anchor has moved, so a
 * mutant can never quietly apply to nothing — which would be a green R6 case
 * proving the opposite of what it claims.
 */
describe('TASK-002 R6 — every case above is provably able to fail', () => {
  it('#2 goes red when the rejection is turned into a pass', async () => {
    await scenario('cmg-m-accept-all', async (s) => {
      const repo = await hookedRepo(s, {
        hook: (src) =>
          replaceOnce(src, 'commit_subject_help >&2\nexit 1', 'commit_subject_help >&2\nexit 0'),
      })

      // The mutant still PRINTS its complaint, which is the point: a gate that
      // warns and exits 0 looks identical in a terminal and stops nothing.
      const r = await checkSubject(s, repo, 'docs: no item named\n')
      expect(r.code).toBe(0)
      expect(r.stderr).toContain('REJECTED')
    })
  })

  it('#3 goes red when the merge/revert/fixup exemption is removed', async () => {
    await scenario('cmg-m-no-exempt', async (s) => {
      const repo = await hookedRepo(s, {
        lib: (src) =>
          replaceOnce(src, '"Merge "*|"Revert "*|"fixup!"*|"squash!"*|"amend!"*) return 0 ;;', ''),
      })

      for (const subject of ["Merge branch 'main'", 'Revert "BUG#1: y"', 'fixup! BUG#1: y']) {
        const r = await checkSubject(s, repo, `${subject}\n`)
        expect(r.code, `${subject} was still accepted`).not.toBe(0)
      }
    })
  })

  it("#3 goes red when git's comment template is no longer skipped", async () => {
    await scenario('cmg-m-no-comment-skip', async (s) => {
      const repo = await hookedRepo(s, {
        hook: (src) => replaceOnce(src, "grep -vE '^\\s*#' \"$msg_file\" | ", 'cat "$msg_file" | '),
      })

      const r = await checkSubject(
        s,
        repo,
        '# Please enter the commit message\n#\nBUG#7: after the comment block\n',
      )
      expect(r.code, 'the comment line was not taken as the subject').not.toBe(0)
    })
  })

  it('#3 the no-argument path is defended TWICE, and only removing both opens it', async () => {
    await scenario('cmg-m-open-noarg', async (s) => {
      // WRITTEN AS A ONE-LINE MUTANT AND CORRECTED BY RUNNING IT. Weakening the
      // `-z "$msg_file"` guard to `[ ! -r "${msg_file:-/dev/null}" ]` does NOT
      // open the gate: /dev/null is readable, so control reaches the subject
      // extraction, `grep` over /dev/null yields nothing, and the
      // empty-message branch refuses. The hook is belt-and-braces on this path,
      // which is worth knowing and is not written down anywhere else — a future
      // simplification that deletes the empty-message check as "redundant" would
      // silently remove the second half of a double defence.
      const oneGuard = await hookedRepo(s, {
        hook: (src) =>
          replaceOnce(
            src,
            'if [ -z "$msg_file" ] || [ ! -r "$msg_file" ]; then',
            'if [ ! -r "${msg_file:-/dev/null}" ]; then',
          ),
      })
      const stillRefused = await s.run('sh', [oneGuard.hook], { cwd: oneGuard.dir })
      expect(
        stillRefused.code,
        'the first guard alone was load-bearing — then the empty-message check ' +
          'is not the second defence this case claims it is',
      ).not.toBe(0)

      // Both removed. NOW it fails open, which is what the case guards.
      const noGuard = await hookedRepo(s, {
        hook: (src) =>
          replaceOnce(
            replaceOnce(
              src,
              'if [ -z "$msg_file" ] || [ ! -r "$msg_file" ]; then',
              'if [ ! -r "${msg_file:-/dev/null}" ]; then',
            ),
            'echo "commit-msg: the commit message is empty — refusing." >&2\n  exit 1',
            'exit 0',
          ),
      })
      const opened = await s.run('sh', [noGuard.hook], { cwd: noGuard.dir })
      expect(opened.code, 'the no-argument call was still refused').toBe(0)
    })
  })

  it('#3/#6 goes red when a missing rule library reports a pass', async () => {
    await scenario('cmg-m-open-nolib', async (s) => {
      const repo = await hookedRepo(s, {
        hook: (src) =>
          replaceOnce(
            src,
            'echo "commit-msg: cannot read scripts/lib/commit-subject.sh — refusing." >&2',
            'exit 0',
          ),
      })
      // Remove the library the fixture just installed: a project that pulled the
      // hook and not its rule. "Could not check" must never render as "passed".
      await s.fs.rm(join('repo', 'scripts/lib/commit-subject.sh'))

      const r = await checkSubject(s, repo, 'docs: no item named\n')
      expect(r.code, 'the hook refused without its rule — the mutant did not apply').toBe(0)
    })
  })

  it('#2 goes red when the conventional-commits form is admitted', async () => {
    await scenario('cmg-m-conventional', async (s) => {
      const repo = await hookedRepo(s, {
        lib: (src) =>
          replaceOnce(
            src,
            "grep -qE '^(BUG|FEATURE|TASK)#[0-9]+: .+'",
            "grep -qE '^(BUG|FEATURE|TASK)#[0-9]+: .+|^fix\\(BUG-[0-9]+\\): .+'",
          ),
      })

      // The form this repo used to prescribe. It does not START with the item,
      // which is the founder's rule, so re-admitting it is the most plausible
      // regression this suite has — a reviewer would read the widened regex as
      // generous rather than wrong.
      const r = await checkSubject(s, repo, 'fix(BUG-020): the old form\n')
      expect(r.code).toBe(0)
    })
  })

  it('#4 goes red when the ROOT COMMIT exemption is removed — bootstrap breaks', async () => {
    await scenario('cmg-m-root', async (s) => {
      const repo = await s.gitRepo('repo')
      const hookRel = join('repo', '.githooks/commit-msg')
      await s.fs.write(
        hookRel,
        replaceOnce(
          await readFile(HOOK, 'utf8'),
          'if ! git rev-parse --verify -q HEAD >/dev/null 2>&1; then\n  exit 0\nfi',
          '',
        ),
      )
      await s.fs.chmod(hookRel, 0o755)
      await s.fs.copyIn(RULE_LIB, join('repo', 'scripts/lib/commit-subject.sh'))
      await s.run('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repo.dir })
      await s.fs.write(join('repo', 'f.txt'), 'hello\n')
      await s.run('git', ['add', '-A'], { cwd: repo.dir })

      // This is not hypothetical: the first version of this gate shipped without
      // the exemption and broke `new-project.sh` outright, since bootstrap's
      // initial commit cannot name an item that no backlog yet holds.
      const root = await s.run(
        'git',
        ['commit', '-q', '-m', 'chore(bootstrap): initialize from the blueprint'],
        { cwd: repo.dir },
      )
      expect(root.code, 'the root commit was still accepted').not.toBe(0)
    })
  })
})
