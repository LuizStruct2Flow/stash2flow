/**
 * tests/commit-subjects/commit-subjects.ts — is the item rule checked where the
 * commit is actually MADE?
 *
 * TASK-002 (reopened). The `commit-msg` hook works. It is also the only thing
 * that checks the rule, and it is client-side, so it fires on `git commit` and
 * nowhere else. Two doors were open:
 *
 *   * CI ran `tests/commit-msg-gate`, which exercises the HOOK against
 *     FIXTURES and never reads this repository's actual commits. A gate whose
 *     subject is a fixture cannot notice a real violation.
 *   * GitHub composes the squash-merge commit from the PULL REQUEST TITLE, on
 *     its own servers, where no client-side hook can exist.
 *
 * That second door is the one every blueprint change used to go through, and
 * `5fe89e0` went through it: it landed on `main` AFTER the gate shipped, with a
 * subject the hook rejects.
 *
 * WHAT THIS FILE DOES AND DELIBERATELY DOES NOT DO. It checks the WIRING — that
 * one definition of the rule exists, that the hook and the CI checker both reach
 * it rather than carrying copies, and that CI points at the PR title. (That both
 * files travel is structural since TASK-021: what ships is managed.) It does NOT express the rule. The rule is
 * `commit_subject_ok` in `scripts/lib/commit-subject.sh`, it ships as shell
 * because `commit-msg` must run on a machine with no Node, and a TypeScript
 * restatement of it would be the second copy this whole suite exists to forbid.
 * The spec DRIVES the shell library instead.
 */

import { readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { join } from 'node:path'

export interface WiringScan {
  /** #1 — the shared rule exists at the one path everything reaches for. */
  readonly ruleLibPresent: boolean
  /** #3 — the CI checker exists and can be executed. */
  readonly checkerExecutable: boolean
  /** #4 — the hook sources the shared rule rather than carrying its own. */
  readonly hookSourcesRule: boolean
  /** #4 — the hook carries no second copy of the pattern. */
  readonly hookCarriesPatternCopy: boolean
  /** #5 — CI invokes the checker at all. */
  readonly ciInvokesChecker: boolean
  /** #5 — CI checks the PR TITLE, which becomes the squash subject. */
  readonly ciChecksPrTitle: boolean
  /** #5 — the workflow re-runs when the title is EDITED after a green run. */
  readonly ciRerunsOnEdit: boolean
}

/** The rule library and its CI checker. */
export const MUST_TRAVEL = [
  'scripts/lib/commit-subject.sh',
  'scripts/check-commit-subjects.sh',
] as const

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    // A missing file reads as '' and the check reports it absent: fail-closed.
    return ''
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await stat(path)
    await access(path, constants.X_OK)
    return true
  } catch {
    // Not there or not executable: either way false, which the check reports.
    return false
  }
}

export async function scanWiring(root: string): Promise<WiringScan> {
  const hook = await readOrEmpty(join(root, '.githooks/commit-msg'))
  const workflow = await readOrEmpty(join(root, '.github/workflows/security.yml'))

  return {
    ruleLibPresent: (await readOrEmpty(join(root, MUST_TRAVEL[0]))) !== '',
    checkerExecutable: await isExecutable(join(root, MUST_TRAVEL[1])),

    hookSourcesRule: hook.includes('commit-subject.sh'),
    // A LITERAL substring, not a regex, and `includes` rather than a count. The
    // shell version's first draft used `grep -c`, which prints "0" AND exits 1
    // on no match — so `$(grep -c … || echo 0)` yielded "0\n0" and the `-eq`
    // test died on it. A check that cannot say pass or fail is worse than none.
    hookCarriesPatternCopy: hook.includes('(BUG|FEATURE|TASK)#[0-9]'),

    ciInvokesChecker: workflow.includes('check-commit-subjects.sh'),
    ciChecksPrTitle: workflow.includes('pull_request.title'),
    // `edited` is NOT a default `pull_request` activity type, and it is the one
    // that matters: a title edited after the checks pass would otherwise merge
    // unchecked.
    ciRerunsOnEdit: workflow.includes('edited'),
  }
}
