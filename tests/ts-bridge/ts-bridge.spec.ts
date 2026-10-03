/**
 * tests/ts-bridge/ts-bridge.spec.ts — BUG-055: the vitest bridge could not run
 * under a real `git push`, and when it failed it said NOTHING.
 *
 * Parallelism hazard: none. Each case builds its own fixture project and its own
 * stub `npx` inside its own scenario workspace. No real vitest is invoked from
 * inside these cases — which is the point, and also the subject of the honest
 * limits section below.
 *
 * TWO DEFECTS in `scripts/run-ts-suites.sh`, found because a push was refused with
 * no explanation and the gate's own log simply stopped mid-list:
 *
 *   1. git exports GIT_DIR when it invokes a hook. The TS harness refuses to run
 *      any scenario while that variable is present (`tests/harness/env.ts`,
 *      `assertProcessEnvClean`) and that refusal is CORRECT — it is the
 *      BUG-046/BUG-047 guard. Together those two facts meant every TS suite failed
 *      under a push and passed by hand. The shell suites have scrubbed git's
 *      environment since BUG-014; the TS path never got the equivalent.
 *   2. The runner was invoked as `( … ) >/dev/null 2>&1` with `_ts_rc=$?` on the
 *      following line, inside a hook that runs `set -e`. The assignment is
 *      unreachable on the only path where it matters, so a failing runner killed
 *      the hook before any stage printed: no stage line, no summary, no error. A
 *      broken run and a missing one were indistinguishable, which is BUG-005 in
 *      the stage built to report BUG-005.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS SPEC CAN AND CANNOT PROVE — read this before trusting it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is a TypeScript spec, run BY vitest, testing the shell bridge whose job is
 * to run vitest. The circularity is real and it is not resolved by being careful.
 *
 * WHAT IT PROVES, and the coverage here is essentially complete in CONTENT.
 * Every case drives a COPY of `scripts/run-ts-suites.sh` inside a fixture project,
 * against a STUB `npx`. So each assertion is about the bridge's logic over inputs
 * this spec constructs, and none of them depends on the real bridge being correct
 * — only on vitest currently working well enough to execute this file. The
 * environment scrub, the rendering, the survival of a non-zero declared-suites
 * status, and the visibility of a failing runner are all genuinely pinned.
 *
 * WHAT IT CANNOT PROVE, stated as three specific properties rather than a vague
 * caveat:
 *
 *   (a) THAT A REGRESSION OF BUG-055 WOULD BE REPORTED. If the real bridge dies
 *       silently again, this spec does not run at all — so it produces no red
 *       case. The failure mode BUG-055 actually had (an absence, not an error) is
 *       precisely the one an absent test cannot report.
 *   (b) THAT THE BRIDGE CAN START VITEST IN THIS REPO. The `npx`-missing and
 *       `tests/node_modules`-missing guards BLOCK rather than skip, which is the
 *       right shape; but if either misfired, the specs would not run and this file
 *       could not say so.
 *   (c) THE NO-TOOLCHAIN PROPERTY. `tests/manifest`'s retiring shell version
 *       re-ran itself with node/npm/npx/tsc/vitest poisoned and asserted it
 *       invoked none of them, so a project with no toolchain still got a truthful
 *       answer out of its own coverage control. No vitest spec can assert that
 *       about itself. Its migration recorded the same loss, in the same words.
 *
 * THE PARTIAL MITIGATION THAT DOES EXIST, and it is worth knowing about because it
 * shrinks (a) considerably. `tests/bootstrap-gate` #2/#3 bootstraps a project and
 * runs its ENTIRE pre-push gate as a subprocess, then asserts the gate reported at
 * least 25 stages. A bridge that died silently inside that inner gate would
 * truncate the stage list and turn that case red. So a silent bridge death IS
 * observable from outside — by an outer vitest run watching an inner gate. What
 * remains unobservable is only a failure that takes down the OUTER run too.
 *
 * THE RESIDUE WAS TASK-023, AND IT IS NOW AN ACCEPTED LOSS. Closing (a) and (c)
 * properly needs an assertion executed by something that is not vitest. The
 * founder decided on 2026-09-16 to accept that loss rather than keep a rule with
 * a silent exception (TASK-047): `tests/ts-bridge/test.sh` is retired, this spec
 * is the whole of the suite, and TASK-023 is closed. What it costs is recorded
 * in docs/config/findings.md F-003 — a silently dead bridge now produces no red
 * case — rather than left in a commit body.
 *
 * Do not answer it by inventing a second runner kind on one agent's authority:
 * that is how a test stack acquires the exemption R5 spent a day removing, and
 * it is a decision rather than a stage.
 *
 * WHERE THE §3.3 LINE FALLS. `scripts/run-ts-suites.sh` is sourced by
 * `.githooks/pre-push-project`, on the shell side of the boundary
 * TASK-018-TARGET §3.3 draws — and it has to be, for exactly §3.3's reason: it is
 * the code that discovers `npx` and `tests/node_modules` are absent, which is a
 * report a TypeScript program cannot make about its own missing toolchain. It is
 * not ported. The suite is.
 *
 * ONE IMPROVEMENT OVER THE SHELL VERSION WORTH NAMING, because it deletes a whole
 * bug class. #1c cross-checks the scrub against the harness's own `FORBIDDEN_ENV`.
 * The shell suite did that by `sed`-parsing `tests/harness/env.ts`, and BUG-063 is
 * what happened when the declaration changed shape: the pattern matched nothing,
 * the case failed as "could not read", and it took the push gate with it. Here the
 * list is IMPORTED. A parser that can go stale is replaced by a reference that
 * cannot, and the mirrored "skip 'inert'" rule the shell had to restate is gone
 * with it.
 *
 * The shell version also keyed #1c on `.blueprint-root`, on the premise that
 * `tests/harness/` is blueprint-tier and does not ship. That premise is stale:
 * `.gitattributes` carries no `tests/harness/ export-ignore` line, so the harness
 * DOES ship and the case would have run downstream anyway. The keying was
 * disarming a check that needed no disarming. Dropped, not ported.
 *
 * EQUIVALENCE RECORD (R6). The retiring `tests/ts-bridge/test.sh` and this spec
 * were run over the healthy repo plus one mutant of `scripts/run-ts-suites.sh` per
 * assertion, and the per-case verdict sets diffed mechanically. Table in the
 * migration report.
 *
 * Two deliberate divergences, both this spec being stronger:
 *
 *   * BUG-080 — `grep demo` is satisfied by `pipe_batch_end`'s "declared but
 *     never reported: demo" refusal, so the shell suite's #1b and #2c pass with
 *     per-suite reporting DELETED. Asserted here on a rendered stage line.
 *   * The `| floor` requirement had NO case at all. The bridge's own comment
 *     records that it was "caught by running the bridge rather than by reading
 *     it", and then nothing pinned it; #1e does.
 *
 * TASK-031 — THE TYPECHECK (#4, #5). vitest strips types without checking them,
 * so a green suite set says nothing about types: two tsc errors sat on main until
 * BUG-119, and `exactOptionalPropertyTypes` was enforced by nobody. The gate's
 * typecheck stage and CI's typecheck step call ONE function in this bridge,
 * `ts_typecheck`, which starts the pinned compiler through `ts_scrubbed` — BUG-117's
 * lesson applied before the two modes could diverge, not after. #4 reads the
 * hook's managed region, live lines only, for the one link execution cannot reach
 * (the hook is the whole gate). #4b–#4f EXECUTE the stage from a copy of this
 * bridge: a planted type error fails it with the real pinned compiler, a clean tree
 * passes, the compiler sees no scrubbed name, a project with no tests/package.json
 * skips with a reason, and an uninstalled compiler blocks. #5 EXECUTES every
 * workflow step that starts tsc, the way #3 does for vitest.
 *
 * TASK-033 — THE SHELL LINT (#6, #7), the same shape. The scripts carried
 * `# shellcheck` directives as if they were linted, and nothing installed or ran
 * ShellCheck. `sh_lint` lints the tracked shell scripts under scripts/ and
 * .githooks/ at severity WARNING, through the same scrub; the gate's stage and a
 * CI step call it. #6 reads the hook for the call. #6b–#6e EXECUTE the stage in
 * a git fixture: a planted SC2034 fails it through the REAL ShellCheck, an
 * info-level SC2086 passes (the threshold), a recording stub shows which files
 * were linted and that no scrubbed name reached it, and a missing ShellCheck
 * blocks. #7 executes the CI step. The real-ShellCheck cases REQUIRE it installed
 * and fail naming the installer when it is not: skipping would be a green suite
 * over a lint that never ran.
 *
 * MUTATION RECIPE (R6), each applied to `scripts/run-ts-suites.sh`:
 *
 *   M1  delete the `for _v in $(env | sed …); do unset "$_v"; done` scrub
 *       Red: #1, #1c.
 *   M2  scrub GIT_* only (the first fix, which left AGENT_* inherited and made
 *       the real push fail again, identically and just as silently)
 *       Red: #1, #1c.
 *   M3  restore `( … ) >/dev/null 2>&1` with `_ts_rc=$?` on the next line
 *       Red: #2, #2b, #2c.
 *   M4  drop the `|| _ts_declrc=$?` guard on the declared-suites call
 *       Red: #1d.
 *   M5  delete the `if [ "$_ts_rc" -ne 0 ]` reporting block
 *       Red: #2b.
 *   M6  drop `pipe_stage_report` (report nothing per suite)
 *       Red: #1b, #1d, #1e, #2c — but ONLY since those stopped grepping for the
 *       bare suite name. That is BUG-080: `pipe_batch_end` refuses the batch with
 *       "declared but never reported: demo", so a name grep is satisfied by the
 *       message saying the suite was NEVER reported. Survives the shell suite.
 *   M7  remove the `| floor` from the duration jq (durations render 0.0s)
 *       Red: #1e.
 *   M8  (TASK-025) delete `unset BLUEPRINT_ROOT` after the prefix loop
 *       Red: #1/#1c.
 *   M9  (TASK-025) narrow the loop to unset only the FORBIDDEN_ENV names
 *       Red: #1/#1c, on GIT_ALLOW_PROTOCOL — the undeclared population a
 *       direct run now scrubs by rule (tests/harness/env.ts isForbiddenAmbient).
 *   On the parent of TASK-025's reproducer commit the whole file is red: the
 *   imports it needs (UNPREFIXED_FORBIDDEN, isForbiddenAmbient) do not exist.
 *
 *   TASK-031, each applied to a copy of the tree and the suite run (observed):
 *   M10 delete `ts_typecheck_stage "$BP_CODE_ROOT"` from the hook's managed region
 *       Red: #4 only. Execution cannot see the hook, which is why #4 reads it.
 *   M11 delete the "Blueprint TypeScript typecheck" step from the workflow
 *       Red: #5 only.
 *   M12 in `ts_typecheck`, start the compiler directly instead of via ts_scrubbed
 *       Red: #4d, #5. Both modes lose the scrub at once, because they share one
 *       function, and each mode's case says so.
 *   On the parent of the fix (the reproducer commit), #4, #4b–#4f and #5 are all
 *   red: `ts_typecheck_stage: not found`, and no workflow step typechecks.
 *   RE-RUN FROM A GREEN BASELINE, with every run's log kept (Jesko, TASK-031
 *   review, S2): the unmutated copy passed 14/14, and M10, M11 and M12 went red
 *   exactly as listed above. Logs: .scratch/philipp-task031-mutants/, one per
 *   run, each headed by the revision and TMPDIR it ran with. The first run left
 *   no log, and a reviewer whose baseline was red could not tell M11 apart.
 *
 *   TASK-033, each applied to a fresh copy and ts-bridge run from a GREEN
 *   baseline (20/20), with ShellCheck 0.10.0 first on PATH. Logs, one per run:
 *   .scratch/philipp-task033-mutants/.
 *   M13 delete `sh_lint_stage "$BP_CODE_ROOT"` from the hook's managed region
 *       Red: #6 only.
 *   M14 delete the "Blueprint shell lint" step from the workflow
 *       Red: #7 only.
 *   M15 in `sh_lint`, `exit 0` instead of starting ShellCheck (linter bypassed)
 *       Red: #6b, #6d, #7. #6c and #6e stay green, correctly: a clean tree
 *       passes either way, and the missing-ShellCheck block comes before sh_lint.
 *   On the parent of the fix (the reproducer commit), #6 found no call, #6b–#6e
 *   failed with `sh_lint_stage: not found`, and #7 found no step.
 */

import { describe, it, expect, vi } from 'vitest'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { FORBIDDEN_ENV, UNPREFIXED_FORBIDDEN, isForbiddenAmbient } from '../harness/env.js'
import { liveCmds } from '../manifest/manifest.js'
import { notGithubActions, skipNote, skipVisibly } from '../helpers/project-config.js'
import { parseDocument } from 'yaml'

/**
 * A RENDERED STAGE LINE for `demo`, not merely the word "demo".
 *
 * BUG-080, and it is the reason this constant exists rather than a bare
 * `toContain('demo')`. When `pipe_stage_report` is deleted from the bridge,
 * `pipe_batch_end` refuses the batch with `declared but never reported: demo` —
 * a message that CONTAINS the suite name. So an assertion that greps for the
 * name is satisfied by the error saying the suite was never reported, which is
 * the exact opposite of the property. Measured: that mutant survives the
 * retiring shell suite's #1b and #2c.
 *
 * `pipeline.sh` renders a result as `│ ✓ <label>  <dur>` / `│ ✗ <label> …`, so a
 * status marker immediately before the name is what distinguishes a reported
 * stage from a complaint about a missing one.
 */
const STAGE_LINE = /[✓✗]\s+demo\s/

/**
 * Every variable the driver exports into the bridge, as a hook would. #1c judges
 * each of these by the harness's rule, so this list is shared by the driver and
 * the assertion rather than written twice.
 */
const DRIVER_EXPORTS = [
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_CONFIG_GLOBAL',
  'AGENT_FEED_TAG',
  'AGENT_SIGNAL_FILE',
  'AGENT_STATE_HOME',
  'BLUEPRINT_ROOT',
  'GIT_ALLOW_PROTOCOL',
  'AGENT_TASK025_DECOY',
  'GIT_AUTHOR_NAME',
] as const

describe('BUG-055 — the vitest bridge scrubs git’s environment and reports its own failures', () => {
  it('#0 the fixture declares a suite that owns a spec', async () => {
    await scenario('tsbridge-0', async (s) => {
      // Without this the cases below assert nothing about a real declared
      // suite.
      //
      // CORRECTED BY MEASUREMENT (R6 second pass). This comment used to say they
      // would "pass vacuously — `ts_suites_stage` skips outright when no suite
      // owns a spec, and a skip is green". They do not: a mutant blinding the
      // spec discovery turns #1, #1b, #1c, #1e, #2, #2b and #2c RED. The fixture
      // claim this case makes is true and the case is non-vacuous; the stated
      // consequence of its absence was not.
      const f = await fixture(s)

      const r = await s.run(
        'sh',
        [
          await s.fs.write(
            'declared.sh',
            `. ${JSON.stringify(join(f.dir, 'scripts/lib/suites.sh'))}\n` +
              `bp_suites_with_spec ${JSON.stringify(f.dir)}\n`,
          ),
        ],
        { cwd: f.dir },
      )

      expect(r.stdout.trim().split('\n').filter(Boolean), r.output).toEqual(['demo'])
    })
  })

  it('#1/#1c the runner sees no GIT_* or AGENT_* variable, and none from the harness’s own forbidden set', async () => {
    await scenario('tsbridge-1', async (s) => {
      // The harness refuses every scenario while any of these is set, so without
      // the scrub the whole TS stage fails under a real push while passing by
      // hand. #1c is asserted on the same run: it is a property of the same
      // recorded environment, and a second bridge invocation would prove nothing
      // more.
      const f = await fixture(s)
      await f.npx(0)

      const r = await f.runBridge()

      const seen = await f.seenEnv()
      expect(seen, `the runner was never invoked at all\n${r.output}`).not.toBeNull()
      expect(
        seen?.names ?? [],
        'the runner inherited these — the harness refuses every scenario while any is set',
      ).toEqual([])

      // #1c — the bridge removes AT LEAST what a direct run removes. It compares
      // the harness's RULE (isForbiddenAmbient, TASK-025 H5), not its declared
      // list: a direct run also scrubs every UNDECLARED GIT_*/AGENT_* name, and a
      // check over declared names only would pass a bridge that let
      // GIT_ALLOW_PROTOCOL through. IMPORTED rather than parsed: BUG-063 was a
      // `sed` range that stopped matching after a legal refactor.
      expect(FORBIDDEN_ENV.length, 'the harness declares no forbidden names — #1c would be vacuous').toBeGreaterThan(
        0,
      )
      const judged = [...new Set([...DRIVER_EXPORTS, ...FORBIDDEN_ENV])]
      expect(
        judged.filter((n) => isForbiddenAmbient(n) && !(FORBIDDEN_ENV as readonly string[]).includes(n)),
        'the driver plants no UNDECLARED forbidden name — the undeclared arm would go unjudged',
      ).not.toEqual([])
      for (const name of judged) {
        if (isForbiddenAmbient(name)) {
          expect(seen?.names ?? [], `${name} reached the runner, and a direct run would have removed it`).not.toContain(
            name,
          )
        }
      }
      // And everything the rule forbids is either in a prefix the bridge scrubs
      // or in the one short list it unsets by name. That is what makes the
      // bridge's two lines sufficient rather than assumed. The only names the
      // bridge removes BEYOND the rule are declared-inert ones and BP_* tunables.
      for (const name of judged.filter(isForbiddenAmbient)) {
        const byName = (UNPREFIXED_FORBIDDEN as readonly string[]).includes(name)
        expect(
          byName || /^(GIT|AGENT|BP)_/.test(name),
          `${name} is forbidden but neither prefixed nor in UNPREFIXED_FORBIDDEN, so the bridge cannot remove it`,
        ).toBe(true)
      }
    })
  })

  it('#1b the declared suite renders as its own stage', async () => {
    await scenario('tsbridge-1b', async (s) => {
      // The stage must actually RENDER, not merely run: `bootstrap-gate` #3 counts
      // stages as its non-vacuity guard, and the SLO's slowest-stage line has to
      // name something actionable. "slowest: vitest 200s" names nothing.
      const f = await fixture(s)
      await f.npx(0)

      const r = await f.runBridge()

      expect(r.output, `the suite ran but produced no stage line\n${r.output}`).toMatch(STAGE_LINE)
    })
  })

  it('#1e a stage duration renders as a real number, not 0.0s', async () => {
    await scenario('tsbridge-1e', async (s) => {
      // `| floor` in the duration jq is REQUIRED, not tidiness: vitest reports
      // endTime as a float, so the subtraction yields a float,
      // `pipe_stage_report` rejects a non-integer, and the guard substitutes 0 —
      // every stage rendering 0.0s while the SLO's slowest-stage line named
      // nothing. The stub reports fractional times for exactly that reason.
      const f = await fixture(s)
      await f.npx(0)

      const r = await f.runBridge()

      // The stub reports ~1399.9 ms of suite time. Floored that is 1399 ms and
      // renders "1.3s"; coerced to 0 by the non-integer guard it renders "0.0s".
      // The magnitude is chosen so the two are DISTINGUISHABLE — an 80 ms
      // duration renders 0.0s either way, which is how the first version of this
      // case failed to test anything (measured, not reasoned).
      expect(r.output, `the duration collapsed to zero\n${r.output}`).not.toMatch(/demo\s+0\.0s/)
      expect(r.output, `no non-zero duration rendered at all\n${r.output}`).toMatch(/demo\s+1\.\ds/)
    })
  })

  it('#1d a non-zero declared-suites status does not abort the stage under set -e', async () => {
    await scenario('tsbridge-1d', async (s) => {
      // THE DEFECT ITSELF. `bp_suites_with_spec` returned 1 with a correct
      // four-suite list, the caller's unprotected `_ts_expect="$(…)"` inherited
      // that status, and `set -e` destroyed the hook between two statements — no
      // stage, no skip, no summary, no error, and a push refused with nothing to
      // read. Eight pushes to find, because the failure rendered as an absence.
      //
      // The status is INJECTED rather than coaxed out of the manifest parser.
      // Reproducing it through the fixture depends on which suite happens to sort
      // last and on internals of `bp_suites_with_spec`, so it would silently stop
      // reproducing the moment either changed and the case would go green while
      // guarding nothing. What the bridge must survive is a non-zero status from
      // that call, whatever produces it.
      //
      // The assertion is deliberately about the CONSEQUENCE (the stage still
      // reports) rather than about how the status is masked, so a future rewrite
      // of the masking cannot pass this by accident.
      const f = await fixture(s)
      await f.npx(0)

      const r = await f.runBridge({
        inject: `ts_declared_suites(){ printf 'demo\\n'; return 1; }\n`,
      })

      expect(
        r.output,
        `the stage did not survive a non-zero declared-suites status — the exact silent death that refused the push\n${r.output}`,
      ).toMatch(STAGE_LINE)
    })
  })

  it('#2/#2b/#2c a failing runner is visible, names the failure, and still reaches per-suite reporting', async () => {
    await scenario('tsbridge-2', async (s) => {
      // The half that cost the diagnosis. Under `set -e` the old form aborted the
      // caller before the status could be read, so the gate's output simply
      // stopped and the push was refused with nothing to go on.
      //
      // NOT wrapped in a tolerant construct. A `|| true` around the invocation
      // would put the whole thing in a tested context, which disables `set -e` for
      // everything inside it — and `set -e` is the mechanism under test. Written
      // that way first, and this case then passed against the unfixed bridge, i.e.
      // asserted nothing. Here the driver runs as its own process and its status
      // is simply read afterwards.
      const f = await fixture(s)
      await f.npx(1)

      const r = await f.runBridge()

      expect(
        r.output.trim(),
        'the runner failed and the bridge printed NOTHING — a broken run is indistinguishable from a stage that does not exist',
      ).not.toBe('')
      // #2b — the output must NAME the runner failure and its status.
      expect(r.output, `the run failed but nothing said so\n${r.output}`).toMatch(/vitest failed/i)
      // #2c — the stage must still REACH its reconciliation. Under the old form
      // `set -e` aborted at the failing subshell, so `pipe_batch_end` never ran
      // and the gate stopped printing — which is how this presented: a refused
      // push with the stage list truncated mid-way and no error anywhere.
      expect(
        r.output,
        `the bridge aborted before reporting any suite — the silent truncation that made a refused push unexplainable\n${r.output}`,
      ).toMatch(STAGE_LINE)
    })
  })

  it('#8 TASK-044 a SKIP-NOTE printed by a PASSING run reaches the gate output', async () => {
    await scenario('tsbridge-8', async (s) => {
      // A skipped case is otherwise invisible in the gate. On a pass the bridge
      // deletes vitest's output, and vitest's JSON carries no skip reason. So a
      // case skipped because the project runs another CI would look like a pass.
      const note = 'SKIP-NOTE: demo > #3: the declared CI is aws-codepipeline'
      const f = await fixture(s)
      await f.npx(0, note)

      const r = await f.runBridge()

      expect(r.output, r.output).toMatch(STAGE_LINE)
      expect(r.output, `the skip reason never reached the gate\n${r.output}`).toContain(note)
    })
  })

  it('#8b every skip notice survives, however many canary notes precede it', async () => {
    await scenario('tsbridge-8b', async (s) => {
      // The notices shared one `head -20` budget, so canary notes could spend it
      // all and every later skip reason was dropped — while #8 still passed on
      // its single note. A skip nobody can see is the silence TASK-044 refuses.
      const canary = Array.from({ length: 25 }, (_, i) => `CANARY-NOTE: the baton moved (${i})`)
      const skips = [
        'SKIP-NOTE: #live (#5): the declared CI is aws-codepipeline',
        'SKIP-NOTE: #live (#5b): the declared CI is aws-codepipeline',
      ]
      const f = await fixture(s)
      await f.npx(0, [...canary, ...skips])

      const r = await f.runBridge()

      for (const skip of skips) {
        expect(r.output, `a skip notice was dropped behind the canary notes\n${r.output}`).toContain(skip)
      }
    })
  })

  it('#8c a notice whose title or reason contains a newline reaches the gate whole', async () => {
    // THE BYTES COME FROM THE REAL HELPER, not from a restatement of its format.
    // What the gate must preserve is whatever skipNote actually emits, so a
    // change to that format cannot leave this case passing over the old one.
    //
    // Alexey, finding 7: the gate keeps the marked LINES and deletes the rest of
    // the run's output, so a notice split across two physical lines arrives
    // without its reason — and a wrapped test title alone is enough to split it.
    const emitted: string[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation((m: string) => void emitted.push(m))
    try {
      skipNote('#live (#5)\nwrapped title', 'the declared CI is aws-codepipeline\nso the workflow is inert')
    } finally {
      warn.mockRestore()
    }

    await scenario('tsbridge-8c', async (s) => {
      const f = await fixture(s)
      await f.npx(0, (emitted[0] ?? '').split('\n'))

      const r = await f.runBridge()

      expect(r.output, `the case identity was lost\n${r.output}`).toContain('#live (#5)')
      expect(
        r.output,
        `the REASON was lost — the half that says why a check did not run\n${r.output}`,
      ).toContain('the declared CI is aws-codepipeline')
    })
  })
})

interface WorkflowStep {
  name?: string
  if?: unknown
  run?: string
  'working-directory'?: string
}

describe('BUG-117 — CI starts vitest under the same scrub as the gate', () => {
  it('#3 every workflow step that runs vitest hands it no GIT_*, AGENT_*, BP_* or unprefixed forbidden name', async (ctx) => {
    const notGithub = await notGithubActions(REPO_ROOT)
    if (notGithub) skipVisibly(ctx, notGithub)
    await scenario('tsbridge-3', async (s) => {
      // THE GATE AND CI ARE TWO EXECUTION MODES OF ONE SUITE SET. The harness
      // refuses a test process carrying any undeclared GIT_* / AGENT_* name
      // (H5), and the gate satisfies that through this bridge. CI ran
      // `npx vitest run` directly, so it inherited the runner's environment —
      // GitHub-hosted runners export AGENT_TOOLSDIRECTORY — and 697 of 770 tests
      // were refused. Every case above tests the BRIDGE; none tested the other
      // mode, and tests/manifest #5 reads the workflow as text.
      //
      // So the workflow's own vitest steps are EXECUTED, exactly as GitHub runs
      // a `run:` block, against the recording stub. The decoys are undeclared
      // names in all three prefixes plus the unprefixed hazard: a fix that named
      // one runner variable would still hand the stub the rest.
      const steps = (await workflowSteps()).filter(
        (step) => typeof step.run === 'string' && /\bvitest\s+run\b/.test(step.run),
      )
      expect(steps.length, 'no workflow step runs vitest — this case would assert nothing').toBeGreaterThan(0)

      const f = await fixture(s)
      for (const [i, step] of steps.entries()) {
        await f.npx(0)
        const script = await s.fs.write(`ci-step-${i}.sh`, step.run ?? '')
        const cwd = join(f.dir, step['working-directory'] ?? '.')
        // GitHub's own invocation of a `run:` block on a Linux runner.
        const driver = await s.fs.write(
          `ci-driver-${i}.sh`,
          `cd ${JSON.stringify(cwd)}\n` +
            `PATH=${JSON.stringify(f.shimPath)}\n` +
            `AGENT_TOOLSDIRECTORY=${JSON.stringify(join(f.dir, 'decoy-toolcache'))}\n` +
            `AGENT_BUG117_DECOY=${JSON.stringify(s.escapeToken)}\n` +
            `GIT_BUG117_DECOY=decoy\n` +
            `BP_BUG117_DECOY=decoy\n` +
            `BLUEPRINT_ROOT=${JSON.stringify(join(f.dir, 'decoy-blueprint'))}\n` +
            `export PATH AGENT_TOOLSDIRECTORY AGENT_BUG117_DECOY GIT_BUG117_DECOY BP_BUG117_DECOY BLUEPRINT_ROOT\n` +
            `exec bash --noprofile --norc -eo pipefail ${JSON.stringify(script)}\n`,
        )
        const r = await s.run('sh', [driver], { cwd: f.dir, timeoutMs: 120_000 })

        const seen = await f.seenEnv()
        expect(seen, `step "${step.name}" never started vitest at all\n${r.output}`).not.toBeNull()
        expect(
          seen?.names ?? [],
          `step "${step.name}" hands vitest the runner's environment — the harness refuses every scenario while any of these is set`,
        ).toEqual([])
      }
    })
  })
})

describe('BUG-149 — the documented entry point scrubs a normal terminal for itself', () => {
  it('#10 npm test with GIT_ASKPASS set runs the suites green', async () => {
    await scenario('tsbridge-149', async (s) => {
      // The founder's terminal exports GIT_ASKPASS (VS Code does), and the
      // harness rightly refuses to run under it — that guard is BUG-046/047's
      // class and stays. What was wrong is that the entry point the project
      // itself documents (`npm test` in tests/) inherited the variable, so
      // the person who must run acceptance tests was the one person the
      // command failed for (969 cases). The package.json script now runs
      // vitest through run-ts-suites.sh's ts_scrubbed; this case executes the
      // REAL entry point against the REAL tree with GIT_ASKPASS deliberately
      // set, and expects green.
      //
      // The filter narrows the nested run to one cheap suite whose scenarios
      // call assertProcessEnvClean — the exact guard that fired 969 times —
      // so a package.json that lost its scrub, or a harness that stopped
      // declaring GIT_ASKPASS (this case's override would then be refused),
      // turns RED. The fake askpass is a program inside the workspace, which
      // is what the 'path' kind in tests/harness/env.ts requires.
      const askpass = await s.fs.write('askpass.sh', '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      const r = await s.run('npm', ['test', '--', 'doc-links/doc-links.spec.ts'], {
        cwd: join(REPO_ROOT, 'tests'),
        env: { GIT_ASKPASS: askpass },
        timeoutMs: 180_000,
      })
      expect(
        r.code,
        `npm test failed with GIT_ASKPASS set — the documented entry point does not scrub a normal terminal\n${r.output}`,
      ).toBe(0)
    })
  })
})

describe('BUG-132 — CI runs the suites on a machine the installer prepared', () => {
  it('#9 after the suites job’s provisioning steps, install-toolchain.sh check passes on a runner that had none of its tools', async (ctx) => {
    const notGithub = await notGithubActions(REPO_ROOT)
    if (notGithub) skipVisibly(ctx, notGithub)
    await scenario('tsbridge-9', async (s) => {
      // THE SUITES NEED THE TOOLS A DEVELOPER MACHINE HAS. BUG-127 made a2bp
      // refuse without gitleaks, the installer puts gitleaks on every developer
      // machine, and the job running the suites installed ShellCheck by name and
      // nothing else, so six a2bp files went red in CI only. Naming gitleaks next
      // would catch gitleaks. What this case requires instead is the installer's
      // own verdict: whatever the installer declares, the job must provide.
      // The machinery, and what it does NOT prove, is on provisionSuitesJob.
      const failure = await provisionSuitesJob(s)
      expect(failure, failure ?? '').toBeNull()
    })
  })

  // WITNESSES. Each is a regression #9 would have passed before Jesko's review
  // (Codex, 2026-09-16): the machinery has to turn it red, not merely run.
  it('#9b a provisioning step whose guard is false is skipped, as GitHub skips it, so the tools are missing', async (ctx) => {
    const notGithub = await notGithubActions(REPO_ROOT)
    if (notGithub) skipVisibly(ctx, notGithub)
    await scenario('tsbridge-9b', async (s) => {
      const failure = await provisionSuitesJob(s, {
        edit: (job) => {
          namedStep(job, 'Gate toolchain').if = "hashFiles('tests/package.json') == ''"
        },
      })
      expect(failure ?? '#9 PASSED', 'a skipped installer passed #9 — the guard is not evaluated').toMatch(/check failing/)
      expect(failure ?? '#9 PASSED').toContain('gitleaks  MISSING')
    })
  })

  it('#9c with no tests/package.json the guarded installer is skipped, and the job still provides ShellCheck for the shell lint', async (ctx) => {
    const notGithub = await notGithubActions(REPO_ROOT)
    if (notGithub) skipVisibly(ctx, notGithub)
    await scenario('tsbridge-9c', async (s) => {
      // The guard is evaluated against the fixture's real files: the manifest is
      // absent here, so the installer must not run. The shell lint step is not
      // guarded, so ShellCheck must arrive anyway (the harness-less checkout).
      const failure = await provisionSuitesJob(s, { omitManifest: true })
      expect(failure ?? '#9 PASSED', 'the installer ran although its manifest is missing').toMatch(/check failing/)
      expect(failure ?? '#9 PASSED').toContain('gitleaks  MISSING')
      expect(failure ?? '#9 PASSED', 'a harness-less checkout reaches the shell lint without ShellCheck').toContain('✓ shellcheck')
    })
  })

  it('#9d a setup step that installs the tools and then exits nonzero is red, naming the step and its output', async (ctx) => {
    const notGithub = await notGithubActions(REPO_ROOT)
    if (notGithub) skipVisibly(ctx, notGithub)
    await scenario('tsbridge-9d', async (s) => {
      const failure = await provisionSuitesJob(s, {
        edit: (job) => {
          const step = namedStep(job, 'Gate toolchain')
          step.run = `${step.run ?? ''}\necho BUG132-AFTER-INSTALL\nexit 42\n`
        },
      })
      expect(failure ?? '#9 PASSED', 'a failed setup step passed #9').toMatch(/setup step "Gate toolchain" exited 42/)
      expect(failure ?? '#9 PASSED').toContain('BUG132-AFTER-INSTALL')
    })
  })

  it('#9e a step condition #9 cannot evaluate fails loudly instead of being ignored', async (ctx) => {
    const notGithub = await notGithubActions(REPO_ROOT)
    if (notGithub) skipVisibly(ctx, notGithub)
    await scenario('tsbridge-9e', async (s) => {
      const failure = await provisionSuitesJob(s, {
        edit: (job) => {
          namedStep(job, 'Gate toolchain').if = false
        },
      })
      expect(failure ?? '#9 PASSED', 'an unmodelled condition was run or skipped on a guess').toMatch(/cannot evaluate/)
    })
  })
})

function namedStep(job: WorkflowStep[], name: string): WorkflowStep {
  const step = job.find((st) => st.name === name)
  expect(step, `the suites job has no step "${name}"`).toBeDefined()
  return step as WorkflowStep
}

/**
 * #9's machinery. The suites job's provisioning steps are EXECUTED, the way #3
 * executes the vitest step, on a PATH with every tool the installer declares
 * removed. Provisioning steps are the `run:` steps before the vitest step, minus
 * the ones that source run-ts-suites.sh: those consume tools. Each step's `if:`
 * is evaluated as GitHub would, for the one form this job uses,
 * `hashFiles('<path>') != ''` or `== ''`, against the fixture's files; any other
 * form is a failure, not a guess. A step that exits nonzero fails the job here,
 * as it does on GitHub. Then the installer's `check` judges the result.
 *
 * OFFLINE, and NOT an install smoke test: curl, tar, pipx and apt-get are stubs
 * that make whatever was asked for, and `npm ci` succeeds without installing. So
 * this proves the wiring (which steps run, that each succeeds, that GITHUB_PATH
 * reaches the next step, that the declared tool set is provided) and nothing
 * about downloads, archive contents, package validity or scanner versions.
 * A tool a suite needs that the INSTALLER does not declare is invisible here,
 * as it is on every developer machine.
 *
 * Returns why the job would leave the suites without their tools, or null.
 */
async function provisionSuitesJob(
  s: Scenario,
  opts: { edit?: (job: WorkflowStep[]) => void; omitManifest?: boolean } = {},
): Promise<string | null> {
  const installer = await readFile(join(REPO_ROOT, 'scripts/install-toolchain.sh'), 'utf8')
  const declared = (/^SECURITY_TOOLS="([^"]*)"/m.exec(installer)?.[1] ?? '').split(/\s+/).filter(Boolean)
  expect(declared.length, 'the installer declares no tools — this case would assert nothing').toBeGreaterThan(0)

  const job = await suitesJob()
  opts.edit?.(job)
  const at = job.findIndex((step) => typeof step.run === 'string' && /\bvitest\s+run\b/.test(step.run))
  expect(at, 'no job runs vitest — this case would assert nothing').toBeGreaterThan(-1)
  const provisioning = job
    .slice(0, at)
    .filter((step) => typeof step.run === 'string' && !step.run.includes('run-ts-suites.sh'))

  const dir = await s.workspace.dir('runner-proj')
  const files = ['scripts/install-toolchain.sh', 'scripts/lib/watcher-lock.sh']
  if (!opts.omitManifest) files.push('tests/package.json')
  for (const f of files) await s.fs.copyIn(join(REPO_ROOT, f), `runner-proj/${f}`)
  const home = await s.workspace.dir('runner-home')
  const githubPath = await s.fs.write('github-path', '')
  const which = async (tool: string) => {
    const r = await s.run('sh', ['-c', `command -v ${tool}`], { cwd: dir })
    expect(r.code, `${tool} is not on this machine`).toBe(0)
    return r.stdout.trim()
  }
  const [tar, npm] = [await which('tar'), await which('npm')]

  const stub = (name: string) => `printf '#!/bin/sh\\necho "${name} stub 0.0.0"\\n'`
  const shims = await s.shimDir('runner-bin')
  await shims.add('uname', 'case "$1" in -m) echo x86_64 ;; *) echo Linux ;; esac')
  await shims.add('sudo', 'exec "$@"')
  await shims.add('npm', `[ "$1" = ci ] && exit 0\nexec ${JSON.stringify(npm)} "$@"`)
  await shims.add(
    'curl',
    `while [ "$#" -gt 0 ]; do case "$1" in -o) out="$2"; shift ;; esac; shift; done\n` +
      `${stub('fetched')} > "$out"`,
  )
  await shims.add(
    'tar',
    `case " $* " in *" -x"*) ;; *) exec ${JSON.stringify(tar)} "$@" ;; esac\n` +
      `while [ "$#" -gt 0 ]; do case "$1" in -C) into="$2"; shift ;; *) member="$1" ;; esac; shift; done\n` +
      `mkdir -p "$(dirname "$into/$member")"\n${stub('extracted')} > "$into/$member"\nchmod 755 "$into/$member"`,
  )
  await shims.add(
    'pipx',
    `[ "$1" = install ] || exit 0\nmkdir -p "$HOME/.local/bin"\n${stub('pipx')} > "$HOME/.local/bin/$2"\nchmod 755 "$HOME/.local/bin/$2"`,
  )
  await shims.add(
    'apt-get',
    `[ "$1" = install ] || exit 0\nfor p in "$@"; do case "$p" in install|-*) ;; *) ${stub('apt')} > ${JSON.stringify(shims.dir)}/"$p"; chmod 755 ${JSON.stringify(shims.dir)}/"$p" ;; esac; done`,
  )
  // jq stays: every GitHub runner image ships it, and on Linux the installer
  // does not fetch it but defers to the package manager. Every other declared
  // tool is absent, so the job has to provide it.
  const absent = declared.filter((t) => t !== 'jq')
  const base = await s.pathWithout([...absent, 'curl', 'tar', 'pipx', 'sudo', 'apt-get', 'brew', 'uname', 'npm'])

  let path = `${shims.dir}:${base}`
  const log: string[] = []
  for (const [i, step] of provisioning.entries()) {
    const runs = await stepRuns(step, dir)
    if (typeof runs === 'string') return runs
    if (!runs) {
      log.push(`--- step "${step.name}" skipped: if: ${String(step.if)} is false here ---`)
      continue
    }
    const script = await s.fs.write(`provision-${i}.sh`, step.run ?? '')
    const r = await s.run('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
      cwd: join(dir, step['working-directory'] ?? '.'),
      env: { HOME: home, PATH: path, GITHUB_PATH: githubPath },
      timeoutMs: 120_000,
    })
    log.push(`--- step "${step.name}" exit ${r.code} ---\n${r.output}`)
    if (r.code !== 0) {
      return `setup step "${step.name}" exited ${r.code} — GitHub fails the job here and the suites never run\n${log.join('\n')}`
    }
    // GitHub prepends what a step appends to GITHUB_PATH, for every later step.
    const added = (await readFile(githubPath, 'utf8')).split('\n').filter(Boolean).reverse()
    await s.fs.write('github-path', '')
    if (added.length > 0) path = `${added.join(':')}:${path}`
  }

  const check = await s.run('bash', [join(dir, 'scripts/install-toolchain.sh'), 'check'], {
    cwd: dir,
    env: { HOME: home, PATH: path },
  })
  if (check.code === 0) return null
  return (
    `the job's provisioning left the installer's check failing — the suites would run without these tools\n` +
    `${check.output}\n${log.join('\n')}`
  )
}

/**
 * Whether GitHub runs `step`, for the one condition form the suites job uses.
 * A string is the reason the condition cannot be evaluated: guessing either way
 * would let a skipped installer pass, or an unskipped one hide its guard.
 */
async function stepRuns(step: WorkflowStep, root: string): Promise<boolean | string> {
  if (step.if === undefined) return true
  const m = /^\s*(?:\$\{\{\s*)?hashFiles\('([^'*?[\]]+)'\)\s*(!=|==)\s*''\s*(?:\}\}\s*)?$/.exec(String(step.if))
  if (!m) {
    return (
      `step "${step.name}" has \`if: ${String(step.if)}\`, which #9 cannot evaluate — it models only ` +
      `hashFiles('<literal path>') != '' and == ''. Model the new form in stepRuns.`
    )
  }
  // hashFiles hashes files, so a directory at that path counts as absent.
  const present = await stat(join(root, m[1] ?? '')).then(
    (st) => st.isFile(),
    () => false,
  )
  return (m[2] === '!=') === present
}

/** The steps of the one job that runs the vitest suites. */
async function suitesJob(): Promise<WorkflowStep[]> {
  const wf = parseDocument(
    await readFile(join(REPO_ROOT, '.github/workflows/security.yml'), 'utf8'),
  ).toJS() as { jobs?: Record<string, { steps?: WorkflowStep[] }> }
  return (
    Object.values(wf.jobs ?? {})
      .map((job) => job.steps ?? [])
      .find((steps) => steps.some((step) => typeof step.run === 'string' && /\bvitest\s+run\b/.test(step.run))) ?? []
  )
}

/** Every step of every job in the real workflow, as GitHub parses it. */
async function workflowSteps(): Promise<WorkflowStep[]> {
  const wf = parseDocument(
    await readFile(join(REPO_ROOT, '.github/workflows/security.yml'), 'utf8'),
  ).toJS() as { jobs?: Record<string, { steps?: WorkflowStep[] }> }
  return Object.values(wf.jobs ?? {}).flatMap((job) => job.steps ?? [])
}

/** Printed by a stage driver after the stage returns — absent when the stage stopped the gate. */
const AFTER = 'TC-FIXTURE-CONTINUED'

describe('TASK-031 — the gate and CI typecheck tests/ through one scrubbed command', () => {
  it('#4 the managed region of the hook calls ts_typecheck_stage in live code', async () => {
    // Text, and only for the link execution cannot reach: the hook IS the whole
    // gate. What the call does is executed in #4b–#4f. Comment lines are removed
    // first (liveCmds, Codex R2-F1b), so a commented-out call is not an invocation.
    // The managed region, because that is what `blueprint pull` delivers: a call
    // below the end marker would exist in this repo and in no derived project.
    const hook = await readFile(join(REPO_ROOT, '.githooks/pre-push-project'), 'utf8')
    const end = hook.search(/^# BLUEPRINT:END/m)
    expect(end, 'the hook has no managed region').toBeGreaterThan(0)
    expect(
      liveCmds(hook.slice(0, end)),
      'the gate never calls the typecheck stage, so a type error in tests/ pushes green',
    ).toMatch(/^[ \t]*ts_typecheck_stage[ \t]+"\$BP_CODE_ROOT"[ \t]*$/m)
  })

  it('#4b a planted type error FAILS the stage, shows the compiler error, and stops the gate', async () => {
    await scenario('tsbridge-tc-4b', async (s) => {
      const f = await typecheckFixture(s, { tsc: 'real', planted: true })
      const r = await f.runStage()
      expect(r.code, describeRun('a type error passed the typecheck stage', r)).not.toBe(0)
      expect(r.output, describeRun("the stage failed without showing tsc's TS2322", r)).toContain('TS2322')
      expect(r.output, `no failed typecheck stage rendered\n${r.output}`).toMatch(/✗\s+typecheck · TASK-031/)
      expect(r.output, 'the gate carried on past a failed typecheck').not.toContain(AFTER)
    })
  })

  it('#4c a clean tree PASSES and renders the stage — so #4b is not a stage that always fails', async () => {
    await scenario('tsbridge-tc-4c', async (s) => {
      const f = await typecheckFixture(s, { tsc: 'real' })
      const r = await f.runStage()
      expect(r.code, r.output).toBe(0)
      expect(r.output, `no passing typecheck stage rendered\n${r.output}`).toMatch(/✓\s+typecheck · TASK-031\s/)
      expect(r.output).toContain(AFTER)
    })
  })

  it('#4d the stage starts the compiler through ts_scrubbed: it sees no GIT_*, AGENT_*, BP_* or unprefixed forbidden name', async () => {
    await scenario('tsbridge-tc-4d', async (s) => {
      const f = await typecheckFixture(s, { tsc: 'stub' })
      const r = await f.runStage()
      expect(await f.seenEnv(), `the stage handed the compiler these (null: it never ran)\n${r.output}`).toEqual([])
    })
  })

  it('#4e a project with no tests/package.json SKIPS with a stated reason and starts no compiler', async () => {
    await scenario('tsbridge-tc-4e', async (s) => {
      const f = await typecheckFixture(s, { tsc: 'stub', packageJson: false })
      const r = await f.runStage()
      expect(r.code, r.output).toBe(0)
      expect(r.output).toContain('typecheck · TASK-031')
      expect(r.output, `the skip gave no reason\n${r.output}`).toContain('skipped · no tests/package.json')
      expect(await f.seenEnv(), 'a skipped stage started the compiler').toBeNull()
      expect(r.output).toContain(AFTER)
    })
  })

  it('#4f an uninstalled compiler BLOCKS rather than skipping or fetching one', async () => {
    await scenario('tsbridge-tc-4f', async (s) => {
      // The same argument as the vitest stage's tests/node_modules guard: a skip
      // is a green gate over a check that never ran, and `npx tsc` would fetch an
      // unpinned compiler mid-push.
      const f = await typecheckFixture(s, { tsc: 'none' })
      const r = await f.runStage()
      expect(r.code, `an absent compiler did not block\n${r.output}`).not.toBe(0)
      expect(r.output).toContain('tests/node_modules/.bin/tsc is absent')
      expect(r.output).not.toContain(AFTER)
    })
  })

  it('#5 CI typechecks through the same function: every step that starts tsc goes through ts_typecheck, scrubbed, and fails on a planted error', async (ctx) => {
    const notGithub = await notGithubActions(REPO_ROOT)
    if (notGithub) skipVisibly(ctx, notGithub)
    // WHAT THIS CASE NEEDS FROM ITS ENVIRONMENT. It is stated here because a
    // reviewer's Codex sandbox turned it red twice with a non-zero exit and NO
    // output at all (Jesko, TASK-031 review, S1). The same checkout passed 14/14
    // outside that sandbox, with TMPDIR in ~/.cache and in /dev/shm.
    //   - It must be allowed to EXECUTE this checkout's
    //     tests/node_modules/.bin/tsc: node running typescript/bin/tsc through a
    //     symlink out of the scenario workspace. So node must be on PATH and
    //     runnable there.
    //   - It needs a writable TMPDIR, where the scenario workspace lives.
    // What that sandbox denied is NOT identified, because it could not be
    // reproduced outside it. Inside it, #4b (the same compiler, run by `sh`) and
    // #3 (a step run by `exec bash --noprofile --norc -eo pipefail`, with a stub
    // runner) both passed. Only this combination, a bash-run step starting the
    // real compiler, failed. When TS2322 is missing, the failure now prints the
    // exit code, the signal, the commands and both streams, so a repeat names
    // its cause instead of an empty diff.
    await scenario('tsbridge-tc-5', async (s) => {
      const steps = (await workflowSteps()).filter(
        (step) => typeof step.run === 'string' && /\b(tsc|ts_typecheck)\b/.test(step.run),
      )
      expect(steps.length, 'no workflow step typechecks tests/, so CI passes a type error').toBeGreaterThan(0)
      expect(
        steps.filter((step) => !/(^|\s)ts_typecheck\b/m.test(step.run ?? '')).map((step) => step.name),
        'these steps start tsc themselves rather than through ts_typecheck — a second copy of the command',
      ).toEqual([])

      for (const [i, step] of steps.entries()) {
        const stub = await typecheckFixture(s, { tsc: 'stub', name: `tc5-stub-${i}` })
        const r1 = await stub.runCiStep(step, i)
        expect(
          await stub.seenEnv(),
          describeRun(`step "${step.name}" handed the compiler these (null: it never ran)`, r1),
        ).toEqual([])

        const real = await typecheckFixture(s, { tsc: 'real', planted: true, name: `tc5-real-${i}` })
        const r2 = await real.runCiStep(step, i)
        expect(r2.code, describeRun(`step "${step.name}" passed a planted type error`, r2)).not.toBe(0)
        expect(r2.output, describeRun(`step "${step.name}" failed without showing tsc's TS2322`, r2)).toContain(
          'TS2322',
        )
      }
    })
  })
})

/**
 * BUG-158 — the harness typecheck claimed whatever the PROJECT owns under
 * tests/. The old `include` of every `**\/\*.ts` reached a derived project's
 * own `*.test.ts` there, which imports src/ and the root packages; CI's
 * ts-tests job installs tests/ only, so tsc failed TS2307 there while a host
 * with root node_modules passed the local gate — green locally, red in CI on
 * every push. These run this checkout's REAL tests/tsconfig.json in a fixture
 * with no root node_modules: CI's condition, not the host's.
 */
describe('BUG-158 — the harness typecheck covers what the harness runs, not the project’s own tests', () => {
  const SPEC = "import { helper } from '../helpers/helper.js'\nexport const n: number = helper\n"

  it('#16 a project-owned *.test.ts under tests/ importing a package tests/node_modules lacks does not fail the typecheck', async () => {
    await scenario('tsbridge-bug158', async (s) => {
      const f = await typecheckFixture(s, {
        tsc: 'real',
        realConfig: {
          'demo/demo.spec.ts': SPEC,
          'helpers/helper.ts': 'export const helper: number = 1\n',
          'foo.test.ts': "import { z } from 'bug158-not-installed-in-tests'\nexport const s = z\n",
        },
      })
      const r = await f.runStage()
      expect(
        r.code,
        describeRun('the harness typecheck failed on a project-owned test it does not run', r),
      ).toBe(0)
      expect(r.output).toContain(AFTER)
    })
  })

  it('#17 a type error in a helper that only a spec imports still FAILS — the scope is not narrowed past what the harness runs', async () => {
    // Guards against over-narrowing: passes on the pre-fix config (helper.ts is
    // reached by `**/*.ts` directly) and must keep passing after the include is
    // narrowed (helper.ts is then reached only by import from the spec).
    await scenario('tsbridge-bug158b', async (s) => {
      const f = await typecheckFixture(s, {
        tsc: 'real',
        realConfig: {
          'demo/demo.spec.ts': SPEC,
          'helpers/helper.ts': "export const helper: number = 'not a number'\n",
        },
      })
      const r = await f.runStage()
      expect(r.code, describeRun('a type error in a spec-imported helper passed', r)).not.toBe(0)
      expect(r.output, describeRun("the stage failed without showing tsc's TS2322", r)).toContain('TS2322')
    })
  })
})

describe('TASK-083 — ts_scrubbed redirects a TMPDIR the launchers plant inside a git tree (BUG-110)', () => {
  // TASK-083 has every dispatched agent's launcher set TMPDIR to a path under
  // the repo it runs in, so a plain `npm --prefix tests test` refused every
  // scenario: tests/harness/workspace.ts (BUG-110) refuses any TMPDIR with a
  // project marker (.git and friends) above it. ts_scrubbed is the one choke
  // point both `npm test` and CI's ts-tests step already go through
  // (BUG-117), so it is where the redirect belongs — nowhere else needs to
  // know TASK-083's TMPDIR exists.
  it('#13 a TMPDIR inside a git tree is redirected, and the declared suite still runs', async () => {
    await scenario('tsbridge-83a', async (s) => {
      const f = await fixture(s)
      await f.npx(0)
      // The same marker shape harness.spec.ts's own BUG-110 cases plant: an
      // empty `.git` directly above the TMPDIR this case hands the bridge.
      await s.fs.write('proj/.git', '')
      const badTmp = await s.fs.mkdirp('proj/scratch-tmp')

      const driver = await s.fs.write(
        'run-bridge-83a.sh',
        `cd ${JSON.stringify(f.dir)}\n` +
          `PATH=${JSON.stringify(f.shimPath)}\n` +
          `export PATH\n` +
          `set -e\n` +
          `. ./scripts/lib/pipeline.sh\n` +
          `pipe_init 'ts-bridge fixture' >/dev/null 2>&1 || true\n` +
          `. ./scripts/run-ts-suites.sh\n` +
          `ts_suites_stage ${JSON.stringify(f.dir)}\n`,
      )
      const r = await s.run('sh', [driver], {
        cwd: f.dir,
        env: { TMPDIR: badTmp },
        timeoutMs: 120_000,
      })
      // ts_suites_stage captures the redirect notice into its own temp log
      // and only echoes that log back on a FAILING run (see the comment
      // above ts_suites_stage's `>"$_ts_out" 2>&1`) — deliberately, so a
      // green stage stays quiet. A passing run's only externally visible
      // proof is that the declared suite ran at all: #13b/#13c below pin the
      // notice's own wording directly against ts_scrubbed.
      expect(r.code, r.output).toBe(0)
      expect(
        (await f.seenEnv()) !== null,
        `the stub npx never ran — the declared suite did not run\n${r.output}`,
      ).toBe(true)
    })
  })

  it('#13b the redirect notice names the old and new TMPDIR and BUG-110/TASK-083, and the redirected dir is removed afterward on success and on a failing command', async () => {
    await scenario('tsbridge-83b', async (s) => {
      const dir = await scrubFixture(s, 'scrub-b')
      await s.fs.write('scrub-b/.git', '')
      const badTmp = await s.fs.mkdirp('scrub-b/scratch-tmp')

      const ok = await runScrubbed(s, dir, badTmp, 'printf \'%s\\n\' "$TMPDIR"; mkdir -p "$TMPDIR/probe"')
      expect(ok.code, ok.output).toBe(0)
      // NEVER SILENT (the coordinator's #3): the notice names both the old
      // (git-tree) value and the new one, and the two bugs behind it.
      expect(ok.stderr, ok.output).toContain('BUG-110')
      expect(ok.stderr, ok.output).toContain('TASK-083')
      expect(ok.stderr, ok.output).toContain(badTmp)
      const seenOk = ok.stdout.trim()
      expect(ok.stderr, ok.output).toContain(seenOk)
      expect(seenOk, ok.output).not.toBe(badTmp)
      expect(await pathExists(seenOk), `the redirected dir ${seenOk} survived a successful run\n${ok.output}`).toBe(
        false,
      )

      const failing = await runScrubbed(s, dir, badTmp, 'printf \'%s\\n\' "$TMPDIR"; exit 9')
      expect(failing.code, failing.output).toBe(9)
      const seenFail = failing.stdout.trim()
      expect(seenFail, failing.output).not.toBe(badTmp)
      expect(
        await pathExists(seenFail),
        `the redirected dir ${seenFail} survived a failing run\n${failing.output}`,
      ).toBe(false)
    })
  })

  it('#13c a TMPDIR outside any git tree is left exactly as is', async () => {
    await scenario('tsbridge-83c', async (s) => {
      const dir = await scrubFixture(s, 'scrub-c')
      // No marker anywhere above a scenario workspace — that guarantee is
      // BUG-121's, and this case relies on it rather than restating it.
      const okTmp = await s.workspace.dir('scrub-c-tmp')

      const r = await runScrubbed(s, dir, okTmp, 'printf \'%s\\n\' "$TMPDIR"')
      expect(r.code, r.output).toBe(0)
      expect(r.stdout.trim(), r.output).toBe(okTmp)
      expect(r.stderr, r.output).toBe('')
    })
  })

  it('#13e ts_scrubbed leaves the CALLER shell TMPDIR as it found it, so a second call redirects again (TASK-087)', async () => {
    // ts_scrubbed is sourced and runs in the caller's shell. Assigning TMPDIR
    // there changed it for good: after the redirected dir was removed the
    // caller held a TMPDIR naming nothing, and the next call, finding no
    // marker above it, passed that on. The typecheck stage makes two calls.
    await scenario('tsbridge-87a', async (s) => {
      const dir = await scrubFixture(s, 'scrub-e')
      await s.fs.write('scrub-e/.git', '')
      const badTmp = await s.fs.mkdirp('scrub-e/scratch-tmp')
      const probe = await s.fs.write('scrub-e-probe.sh', 'printf \'%s\\n\' "$TMPDIR"\n')
      const driver = await s.fs.write(
        'scrub-e-driver.sh',
        `cd ${JSON.stringify(dir)}\n` +
          `. ./run-ts-suites.sh\n` +
          `ts_scrubbed sh ${JSON.stringify(probe)} >/dev/null\n` +
          `printf 'caller=%s\\n' "$TMPDIR"\n` +
          `ts_scrubbed sh ${JSON.stringify(probe)}\n`,
      )
      const r = await s.run('sh', [driver], { cwd: dir, env: { TMPDIR: badTmp }, timeoutMs: 60_000 })
      expect(r.code, r.output).toBe(0)
      expect(r.stdout, r.output).toContain(`caller=${badTmp}\n`)
      const second = r.stdout.trim().split('\n').pop() as string
      expect(second, r.output).not.toBe(badTmp)
      expect(second, r.output).not.toBe('')
    })
  })

  // Elias (Codex), reviewing 3d81490: the traps in the redirect branch were
  // set and cleared in ts_scrubbed's OWN shell — but ts_scrubbed is SOURCED,
  // so that shell is the CALLER's, and a caller with its own INT/TERM/HUP
  // trap would have it silently overwritten and then discarded. Every caller
  // today happens to start a fresh shell with no trap of its own, so nothing
  // observed it. The fix wraps the whole redirect branch in a subshell so its
  // traps are structurally local; #13d below is the one behavioural case that
  // survives that fix either way — a real SIGTERM still cleans up and still
  // kills the run by that signal — while a case for "a caller's pre-existing
  // trap survives" would need a black-box way to observe a shell's own trap
  // table from outside it, which does not exist.
  it('#13d a redirected command killed by SIGTERM leaves no /dev/shm dir behind, and the run ends by that signal', async () => {
    await scenario('tsbridge-83d', async (s) => {
      const dir = await scrubFixture(s, 'scrub-d')
      await s.fs.write('scrub-d/.git', '')
      const badTmp = await s.fs.mkdirp('scrub-d/scratch-tmp')
      const seenPath = s.workspace.path('scrub-d-seen-tmpdir')
      // Records the redirected TMPDIR to a FILE, not stdout: the assertion
      // needs to read it well before the process closes, to know when it is
      // safe to signal.
      const probe = await s.fs.write(
        'scrub-d-probe.sh',
        `printf '%s\\n' "$TMPDIR" > ${JSON.stringify(seenPath)}\n` + `exec sleep 30\n`,
      )
      const driver = await s.fs.write(
        'scrub-d-driver.sh',
        `cd ${JSON.stringify(dir)}\n` + `. ./run-ts-suites.sh\n` + `ts_scrubbed sh ${JSON.stringify(probe)}\n`,
      )

      // background(), not run(): run() only resolves once the process has
      // already exited, which is too late to send it a signal.
      const child = s.background('sh', [driver], { cwd: dir, env: { TMPDIR: badTmp } })
      const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.on('close', (code, signal) => resolve({ code, signal }))
      })

      // Wait for the redirect to actually happen before signalling — a kill
      // that lands before ts_scrubbed creates the /dev/shm dir would prove
      // nothing about its cleanup.
      await expect.poll(() => pathExists(seenPath), { timeout: 5000, interval: 20 }).toBe(true)
      const seenTmp = (await readFile(seenPath, 'utf8')).trim()
      expect(seenTmp, 'the probe never saw a redirected TMPDIR').not.toBe(badTmp)

      // -pid, not pid: background() spawns detached (its own process group),
      // exactly so a whole tree like this one — the driver shell, the
      // redirect subshell, the exec'd probe — can be signalled together, the
      // way an external SIGTERM (Ctrl-C, a CI cancellation) would reach all
      // of them at once.
      expect(child.pid, 'background() returned no pid').toBeTypeOf('number')
      process.kill(-(child.pid as number), 'SIGTERM')

      const result = await closed
      expect(result.signal, `the run did not end BY the signal: ${JSON.stringify(result)}`).toBe('SIGTERM')

      // Cleanup runs in the sibling subshell process ts_scrubbed's fix wraps
      // the redirect in, which is free to still be finishing as the driver's
      // own close event fires — poll rather than race it.
      await expect.poll(() => pathExists(seenTmp), { timeout: 5000, interval: 20 }).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// The fixture: a project the bridge will accept.
//
// It needs a `tests/vitest.config.ts`, one suite directory holding a `*.spec.ts`,
// `tests/node_modules`, and the two libs the bridge sources.
//
// THERE IS NO SUITES.md TO BUILD (TASK-020). The bridge's expected set used to
// come from that table and now comes from the filesystem (R1), so the FIXTURE IS
// THE DECLARATION: creating `tests/demo/demo.spec.ts` is what makes `demo` a
// declared suite.
// ---------------------------------------------------------------------------

interface BridgeFixture {
  readonly dir: string
  /** PATH with the stub `npx` first. */
  readonly shimPath: string
  /** A stub `npx` that records the environment it was handed, prints `say` (one line each), then exits `code`. */
  npx(code: number, say?: string | string[]): Promise<void>
  /** The GIT_ / AGENT_ prefixed names the stub saw, or null if it never ran. */
  seenEnv(): Promise<{ names: string[] } | null>
  runBridge(options?: { inject?: string }): Promise<{ code: number | null; output: string }>
}

async function fixture(s: Scenario): Promise<BridgeFixture> {
  const dir = await s.workspace.dir('proj')
  const shims = await s.shimDir('bin')
  const seenPath = s.workspace.path('seen-env')

  for (const lib of ['scripts/lib/pipeline.sh', 'scripts/lib/suites.sh', 'scripts/run-ts-suites.sh']) {
    await s.fs.copyIn(join(REPO_ROOT, lib), `proj/${lib}`)
  }
  await s.fs.write('proj/tests/vitest.config.ts', '')
  await s.fs.write('proj/tests/demo/demo.spec.ts', '')
  // `tests/node_modules` STANDS IN FOR AN INSTALLED PROJECT. The bridge refuses
  // to run when it is absent, because `npx` answers a missing local vitest by
  // FETCHING one from the registry — an unpinned package installed mid-push, past
  // the lockfile that exists to pin it. Every case here is about what the bridge
  // REPORTS once it runs, and npx is stubbed anyway, so without this directory
  // they would all short-circuit on that guard and assert nothing. An empty
  // directory is exactly the right fidelity: it is the condition the guard tests,
  // and this fixture never resolves a real binary.
  await s.fs.mkdirp('proj/tests/node_modules')

  // A SECOND SUITE THAT OWNS NO SPEC, SORTING LAST.
  //
  // `bp_suites_with_spec` used to end its loop on a `find` test, so the LAST suite
  // decided the function's exit status: a final suite without a spec made it
  // return 1 while printing a perfectly correct list — "harmless to the one caller
  // that reads it through `$( )`", except that caller runs under `set -e`, where
  // it was fatal (BUG-055). The first version of this fixture had `demo` alone, so
  // the function returned 0 and every case passed while the real gate died on the
  // real manifest. A fixture that cannot produce the failing input is not a
  // fixture for it. `nospec` sorts after `demo`, which is what puts it last.
  await s.fs.write('proj/tests/nospec/test.sh', '')

  return {
    dir,
    shimPath: shims.path(),

    async npx(code: number, say: string | string[] = []): Promise<void> {
      // One printf per line: POSIX printf does not expand `\n` inside an
      // ARGUMENT, so a single embedded newline would print literally.
      const lines = typeof say === 'string' ? (say ? [say] : []) : say
      // The recording path is HARD-CODED rather than passed through the
      // environment: the bridge unsets every GIT_*/AGENT_* name before invoking
      // the runner, which is the behaviour under test, so a variable is exactly
      // the wrong channel for telling the stub where to write.
      // Records every prefixed name AND every UNPREFIXED_FORBIDDEN name, the
      // latter imported so a new unprefixed hazard is recorded without an edit here.
      const recorded = `(GIT|AGENT|BP)_[A-Za-z0-9_]*|${UNPREFIXED_FORBIDDEN.join('|')}`
      await shims.add(
        'npx',
        `env | sed -nE 's/^(${recorded})=.*/\\1/p' | sort > ${JSON.stringify(seenPath)}\n` +
          `printf 'ran\\n' >> ${JSON.stringify(seenPath)}\n` +
          `echo "stub npx: pretending to be vitest"\n` +
          lines.map((l) => `printf '%s\\n' ${JSON.stringify(l)}\n`).join('') +
          `for a in "$@"; do\n` +
          `  case "$a" in --outputFile=*) out="\${a#--outputFile=}" ;; esac\n` +
          `done\n` +
          // Fractional startTime/endTime, as vitest really reports them — that is
          // what #1e exists for.
          `[ -n "\${out:-}" ] && cat > "$out" <<'JSON'\n` +
          `{"testResults":[{"name":"/tests/demo/demo.spec.ts","status":"passed","startTime":100.5,"endTime":1500.4248}]}\n` +
          `JSON\n` +
          `exit ${code}`,
      )
      await s.fs.rm('seen-env')
    },

    async seenEnv() {
      try {
        const lines = (await readFile(seenPath, 'utf8')).split('\n').filter(Boolean)
        return { names: lines.filter((l) => l !== 'ran') }
      } catch {
        // The stub never ran, so nothing was recorded. null is that answer.
        return null
      }
    },

    async runBridge(options: { inject?: string } = {}) {
      // The environment a real hook is handed — everything git and the gate
      // actually export. The first version of this case set GIT_DIR alone, so it
      // passed a fix that unset four git names and left AGENT_* inherited, and the
      // real push failed again, identically and just as silently. One variable is
      // not a population.
      //
      // Set INSIDE the driver, not through the scenario env, for two reasons: it
      // is what a hook does, and the harness would otherwise — correctly — refuse
      // to hand a child the very variables this case exists to plant. Every decoy
      // points inside the workspace, so nothing can escape even if the scrub
      // fails, and AGENT_FEED_TAG keeps this scenario's escape token so a leak
      // stays attributable (BUG-062).
      // TASK-025 adds four: BLUEPRINT_ROOT (the unprefixed hazard), an
      // undeclared GIT_ALLOW_PROTOCOL and AGENT_TASK025_DECOY (the population a
      // direct run now scrubs by rule), and the declared-inert GIT_AUTHOR_NAME.
      // None can redirect git inside the driver.
      const driver = await s.fs.write(
        'run-bridge.sh',
        `cd ${JSON.stringify(dir)}\n` +
          `PATH=${JSON.stringify(shims.path())}\n` +
          `export PATH\n` +
          decoyExports(dir, s.escapeToken) +
          `set -e\n` +
          `. ./scripts/lib/pipeline.sh\n` +
          `pipe_init 'ts-bridge fixture' >/dev/null 2>&1 || true\n` +
          `. ./scripts/run-ts-suites.sh\n` +
          (options.inject ?? '') +
          `ts_suites_stage ${JSON.stringify(dir)}\n`,
      )
      const r = await s.run('sh', [driver], { cwd: dir, timeoutMs: 120_000 })
      return { code: r.code, output: r.output }
    },
  }
}

/**
 * DRIVER_EXPORTS as shell assignments plus one `export` line. Every decoy points
 * inside `dir`, and AGENT_FEED_TAG keeps the scenario's escape token (BUG-062).
 */
function decoyExports(dir: string, token: string): string {
  const values: Record<(typeof DRIVER_EXPORTS)[number], string> = {
    GIT_DIR: join(dir, '.git-decoy'),
    GIT_INDEX_FILE: join(dir, '.git-decoy/index'),
    GIT_CONFIG_GLOBAL: join(dir, '.gitconfig-decoy'),
    AGENT_FEED_TAG: `${token}-GATE`,
    AGENT_SIGNAL_FILE: join(dir, 'decoy-signal.md'),
    AGENT_STATE_HOME: join(dir, 'decoy-state'),
    BLUEPRINT_ROOT: join(dir, 'decoy-blueprint'),
    GIT_ALLOW_PROTOCOL: 'decoy',
    AGENT_TASK025_DECOY: token,
    GIT_AUTHOR_NAME: 'decoy',
  }
  return (
    DRIVER_EXPORTS.map((k) => `${k}=${JSON.stringify(values[k])}\n`).join('') +
    `export ${DRIVER_EXPORTS.join(' ')}\n`
  )
}

// ---------------------------------------------------------------------------
// The typecheck fixture (TASK-031): a project holding a tests/ tree the bridge's
// typecheck stage accepts, with a real, stub or absent compiler.
// ---------------------------------------------------------------------------

/** What one fixture run did, kept whole so a failed assertion can show all of it. */
interface FixtureRun {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  output: string
  /** The exact commands that ran: the driver, and for a CI step the step's own block. */
  command: string
}

/**
 * The message for an assertion about a fixture run: exit code, signal, the
 * commands, and stdout and stderr separately. A non-zero exit with nothing
 * printed means the compiler never started, and this says so rather than
 * leaving a reviewer an empty `toContain` diff (Jesko, TASK-031 review, S1).
 */
function describeRun(what: string, r: FixtureRun): string {
  const silent = r.stdout.trim() === '' && r.stderr.trim() === ''
  return (
    `${what}\n` +
    `  exit code: ${r.code ?? 'none'}   signal: ${r.signal ?? 'none'}\n` +
    (silent
      ? '  NOTHING was printed on stdout or stderr: the compiler most likely never started.\n' +
        "  See #5's environment note: it must be allowed to execute tests/node_modules/.bin/tsc.\n"
      : '') +
    `--- commands run ---\n${r.command}\n` +
    `--- stdout ---\n${r.stdout}\n` +
    `--- stderr ---\n${r.stderr}`
  )
}

interface TypecheckFixture {
  /** The compiler's recorded GIT_/AGENT_/BP_/unprefixed names, or null if it never ran. */
  seenEnv(): Promise<string[] | null>
  /** Source pipeline.sh and the bridge under `set -e`, as the hook does, and run the stage. */
  runStage(): Promise<FixtureRun>
  /** Run one workflow step exactly as GitHub runs a `run:` block. */
  runCiStep(step: WorkflowStep, i: number): Promise<FixtureRun>
}

async function typecheckFixture(
  s: Scenario,
  opts: {
    tsc: 'real' | 'stub' | 'none'
    planted?: boolean
    packageJson?: boolean
    name?: string
    /**
     * BUG-158: this checkout's REAL tests/tsconfig.json instead of the minimal
     * one, plus these files under tests/. It declares `types: ["node"]`, so the
     * pinned @types tree is linked in too, and nothing else: the fixture has no
     * root node_modules, which is exactly CI's ts-tests job.
     */
    realConfig?: Record<string, string>
  },
): Promise<TypecheckFixture> {
  const name = opts.name ?? 'tc'
  const dir = await s.workspace.dir(name)
  const seenPath = s.workspace.path(`${name}-seen-env`)

  for (const lib of ['scripts/lib/pipeline.sh', 'scripts/run-ts-suites.sh']) {
    await s.fs.copyIn(join(REPO_ROOT, lib), `${name}/${lib}`)
  }
  if (opts.packageJson !== false) await s.fs.write(`${name}/tests/package.json`, '{ "private": true }\n')
  if (opts.realConfig === undefined) {
    // Minimal on purpose: no `types: ["node"]`, so the fixture needs no @types tree.
    await s.fs.write(
      `${name}/tests/tsconfig.json`,
      JSON.stringify({
        compilerOptions: { target: 'ES2022', lib: ['ES2022'], strict: true, noEmit: true, types: [], skipLibCheck: true },
        include: ['**/*.ts'],
      }) + '\n',
    )
    await s.fs.write(`${name}/tests/clean.ts`, 'export const clean: number = 1\n')
  } else {
    await s.fs.copyIn(join(REPO_ROOT, 'tests/tsconfig.json'), `${name}/tests/tsconfig.json`)
    for (const [rel, body] of Object.entries(opts.realConfig)) await s.fs.write(`${name}/tests/${rel}`, body)
    // The real config's `types: ["node"]` resolves @types/node (and vitest's
    // own types, transitively) from here — linked, not copied, same as tsc.
    await s.fs.mkdirp(`${name}/tests/node_modules`)
    const types = await s.run(
      'ln',
      ['-s', join(REPO_ROOT, 'tests/node_modules/@types'), join(dir, 'tests/node_modules/@types')],
      { cwd: dir },
    )
    expect(types.code, types.output).toBe(0)
  }
  if (opts.planted) {
    await s.fs.write(`${name}/tests/planted.ts`, "export const planted: number = 'not a number'\n")
  }
  await s.fs.mkdirp(`${name}/tests/node_modules/.bin`)

  if (opts.tsc === 'stub') {
    await s.fs.write(`${name}/tests/node_modules/.bin/tsc`, `#!/bin/sh\n${recordingStub(seenPath)}`, { mode: 0o755 })
  } else if (opts.tsc === 'real') {
    // THE PINNED COMPILER this checkout installed, linked rather than copied: it
    // loads its lib files relative to its real path.
    const ln = await s.run(
      'ln',
      ['-s', join(REPO_ROOT, 'tests/node_modules/typescript/bin/tsc'), join(dir, 'tests/node_modules/.bin/tsc')],
      { cwd: dir },
    )
    expect(ln.code, ln.output).toBe(0)
  }

  return {
    seenEnv: () => recordedNames(seenPath),
    ...stageDrivers(s, name, dir, `ts_typecheck_stage ${JSON.stringify(dir)}`),
  }
}

/** The GIT_/AGENT_/BP_/unprefixed names a recording stub wrote to `file`, or null if it never ran. */
async function recordedNames(file: string): Promise<string[] | null> {
  try {
    const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean)
    return lines.filter((l) => l !== 'ran')
  } catch {
    // The stub never ran, so nothing was recorded. null is that answer.
    return null
  }
}

/** A recording stub body: the forbidden-prefix names it was handed go to `envFile`, its argv to `argsFile`. */
function recordingStub(envFile: string, argsFile?: string): string {
  const recorded = `(GIT|AGENT|BP)_[A-Za-z0-9_]*|${UNPREFIXED_FORBIDDEN.join('|')}`
  return (
    (argsFile === undefined ? '' : `printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\n`) +
    `env | sed -nE 's/^(${recorded})=.*/\\1/p' | sort > ${JSON.stringify(envFile)}\n` +
    `printf 'ran\\n' >> ${JSON.stringify(envFile)}\n`
  )
}

/**
 * The two ways a fixture runs a bridge stage, shared by the typecheck (TASK-031)
 * and shell lint (TASK-033) fixtures: as the hook does (`set -e`, the renderer
 * and the bridge sourced, then `stageCall`), and as GitHub runs a workflow step.
 * Both export the decoys and keep the whole run for describeRun. `path`, when
 * given, is the child's PATH.
 */
function stageDrivers(s: Scenario, name: string, dir: string, stageCall: string, path?: string) {
  const run = async (file: string, body: string): Promise<FixtureRun> => {
    const driver = await s.fs.write(file, body)
    const r = await s.run('sh', [driver], {
      cwd: dir,
      timeoutMs: 120_000,
      ...(path === undefined ? {} : { env: { PATH: path } }),
    })
    return { code: r.code, signal: r.signal, stdout: r.stdout, stderr: r.stderr, output: r.output, command: body }
  }

  return {
    runStage(): Promise<FixtureRun> {
      return run(
        `${name}-stage.sh`,
        `cd ${JSON.stringify(dir)}\n` +
          decoyExports(dir, s.escapeToken) +
          `set -e\n` +
          `. ./scripts/lib/pipeline.sh\n` +
          `pipe_init '${name} fixture' >/dev/null 2>&1 || true\n` +
          `. ./scripts/run-ts-suites.sh\n` +
          `${stageCall}\n` +
          `echo ${AFTER}\n`,
      )
    },

    async runCiStep(step: WorkflowStep, i: number): Promise<FixtureRun> {
      const script = await s.fs.write(`${name}-ci-step-${i}.sh`, step.run ?? '')
      const r = await run(
        `${name}-ci-driver-${i}.sh`,
        `cd ${JSON.stringify(join(dir, step['working-directory'] ?? '.'))}\n` +
          decoyExports(dir, s.escapeToken) +
          `exec bash --noprofile --norc -eo pipefail ${JSON.stringify(script)}\n`,
      )
      return { ...r, command: `${r.command}# ${script}:\n${step.run ?? ''}` }
    },
  }
}

// ---------------------------------------------------------------------------
// TASK-033 — the shell lint stage: ShellCheck in the gate and in CI, the way
// TASK-031 runs the typecheck.
// ---------------------------------------------------------------------------

const SC_STAGE = 'shellcheck · TASK-033'
/** An unused variable: ShellCheck SC2034, severity WARNING. */
const PLANTED = '#!/bin/sh\nunused=1\n'
/** An unquoted expansion: ShellCheck SC2086, severity INFO, below the stage's threshold. */
const INFO_ONLY = '#!/bin/sh\necho $1\n'

describe('TASK-033 — the gate and CI lint the shipped shell scripts through one scrubbed command', () => {
  it('#6 the managed region of the hook calls sh_lint_stage in live code', async () => {
    // Text, for the one link execution cannot reach, as #4 does for the typecheck.
    const hook = await readFile(join(REPO_ROOT, '.githooks/pre-push-project'), 'utf8')
    const end = hook.search(/^# BLUEPRINT:END/m)
    expect(end, 'the hook has no managed region').toBeGreaterThan(0)
    expect(
      liveCmds(hook.slice(0, end)),
      'the gate never calls the shell lint stage, so a ShellCheck finding pushes green',
    ).toMatch(/^[ \t]*sh_lint_stage[ \t]+"\$BP_CODE_ROOT"[ \t]*$/m)
  })

  it('#6b a planted warning FAILS the stage through the real ShellCheck, names the finding, and stops the gate', async () => {
    await scenario('tsbridge-sc-6b', async (s) => {
      const f = await lintFixture(s, { shellcheck: 'real', tracked: { 'scripts/planted.sh': PLANTED } })
      const r = await f.runStage()
      expect(r.code, describeRun('a ShellCheck warning passed the lint stage', r)).not.toBe(0)
      expect(r.output, describeRun("the stage failed without showing ShellCheck's SC2034", r)).toContain('SC2034')
      expect(r.output, describeRun('no failed lint stage rendered', r)).toMatch(new RegExp(`✗\\s+${SC_STAGE}`))
      expect(r.output, 'the gate carried on past a failed lint').not.toContain(AFTER)
    })
  })

  it('#6c the threshold is WARNING: an info-level finding passes and the stage renders, so #6b is not a stage that always fails', async () => {
    await scenario('tsbridge-sc-6c', async (s) => {
      const f = await lintFixture(s, {
        shellcheck: 'real',
        tracked: { 'scripts/info.sh': INFO_ONLY, '.githooks/hook': '#!/bin/sh\necho ok\n' },
      })
      const r = await f.runStage()
      expect(r.code, describeRun('an info-level finding failed the lint stage', r)).toBe(0)
      expect(r.output, describeRun('no passing lint stage rendered', r)).toMatch(new RegExp(`✓\\s+${SC_STAGE}\\s`))
      expect(r.output).toContain(AFTER)
    })
  })

  it('#6d the set is DERIVED from git — tracked shell files under scripts/ and .githooks/, by extension or shebang — linted at warning, scrubbed', async () => {
    await scenario('tsbridge-sc-6d', async (s) => {
      const f = await lintFixture(s, {
        shellcheck: 'stub',
        tracked: {
          'scripts/a.sh': '#!/bin/sh\necho a\n',
          'scripts/lib/b.sh': 'echo b\n',
          'scripts/cli': '#!/usr/bin/env bash\necho cli\n',
          '.githooks/hook': '#!/bin/sh\necho hook\n',
          'scripts/notes.txt': 'not a script\n',
          'scripts/data': 'no shebang at all\n',
          'docs/elsewhere.sh': '#!/bin/sh\necho outside\n',
        },
        untracked: { 'scripts/untracked.sh': '#!/bin/sh\necho untracked\n' },
      })
      const r = await f.runStage()
      const args = await f.seenArgs()
      expect(args, describeRun('the stage never started ShellCheck', r)).not.toBeNull()
      expect(
        (args ?? []).filter((a) => !a.startsWith('-')).sort(),
        describeRun('the linted set is not the tracked shell files under scripts/ and .githooks/', r),
      ).toEqual(['.githooks/hook', 'scripts/a.sh', 'scripts/cli', 'scripts/lib/b.sh'])
      expect(args, 'the stage does not pin the severity threshold at warning').toContain('--severity=warning')
      expect(await f.seenEnv(), describeRun('the stage handed ShellCheck these', r)).toEqual([])
    })
  })

  it('#6e a missing ShellCheck BLOCKS the gate and prints the install command', async () => {
    await scenario('tsbridge-sc-6e', async (s) => {
      const f = await lintFixture(s, { shellcheck: 'none', tracked: { 'scripts/a.sh': '#!/bin/sh\necho a\n' } })
      const r = await f.runStage()
      expect(r.code, describeRun('a missing ShellCheck did not block', r)).not.toBe(0)
      expect(r.output).toContain('ShellCheck is not installed')
      expect(r.output).toContain('bash scripts/install-toolchain.sh')
      expect(r.output).not.toContain(AFTER)
    })
  })

  it('#7 CI lints through the same function: a step calls sh_lint, hands ShellCheck no scrubbed name, and fails on a planted warning', async (ctx) => {
    const notGithub = await notGithubActions(REPO_ROOT)
    if (notGithub) skipVisibly(ctx, notGithub)
    // Steps are found by `sh_lint`, not by the word `shellcheck`: the step that
    // makes sure ShellCheck is installed names the binary legitimately.
    await scenario('tsbridge-sc-7', async (s) => {
      const steps = (await workflowSteps()).filter(
        (step) => typeof step.run === 'string' && /(^|\s)sh_lint\b/m.test(step.run),
      )
      expect(steps.length, 'no workflow step lints the shell scripts, so CI passes a ShellCheck finding').toBeGreaterThan(0)

      for (const [i, step] of steps.entries()) {
        const stub = await lintFixture(s, {
          shellcheck: 'stub',
          tracked: { 'scripts/a.sh': '#!/bin/sh\necho a\n' },
          name: `sc7-stub-${i}`,
        })
        const r1 = await stub.runCiStep(step, i)
        expect(
          await stub.seenEnv(),
          describeRun(`step "${step.name}" handed ShellCheck these (null: it never ran)`, r1),
        ).toEqual([])

        const real = await lintFixture(s, {
          shellcheck: 'real',
          tracked: { 'scripts/planted.sh': PLANTED },
          name: `sc7-real-${i}`,
        })
        const r2 = await real.runCiStep(step, i)
        expect(r2.code, describeRun(`step "${step.name}" passed a planted ShellCheck warning`, r2)).not.toBe(0)
        expect(r2.output, describeRun(`step "${step.name}" failed without showing SC2034`, r2)).toContain('SC2034')
      }
    })
  })
})

interface LintFixture {
  /** The names ShellCheck's stub was handed, or null if it never ran. */
  seenEnv(): Promise<string[] | null>
  /** The arguments ShellCheck's stub was handed, or null if it never ran. */
  seenArgs(): Promise<string[] | null>
  runStage(): Promise<FixtureRun>
  runCiStep(step: WorkflowStep, i: number): Promise<FixtureRun>
}

/**
 * A git repository whose TRACKED files are `tracked`, plus `untracked` files it
 * never adds, and a real, stub or absent ShellCheck. The bridge and its renderer
 * are copied in UNTRACKED, so they are not part of the set being linted.
 *
 * A REAL ShellCheck is required, not skipped when absent: TASK-033 makes it a
 * requirement of every machine that pushes, and a case that skipped would be a
 * green suite over a lint that never ran.
 */
async function lintFixture(
  s: Scenario,
  opts: {
    shellcheck: 'real' | 'stub' | 'none'
    tracked: Record<string, string>
    untracked?: Record<string, string>
    name?: string
  },
): Promise<LintFixture> {
  const name = opts.name ?? 'lint'
  const repo = await s.gitRepo(name)
  const envFile = s.workspace.path(`${name}-seen-env`)
  const argsFile = s.workspace.path(`${name}-seen-args`)

  for (const lib of ['scripts/lib/pipeline.sh', 'scripts/run-ts-suites.sh']) {
    await s.fs.copyIn(join(REPO_ROOT, lib), `${name}/${lib}`)
  }
  for (const [rel, body] of Object.entries({ ...opts.tracked, ...(opts.untracked ?? {}) })) {
    await s.fs.write(`${name}/${rel}`, body)
  }
  const add = await repo.git(['add', '--', ...Object.keys(opts.tracked)])
  expect(add.code, add.output).toBe(0)

  let path: string | undefined
  if (opts.shellcheck === 'stub') {
    const shims = await s.shimDir(`${name}-bin`)
    await shims.add('shellcheck', recordingStub(envFile, argsFile))
    path = shims.path()
  } else if (opts.shellcheck === 'none') {
    path = await s.pathWithout(['shellcheck'])
  } else {
    const found = await s.run('sh', ['-c', 'command -v shellcheck'], { cwd: repo.dir })
    expect(
      found.code,
      'ShellCheck is not installed on this machine. TASK-033 makes it a requirement of the gate and of this ' +
        'case, which runs the real linter: bash scripts/install-toolchain.sh',
    ).toBe(0)
  }

  return {
    seenEnv: () => recordedNames(envFile),
    async seenArgs() {
      try {
        return (await readFile(argsFile, 'utf8')).split('\n').filter(Boolean)
      } catch {
        // The stub never ran, so nothing was recorded. null is that answer.
        return null
      }
    },
    ...stageDrivers(s, name, repo.dir, `sh_lint_stage ${JSON.stringify(repo.dir)}`, path),
  }
}

// ---------------------------------------------------------------------------
// TASK-083: a bare copy of the bridge, for probing ts_scrubbed's TMPDIR
// redirect directly rather than through a whole stage.
// ---------------------------------------------------------------------------

/** A directory holding nothing but the bridge itself, for a case that calls `ts_scrubbed` directly. */
async function scrubFixture(s: Scenario, name: string): Promise<string> {
  const dir = await s.workspace.dir(name)
  await s.fs.copyIn(join(REPO_ROOT, 'scripts/run-ts-suites.sh'), `${name}/run-ts-suites.sh`)
  return dir
}

/**
 * Source the bridge in `dir` and call `ts_scrubbed sh PROBE` with TMPDIR set
 * to `tmpdir`, where PROBE is `cmd` written to its own file. stdout and
 * stderr come back SEPARATELY (unlike the stage drivers elsewhere in this
 * file), because #13b/#13c need to read what the child actually saw apart
 * from the redirect notice ts_scrubbed prints.
 *
 * `cmd` is a FILE, not a `sh -c` argument: `cmd` reads `$TMPDIR`, and that
 * name has to stay unexpanded until the probe actually runs — inside
 * ts_scrubbed, after the redirect. Splicing `cmd` into `sh -c "..."` through
 * JSON.stringify nests one double-quoted string inside another with no real
 * quoting boundary between them, so the OUTER shell (the driver, before
 * ts_scrubbed even starts) expands `$TMPDIR` early and bakes in the
 * pre-redirect value — which is indistinguishable from the redirect simply
 * not working. Caught by #13b: `mkdir -p "$TMPDIR/probe"` was written INSIDE
 * the driver's own quoting, so it silently created a directory under the OLD
 * TMPDIR while the recorded stdout matched it too — a passing case that would
 * have proven nothing. A plain file has no such boundary to lose.
 */
async function runScrubbed(s: Scenario, dir: string, tmpdir: string, cmd: string) {
  const name = dir.split('/').pop()
  const probe = await s.fs.write(`${name}-probe.sh`, `${cmd}\n`)
  const driver = await s.fs.write(
    `${name}-scrubbed-driver.sh`,
    `cd ${JSON.stringify(dir)}\n` + `. ./run-ts-suites.sh\n` + `ts_scrubbed sh ${JSON.stringify(probe)}\n`,
  )
  return s.run('sh', [driver], { cwd: dir, env: { TMPDIR: tmpdir }, timeoutMs: 60_000 })
}

/** Whether an ABSOLUTE path exists, unscoped — the redirected TMPDIR lives outside every scenario workspace by design (/dev/shm), so `s.fs` cannot see it. */
async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}
