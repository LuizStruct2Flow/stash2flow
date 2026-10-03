/**
 * tests/live-state-canary/live-state-canary.spec.ts — TASK-021 §5.5 R1-R3.
 *
 * THE SHAPE THIS EXISTS TO KILL. Three suites guarded this repo's live state
 * with a comparison that GUARDED ITSELF OUT when the watched file was absent:
 *
 *     _real_before=""
 *     [ -f "$_real_signal" ] && _real_before="$(cat "$_real_signal")"
 *     ...
 *     if [ -n "$_real_before" ] && [ "$_real_before" != "$(cat …)" ]; then
 *
 * Absent file → empty snapshot → the `-n` conjunct is false → the assertion is
 * skipped → the suite prints `#0 … no fixture reached live state`. A green
 * about a file it never read. `tests/pipeline` #19 had the same shape spelled
 * as an explicit `else pass "no real feed present to pollute"`, and
 * `tests/watcher-liveness` #7 as a `had_live_lock` sentinel.
 *
 * That is not hypothetical. Reproduced by running the exact guard lines with an
 * identical induced leak in both layouts: FAIL today, `pass` once the resolved
 * path moved, with the real baton reading `Holder | LEAKED-BY-FIXTURE`.
 *
 * The disarm conjuncts are deleted in place. The assertions that REPLACE them
 * are new coverage, so they live here in TypeScript rather than being appended
 * to a `test.sh`.
 *
 * WHY A POSITIVE CANARY AND NOT JUST A PRECONDITION (R3). A guard that has
 * never been shown to fire is not a guard. `tests/state-dir` #6b is the
 * precedent — it proves the decoy environment is genuinely hostile so that a
 * green #8 cannot be green by accident. #3 below does the same job: it induces
 * the leak and requires the comparison to catch it.
 *
 * MUTATION RECIPE (R6) — observed red, not predicted:
 *   Restore the `[ -n "$before" ] &&` conjunct in the comparison under test.
 *   → #3 goes red: the induced leak is no longer detected.
 *
 * DISSOLVED CASE — `#4 the three disarm conjuncts are gone from the suites that
 * carried them` (removed 2026-09-11, TASK-018).
 *
 * It `readFile`d `tests/baton-durability/test.sh`, `tests/pipeline/test.sh` and
 * `tests/watcher-liveness/test.sh` and asserted, structurally, that none had its
 * disarm conjunct back. Its SUBJECT was those three files. The shell-runner
 * retirement deletes all three, so the case does not become weaker — it becomes
 * about nothing, and `readFile` turns ENOENT into a red for the opposite of a
 * defect. Same disposition as `tests/manifest` #4/#5 in TASK-018-TARGET §4: not
 * satisfied by the migration, DISSOLVED by it. Recorded rather than silently
 * dropped, following the `drift-in-blueprint` precedent.
 *
 * WHAT IS NOT LOST WITH IT, and the reason this is a dissolution rather than a
 * coverage cut: the case guarded against the SHAPE returning in a fourth shell
 * suite copying one of the three. With no shell suite left to copy it into,
 * there is no fourth. The property itself — a live-state guard that disarms when
 * the watched file is absent — is what #3 above proves is CAUGHT, by inducing
 * the leak rather than by grepping for the anti-pattern, and #3 stands.
 *
 * WHAT THE REPLACEMENT MUST NOT BE: an iteration over "whatever `*.sh` still
 * exist". That is a vacuous pass wearing the old name — green over an empty
 * list, and BUG-066's shape exactly.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'

const STATE_LIB = join(REPO_ROOT, 'scripts', 'lib', 'state-dir.sh')

/**
 * Resolve a live-state path exactly as production does, from a given code root
 * — INCLUDING the once-per-script `BP_STATE_ROOT` init.
 *
 * Omitting that init is not a shortcut: `agent_signal_file` returns 9 without
 * it, by design, because a consumer that never resolved a state root must not
 * silently derive one at first use. The first version of this helper skipped
 * the init and got exactly that 9 back, which is the contract working.
 */
async function resolveLive(s: Scenario, fn: string, codeRoot: string) {
  const init = `BP_CODE_ROOT="${codeRoot}"; BP_STATE_ROOT="$(bp_state_root)" || exit 9`
  return s.run(
    'sh',
    ['-c', `env -u AGENT_STATE_HOME -u AGENT_SIGNAL_FILE sh -c '. "${STATE_LIB}"; ${init}; ${fn}'`],
    { cwd: REPO_ROOT },
  )
}

describe('TASK-021 §5.5 — the live-state canaries cannot pass vacuously', () => {
  it('#1 R1 the resolved live root is the repository root and carries its marker', async () => {
    await scenario('canary-1', async (s) => {
      const r = await resolveLive(s, 'bp_state_root', join(REPO_ROOT, 'scripts'))
      expect(r.code).toBe(0)
      expect(r.stdout.trim()).toBe(REPO_ROOT)

      // …and it really is a project root, not merely a directory that existed.
      //
      // ANY of the three accepted terminators, not `.blueprint-root`. This
      // suite SHIPS, so it also runs inside every derived project — where
      // `.blueprint-root` is deliberately absent (it is export-ignore'd, and
      // its whole job is to distinguish the blueprint from its descendants).
      // The first version asserted that one file and failed the derived
      // project's own gate under tests/bootstrap-gate #3, which is precisely
      // the check that exists to catch a suite that only works here.
      const terminators = ['.blueprint-root', '.blueprint-source', '.git']
      const found: string[] = []
      for (const t of terminators) {
        const ok = await readFile(join(REPO_ROOT, t), 'utf8').then(
          () => true,
          // a `.git` DIRECTORY is EISDIR on read, which is still a terminator
          (e: NodeJS.ErrnoException) => e.code === 'EISDIR',
        )
        if (ok) found.push(t)
      }
      expect(found, `no accepted terminator at ${REPO_ROOT}`).not.toEqual([])
    })
  })

  it('#2 R2 the watched baton resolves UNDER that root, from a nested code root', async () => {
    // The failure this pins: a canary anchored on its own `../..` watches
    // `<code root>/logs/state/signal.md`, which after the scaffolding/ split is
    // a file that does not exist — so it snapshots nothing and asserts nothing.
    await scenario('canary-2', async (s) => {
      const nested = join(REPO_ROOT, 'scripts', 'lib')
      const sig = await resolveLive(s, 'agent_signal_file', nested)
      expect(sig.code).toBe(0)
      expect(sig.stdout.trim()).toBe(join(REPO_ROOT, 'logs', 'state', 'signal.md'))

      const jrn = await resolveLive(s, 'agent_signal_journal', nested)
      expect(jrn.stdout.trim()).toBe(join(REPO_ROOT, 'logs', 'state', 'signal-history.log'))
    })
  })

  it('#3 R3 the comparison DETECTS an induced leak — and detects it when the file was absent', async () => {
    /**
     * The positive canary. Runs the guard's own comparison over a fixture
     * target, twice:
     *
     *   (a) target exists, then a leak lands       → must report the leak
     *   (b) target ABSENT, then a leak creates it  → must ALSO report the leak
     *
     * (b) is the case the deleted `[ -n "$before" ]` conjunct silently passed,
     * and it is the one that matters: a canary pointed at the wrong root sees
     * exactly (b) on every run.
     *
     * Everything happens inside the scenario workspace. The real baton is never
     * touched — the harness's own RealStateCanary asserts that afterwards.
     */
    await scenario('canary-3', async (s) => {
      const dir = await s.fs.mkdirp('live')
      const target = join(dir, 'signal.md')

      // The comparison under test, with the disarm conjunct REMOVED.
      const guard = `
        before=""
        [ -f "$T" ] && before="$(cat "$T")"
        printf 'Holder | LEAKED-BY-FIXTURE\\n' > "$T"     # the induced leak
        if [ "$before" != "$(cat "$T" 2>/dev/null)" ]; then echo LEAK-DETECTED; else echo no-leak; fi
      `

      // (a) the target exists beforehand
      await s.fs.write('live/signal.md', 'Holder | Christian\n')
      const withFile = await s.run('sh', ['-c', `T="${target}"; ${guard}`], { cwd: dir })
      expect(withFile.stdout.trim()).toBe('LEAK-DETECTED')

      // (b) the target does NOT exist beforehand — the vacuity case
      await s.fs.rm('live/signal.md')
      const withoutFile = await s.run('sh', ['-c', `T="${target}"; ${guard}`], { cwd: dir })
      expect(withoutFile.stdout.trim()).toBe('LEAK-DETECTED')

      // And the DISARMED form is genuinely blind to (b) — otherwise #3 proves
      // nothing about why the conjunct had to go.
      const disarmed = guard.replace(
        'if [ "$before" !=',
        'if [ -n "$before" ] && [ "$before" !=',
      )
      await s.fs.rm('live/signal.md')
      const blind = await s.run('sh', ['-c', `T="${target}"; ${disarmed}`], { cwd: dir })
      expect(blind.stdout.trim()).toBe('no-leak')
    })
  })

})
