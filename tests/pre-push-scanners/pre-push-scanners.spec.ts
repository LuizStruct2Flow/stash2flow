/**
 * tests/pre-push-scanners/pre-push-scanners.spec.ts — BUG-003: the pre-push
 * security gate must distinguish "the scanner found something" from "the scanner
 * could not run".
 *
 * Parallelism hazard: none. Each case builds its own fixture repo and its own
 * shim directory inside its own scenario workspace; no real scanner is invoked
 * and no network is touched.
 *
 * THE DEFECT. `semgrep … || { echo "found a WARNING+ finding"; exit 1; }` treated
 * EVERY non-zero exit as a finding. semgrep exits 1 for findings and >= 2 for a
 * fatal error, and `--quiet` suppressed the reason entirely. Observed on this
 * repo: identical back-to-back runs alternating exit 0 and exit 2 with zero
 * output, in both bash and sh, while the same command outside the hook always
 * passed. gitleaks had the same conflation.
 *
 * WHY IT MATTERS IN BOTH DIRECTIONS. A broken scanner reported as a vulnerability
 * teaches operators to shrug off the gate, and that shrug is what carries over to
 * a real finding. A gate that cries wolf is a gate people learn to bypass.
 *
 * WHERE THE §3.3 LINE FALLS — AND THIS SUITE IS WHERE IT MATTERS MOST.
 * TASK-018-TARGET §3.3 rules that the pre-push hook's shell ENTRY POINT stays
 * shell permanently: if the gate were TypeScript and `npm ci` had not run, there
 * would be no gate in precisely the state where one is most wanted, and a
 * TypeScript gate cannot report its own absence. `.githooks/pre-push` is that
 * entry point and IS NOT BEING PORTED. What is ported is the suite that tests it.
 * So every case below runs the REAL hook — copied byte-for-byte into the fixture
 * — under `/bin/sh`, with shim scanners on PATH. Nothing here reimplements a
 * stage in TypeScript, and nothing here skips a case on the grounds that its
 * subject is shell.
 *
 * (`tests/osv-severity` is the one place a stage's LOGIC is lifted out of this
 * hook and driven directly. That is a different question — what the severity
 * policy decides once a scan has run — and it is deliberately not duplicated
 * here, where the question is whether the scanners run at all and cannot be
 * evaded by PATH manipulation.)
 *
 * EQUIVALENCE RECORD (R6). The retiring `tests/pre-push-scanners/test.sh` and this
 * spec were run over the healthy repo plus one mutant of `.githooks/pre-push` per
 * assertion group, and the per-case verdict sets diffed mechanically. Table in the
 * migration report.
 *
 * MUTATION RECIPE (R6), each applied to `.githooks/pre-push`:
 *
 *   M1  `_st_semgrep` classifies by EXIT CODE again (rc=1 -> finding, else ok)
 *       Red: #3, R-3, R2-1a, R2-1b. This is BUG-003 restored.
 *   M2  drop the retry entirely
 *       Red: #3-retry-count, #4, #4b.
 *   M3  the retry keeps `--jobs` at its default
 *       Red: #4b.
 *   M4  `.results` length read with `// 0` instead of a schema check
 *       Red: R2-1b.
 *   M5  a non-zero semgrep exit with zero results is accepted as clean
 *       Red: R2-1a.
 *   M6  the tool-failure branch suppresses the scanner's stderr
 *       Red: #3-diagnostic.
 *   M7  `_st_gitleaks` treats rc >= 2 as a finding
 *       Red: #6.
 *   M8  `_st_gitleaks` retries
 *       Red: #6-no-retry.
 *   M9  the gitleaks finding branch hides the scanner's output
 *       Red: #5.
 *   M10 the semgrep finding branch stops printing the rule id
 *       Red: #2.
 *   M11 remove the osv-scanner shim from the fixture (a FIXTURE mutant, not a
 *       hook one — it is the only way to prove the isolation claim #0 makes)
 *       Red: #0.
 *   M12 `_st_semgrep` stops reading `.errors` (BUG-126 restored)
 *       Red: BUG-126 #1, #2, #4.
 *   M13 the shell parse-error policy tolerates every extensionless path
 *       Red: BUG-126 #4.
 *   M14 the CI semgrep step goes back to `semgrep scan --error`
 *       Red: BUG-126 #ci.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { notGithubActions, skipVisibly } from '../helpers/project-config.js'

/**
 * The shim-directory handle, derived from the harness rather than re-declared.
 *
 * `tests/harness/index.ts` does not re-export `ShimDir`, and adding a second
 * declaration of it here would be a copy that drifts — the thing R1 deletes.
 * Deriving it from the method's own return type cannot drift by construction.
 */
type ShimDirLike = Awaited<ReturnType<Scenario['shimDir']>>

const HOOK = join(REPO_ROOT, '.githooks/pre-push')

describe('BUG-003 — scanner failures and scanner findings are distinguished', () => {
  it('#0 fixture isolation holds: the shims win PATH over a hostile ambient binary', async () => {
    await scenario('scanners-0', async (s) => {
      // POSITIVE CONTROL for the fixture's own isolation (Slava, R11).
      //
      // EVERY executable the hook can discover must be under fixture control, not
      // just the ones a case asserts on. The hook probes gitleaks, semgrep AND
      // osv-scanner; only the first two were shimmed originally, so every case
      // silently ran the real osv-scanner off the ambient PATH — a claim made
      // from inspection and refuted by experiment.
      //
      // Adding the shim only helps if the shim dir actually WINS resolution. So
      // prove it adversarially: plant a HOSTILE osv-scanner LATER on PATH that,
      // if ever reached, records a sentinel and exits 1. A clean run must stay
      // green AND leave the sentinel untouched.
      const f = await fixture(s)
      await f.gitleaks([0])
      await f.semgrep(['clean'])

      const hostile = await s.shimDir('hostile')
      const sentinel = s.workspace.path('osv-hostile-was-called')
      await hostile.add(
        'osv-scanner',
        `: >${JSON.stringify(sentinel)}\necho HOSTILE-OSV-REACHED >&2\nexit 1`,
      )

      // Shim dir first, hostile SECOND, real ambient PATH last.
      const r = await f.runHook({ path: `${f.shims.dir}:${hostile.path()}` })

      expect(r.code, `a hostile ambient osv-scanner decided this run\n${r.output}`).toBe(0)
      expect(
        await s.fs.exists('osv-hostile-was-called'),
        'the hostile binary was reachable — the fixture no longer isolates the SCA probe',
      ).toBe(false)
    })
  })

  it('#1 clean scanners → the gate passes', async () => {
    await scenario('scanners-1', async (s) => {
      const f = await fixture(s)
      await f.gitleaks([0])
      await f.semgrep(['clean'])

      const r = await f.runHook()

      expect(r.code, `clean scanners should pass\n${r.output}`).toBe(0)
    })
  })

  it('#2 a semgrep JSON finding blocks, shows the rule, and is not retried', async () => {
    await scenario('scanners-2', async (s) => {
      const f = await fixture(s)
      await f.gitleaks([0])
      await f.semgrep(['finding'])

      const r = await f.runHook()

      expect(r.code, `a JSON result must block\n${r.output}`).not.toBe(0)
      expect(r.output, 'a finding was not labelled a finding').toContain('WARNING+ finding')
      expect(r.output, 'a finding was labelled a tool failure').not.toContain('could not complete')
      expect(r.output, 'the finding blocked but the rule id was not shown').toContain('demo.rule')
      // A real finding is deterministic. Retrying it doubles the slowest stage in
      // the gate for nothing.
      expect(await f.calls('semgrep'), 'a real finding was retried').toBe(1)
    })
  })

  it('#3 a semgrep crash (exit 2) blocks as a TOOL FAILURE, retries once, and surfaces the diagnostic', async () => {
    await scenario('scanners-3', async (s) => {
      const f = await fixture(s)
      await f.gitleaks([0])
      await f.semgrep(['crash2', 'crash2'])

      const r = await f.runHook()

      expect(r.code, `a semgrep tool error must block\n${r.output}`).not.toBe(0)
      expect(r.output, 'a crash was not reported as a scan that did not run').toContain('did NOT run')
      expect(
        r.output,
        'a semgrep tool error was reported as a security finding — the BUG-003 conflation',
      ).not.toContain('WARNING+ finding')
      expect(await f.calls('semgrep'), 'expected exactly 1 call + 1 retry').toBe(2)
      expect(
        r.output,
        'the tool-failure path hid the scanner’s own diagnostic — which is what made the gate untrustworthy in the first place',
      ).toContain('SEMGREP-CRASH-DIAG')
    })
  })

  it('R-3 semgrep exit 1 with NO valid JSON is a tool failure, not a finding', async () => {
    await scenario('scanners-r3', async (s) => {
      // An OSError BEFORE the scan — an unwritable `~/.semgrep` settings dir,
      // observed in review. The exit-code classifier said "exit 1 = finding", so
      // it reported a crash as a vulnerability. Findings must come from semgrep's
      // JSON `results`, which an OSError never produces.
      const f = await fixture(s)
      await f.gitleaks([0])
      await f.semgrep(['oserror', 'oserror'])

      const r = await f.runHook()

      expect(r.code, r.output).not.toBe(0)
      expect(r.output).toContain('did NOT run')
      expect(r.output, 'an OSError was misclassified as a finding').not.toContain('WARNING+ finding')
    })
  })

  it('#4 a transient semgrep failure retries once and passes', async () => {
    await scenario('scanners-4', async (s) => {
      const f = await fixture(s)
      await f.gitleaks([0])
      await f.semgrep(['crash2', 'clean'])

      const r = await f.runHook()

      expect(r.code, `a transient semgrep failure should recover\n${r.output}`).toBe(0)
      expect(r.output, 'it recovered silently — the operator cannot tell a retry happened').toContain(
        'retrying',
      )
      expect(await f.calls('semgrep'), 'transient recovery must use exactly one retry').toBe(2)
    })
  })

  it('#4b the retry drops to --jobs 1 and recovers a parallel-only crash', async () => {
    await scenario('scanners-4b', async (s) => {
      // Mirrors the real failure: semgrep's multi-core engine crashes on
      // `io_uring_queue_init` under a low RLIMIT_MEMLOCK, and `--jobs 1` avoids
      // it. A shim that fails UNLESS invoked single-job passes only if the retry
      // actually dropped parallelism — which pins the CLAIM, not just "it
      // retried".
      const f = await fixture(s)
      await f.gitleaks([0])
      await f.shims.add(
        'semgrep',
        `case " $* " in\n` +
          `  *" --jobs 1 "*) printf '{"version":"1","results":[],"errors":[]}\\n'; exit 0 ;;\n` +
          `esac\n` +
          `echo "SEMGREP-CRASH-DIAG (simulated io_uring)" >&2\n` +
          `printf '{"version":"1","results":[],"errors":[{"level":"error"}]}\\n'\n` +
          `exit 2`,
      )

      const r = await f.runHook()

      // The hook hides scanner stdout on success by design, so the claim is proven
      // through the exit code plus the hook's own message, not the shim's output.
      expect(r.code, `the retry did not recover a parallel-only failure\n${r.output}`).toBe(0)
      expect(r.output, 'the retry did not drop to single-job').toContain('retrying single-job')
    })
  })

  it('R2-1a valid JSON + zero results + non-zero exit is NOT a proven clean scan', async () => {
    await scenario('scanners-r21a', async (s) => {
      // exit 1 is not semgrep's clean exit, so "0 results" cannot be trusted.
      // Classify as incomplete, never clean (Codex R2-1).
      const f = await fixture(s)
      await f.gitleaks([0])
      await f.semgrep(['err1json', 'err1json'])

      const r = await f.runHook()

      expect(r.code, `exit 1 with 0 results was waved through as clean\n${r.output}`).not.toBe(0)
      expect(r.output).toContain('did NOT run')
      expect(r.output).not.toContain('WARNING+ finding')
    })
  })

  it('R2-1b valid JSON whose .results is not an array is incomplete, not zero findings', async () => {
    await scenario('scanners-r21b', async (s) => {
      // The `|| echo 0` fail-open. Exit 0 here proves it is caught by schema
      // validation, independent of the exit code.
      const f = await fixture(s)
      await f.gitleaks([0])
      await f.semgrep(['badschema', 'badschema'])

      const r = await f.runHook()

      expect(r.code, `a malformed results schema was treated as zero findings\n${r.output}`).not.toBe(0)
      expect(r.output).toContain('did NOT run')
      expect(r.output).not.toContain('WARNING+ finding')
    })
  })

  it('#5 gitleaks exit 1 blocks as a SECRET, with its output shown', async () => {
    await scenario('scanners-5', async (s) => {
      const f = await fixture(s)
      await f.gitleaks([1])
      await f.semgrep(['clean'])

      const r = await f.runHook()

      expect(r.code, `gitleaks exit 1 must block\n${r.output}`).not.toBe(0)
      expect(r.output, 'a secret was not labelled a secret').toContain('found a secret')
      expect(r.output, 'a secret was labelled a tool failure').not.toContain('could not complete')
      // BUG-003's diagnosis was that suppressed diagnostics made the gate
      // untrustworthy, so classification alone is not enough to pin.
      expect(r.output, 'it blocked but hid the scanner output').toContain('SIMULATED-FINDING')
    })
  })

  it('#6 gitleaks exit 2 blocks as a TOOL FAILURE and is NOT retried', async () => {
    await scenario('scanners-6', async (s) => {
      // gitleaks is classified but deliberately NOT retried — its failures are
      // local and deterministic (bad config, unreadable repo), unlike semgrep's
      // registry fetch. Claiming an "identical fix" for both overstated parity.
      const f = await fixture(s)
      await f.gitleaks([2])
      await f.semgrep(['clean'])

      const r = await f.runHook()

      expect(r.code, r.output).not.toBe(0)
      expect(r.output, 'a gitleaks tool error was reported as a secret').not.toContain('found a secret')
      expect(r.output).toContain('gitleaks could not complete')
      expect(r.output, 'the tool-failure path hid the diagnostic output').toContain('shim gitleaks call')
      expect(await f.calls('gitleaks'), 'gitleaks was retried; no retry is intended').toBe(1)
    })
  })
})

describe('BUG-126 — a scan semgrep could not finish is not a clean scan', () => {
  // semgrep 1.171.0 over `function broken( {` then `eval("x")` exits 0 with
  // `results: []` and a PartialParsing entry in `errors`. The gate never read
  // `errors`, so it approved a file it had not analysed.
  it('#1 exit 0, zero results and a PartialParsing error blocks, retries once, and names the type and path', async () => {
    await scenario('scanners-bug126-1', async (s) => {
      const f = await fixture(s)
      await f.gitleaks([0])
      await f.semgrep(['partial'])

      const r = await f.runHook()

      expect(r.code, `a partial scan was approved as clean\n${r.output}`).not.toBe(0)
      expect(r.output).not.toContain('WARNING+ finding')
      expect(r.output, 'the block did not name the error type').toContain('PartialParsing')
      expect(r.output, 'the block did not name the unanalysed path').toContain('src/broken.js')
      expect(await f.calls('semgrep'), 'expected exactly 1 call + 1 retry').toBe(2)
    })
  })

  it('#2 a partial scan that completes on the single-job retry passes', async () => {
    await scenario('scanners-bug126-2', async (s) => {
      const f = await fixture(s)
      await f.gitleaks([0])
      await f.semgrep(['partial', 'clean'])

      const r = await f.runHook()

      expect(r.code, r.output).toBe(0)
      expect(r.output).toContain('retrying single-job')
      expect(await f.calls('semgrep')).toBe(2)
    })
  })

  it('#3 parse errors on shell scripts are accepted by the stated policy, visibly and without a retry', async () => {
    await scenario('scanners-bug126-3', async (s) => {
      // semgrep's bash parser rejects valid scripts: 18 of this repo's own
      // shell files, all shellcheck-clean. Blocking on those would block every push.
      const f = await fixture(s)
      await shellTargets(s)
      await f.gitleaks([0])
      await f.semgrep(['shellparse'])

      const r = await f.runHook()

      expect(r.code, `shell parse errors blocked the gate\n${r.output}`).toBe(0)
      expect(r.output, 'the accepted errors were accepted silently').toMatch(/2 shell parse error\(s\) accepted/)
      expect(await f.calls('semgrep')).toBe(1)
    })
  })

  it('#4 the shell policy goes by shebang, not by a missing extension: a node script still blocks', async () => {
    await scenario('scanners-bug126-4', async (s) => {
      const f = await fixture(s)
      await shellTargets(s)
      await f.gitleaks([0])
      await f.semgrep(['nodeparse'])

      const r = await f.runHook()

      expect(r.code, `a parse error on a node script was accepted\n${r.output}`).not.toBe(0)
      expect(r.output).toContain('scripts/node-tool')
    })
  })

  it('#5 an error entry the gate cannot decode is incomplete, not zero unaccepted errors', async () => {
    await scenario('scanners-bug126-5', async (s) => {
      // Alex's finding 1. `errors: [42]` cannot be indexed, so jq wrote nothing,
      // the empty output read as "no unaccepted errors", and the gate PASSED
      // claiming one accepted shell parse error. jq's own exit status was ignored.
      const f = await fixture(s)
      await f.gitleaks([0])
      await f.semgrep(['errnumber'])

      const r = await f.runHook()

      expect(r.code, `an undecodable error list was approved\n${r.output}`).not.toBe(0)
      expect(r.output).not.toContain('WARNING+ finding')
      expect(r.output, 'the block did not say the error list could not be read').toMatch(/could not be (read|decoded)/)
      expect(await f.calls('semgrep'), 'expected exactly 1 call + 1 retry').toBe(2)
    })
  })

  it('#5b an error whose type and path are objects is incomplete too', async () => {
    await scenario('scanners-bug126-5b', async (s) => {
      const f = await fixture(s)
      await f.gitleaks([0])
      await f.semgrep(['errobject'])

      const r = await f.runHook()

      expect(r.code, `an error with object-valued fields was approved\n${r.output}`).not.toBe(0)
      expect(r.output).not.toContain('WARNING+ finding')
    })
  })

  it('#6 the interpreter is parsed: a node script behind env -S blocks', async () => {
    await scenario('scanners-bug126-6', async (s) => {
      // Alex's finding 2. The predicate searched anywhere after `#!` for sh, bash
      // or dash, so `#!/usr/bin/env -S node --require /tmp/bash` matched on the
      // REQUIRE argument and a node file was accepted as shell.
      const f = await fixture(s)
      await shellTargets(s)
      await f.gitleaks([0])
      await f.semgrep(['envnode'])

      const r = await f.runHook()

      expect(r.code, `a node script was accepted as shell\n${r.output}`).not.toBe(0)
      expect(r.output).toContain('scripts/env-node')
    })
  })

  it('#6b the joined spelling -Snode blocks as well', async () => {
    await scenario('scanners-bug126-6b', async (s) => {
      const f = await fixture(s)
      await shellTargets(s)
      await f.gitleaks([0])
      await f.semgrep(['envnodejoined'])

      const r = await f.runHook()

      expect(r.code, `-Snode was read as a shell header\n${r.output}`).not.toBe(0)
      expect(r.output).toContain('scripts/env-node-joined')
    })
  })

  it('#6c real shell headers keep their acceptance: a flag, env -S, env assignments', async () => {
    await scenario('scanners-bug126-6c', async (s) => {
      // The other half of finding 2: tightening the predicate must not start
      // blocking the scripts the policy exists to accept.
      const f = await fixture(s)
      await shellTargets(s)
      await f.gitleaks([0])
      await f.semgrep(['envshell'])

      const r = await f.runHook()

      expect(r.code, `a real shell header stopped being accepted\n${r.output}`).toBe(0)
      expect(r.output).toMatch(/3 shell parse error\(s\) accepted/)
    })
  })

  it('#ci the workflow semgrep step applies the same classification', async (ctx) => {
    const notGithub = await notGithubActions(REPO_ROOT)
    if (notGithub) skipVisibly(ctx, notGithub)
    await scenario('scanners-bug126-ci', async (s) => {
      // `semgrep scan --error` fails on findings only. The step is EXECUTED, as
      // GitHub runs a `shell: bash` block, over the payloads the hook cases use.
      const wf = parseDocument(
        await readFile(join(REPO_ROOT, '.github/workflows/security.yml'), 'utf8'),
      ).toJS() as { jobs?: Record<string, { steps?: { run?: string }[] }> }
      const runs = Object.values(wf.jobs ?? {})
        .flatMap((job) => job.steps ?? [])
        .flatMap((step) => (typeof step.run === 'string' && /\bsemgrep\s+scan\b/.test(step.run) ? [step.run] : []))
      expect(runs.length, 'expected exactly one workflow step running semgrep scan').toBe(1)

      const f = await fixture(s)
      await shellTargets(s)
      const script = await s.fs.write('ci-semgrep.sh', runs[0] ?? '')
      // The step's JSON must land outside the tree it scans: written into the
      // checkout, semgrep scans its own half-written output and reports a Syntax
      // error on it (seen in the real image, 2026-09-16).
      const tree = async (): Promise<string> =>
        (await s.run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: f.dir })).output
      const before = await tree()
      const cases: [SemgrepMode, boolean][] = [
        ['clean', true],
        ['shellparse', true],
        ['partial', false],
        ['nodeparse', false],
        ['finding', false],
        ['oserror', false],
        ['badschema', false],
        ['err1json', false],
        // Alex's findings 1 and 2, against the workflow block as well as the
        // hook: the two copies of the policy must agree on every payload.
        ['errnumber', false],
        ['errobject', false],
        ['envnode', false],
        ['envnodejoined', false],
        ['envshell', true],
      ]
      for (const [mode, passes] of cases) {
        await f.shims.add('semgrep', `mode=${mode}\n${SEMGREP_MODES}`)
        const driver = await s.fs.write(
          `ci-driver-${mode}.sh`,
          `cd ${JSON.stringify(f.dir)}\n` +
            `PATH=${JSON.stringify(f.shims.path())}\nexport PATH\n` +
            `exec bash --noprofile --norc -eo pipefail ${JSON.stringify(script)}\n`,
        )
        const r = await s.run('sh', [driver], { cwd: f.dir, timeoutMs: 60_000 })
        if (passes) expect(r.code, `CI failed a ${mode} scan\n${r.output}`).toBe(0)
        else expect(r.code, `CI passed a ${mode} scan\n${r.output}`).not.toBe(0)
        if (mode === 'partial') expect(r.output, 'CI did not name the unanalysed path').toContain('src/broken.js')
        expect(await tree(), `the ${mode} run wrote into the scanned tree`).toBe(before)
      }
    })
  })
})

describe('BUG-136 — a failed osv-scanner run surfaces its own diagnostic', () => {
  // .githooks/pre-push used to redirect osv-scanner's stderr to /dev/null, so a
  // tool failure only ever said "could not complete (exit N)" — CI run
  // 35220731328 hit exit 127 and the log could not say why (osv.dev
  // unreachable, most likely, but unprovable from the gate's own output).
  it('#1 exit 127 blocks as a TOOL FAILURE and surfaces the scanner\'s own stderr', async () => {
    await scenario('scanners-bug136-1', async (s) => {
      const f = await fixture(s)
      await f.gitleaks([0])
      await f.semgrep(['clean'])
      await f.shims.add(
        'osv-scanner',
        `echo "OSV-SCANNER-DIAG (simulated: osv.dev unreachable)" >&2\nexit 127`,
      )

      const r = await f.runHook()

      expect(r.code, `an osv-scanner tool error must block\n${r.output}`).not.toBe(0)
      expect(r.output).toContain('could not complete')
      expect(
        r.output,
        "the tool-failure path hid osv-scanner's own diagnostic — the BUG-136 defect",
      ).toContain('OSV-SCANNER-DIAG')
    })
  })

  it('#2 a clean osv-scanner run stays quiet, same as before the fix', async () => {
    await scenario('scanners-bug136-2', async (s) => {
      const f = await fixture(s)
      await f.gitleaks([0])
      await f.semgrep(['clean'])
      // fixture()'s default osv-scanner shim already emits a clean `{"results":[]}`.

      const r = await f.runHook()

      expect(r.code, r.output).toBe(0)
      expect(r.output, 'a clean scan printed diagnostic noise').not.toContain('OSV-SCANNER-DIAG')
      expect(r.output, 'a clean scan printed a tool-failure message').not.toContain('could not complete')
    })
  })
})

describe('TASK-053 — a push that changes only .md files skips the code stages', () => {
  /**
   * Commit `files` on top of a base commit and run the hook with the real ref
   * line for that range, so the hook decides from what is actually pushed.
   */
  async function pushOf(s: Scenario, files: Record<string, string>) {
    return pushWith(s, async (git, commit) => {
      const base = await git('rev-parse', 'HEAD')
      const head = await commit(files)
      return `refs/heads/main ${head} refs/heads/main ${base}\n`
    })
  }

  /**
   * Commit the fixture as a base, let `build` shape history, and run the hook
   * with the ref lines `build` returns.
   */
  async function pushWith(
    s: Scenario,
    build: (
      git: (...args: string[]) => Promise<string>,
      commit: (files: Record<string, string>) => Promise<string>,
    ) => Promise<string>,
  ) {
    const f = await fixture(s)
    await f.gitleaks([0])
    await f.semgrep(['clean'])
    const git = async (...args: string[]) => {
      const r = await s.run('git', args, { cwd: f.dir })
      expect(r.code, `git ${args.join(' ')}\n${r.output}`).toBe(0)
      return r.stdout.trim()
    }
    const commit = async (files: Record<string, string>) => {
      for (const [path, body] of Object.entries(files)) await s.fs.write(`repo/${path}`, body)
      await git('add', '--', ...Object.keys(files))
      await git('commit', '-q', '-m', 'change')
      return git('rev-parse', 'HEAD')
    }
    await git('add', '-A')
    await git('commit', '-q', '-m', 'base')

    const refs = await s.fs.write('refs.txt', await build(git, commit))
    const driver = await s.fs.write(
      'run-hook.sh',
      `exec sh .githooks/pre-push origin git@example.com:x/y.git < ${JSON.stringify(refs)}\n`,
    )
    const r = await s.run('sh', [driver], { cwd: f.dir, env: { PATH: f.shims.path() }, timeoutMs: 120_000 })
    return { ...r, gitleaks: await f.calls('gitleaks'), semgrep: await f.calls('semgrep') }
  }

  it('#text-1 only .md changed: gitleaks runs, semgrep and the code stages skip as text-only', async () => {
    await scenario('scanners-text-1', async (s) => {
      const r = await pushOf(s, { 'CLAUDE.md': 'rules\n', 'docs/a.md': 'a\n' })

      expect(r.code, r.output).toBe(0)
      expect(r.gitleaks, `the secret scan must still run on a text-only push\n${r.output}`).toBeGreaterThan(0)
      expect(r.semgrep, `semgrep ran on a text-only push\n${r.output}`).toBe(0)
      expect(r.output).toContain('text-only push')
    })
  })

  it('#text-2 one non-.md file in the push takes the FULL gate', async () => {
    await scenario('scanners-text-2', async (s) => {
      const r = await pushOf(s, { 'docs/a.md': 'a\n', 'scripts/x.sh': 'echo x\n' })

      expect(r.code, r.output).toBe(0)
      expect(r.semgrep, `a push changing a script skipped semgrep\n${r.output}`).toBe(1)
      expect(r.output).not.toContain('text-only push')
    })
  })

  const expectFull = (r: { code: number | null; output: string; semgrep: number }, why: string) => {
    expect(r.code, r.output).toBe(0)
    expect(r.semgrep, `${why}\n${r.output}`).toBe(1)
    expect(r.output).not.toContain('text-only push')
  }

  it('#text-3 two refs in one push: one ref range cannot hide the other ref code commit', async () => {
    await scenario('scanners-text-3', async (s) => {
      const r = await pushWith(s, async (git, commit) => {
        const a = await git('rev-parse', 'HEAD')
        const b = await commit({ 'app.js': 'new\n' })
        const c = await commit({ 'README.md': 'docs\n' })
        return `refs/heads/one ${b} refs/heads/one ${a}\nrefs/heads/two ${c} refs/heads/two ${b}\n`
      })
      expectFull(r, 'the A..B code range was hidden by the B..C lower bound')
    })
  })

  it('#text-4 a non-fast-forward update takes the FULL gate', async () => {
    await scenario('scanners-text-4', async (s) => {
      const r = await pushWith(s, async (git, commit) => {
        const a = await git('rev-parse', 'HEAD')
        const b = await commit({ 'app.js': 'new\n' })
        await git('checkout', '-q', a)
        const c = await commit({ 'README.md': 'docs\n' })
        return `refs/heads/main ${c} refs/heads/main ${b}\n`
      })
      expectFull(r, 'a force push dropping app.js was classified text-only')
    })
  })

  it('#text-5 a new branch takes the FULL gate, even with only .md in its history', async () => {
    await scenario('scanners-text-5', async (s) => {
      const r = await pushWith(s, async (git, commit) => {
        await git('checkout', '-q', '--orphan', 'docs')
        await git('rm', '-r', '-q', '--cached', '.')
        const c = await commit({ 'README.md': 'docs\n' })
        return `refs/heads/docs ${c} refs/heads/docs ${'0'.repeat(40)}\n`
      })
      expectFull(r, 'a new branch was classified text-only')
    })
  })
})

describe('TASK-040 — the IaC stages find infrastructure/ as well as infra/', () => {
  it('#iac-1 a project with infrastructure/cdk.json reaches the CDK synth stage', async () => {
    await scenario('scanners-iac-1', async (s) => {
      // storm2flow keeps its CDK app in infrastructure/. The hook looked only in
      // infra/, so the synth stage was skipped and the gate still said PASSED.
      const f = await fixture(s)
      await f.gitleaks([0])
      await f.semgrep(['clean'])
      await s.fs.write('repo/infrastructure/cdk.json', '{}\n')
      const cwdLog = s.workspace.path('cdk-cwd')
      await f.shims.add('cdk', `pwd >${JSON.stringify(cwdLog)}\nexit 0`)

      const r = await f.runHook()

      expect(r.code, r.output).toBe(0)
      expect(await s.fs.exists('cdk-cwd'), `cdk synth never ran for infrastructure/\n${r.output}`).toBe(true)
      expect((await readFile(cwdLog, 'utf8')).trim(), 'cdk synth ran outside infrastructure/').toMatch(
        /\/infrastructure$/,
      )
    })
  })

  it('#iac-2 an EMPTY infra/ does not hide the recipes in infrastructure/', async () => {
    await scenario('scanners-iac-2', async (s) => {
      // The layout Alex ran: both directories exist, only one holds anything.
      // Detection took the first that existed, so every recipe went unchecked
      // and the gate exited 0 without a skip line — the silence TASK-040 closes.
      const f = await fixture(s)
      await f.gitleaks([0])
      await f.semgrep(['clean'])
      await s.fs.mkdirp('repo/infra')
      await s.fs.write('repo/infrastructure/cdk.json', '{}\n')
      await s.fs.write('repo/infrastructure/main.tf', 'terraform {\n}\n')
      await s.fs.mkdirp('repo/infrastructure/.terraform')
      await s.fs.write('repo/infrastructure/charts/demo/Chart.yaml', 'name: demo\n')

      // Each shim records its working directory AND its arguments, because the
      // three stages address the tree differently: cdk and terraform `cd` into
      // it, while helm stays at the repo root and passes the chart path.
      const logs: Record<string, string> = {}
      for (const tool of ['cdk', 'terraform', 'helm']) {
        logs[tool] = s.workspace.path(`${tool}-log`)
        await f.shims.add(
          tool,
          `pwd >>${JSON.stringify(logs[tool])}\nprintf '%s\\n' "$@" >>${JSON.stringify(logs[tool])}\nexit 0`,
        )
      }
      const logOf = async (tool: string): Promise<string> => readFile(logs[tool] as string, 'utf8')

      const r = await f.runHook()

      expect(r.code, `the gate failed on a valid mixed layout\n${r.output}`).toBe(0)
      for (const tool of ['cdk', 'terraform', 'helm']) {
        expect(
          await s.fs.exists(`${tool}-log`),
          `${tool} never ran: an empty infra/ hid infrastructure/\n${r.output}`,
        ).toBe(true)
        expect((await logOf(tool)).split('\n'), `${tool} ran against the empty infra/`).not.toContain(
          join(f.dir, 'infra'),
        )
      }
      // cdk and terraform run INSIDE the tree.
      for (const tool of ['cdk', 'terraform']) {
        expect((await logOf(tool)).trim(), `${tool} ran outside infrastructure/`).toMatch(/\/infrastructure$/m)
      }
      // helm lints from the repo root, naming the chart — the working directories
      // Alex confirmed as correct, so this asserts the argument instead.
      expect(await logOf('helm'), 'helm linted a chart outside infrastructure/').toMatch(
        /infrastructure\/charts\/demo/,
      )
    })
  })
})

// ---------------------------------------------------------------------------
// The fixture: a repo the hook can run in and exit quickly.
//
// No backend/ or frontend/, no pre-push-project, no IaC — so the hook reaches the
// scanner section and then falls straight through. Shims make the scanners
// instant and deterministic rather than waiting for a flake to recur.
// ---------------------------------------------------------------------------

interface ScannerFixture {
  readonly dir: string
  readonly shims: ShimDirLike
  /** A shim whose Nth call exits with `codes[N-1]`; the last code repeats. */
  gitleaks(codes: number[]): Promise<void>
  /** A semgrep shim playing one MODE per call; the last mode repeats. */
  semgrep(modes: SemgrepMode[]): Promise<void>
  /** How many times a shim was invoked. */
  calls(name: string): Promise<number>
  runHook(options?: { path?: string }): Promise<{ code: number | null; output: string }>
}

type SemgrepMode =
  | 'clean'
  | 'finding'
  | 'crash2'
  | 'err1json'
  | 'badschema'
  | 'oserror'
  | 'partial'
  | 'shellparse'
  | 'nodeparse'
  | 'errnumber'
  | 'errobject'
  | 'envnode'
  | 'envnodejoined'
  | 'envshell'

/** The targets BUG-126's shell policy reads the shebang of. */
async function shellTargets(s: Scenario): Promise<void> {
  await s.fs.write('repo/scripts/x.sh', 'echo x\n')
  await s.fs.write('repo/scripts/tool', '#!/usr/bin/env bash\necho tool\n')
  await s.fs.write('repo/scripts/node-tool', '#!/usr/bin/env node\nconsole.log(1)\n')
  // Alex's finding 2: a header whose REAL interpreter is node, wearing a shell
  // name further along the line. Both spellings of env's --split-string.
  await s.fs.write(
    'repo/scripts/env-node',
    '#!/usr/bin/env -S node --require /tmp/bash\nconsole.log(1)\n',
  )
  await s.fs.write(
    'repo/scripts/env-node-joined',
    '#!/usr/bin/env -Snode --require /tmp/bash\nconsole.log(1)\n',
  )
  // Shell headers that must KEEP their acceptance: a direct one with a flag, an
  // env one behind -S, and one behind an env assignment and -u.
  await s.fs.write('repo/scripts/direct-sh', '#!/bin/sh -e\necho hi\n')
  await s.fs.write('repo/scripts/env-dash', '#!/usr/bin/env -S dash -e\necho hi\n')
  await s.fs.write('repo/scripts/env-assign', '#!/usr/bin/env -u FOO BAR=1 bash\necho hi\n')
}

async function fixture(s: Scenario): Promise<ScannerFixture> {
  const repo = await s.gitRepo('repo')
  const shims = await s.shimDir('bin')
  const callsDir = await s.workspace.dir('calls')

  await s.fs.copyIn(HOOK, 'repo/.githooks/pre-push')
  await s.fs.chmod('repo/.githooks/pre-push', 0o755)

  // FEATURE-002: the hook sources the pipeline renderer, and a missing renderer
  // fails the push CLOSED — deliberately. Leaving it out of the fixture turns
  // every case into "the hook could not start", which is what happened when this
  // was first wired: seventeen assertions failed for one missing file.
  await s.fs.copyIn(join(REPO_ROOT, 'scripts/lib/pipeline.sh'), 'repo/scripts/lib/pipeline.sh')
  // BUG-126: the SAST stage sources the verdict policy, and the #ci case runs
  // the workflow step in this same directory, which EXECUTES it. Without it the
  // stage fails closed and every case here blocks for the wrong reason.
  await s.fs.copyIn(join(REPO_ROOT, 'scripts/semgrep-verdict.sh'), 'repo/scripts/semgrep-verdict.sh')
  await s.fs.write('repo/.claude/settings.json', '{\n  "permissions": {\n    "allow": []\n  }\n}\n')

  // A NEUTRAL osv-scanner, EMITTING WHAT A CLEAN SCAN ACTUALLY LOOKS LIKE.
  // It used to be a bare `exit 0`, which was faithful while the stage judged
  // osv-scanner by its exit code alone. BUG-045 made the stage read
  // `--format=json` and apply CI's MEDIUM+ threshold, so a scan that prints
  // nothing is now — correctly — a TOOL FAILURE: "trust an empty document" is the
  // fail-open the new stage refuses. This is the shim catching up with the
  // contract, not a weakened assertion.
  await shims.add('osv-scanner', `echo '{"results":[]}'\nexit 0`)

  const counted = (name: string, decide: string): string =>
    `CALLS=${JSON.stringify(join(callsDir, name))}\n` +
    `n=$(cat "$CALLS" 2>/dev/null || echo 0)\n` +
    `n=$((n+1))\n` +
    `echo "$n" >"$CALLS"\n` +
    decide

  return {
    dir: repo.dir,
    shims,

    async gitleaks(codes: number[]): Promise<void> {
      await shims.add(
        'gitleaks',
        counted(
          'gitleaks',
          `case "$n" in\n${pick(codes, (c) => `code=${c}`)}\nesac\n` +
            `echo "shim gitleaks call $n exiting $code"\n` +
            `[ "$code" = "1" ] && echo "SIMULATED-FINDING"\n` +
            `exit "$code"`,
        ),
      )
    },

    async semgrep(modes: SemgrepMode[]): Promise<void> {
      await shims.add(
        'semgrep',
        counted(
          'semgrep',
          `case "$n" in\n${pick(modes, (m) => `mode=${m}`)}\nesac\n` + SEMGREP_MODES,
        ),
      )
    },

    async calls(name: string): Promise<number> {
      try {
        return Number((await readFile(join(callsDir, name), 'utf8')).trim())
      } catch {
        // No counter file means the stub was never called.
        return 0
      }
    },

    async runHook(options: { path?: string } = {}) {
      const r = await s.run('sh', ['.githooks/pre-push'], {
        cwd: repo.dir,
        env: { PATH: options.path ?? shims.path() },
        timeoutMs: 120_000,
      })
      return { code: r.code, output: r.output }
    },
  }
}

/**
 * A `case` body selecting the Nth element, with the LAST one repeating.
 *
 * Generated as a `case` rather than the shell suite's `set -- … ; eval` because
 * the eval form captured `$#` at heredoc-write time, not at shim runtime — which
 * is why that suite needed a separate, uncounted osv-scanner shim to sidestep its
 * own repeat branch. A `case` has no such hazard and reads as what it does.
 */
function pick<T>(values: T[], render: (v: T) => string): string {
  const last = values[values.length - 1]
  if (last === undefined) throw new Error('pick(): needs at least one value')
  const arms = values
    .slice(0, -1)
    .map((v, i) => `  ${i + 1}) ${render(v)} ;;`)
    .join('\n')
  return `${arms}${arms ? '\n' : ''}  *) ${render(last)} ;;`
}

/**
 * The payloads, in the shapes the real tool emits. The hook classifies from
 * semgrep's `--json` output, so the SHAPE is the fixture — an exit code alone
 * cannot express the distinctions R2-1a and R2-1b are about.
 */
const SEMGREP_MODES = `case "$mode" in
  clean)     printf '{"version":"1","results":[],"errors":[]}\\n'; exit 0 ;;
  finding)   printf '{"version":"1","results":[{"check_id":"demo.rule","path":"x.py","start":{"line":7}}],"errors":[]}\\n'; exit 1 ;;
  crash2)    echo "SEMGREP-CRASH-DIAG (simulated io_uring)" >&2; printf '{"version":"1","results":[],"errors":[{"level":"error"}]}\\n'; exit 2 ;;
  err1json)  echo "SEMGREP-CRASH-DIAG (error, exit 1, valid JSON)" >&2; printf '{"version":"1","results":[],"errors":[{"level":"error"}]}\\n'; exit 1 ;;
  badschema) printf '{"version":"1","results":"not-an-array"}\\n'; exit 0 ;;
  oserror)   echo "Traceback (most recent call last):" >&2; echo "PermissionError: settings.yml" >&2; exit 1 ;;
  partial)   printf '{"version":"1.171.0","results":[],"errors":[{"code":3,"level":"warn","type":["PartialParsing",[{"path":"src/broken.js","start":{"line":1,"col":1,"offset":0},"end":{"line":2,"col":10,"offset":28}}]],"message":"Syntax error at line src/broken.js:1","path":"src/broken.js"}]}\\n'; exit 0 ;;
  shellparse) printf '{"version":"1.171.0","results":[],"errors":[{"code":3,"level":"warn","type":["PartialParsing",[{"path":"scripts/x.sh","start":{"line":1,"col":1,"offset":0},"end":{"line":1,"col":4,"offset":3}}]],"message":"Syntax error at line scripts/x.sh:1","path":"scripts/x.sh"},{"code":3,"level":"warn","type":"Syntax error","message":"Syntax error at line scripts/tool:1","path":"scripts/tool"}]}\\n'; exit 0 ;;
  nodeparse) printf '{"version":"1.171.0","results":[],"errors":[{"code":3,"level":"warn","type":"Syntax error","message":"Syntax error at line scripts/node-tool:1","path":"scripts/node-tool"}]}\\n'; exit 0 ;;
  errnumber) printf '{"version":"1.171.0","results":[],"errors":[42]}\\n'; exit 0 ;;
  errobject) printf '{"version":"1.171.0","results":[],"errors":[{"code":3,"level":"warn","type":{"kind":"odd"},"path":{"file":"src/x.js"}}]}\\n'; exit 0 ;;
  envnode)   printf '{"version":"1.171.0","results":[],"errors":[{"code":3,"level":"warn","type":"Syntax error","message":"Syntax error at line scripts/env-node:2","path":"scripts/env-node"}]}\\n'; exit 0 ;;
  envnodejoined) printf '{"version":"1.171.0","results":[],"errors":[{"code":3,"level":"warn","type":"Syntax error","message":"Syntax error at line scripts/env-node-joined:2","path":"scripts/env-node-joined"}]}\\n'; exit 0 ;;
  envshell)  printf '{"version":"1.171.0","results":[],"errors":[{"code":3,"level":"warn","type":"Syntax error","path":"scripts/direct-sh"},{"code":3,"level":"warn","type":["PartialParsing",[{"path":"scripts/env-dash"}]],"path":"scripts/env-dash"},{"code":3,"level":"warn","type":"Syntax error","path":"scripts/env-assign"}]}\\n'; exit 0 ;;
esac`
