/**
 * tests/staleness/staleness.spec.ts — the staleness probe, and `blueprint drift`
 * as it actually runs it.
 *
 * WHAT IS AT STAKE. `drift` compares a project against BLUEPRINT_ROOT — the
 * operator's LOCAL checkout — so it can print "✓ all files match the blueprint
 * HEAD" while meaning "you match your six-week-old copy of it". The probe exists
 * to stop that. But it READS AND WRITES A REPOSITORY THAT IS NOT THE ONE THE
 * OPERATOR IS IN, which is the same shape as the direct write PLAN-A2BP-PR
 * removed from `a2bp`. That is acceptable only while it stays fast-forward-only,
 * clean-tree-only, on-branch-only and never automatic — so every one of those
 * bounds is asserted here rather than assumed.
 *
 * It also runs at EVERY agent wake, usually with no TTY. A prompt that blocks or
 * a network call that hangs breaks the wake protocol, which is worse than the
 * stale checkout the feature was added to report.
 *
 * PORTED FROM TWO SHELL RUNNERS — `tests/staleness/test.sh` (#1–#9, the probe's
 * verdicts) and `tests/staleness/drift-integration.sh` (D#1–D#5, the probe as
 * drift runs it). Both stay in the gate until the central retirement pass. The
 * drift cases are prefixed `D#` because both runners numbered from 1 and merging
 * them into one file would otherwise collide; the mapping is one-to-one.
 *
 * THREE DIVERGENCES FROM THE SHELL RUNNERS, all recorded because each is a
 * behaviour change rather than a transcription:
 *
 *   1. `--fast` IS GONE, AND WITH IT FIVE LATENT SKIPS. The shell runners took a
 *      flag that omitted #8 from the probe suite and #2/#3/#5 from the drift
 *      suite, on the argument that the gate sat at ~29 s of a hard 30 s ceiling.
 *      That ceiling was abolished (CLAUDE.md §"Pre-push tolerance"), which is
 *      the section describing exactly this failure: coverage decided on budget
 *      rather than risk, invisibly, while the gate printed PASSED.
 *
 *      BE PRECISE ABOUT WHAT WAS LOST, because the obvious reading overstates
 *      it: `.githooks/pre-push-project` passes NO arguments to either runner, so
 *      `FAST=0` and all nine cases have been running on every push. The flag was
 *      a loaded gun nobody had fired. Removing it removes the possibility, not
 *      an active gap — and R7 is why the possibility is not worth keeping.
 *   2. THE HANGING REMOTE IS AN `ssh` SHIM, NOT `GIT_SSH_COMMAND='sleep 60 #'`.
 *      The shell version's trailing `#` was load-bearing and easy to lose: git
 *      appends the host and the remote command, so a bare `sleep 60` receives
 *      `git@127.0.0.1` as its interval, errors in ~100 ms, and the case passes
 *      against a hang that never happened. A shim that ignores its arguments
 *      cannot be got wrong that way. It is also what the harness permits:
 *      `GIT_SSH_COMMAND` is not a declared variable, and an undeclared `GIT_*`
 *      name is refused rather than passed to a fixture (env.ts). PATH is not,
 *      and `shimDir` exists for exactly this. AND THE SHIM BLOCKS ON A FIFO
 *      RATHER THAN FOR A DURATION — see `blackHoleRemote`. R4 bans a fixed wait
 *      and grants no exemption for a hang fixture, so the condition ("nothing
 *      ever answers") is expressed as a FIFO with no writer instead of as 60
 *      seconds of `sleep`.
 *   3. #8's "no timeout provider on this host" SKIP IS NOW A FAILURE. Without
 *      `timeout`/`gtimeout` the probe reports `unknown/no-timeout` for every
 *      checkout, so the feature is off — and a suite that skips there cannot
 *      tell that state from a working one.
 *
 * Parallelism hazard: #8 and D#1/D#5 are `serial-timing` — they assert on
 * elapsed wall-clock against a bound set from the shell runners' measured
 * values, not from a guess. Everything else is parallel-safe: every case builds
 * its own upstream and clone inside its scenario workspace, and nothing reads a
 * repository it did not create.
 *
 * EQUIVALENCE RECORD (R6, and the migration's own evidence).
 *
 * "Ported" is a claim, so it was measured rather than reviewed. Seventeen
 * perturbed trees were built (ten in round 1, seven in round 2 below) and BOTH
 * implementations run over each — the two retiring
 * shell runners and this spec — with the per-case verdict sets compared
 * mechanically. The sets below are OBSERVED, not predicted. The shell runners
 * number BOTH files from 1, so a shell `#3` is ambiguous between the probe's and
 * the drift suite's; the `D#` prefix here is what removes that ambiguity, and it
 * is why the shell column sometimes looks like it named a different case.
 *
 *   Mutant S1: a dirty tree stops blocking the offer.
 *     shell #3 #3b · spec #3 #3b · AGREE.
 *   Mutant S2: detached HEAD and wrong branch stop blocking.
 *     shell #4 #4b · spec #4 #4b · AGREE.
 *   Mutant S3: an unreachable remote reports `current`.
 *     shell #5 #7 #7c #8 · spec #7 #7c #8 · AGREE on the verdict. The shell's
 *     extra `#5` is CROSS-CASE CONTAMINATION, not extra coverage: its cases
 *     share ONE upstream repository, so #5's divergence fixture inherits state
 *     from #2/#3/#4. R5 isolation removes it, and #5's own subject (divergence
 *     is never offered) is unaffected by this mutant.
 *   Mutant S4: offer whenever behind, ignoring `blocker`.
 *     BOTH PASS — and that is a finding about the CODE, not the tests. See
 *     "WHAT THE MUTANTS PROVED ABOUT THE PRODUCT" below.
 *   Mutant S5: collapse `ahead` and `diverged` into `behind`.
 *     shell #5 #6 · spec #5 #6 · AGREE.
 *   Mutant S6: drop `--ff-only` from the one write.
 *     shell PASSES · spec #9 · THE PORT IS STRICTER, and this is the most
 *     valuable single result in this file. See below.
 *   Mutant S7: hardcode the probe's budget to 30 s, ignoring the caller's.
 *     shell D#5 only · spec #8 AND D#5 · THE PORT IS STRICTER on #8. See below.
 *   Mutant S8: `report_staleness` prompts with no TTY.
 *     shell D#1 D#3 · spec D#1 D#3 · AGREE.
 *   Mutant S9: a staleness warning becomes a drift failure.
 *     shell D#4 · spec D#4 · AGREE.
 *   Mutant S10: ignore `BP_NO_PROMPT`.
 *     shell PASSES · spec D#3 · THE PORT IS STRICTER. See below.
 *
 * ROUND 2 — SEVEN MORE MUTANTS, because ten did not reach every case (Jesko,
 * QA-2, cross-provider review 2026-09-11). His finding was precise and is worth
 * repeating rather than paraphrasing: every shell case HAS a named counterpart
 * here, so nothing was dropped in the port — what was missing was R6 EVIDENCE.
 * `#1`, `#2`, `#2b`, `#2c`, `#7b` and `D#2` had no recorded way to go red, so
 * they were being retired on the strength of their names. These sets are
 * OBSERVED, from the same harness:
 *
 *   Mutant S11: an up-to-date checkout is no longer recognised as current.
 *     shell #1 · spec #1 · AGREE.
 *   Mutant S12: the ORDINARY unverified behind-relation stops offering — the
 *     historical defect the lib's own comment records as "sound reasoning, wrong
 *     conclusion".
 *     shell #2 #3 #3b #4 #4b · spec #2 #3 #3b #4 #4b #9 D#3 · AGREE-fail.
 *   Mutant S13: the one write reports success without merging.
 *     shell #2b #9 · spec #2b #9 · AGREE.
 *   Mutant S14: a PROVED behind-relation is reported as unproved.
 *     shell #2c · spec #2c · AGREE.
 *   Mutant S15: a checkout with no remote is reported CURRENT.
 *     shell #7b · spec #7b · AGREE.
 *   Mutant S16: `report_staleness` FAST-FORWARDS the other checkout itself on the
 *     no-TTY path — i.e. on every agent wake.
 *     shell PASSES · spec D#2 · THE PORT IS STRICTER. See below.
 *   Mutant S17: the refused write leaves the other repository MID-MERGE
 *     (`merge --no-commit --no-ff`, then report failure).
 *     shell #2b · spec #2b #9 · AGREE-fail, and #9 is red only because of the
 *     strengthened oracle below — under the old two assertions this mutant was
 *     invisible to both implementations.
 *
 * FIVE PLACES THE SHELL RUNNERS WERE GREEN OVER A REAL DEFECT. Each is a case
 * passing for a reason other than its subject — the R6 class — and each is why
 * the corresponding case here is written differently rather than transcribed.
 *
 *   S6 / #9 — THE ONE WRITE PATH INTO ANOTHER OPERATOR'S REPOSITORY had its
 *     fast-forward-only constraint unenforced. The shell fixture rewrote the same
 *     `f.txt` on both sides, so a non-fast-forward merge CONFLICTS and fails for
 *     a reason unrelated to `--ff-only` — the case's "the merge was refused" is
 *     satisfied by git refusing a conflict. This fixture advances with uniquely
 *     named files, so the divergence merges CLEANLY, which is the actual hazard:
 *     a silent merge commit created in a repository the operator is not in.
 *   S7 / #8 — the shell probe suite CANNOT SEE a defect in the lib's own
 *     top-level assignments. It sources the lib once and calls functions as
 *     `BP_STALENESS_TIMEOUT=2 bp_staleness_assess …`; a variable-assignment
 *     prefix on a function call wins, because the lib's
 *     `BP_STALENESS_TIMEOUT="${BP_STALENESS_TIMEOUT:-8}"` already ran at source
 *     time. A REAL caller is a separate process that sources the lib AFTER the
 *     environment is set, so there the lib's assignment wins. The shell case was
 *     therefore testing an invocation shape that cannot occur in production.
 *     `lib()` here spawns a fresh shell per call, which is the production shape,
 *     and it measures 30.2 s against the 2 s budget it asked for.
 *   S10 / D#3 — BP_NO_PROMPT was never consulted. The shell case ran with stdin
 *     closed, so the `[ ! -t 0 ]` arm suppressed the prompt and the flag's own
 *     arm was dead. An implementation ignoring the flag entirely passed. D#3 now
 *     supplies a pty AND asserts the unsuppressed control prompts first.
 *   S16 / D#2 — "drift does not touch the other repository" was measured AFTER
 *     something else had already touched it. `drift-integration.sh` builds ONE
 *     `bp-local` for all five cases, and its #1 runs a full `drift` with stdin
 *     closed. With the no-TTY arm fast-forwarding the checkout, #1's own run did
 *     the damage; #2 then compared HEAD before and after ITS invocation, found a
 *     checkout already level with its remote, and passed. The write the case
 *     exists to forbid happened one case earlier. R5 isolation is the whole fix —
 *     D#2 builds its own fixture, so the only `drift` that can have moved that
 *     HEAD is its own.
 *   S17 / #9 — THE SAME WRITE PATH, one layer deeper than S6. "Non-zero, and
 *     HEAD unchanged" is satisfied by `merge --no-commit --no-ff` followed by a
 *     failure report: the merge succeeds into the index and worktree, MERGE_HEAD
 *     is left behind, HEAD never moves, and the operator's other repository is
 *     mid-merge. Both implementations were blind to it until #9's oracle below
 *     was strengthened (Jesko, finding 3).
 *
 * WHAT THE MUTANTS PROVED ABOUT THE PRODUCT (S4, and it is not a test defect).
 * `if [ "$status" = "behind" ] && [ "$blocker" = "none" ]` — the second conjunct
 * is DEAD. At that line `blocker` is either its initial `none` or `not-behind`,
 * and `not-behind` is set only on the `ahead`/`diverged` arms, where `status` is
 * not `behind`. So the first conjunct implies the second and no mutation of it is
 * observable by any test. Harmless, and worth deleting rather than guarding.
 *
 * WHAT NEITHER IMPLEMENTATION COVERS, recorded rather than fixed:
 *   - `blocker=no-timeout`. Reachable only on a host with neither `timeout` nor
 *     `gtimeout`, and there is no contained way to hide a binary from `PATH`
 *     while leaving `git` reachable (shimDir prepends, it does not replace). The
 *     branch is three lines and fails closed to `unknown`, which is the safe
 *     direction.
 *   - `branch.<name>.remote` resolving to something other than `origin`. Every
 *     fixture in both implementations uses a clone's default `origin`, so the
 *     first arm of the remote lookup is exercised only in its fallback form.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'

const CLI = join(REPO_ROOT, 'scripts/blueprint.mts')
const LIB = join(REPO_ROOT, 'scripts/lib/staleness.sh')

/**
 * Call one function out of `scripts/lib/staleness.sh`.
 *
 * The lib is sourced, not executed — it declares functions and nothing else —
 * so the only way to reach it from a spec is a shell that sources it and calls
 * one. That will stop being true when the internals become TypeScript
 * (TASK-018-TARGET §3), at which point this helper is deleted and the cases
 * call the function directly. The cases above it do not change.
 */
async function lib(
  s: Scenario,
  fn: string,
  args: string[],
  env: Record<string, string> = {},
  extraPath?: string,
) {
  return s.run(
    'bash',
    ['-c', `set -u\n. "$1"\nshift\n"$@"\n`, 'staleness', LIB, fn, ...args],
    {
      cwd: s.workspace.root,
      env: extraPath ? { ...env, PATH: extraPath } : env,
    },
  )
}

/** `key=value` lines → a record. The probe's verdict IS its stdout. */
function fields(output: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of output.split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return out
}

async function assess(
  s: Scenario,
  root: string,
  branch: string,
  env: Record<string, string> = {},
  extraPath?: string,
): Promise<Record<string, string>> {
  const r = await lib(s, 'bp_staleness_assess', [root, branch], env, extraPath)
  // `assess` never fails the caller — the verdict is the return value, so an
  // unreachable remote is a status rather than an error. A non-zero exit here
  // means the contract itself broke, and reading fields off a crashed run is
  // how a suite reports a plausible-looking verdict for a probe that died.
  expect(r.code, `bp_staleness_assess exited ${r.code}:\n${r.output}`).toBe(0)
  return fields(r.stdout)
}

async function git(s: Scenario, cwd: string, args: string[]) {
  return s.run('git', args, { cwd })
}

/** An upstream repository with one commit. */
async function upstream(s: Scenario, tag: string): Promise<string> {
  const up = await s.workspace.dir(tag, 'up')
  await git(s, up, ['init', '-q', '-b', 'main', '.'])
  await git(s, up, ['config', 'user.email', 't@local'])
  await git(s, up, ['config', 'user.name', 't'])
  await git(s, up, ['config', 'commit.gpgsign', 'false'])
  await s.fs.write(join(up, 'f.txt'), 'one\n')
  await git(s, up, ['add', '-A'])
  await git(s, up, ['commit', '-q', '-m', 'one'])
  return up
}

/** A clone of `up` that can fall behind it. Local file remote: real git, no network. */
async function freshClone(s: Scenario, up: string, tag: string, name: string) {
  const dest = s.workspace.path(tag, name)
  const r = await git(s, s.workspace.root, ['clone', '-q', up, dest])
  expect(r.code, r.output).toBe(0)
  await git(s, dest, ['config', 'user.email', 't@local'])
  await git(s, dest, ['config', 'user.name', 't'])
  await git(s, dest, ['config', 'commit.gpgsign', 'false'])
  return dest
}

/**
 * Move the upstream forward by `n` commits.
 *
 * Each commit adds a UNIQUELY NAMED file. The shell version rewrote one `f.txt`
 * with `'more %s' >> f.txt`, which works only because it was called once per
 * fixture; a second call from the same case would write content the tree already
 * had, and `git commit` on an unchanged tree fails silently inside a `$( )`.
 * #9 needs two calls, so the counter is what makes the helper composable.
 */
let advanceSeq = 0
async function advance(s: Scenario, up: string, n: number) {
  for (let i = 1; i <= n; i++) {
    advanceSeq += 1
    const name = `more-${advanceSeq}.txt`
    await s.fs.write(join(up, name), `${name}\n`)
    await git(s, up, ['add', '-A'])
    const r = await git(s, up, ['commit', '-q', '-m', `up${advanceSeq}`])
    expect(r.code, `upstream commit did not land:\n${r.output}`).toBe(0)
  }
}

/**
 * A remote git can reach over ssh, whose ssh HANGS.
 *
 * Both halves matter. The URL must be an `ssh://` one or git answers instantly
 * from the local filesystem and nothing is bounded — which is how the first
 * version of the shell case "passed" a hang it never produced. And the shim must
 * ignore its arguments: git appends the host and the remote command, so a
 * command that treats its first argument as data (`sleep`) receives
 * `git@127.0.0.1` and errors in milliseconds.
 *
 * IT BLOCKS ON A FIFO WITH NO WRITER, NOT ON `sleep 60` (R4). The condition this
 * fixture exists to create is "the remote accepts the connection and then never
 * answers", and a FIFO nobody writes to IS that condition: `cat` blocks in
 * `open(2)` until a writer appears, and none ever does. `sleep 60` was a guess at
 * a duration long enough to look like never — which is the shape R4 bans, and its
 * text grants no exemption for a deliberate hang fixture. It also had a real
 * failure mode the condition does not: a caller budget above 60 s would see the
 * "hang" END, and the probe would then report a remote error rather than the
 * timeout the case is about.
 *
 * Neither form is reaped by this fixture. `timeout` puts the command it manages
 * in its own process group and signals the GROUP, so the blocked shim dies with
 * the `git ls-remote` it was serving; if that ever stops being true, the
 * scenario's own teardown kills the group and FAILS the test for the leak, which
 * is the behaviour we want over a shim that quietly outlives its case.
 */
async function blackHoleRemote(s: Scenario, repo: string) {
  await git(s, repo, ['remote', 'set-url', 'origin', 'ssh://git@127.0.0.1/blackhole.git'])
  const shim = await s.shimDir('ssh-shim')
  const fifo = s.workspace.path('ssh-shim', 'blackhole.fifo')
  const mk = await s.run('mkfifo', [fifo], { cwd: s.workspace.root })
  expect(mk.code, `mkfifo failed, so the "hanging" remote would not hang:\n${mk.output}`).toBe(0)
  await shim.add('ssh', `exec cat '${fifo}'`)
  return shim.path()
}

describe('the staleness probe reports honestly and only ever offers a safe fast-forward', () => {
  it('#1 an up-to-date checkout is "current" and offers nothing', async () => {
    await scenario('staleness-1', async (s) => {
      const up = await upstream(s, 'a')
      const c = await freshClone(s, up, 'a', 'c1')

      const out = await assess(s, c, 'main')
      expect(out.status).toBe('current')
      expect(out.offer, 'offered a fast-forward with nothing to fast-forward to').toBe('no')
    })
  })

  it('#2 clean + behind + on-branch offers a fast-forward, marked unverified', async () => {
    await scenario('staleness-2', async (s) => {
      // The ONE case that may offer. `verified=no` is the ORDINARY state, not an
      // edge case: a checkout that has not fetched has no local object to ask
      // about ancestry, and refusing to offer there disabled the feature in
      // exactly the situation it exists for.
      const up = await upstream(s, 'a')
      const c = await freshClone(s, up, 'a', 'c2')
      await advance(s, up, 4)

      const out = await assess(s, c, 'main')
      expect(out.status).toBe('behind')
      expect(out.offer, `no fast-forward offered on a clean, behind, on-branch checkout (blocker=${out.blocker})`).toBe(
        'ff',
      )
      expect(out.verified, 'a fresh clone has not fetched, so ancestry cannot be proved locally').toBe('no')
    })
  })

  it('#2c with the objects present the relation is verified and counted', async () => {
    await scenario('staleness-2c', async (s) => {
      const up = await upstream(s, 'a')
      const c = await freshClone(s, up, 'a', 'c2')
      await advance(s, up, 4)
      await git(s, c, ['fetch', '-q', 'origin', 'main'])

      const out = await assess(s, c, 'main')
      // Both paths must OFFER; only the wording differs.
      expect(out.offer).toBe('ff')
      expect(out.verified).toBe('yes')
      expect(out.count, 'the commit count is real once the objects are local').toBe('4')
    })
  })

  it('#2b the fast-forward lands on the remote tip with the old HEAD still an ancestor', async () => {
    await scenario('staleness-2b', async (s) => {
      const up = await upstream(s, 'a')
      const c = await freshClone(s, up, 'a', 'c2')
      await advance(s, up, 4)

      const before = (await git(s, c, ['rev-parse', 'HEAD'])).stdout.trim()
      const ff = await lib(s, 'bp_staleness_fast_forward', [c, 'main', 'origin'])
      expect(ff.code, `the fast-forward failed:\n${ff.output}`).toBe(0)

      const after = (await git(s, c, ['rev-parse', 'HEAD'])).stdout.trim()
      const tip = (await git(s, up, ['rev-parse', 'HEAD'])).stdout.trim()
      expect(after, 'the fast-forward did not land on the remote tip').toBe(tip)
      const ancestor = await git(s, c, ['merge-base', '--is-ancestor', before, 'HEAD'])
      expect(ancestor.code, 'the previous HEAD is no longer an ancestor — that was not a fast-forward').toBe(0)
    })
  })

  it('#3 a modified tree still gets the warning, but no offer', async () => {
    await scenario('staleness-3', async (s) => {
      const up = await upstream(s, 'a')
      const c = await freshClone(s, up, 'a', 'c3')
      await advance(s, up, 1)
      await s.fs.write(join(c, 'f.txt'), 'one\nuncommitted\n')

      const out = await assess(s, c, 'main')
      expect(out.offer, `a dirty tree was offered a fast-forward (blocker=${out.blocker})`).toBe('no')
      expect(out.blocker).toBe('dirty')
      expect(
        out.status,
        'dirtiness suppressed the staleness REPORT as well as the offer — the warning is the point',
      ).toBe('behind')
    })
  })

  it('#3b an untracked file blocks the offer too', async () => {
    await scenario('staleness-3b', async (s) => {
      // A fast-forward that needs to write where an untracked file sits fails
      // halfway, and halfway in someone else's repository is the worst outcome
      // available.
      const up = await upstream(s, 'a')
      const c = await freshClone(s, up, 'a', 'c3b')
      await advance(s, up, 1)
      await s.fs.write(join(c, 'untracked.txt'), 'x\n')

      const out = await assess(s, c, 'main')
      expect(out.blocker, 'an UNTRACKED file did not block the offer').toBe('dirty')
      expect(out.offer).toBe('no')
    })
  })

  it('#4 a detached HEAD is reported and never offered', async () => {
    await scenario('staleness-4', async (s) => {
      const up = await upstream(s, 'a')
      const c = await freshClone(s, up, 'a', 'c4')
      await advance(s, up, 1)
      await git(s, c, ['checkout', '-q', '--detach', 'HEAD'])

      const out = await assess(s, c, 'main')
      expect(out.blocker).toBe('detached')
      expect(out.offer).toBe('no')
    })
  })

  it('#4b a checkout on a different branch is never fast-forwarded onto', async () => {
    await scenario('staleness-4b', async (s) => {
      const up = await upstream(s, 'a')
      const c = await freshClone(s, up, 'a', 'c4b')
      await advance(s, up, 1)
      await git(s, c, ['checkout', '-q', '-b', 'side'])

      const out = await assess(s, c, 'main')
      expect(out.blocker).toBe('wrong-branch')
      expect(out.offer).toBe('no')
    })
  })

  it('#5 a diverged checkout is named as such and never offered', async () => {
    await scenario('staleness-5', async (s) => {
      const up = await upstream(s, 'a')
      const c = await freshClone(s, up, 'a', 'c5')
      await advance(s, up, 1)
      await s.fs.write(join(c, 'local.txt'), 'local only\n')
      await git(s, c, ['add', '-A'])
      await git(s, c, ['commit', '-q', '-m', 'local'])
      await git(s, c, ['fetch', '-q', 'origin', 'main'])

      const out = await assess(s, c, 'main')
      expect(out.status).toBe('diverged')
      expect(
        out.offer,
        'DIVERGED WAS OFFERED A FAST-FORWARD — this would silently discard or block local commits',
      ).toBe('no')
    })
  })

  it('#6 an ahead checkout is "ahead", not "behind", and offers nothing', async () => {
    await scenario('staleness-6', async (s) => {
      const up = await upstream(s, 'a')
      const c = await freshClone(s, up, 'a', 'c6')
      await s.fs.write(join(c, 'a.txt'), 'ahead\n')
      await git(s, c, ['add', '-A'])
      await git(s, c, ['commit', '-q', '-m', 'ahead'])

      const out = await assess(s, c, 'main')
      expect(out.status).toBe('ahead')
      expect(out.offer).toBe('no')
    })
  })

  it('#7 an unreachable remote is "unknown", never "current"', async () => {
    await scenario('staleness-7', async (s) => {
      // Reporting "current" because the probe FAILED is the single worst outcome
      // available here: it is the false reassurance the whole feature exists to
      // remove.
      const up = await upstream(s, 'a')
      const c = await freshClone(s, up, 'a', 'c7')
      await git(s, c, ['remote', 'set-url', 'origin', s.workspace.path('does-not-exist')])

      const out = await assess(s, c, 'main')
      expect(out.status).toBe('unknown')
      expect(out.blocker).toBe('unreachable')
    })
  })

  it('#7b a checkout with no remote is "unknown/no-remote", not "current"', async () => {
    await scenario('staleness-7b', async (s) => {
      const c = await s.workspace.dir('a', 'c7b')
      await git(s, c, ['init', '-q', '-b', 'main', '.'])
      await git(s, c, ['config', 'user.email', 't@local'])
      await git(s, c, ['config', 'user.name', 't'])
      await git(s, c, ['config', 'commit.gpgsign', 'false'])
      await s.fs.write(join(c, 'f'), 'x\n')
      await git(s, c, ['add', '-A'])
      await git(s, c, ['commit', '-q', '-m', 'x'])

      const out = await assess(s, c, 'main')
      expect(out.status).toBe('unknown')
      expect(out.blocker).toBe('no-remote')
    })
  })

  it('#7c a branch the remote does not have is "unknown"', async () => {
    await scenario('staleness-7c', async (s) => {
      const up = await upstream(s, 'a')
      const c = await freshClone(s, up, 'a', 'c7c')

      const out = await assess(s, c, 'no-such-branch')
      expect(out.status).toBe('unknown')
    })
  })

  it('#8 BUG-078: a genuinely hanging remote is cut off at the CALLER\'s budget and reported as unknown', async () => {
    await scenario('staleness-8', async (s) => {
      // serial-timing. This runs at every agent wake, usually with no TTY: a
      // remote that accepts the connection and then says nothing must not stall
      // the wake.
      const timeoutCmd = await lib(s, 'bp_staleness_timeout_cmd', [])
      expect(
        timeoutCmd.stdout.trim(),
        'no timeout provider on this host, so the probe reports no-timeout for ' +
          'every checkout and the feature is OFF. The shell runner skipped here; ' +
          'a skip cannot tell that state from a working one (R7).',
      ).toMatch(/^g?timeout$/)

      const up = await upstream(s, 'a')
      const c = await freshClone(s, up, 'a', 'c8')
      const path = await blackHoleRemote(s, c)

      const start = Date.now()
      const out = await assess(s, c, 'main', { BP_STALENESS_TIMEOUT: '2' }, path)
      const elapsed = Date.now() - start

      // BOTH EDGES. Faster than the budget means the probe never actually
      // blocked, so the bound was not exercised — without the lower edge this
      // case cannot tell "correctly cut off" from "never hung".
      expect(elapsed, `returned in ${elapsed}ms with a 2s budget — the remote did not hang, so nothing was bounded`).toBeGreaterThanOrEqual(
        1500,
      )
      expect(elapsed, `a hanging remote stalled the probe for ${elapsed}ms — this would hang every agent wake`).toBeLessThan(
        6000,
      )
      expect(out.status).toBe('unknown')
    })
  })

  it('#9 BUG-078: a stale offer that would merge CLEANLY is still refused, and leaves HEAD where it was', async () => {
    await scenario('staleness-9', async (s) => {
      // assess() read the remote seconds earlier. If it moved to something
      // non-fast-forwardable in between, the checkout must be left exactly as it
      // was — `--ff-only` is not belt-and-braces over the assess checks, it is
      // the only thing adjudicating against real objects at write time.
      // THE CLONE MUST SIT ON A NON-ROOT COMMIT, which is what the rewrite
      // below has to discard. The shell version got this for free from a shared
      // upstream that earlier cases had already advanced — so `HEAD~2` reached
      // past the clone's commit by accident of ordering. Isolated per case (R5),
      // that accident is gone: with the clone on the root commit, any rewrite
      // still has it as an ancestor and the fast-forward legitimately SUCCEEDS,
      // which is a green case asserting nothing. Two commits before the clone,
      // one after, and `HEAD~2` is the rewrite the offer cannot survive.
      const up = await upstream(s, 'a')
      await advance(s, up, 1)
      const c = await freshClone(s, up, 'a', 'c9')
      await advance(s, up, 1)

      const offered = await assess(s, c, 'main')
      expect(offered.offer, 'the fixture never reached the state this case refuses from').toBe('ff')

      await git(s, up, ['reset', '-q', '--hard', 'HEAD~2'])
      await s.fs.write(join(up, 'f.txt'), 'rewritten\n')
      await git(s, up, ['add', '-A'])
      await git(s, up, ['commit', '-q', '-m', 'rewritten'])

      const before = (await git(s, c, ['rev-parse', 'HEAD'])).stdout.trim()
      const reflogBefore = (await git(s, c, ['reflog', 'show', 'HEAD'])).stdout
      const ff = await lib(s, 'bp_staleness_fast_forward', [c, 'main', 'origin'])
      expect(ff.code, 'a no-longer-fast-forwardable remote was merged anyway').not.toBe(0)
      expect(
        (await git(s, c, ['rev-parse', 'HEAD'])).stdout.trim(),
        'the refused fast-forward still moved HEAD — it must leave the checkout untouched',
      ).toBe(before)

      // "UNTOUCHED" HAS TO MEAN UNTOUCHED, because this is a write path into
      // ANOTHER OPERATOR'S REPOSITORY. Non-zero-and-HEAD-unchanged is satisfied by
      // implementations that wreck the place: `merge --no-commit --no-ff` leaves a
      // staged merge plus MERGE_HEAD and can then return non-zero; a
      // `stash`-then-merge leaves the operator's work in a stash they did not
      // make; a merge followed by `reset --hard` clobbers their ORIG_HEAD, which
      // is the undo point they would reach for. Each passes both assertions above
      // and leaves someone else's checkout mid-operation.
      //
      // WHAT IS ASSERTED: a clean index and worktree, no in-progress merge /
      // cherry-pick / revert / rebase, an empty stash list, and an UNCHANGED HEAD
      // REFLOG. The last one is what catches the implementation HEAD-equality
      // structurally cannot see — merge, then `reset --hard` back — because the
      // round trip leaves two reflog entries where an honest refusal leaves none.
      //
      // WHAT IS DELIBERATELY NOT, and each for a reason rather than by omission:
      //
      //   * FETCH_HEAD, the object store, and `refs/remotes/origin/*` with their
      //     reflogs. The contract is "fetch, then merge ONLY if it fast-forwards"
      //     — the fetch is the function working, not damage, and it touches
      //     nothing the operator can be standing on. Asserting an unchanged object
      //     store would assert the function does not do the first half of its job.
      //   * ORIG_HEAD. MEASURED, not assumed: `git merge --ff-only` writes it
      //     BEFORE it adjudicates, so a correctly refused merge leaves it behind
      //     (git 2.x, `fatal: Not possible to fast-forward`, rc=128). Asserting
      //     its absence would assert a property of git rather than of this
      //     function, and would fail on the healthy path.
      const st = await git(s, c, ['status', '--porcelain'])
      expect(
        st.stdout,
        'the refused fast-forward left the index or worktree dirty — a staged merge or ' +
          'conflicted paths in a repository the operator is not even in',
      ).toBe('')

      for (const marker of [
        'MERGE_HEAD',
        'CHERRY_PICK_HEAD',
        'REVERT_HEAD',
        'REBASE_HEAD',
        'rebase-merge',
        'rebase-apply',
      ]) {
        expect(
          await s.fs.exists(join(c, '.git', marker)),
          `the refused fast-forward left .git/${marker} behind — the checkout is ` +
            `mid-operation in a repository the operator is not even in`,
        ).toBe(false)
      }

      expect(
        (await git(s, c, ['reflog', 'show', 'HEAD'])).stdout,
        'the HEAD reflog grew — HEAD moved and was put back, which "HEAD is unchanged" ' +
          'cannot distinguish from never having moved',
      ).toBe(reflogBefore)

      const stash = await git(s, c, ['stash', 'list'])
      expect(
        stash.stdout.trim(),
        'the refused fast-forward stashed the operator\'s tree to make room for a merge',
      ).toBe('')
    })
  })
})

/**
 * A blueprint upstream, a local checkout of it that is BEHIND, and a project
 * whose `.blueprint-source` points at that local checkout.
 *
 * This is the shape that would actually hurt: `drift` runs at every wake against
 * the local checkout, and it just gained a network call and a prompt.
 */
async function driftFixture(s: Scenario) {
  const up = await s.workspace.dir('bp-remote')
  await git(s, up, ['init', '-q', '-b', 'main', '.'])
  await git(s, up, ['config', 'user.email', 't@local'])
  await git(s, up, ['config', 'user.name', 't'])
  await git(s, up, ['config', 'commit.gpgsign', 'false'])
  await s.fs.write(join(up, 'CLAUDE.md'), '# CLAUDE\n')
  // BUG-029 — `tests/` is a managed DIRECTORY whose expansion is fail-closed, so
  // a fixture blueprint has to ship suites or the CLI refuses rather than
  // silently syncing zero of them.
  await s.fs.write(join(up, 'tests/fixture/test.sh'), 'echo fixture\n')
  await git(s, up, ['add', '-A'])
  await git(s, up, ['commit', '-q', '-m', 'base'])

  const bp = s.workspace.path('bp-local')
  await git(s, s.workspace.root, ['clone', '-q', up, bp])
  await git(s, bp, ['config', 'user.email', 't@local'])
  await git(s, bp, ['config', 'user.name', 't'])
  await git(s, bp, ['config', 'commit.gpgsign', 'false'])
  const bpSha = (await git(s, bp, ['rev-parse', 'HEAD'])).stdout.trim()

  // Move the REMOTE forward so the local checkout is genuinely behind.
  await s.fs.write(join(up, 'CLAUDE.md'), '# CLAUDE\nmore\n')
  await git(s, up, ['add', '-A'])
  await git(s, up, ['commit', '-q', '-m', 'ahead'])

  const proj = await s.workspace.dir('proj')
  await git(s, proj, ['init', '-q', '-b', 'main', '.'])
  await git(s, proj, ['config', 'user.email', 't@local'])
  await git(s, proj, ['config', 'user.name', 't'])
  await git(s, proj, ['config', 'commit.gpgsign', 'false'])
  await s.fs.write(join(proj, 'CLAUDE.md'), '# CLAUDE\n')
  await s.fs.write(
    join(proj, '.blueprint-source'),
    [
      // TASK-025: these cases exercise the OVERRIDE path. drift reads a local
      // checkout only when BLUEPRINT_ROOT names one, and only there is there a
      // checkout whose staleness means anything — so every case passes it.
      `bootstrap_sha    = ${bpSha}`,
      'bootstrap_date   = 2026-01-01',
      '',
    ].join('\n'),
  )
  await git(s, proj, ['add', '-A'])
  await git(s, proj, ['commit', '-q', '-m', 'init'])

  return { up, bp, proj }
}

describe('`blueprint drift` reports staleness without blocking or mutating anything', () => {
  it('D#1 with no TTY: warns, offers a copy-pasteable command, never prompts', async () => {
    await scenario('staleness-drift-1', async (s) => {
      // serial-timing. The harness gives every child /dev/null on stdin, which
      // is what `report_staleness` asks about (`[ ! -t 0 ]`) — so a hang here
      // means the code prompted somewhere it should not have.
      const { bp, proj } = await driftFixture(s)

      const start = Date.now()
      const r = await s.run('node', [CLI, 'drift'], { cwd: proj, env: { BLUEPRINT_ROOT: bp }, timeoutMs: 60_000 })
      const elapsed = Date.now() - start

      expect(elapsed, `drift took ${elapsed}ms without a TTY — this runs at every wake`).toBeLessThan(20_000)
      expect(r.output, `drift did not report the stale checkout:\n${r.output}`).toContain('behind')
      expect(r.output, 'drift PROMPTED with no TTY — every agent wake would block here').not.toContain(
        'fast-forward it now?',
      )
    })
  })

  it('D#2 reporting leaves the blueprint checkout untouched', async () => {
    await scenario('staleness-drift-2', async (s) => {
      // A report with a side effect on someone else's checkout is not a report.
      const { bp, proj } = await driftFixture(s)
      const before = (await git(s, bp, ['rev-parse', 'HEAD'])).stdout.trim()

      await s.run('node', [CLI, 'drift'], { cwd: proj, env: { BLUEPRINT_ROOT: bp }, timeoutMs: 60_000 })

      expect(
        (await git(s, bp, ['rev-parse', 'HEAD'])).stdout.trim(),
        'drift MOVED the blueprint checkout HEAD without being asked',
      ).toBe(before)
    })
  })

  it('D#3 BUG-078: BP_NO_PROMPT=1 suppresses the offer WHERE A TTY IS PRESENT', async () => {
    await scenario('staleness-drift-3', async (s) => {
      // THE FLAG'S WHOLE PURPOSE is that a scripted caller can opt out
      // REGARDLESS of how it was invoked — i.e. where a TTY IS available and the
      // `[ ! -t 0 ]` arm therefore does NOT fire. The shell runner ran this case
      // with stdin closed, so the no-TTY arm suppressed the prompt and the flag
      // was never consulted: the case asserted nothing D#1 did not already
      // cover, and an implementation that ignored BP_NO_PROMPT entirely passed
      // it. Measured, not deduced — mutant S10 (delete the
      // `[ "${BP_NO_PROMPT:-0}" = "1" ] ||` arm) left BOTH implementations
      // green, and this rewrite is what turns it red.
      //
      // Same lesson as BUG-054 one suite over: a guard with two arms needs the
      // OTHER arm held false, or the case cannot say which one fired.
      //
      // The pty is supplied WITHOUT the inner `</dev/null` that
      // pull-behaviour's helper uses — here stdin must BE the terminal. `script`
      // closes the pty as soon as its own stdin (the harness's /dev/null) hits
      // EOF, so the prompt's `read` returns immediately and nothing blocks.
      const { bp, proj } = await driftFixture(s)

      const withTty = async (env: Record<string, string>) => {
        const probe = await s.run('script', ['-qec', 'true', '/dev/null'], { cwd: proj })
        const cmd = `cd '${proj}' && node '${CLI}' drift 2>&1`
        const args =
          probe.code === 0
            ? ['-qec', cmd, '/dev/null']
            : ['-q', '/dev/null', '/bin/sh', '-c', cmd]
        return s.run('script', args, { cwd: proj, env: { ...env, BLUEPRINT_ROOT: bp }, timeoutMs: 60_000 })
      }

      // THE CONTROL FIRST. Without it, "no prompt appeared" is satisfied by a
      // pty that never worked, by drift not reaching the offer, or by the
      // fixture not being behind — and the case would be green for any of them.
      const unsuppressed = await withTty({})
      expect(
        unsuppressed.output,
        'drift did NOT prompt even with a terminal and no BP_NO_PROMPT — so the ' +
          'suppression assertion below would pass for a reason unrelated to the flag',
      ).toContain('fast-forward it now?')

      const suppressed = await withTty({ BP_NO_PROMPT: '1' })
      expect(suppressed.output, 'BP_NO_PROMPT=1 still prompted').not.toContain(
        'fast-forward it now?',
      )
    })
  })

  it('D#4 a stale checkout does not change drift exit status', async () => {
    await scenario('staleness-drift-4', async (s) => {
      // A staleness WARNING must not become a drift FAILURE. They answer
      // different questions, and conflating them breaks every caller that
      // checks the status — which is every agent wake.
      const { bp, proj } = await driftFixture(s)

      const r = await s.run('node', [CLI, 'drift'], { cwd: proj, env: { BLUEPRINT_ROOT: bp }, timeoutMs: 60_000 })

      expect(r.code, `drift exited ${r.code} because the checkout was stale — staleness is advisory`).toBe(0)
    })
  })

  it('D#5 a black-holed remote is bounded and reported as unknown', async () => {
    await scenario('staleness-drift-5', async (s) => {
      // serial-timing. An unreachable remote must not stall the wake, and must
      // not claim current.
      const { bp, proj } = await driftFixture(s)
      const path = await blackHoleRemote(s, bp)

      const start = Date.now()
      const r = await s.run('node', [CLI, 'drift'], {
        cwd: proj,
        env: { BP_STALENESS_TIMEOUT: '2', PATH: path, BLUEPRINT_ROOT: bp },
        timeoutMs: 60_000,
      })
      const elapsed = Date.now() - start

      expect(elapsed, `a black-holed remote stalled drift for ${elapsed}ms`).toBeLessThan(15_000)
      expect(r.output, `an unreachable remote was not reported as unknown:\n${r.output}`).toContain('unknown')
    })
  })
})
