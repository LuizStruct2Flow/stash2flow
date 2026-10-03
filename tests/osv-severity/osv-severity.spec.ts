/**
 * tests/osv-severity/osv-severity.spec.ts — BUG-045.
 *
 * Parallelism class: mockable (each case owns a scenario workspace; the real
 * osv-scanner is never invoked and no network is touched).
 *
 * THE LOCAL SCA GATE AND CI DISAGREED ABOUT WHAT BLOCKS A PUSH.
 * `.githooks/pre-push`'s `_st_osv_scanner` treated ANY non-zero osv-scanner
 * exit that was not the literal string `No package sources found` as a
 * failure — no severity filter at all — while `.github/workflows/security.yml`
 * job `sca` blocked MEDIUM+ (CVSS >= 4.0) only. So a LOW advisory with no
 * upgrade available blocked every local push with no in-gate escape, and the
 * only exit was `--no-verify`. A gate people route around protects nothing
 * (BUG-031, and BUG-045's row says the same).
 *
 * THE FIX MOVES LOCAL **UP** TO CI'S THRESHOLD, NOT CI DOWN. The row is
 * explicit — "do not fix by loosening CI" — and the sentence in
 * `.gitattributes` that reads the other way is the DEFECT STATEMENT, not the
 * intent. Both gates now apply the same jq classification over the same
 * `--format=json` output.
 *
 * WHY THIS ONLY BECAME URGENT AT TASK-018 PHASE 2. The blueprint felt no pain
 * because a repo with no lockfile took the no-op branch. Phase 2 ships
 * `tests/package-lock.json` to every derived project, which removes that
 * exemption everywhere at once — so the day the policy starts applying to
 * everyone is the day it has to be the right policy. Measured by Markus
 * (Security-1) on 2026-09-10: osv-scanner 2.4.0 finds ZERO advisories in that
 * lockfile at every severity, 72 packages, `results: []`, exit 0. Zero findings
 * today is exactly why today was the cheap day to change the policy.
 *
 * WHY THESE CASES ARE TYPESCRIPT AND NOT IN tests/pre-push-scanners.
 * Markus's spec §3.5 proposed adding them to that suite, which already owns an
 * osv-scanner shim. It is a SHELL suite, and the founder's ruling is that all
 * tests are TypeScript — so the cases live here instead. Nothing is duplicated:
 * pre-push-scanners asserts that the scanners RUN and cannot be evaded by PATH
 * manipulation; these assert what the severity POLICY decides once one has run.
 *
 * HOW THE SUBJECT IS OBTAINED, and why that is asserted rather than assumed.
 * The function is extracted from `.githooks/pre-push` by text and sourced, so
 * these cases run the REAL bytes of the real gate rather than a copy. An
 * extractor is a parser, and a parser whose subject changes form goes quiet
 * rather than red — BUG-063 exactly, where a `sed` range stopped matching after
 * a legal refactor and the check began passing over nothing. So #0 pins the
 * extraction itself, and every other case would fail loudly if it returned
 * something empty.
 *
 * MUTATION RECIPE (TASK-018-RULES R6). Each mutant was APPLIED to
 * `.githooks/pre-push` and the suite RUN; the red set is observed.
 *
 *   Mutant A: threshold `>= 4.0` -> `>= 0`, i.e. restore the pre-fix policy
 *     where everything blocks.
 *     Red: #1. The whole point of the change.
 *   Mutant B: threshold `>= 4.0` -> `>= 9.0` (block only CRITICAL) — the
 *     "fix it by making the stage toothless" direction.
 *     Red: #2.
 *   Mutant C: accept any exit code (`-gt 1` -> `-gt 99`), so a crashed scanner
 *     reads as a clean scan.
 *     Red: #3b — AND ONLY AFTER #3b WAS WRITTEN. On the first run mutant C
 *     SURVIVED: #3's payload is malformed JSON, so the completeness predicate
 *     caught it and the exit-code branch was never the thing that fired. The
 *     branch had no test at all and the suite looked like it did. #3b gives it
 *     one — valid JSON, tool-error exit — which is also the more realistic
 *     failure: a scanner that dies partway through can exit non-zero having
 *     already printed a syntactically perfect `{"results": []}`.
 *   Mutant D: tighten the completeness predicate to `(.results|type)=="array"`,
 *     dropping the `or "null"` arm.
 *     Red: #4. This is the one the coordinator warned not to "tidy": with no
 *     package sources osv-scanner 2.4.0 emits `"results": null`, so the
 *     array-only predicate fails CLOSED on a legitimate no-lockfile repo and
 *     blocks a push that should pass.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'

const HOOK = join(REPO_ROOT, '.githooks/pre-push')

/** The real function, lifted out of the real hook. */
async function extractStage(): Promise<string> {
  const text = await readFile(HOOK, 'utf8')
  const start = text.indexOf('_st_osv_scanner(){')
  const end = text.indexOf('\n}\n', start)
  if (start < 0 || end < 0) return ''
  return text.slice(start, end + 3)
}

/**
 * Run `_st_osv_scanner` with a shim osv-scanner that prints `json` and exits
 * `exitCode`. The shim writes to the file named by the hook's `--format=json`
 * redirect — i.e. it just prints to stdout, exactly as the real tool does.
 */
async function runStage(
  s: Scenario,
  json: string,
  exitCode = 1,
): Promise<{ code: number | null; output: string }> {
  const fn = await extractStage()
  const shims = await s.shimDir()
  await shims.add(
    'osv-scanner',
    `cat <<'OSVJSON'\n${json}\nOSVJSON\nexit ${exitCode}`,
  )
  const driver = await s.fs.write(
    'drive.sh',
    `${fn}\n_st_osv_scanner\necho "STAGE_RC=$?"\n`,
  )
  const r = await s.run('sh', [driver], {
    cwd: await s.workspace.dir('repo'),
    env: { PATH: shims.path() },
  })
  const m = /STAGE_RC=(\d+)/.exec(r.output)
  return { code: m ? Number(m[1]) : null, output: r.output }
}

const group = (severity: string) =>
  JSON.stringify({
    results: [
      {
        packages: [
          {
            package: { name: 'left-pad', version: '1.0.0' },
            groups: [{ ids: ['GHSA-test-0001'], max_severity: severity }],
          },
        ],
      },
    ],
  })

describe('BUG-045 — the local SCA gate applies CI’s MEDIUM+ policy, not its own', () => {
  it('#0 the stage is actually extracted from the hook — the other cases are not running over nothing', async () => {
    const fn = await extractStage()
    expect(fn, 'could not extract _st_osv_scanner from .githooks/pre-push').not.toBe('')
    // Pins the two things every case below depends on: the threshold is read
    // from the JSON, and the completeness predicate accepts null. If either is
    // refactored out of recognisable shape this fails HERE, loudly, rather
    // than every case quietly passing over a stage that never ran.
    expect(fn, 'the MEDIUM+ threshold is not in the extracted stage').toContain('>= 4.0')
    expect(fn, 'the results-completeness check is not in the extracted stage').toContain(
      'has("results")',
    )
  })

  it('#1 a sub-MEDIUM advisory does NOT block the push', async () => {
    await scenario('osv-severity-1', async (s) => {
      // The real scanner exits 1 on any finding, so the shim does too. Before
      // the fix that exit code alone blocked the push, whatever the severity.
      const r = await runStage(s, group('3.7'), 1)

      expect(r.code, `a LOW advisory blocked the push:\n${r.output}`).toBe(0)
      expect(r.output).toContain('below MEDIUM')
      // Reported, never swallowed: the operator has to be able to see it and
      // put it in findings.md.
      expect(r.output).toContain('GHSA-test-0001')
    })
  })

  it('#2 a MEDIUM+ advisory still blocks the push', async () => {
    await scenario('osv-severity-2', async (s) => {
      const r = await runStage(s, group('7.5'), 1)

      expect(r.code, `a HIGH advisory did not block the push:\n${r.output}`).not.toBe(0)
      expect(r.output).toContain('MEDIUM+ (CVSS >= 4.0)')
    })
  })

  it('#3 a crashed scanner is NOT a clean scan', async () => {
    await scenario('osv-severity-3', async (s) => {
      // osv-scanner exits 0 clean and 1 with findings; anything else is a tool
      // failure. Coercing that to "no findings" is failing OPEN on the gate
      // that reads our whole dependency tree.
      const r = await runStage(s, 'not json at all', 127)

      expect(r.code, `a scanner crash read as a clean scan:\n${r.output}`).not.toBe(0)
      expect(r.output).toContain('the SCA gate did NOT run')
    })
  })

  it('#3b a tool-error exit is not trusted even when the JSON it printed is well-formed', async () => {
    await scenario('osv-severity-3b', async (s) => {
      // #3 alone does NOT pin the exit-code branch: its payload is malformed,
      // so the jq completeness check catches it and the rc check is never the
      // thing that fired. Measured — mutant C (accept any exit code) SURVIVED
      // until this case existed.
      //
      // The realistic shape is worse than a crash: a scanner that dies partway
      // through — a network failure mid-database-fetch, a permissions error on
      // one manifest — can exit non-zero having already printed a syntactically
      // perfect `{"results": []}`. That reads as "no vulnerabilities" to every
      // check except this one.
      const r = await runStage(s, '{"results": []}', 2)

      expect(r.code, `a tool-error exit with valid JSON read as a clean scan:\n${r.output}`)
        .not.toBe(0)
      expect(r.output).toContain('the SCA gate did NOT run')
    })
  })

  it('#4 no package sources is a PASS, and results:null is how the tool says so', async () => {
    await scenario('osv-severity-4', async (s) => {
      // Verified on osv-scanner 2.4.0: with --allow-no-lockfiles and nothing to
      // scan, `results` is null rather than []. A predicate demanding an array
      // fails closed here and blocks a push that must pass — a template before
      // bootstrap, or a workspace not yet installed.
      const r = await runStage(s, '{"results": null}', 0)

      expect(r.code, `a repo with no lockfile was blocked:\n${r.output}`).toBe(0)
      expect(r.output).not.toContain('did NOT run')
    })
  })
})
