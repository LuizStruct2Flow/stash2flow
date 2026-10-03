/**
 * tests/git-isolation/git-isolation.ts — BUG-014, and the discovery predicate
 * that IS the control.
 *
 * Git EXPORTS `GIT_DIR` (and can export `GIT_WORK_TREE` / `GIT_INDEX_FILE`) to
 * every hook it runs. The pre-push gate runs the shell suites, so every suite
 * inherits it — and `cd` does not protect you: with `GIT_DIR` set, git ignores
 * the working directory and operates on the directory that variable names. A
 * fixture's commit lands in the REAL repository.
 *
 * Not theoretical and not small. On 2026-08-02 the blueprint's own `.git/config`
 * was rewritten at 12:40:15 — `core.bare = true`, `core.hooksPath` wiped — and
 * BUG-004 recorded it as done by "an unrelated process it could not identify".
 * It was this. The suite that exists to prove the gate arms is what disarmed it,
 * and the ungated push of `fdae0e2` follows directly.
 *
 * WHY THE PREDICATE IS THE WHOLE VALUE (BUG-047). It used to be
 * `grep -q 'git init' "$f"`, which was wrong in BOTH directions at once:
 *
 *   * IT MISSED CODE. `commit-subjects:195` was `git -C "$T6" init -q` — no
 *     `git init` substring anywhere in it — while that suite was provably
 *     rewriting a victim repository's config. `bootstrap-identity` never typed
 *     `git init` at all, because `scripts/new-project.sh` did it for them.
 *   * IT MATCHED PROSE. The suites it did find included ones whose only hit was
 *     a COMMENT: `branch-guard`'s header said "this suite runs `git init`" while
 *     its code was `git -C "$1" init -q -b main`. Membership of a safety control
 *     was decided by what comments SAY rather than by what code DOES.
 *
 * So: strip comments FIRST, and ask the broader, honest question — does this file
 * drive git at all, directly or through `new-project.sh` — rather than guessing
 * at one spelling of one subcommand. Over-inclusion is the safe direction:
 * asking a suite that only runs `git --version` for one `unset` line costs
 * nothing and can never be wrong, whereas every under-inclusion is a suite free
 * to corrupt a real repository.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Does this file drive git at all, directly or through the bootstrap script? */
const DRIVES_GIT = /(^|[^A-Za-z0-9_./-])(git|new-project\.sh)([ \t]|$)/m

/**
 * Does it defend itself by unsetting the repo pointer?
 *
 * The shell wrote this as `unset +[A-Z_ ]*GIT_DIR`, where ` +` and the space
 * inside the class both match the same whitespace — ambiguous, and super-linear
 * under backtracking on a long line. Rewritten so each space is consumed by
 * exactly one part of the pattern. It accepts the same inputs: `unset GIT_DIR`,
 * `unset FOO GIT_DIR`, `unset GIT_DIR GIT_WORK_TREE`; and refuses the same ones,
 * including `unset -v GIT_DIR`, since `-` was never in the class.
 */
const UNSETS_GIT_DIR = /unset(?:[ \t]+[A-Z_]+)*[ \t]+GIT_DIR/

export interface GitIsolationScan {
  /** Every `*.sh` under `tests/<suite>/` that was considered. */
  readonly considered: readonly string[]
  /** Those that drive git, and are therefore in scope. */
  readonly members: readonly string[]
  /** Members that do NOT unset GIT_DIR — the finding. */
  readonly naked: readonly string[]
}

/** Comments stripped BEFORE anything is decided. This is the BUG-047 half. */
const codeOnly = (source: string): string =>
  source
    .split('\n')
    .map((line) => line.replace(/#.*/, ''))
    .join('\n')

/**
 * Walk `tests/<suite>/*.sh`, exactly the glob the shell control used.
 *
 * Deliberately NOT recursive past one level, and not including `tests/*.sh`: a
 * runner sitting directly in `tests/` belongs to no suite and executes nowhere,
 * which is `tests/manifest` #1's business rather than this one's.
 */
export async function scanGitIsolation(testsDir: string): Promise<GitIsolationScan> {
  const considered: string[] = []
  const members: string[] = []
  const naked: string[] = []

  const suites = (await readdir(testsDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && e.name !== 'node_modules')
    .map((e) => e.name)
    .sort()

  for (const suite of suites) {
    for (const name of (await readdir(join(testsDir, suite))).sort()) {
      if (!name.endsWith('.sh')) continue
      const rel = `${suite}/${name}`
      considered.push(rel)

      const code = codeOnly(await readFile(join(testsDir, suite, name), 'utf8'))
      if (!DRIVES_GIT.test(code)) continue

      members.push(rel)
      if (!UNSETS_GIT_DIR.test(code)) naked.push(rel)
    }
  }

  return { considered, members, naked }
}

/**
 * The gate strips the variables AT THE SOURCE.
 *
 * The hook is where they enter, so unsetting once there covers every suite the
 * gate will ever run — including ones written after this check. Layer two of a
 * deliberate belt-and-braces: each suite unsets them as well, so a suite invoked
 * from any other hook context is safe on its own.
 */
export async function hookUnsetsGitDir(hookPath: string): Promise<boolean> {
  try {
    return UNSETS_GIT_DIR.test(codeOnly(await readFile(hookPath, 'utf8')))
  } catch {
    // An unreadable hook cannot be shown to unset GIT_DIR, so false is the honest answer.
    return false
  }
}

/**
 * Suites proven BY EXECUTION to write into a victim repository when GIT_DIR is
 * set — the anchors that make the discovery predicate checkable.
 *
 * THE LIST IS INTERSECTED WITH DISK, NOT ASSERTED AGAINST IT, and that is the
 * change TASK-018 forced. `bootstrap-identity` was the fourth anchor and is a
 * `*.spec.ts` now, and `commit-subjects` is going the same way. An
 * anchor list that must all exist turns every retirement into a red gate, which
 * is a test failing for the opposite of a defect. What still holds is the half
 * that would actually have caught BUG-047: an anchor that IS on disk must be
 * discovered by the predicate.
 *
 * A spec does not need an anchor and cannot have one. `tests/harness/env.ts`
 * refuses to start any scenario while a forbidden variable is present, so the
 * hazard is structurally absent rather than remembered (TASK-018-RULES R3);
 * `tests/harness/harness.spec.ts` and `tests/ts-bridge` are where that
 * guarantee is tested.
 *
 * THE LIST IS ONLY THE SUITES ACTUALLY REPRODUCED AGAINST A VICTIM. `state-dir`
 * was added to it while porting and then removed: under the harness environment
 * it aborts in ~0.3 s instead of its usual ~30 s, so executing it proves the
 * victim survived a suite that never reached the code that would have written.
 * An anchor whose run is not known to exercise the hazard is false confidence,
 * which is the whole failure mode BUG-047 and BUG-074 are about.
 */
export const DECLARED_ANCHORS = ['marker-merge', 'gate-arming', 'commit-subjects'] as const
