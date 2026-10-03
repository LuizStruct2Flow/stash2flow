/**
 * tests/manifest/fixture.ts — a synthetic blueprint the manifest can be aimed at.
 *
 * WHY A FIXTURE AT ALL, when the real repo is right there. Because a control
 * that only ever runs over a healthy tree proves nothing about what it would
 * say over a broken one — TASK-018-RULES R6: "for every bug a test exists to
 * catch, there is a recorded way to reintroduce it, and doing so must turn a
 * NAMED test red." The real tree is where the live cases run; this is where
 * every check is shown to be capable of failing, one perturbation at a time.
 *
 * It is a MAP OF FILES rather than a builder with options. A perturbation is
 * then `files.set(path, content)` or `files.delete(path)` written out in the
 * case that needs it, which is readable in place and needs no vocabulary. The
 * option-bag version of this had six booleans within an hour.
 *
 * MINIMAL RATHER THAN A COPY OF HEAD, for the reason tests/suite-sync gives for
 * the same choice: the property under test is what the manifest SAYS, and a
 * fixture small enough to read in full is the one where a surprising verdict
 * means what it says. `tests/bootstrap-gate` covers the real tree end to end.
 *
 * ONE FILE IS COPIED IN RATHER THAN INVENTED: `scripts/lib/suites.sh`. The
 * suite derivation has exactly one implementation (see manifest.ts), so a
 * fixture carrying its own would be asserting against a second one.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, type Scenario } from '../harness/index.js'

/**
 * The suites the baseline tree carries.
 *
 * Each owns a `*.spec.ts` and is reached by the blanket vitest run. Since
 * TASK-047 there is no other kind of runner, so the per-suite `bash
 * tests/<s>/test.sh` lines these used to contribute to the gate and the
 * workflow are gone — and with them the perturbations that dropped ONE suite
 * from either, which is not expressible against a blanket run.
 */
export const SUITES = [
  's01',
  's02',
  's03',
  's04',
  's05',
  's06',
  's07',
  's08',
  's09',
  's10',
] as const

/** The one TypeScript suite, reached only through the bridge's blanket run. */
export const TS_SUITE = 'tsone'

/** Declared blueprint-only in `.gitattributes`, so nothing of it may ship. */
export const BP_ONLY_SUITE = 'bponly'

function gate(): string {
  return [
    '#!/bin/sh',
    '# BLUEPRINT:BEGIN',
    // NO SUITE IS NAMED HERE, and that is the point since TASK-047. Every suite
    // is a spec, so the blanket vitest run below is the whole proof that the
    // gate invokes them — which is why manifest.ts checks the CHAIN (the bridge
    // sourced AND called, a run with no path filter, an include glob that
    // reaches the specs) instead of one line per suite.
    // The bridge: sourced by a literal relative path, and CALLED. All three
    // conditions in manifest.ts's liveBridges have to hold or it does not count.
    //
    // INDENTED, and that is not cosmetic — it is what the retired shell control
    // required in order to see a bridge at all (BUG-074). Every source line in
    // this repo's real hooks happens to be indented, which is why the defect
    // stayed latent. The fixture matches reality here so that the equivalence
    // comparison is about the checks rather than about that one bug.
    '  . ./scripts/run-ts-suites.sh',
    '  ts_suites_stage',
    '# BLUEPRINT:END',
  ].join('\n')
}

function workflow(): string {
  // A REAL workflow shape, not just the text #5 greps: #5b parses it the way
  // GitHub does, and a fixture GitHub would reject proves nothing (BUG-115).
  //
  // ONE JOB SINCE TASK-047. The shell-tests job existed to run per-suite `bash
  // tests/<s>/test.sh` lines, and the real workflow's equivalent went with the
  // last shell runner. CI proves invocation the same way the gate does now: a
  // blanket vitest run, which #5 checks through the same chain as #4.
  return [
    'on: push',
    'jobs:',
    '  ts-tests:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: npx vitest run',
  ].join('\n')
}

/**
 * The healthy tree. Every check passes over it; that is asserted first, because
 * a perturbation that turns a check red proves nothing if the check was red to
 * begin with.
 */
export async function baselineTree(): Promise<Map<string, string>> {
  const files = new Map<string, string>()

  files.set('.blueprint-root', '# the positive marker `drift` uses\n')
  files.set('.gitattributes', `tests/${BP_ONLY_SUITE}/   export-ignore\n`)

  // The ONE derivation, copied rather than reimplemented.
  files.set(
    'scripts/lib/suites.sh',
    await readFile(join(REPO_ROOT, 'scripts/lib/suites.sh'), 'utf8'),
  )

  files.set(
    'scripts/run-ts-suites.sh',
    [
      '#!/bin/sh',
      'ts_suites_stage(){',
      // No positional path filter, deliberately — a path-filtered run is how a
      // suite silently stops being executed, and #4 is what refuses it.
      '  npx vitest run',
      '}',
      '',
    ].join('\n'),
  )

  files.set('.githooks/pre-push', '#!/bin/sh\n# BLUEPRINT:BEGIN\n:\n# BLUEPRINT:END\n')
  files.set('.githooks/pre-push-project', `${gate()}\n`)
  files.set('.github/workflows/security.yml', `${workflow()}\n`)

  files.set('tests/package.json', '{\n  "scripts": {\n    "test": "vitest run"\n  }\n}\n')
  files.set('tests/package-lock.json', '{}\n')
  files.set('tests/tsconfig.json', '{}\n')
  files.set(
    'tests/vitest.config.ts',
    "export default { test: { include: ['**/*.spec.ts'] } }\n",
  )
  files.set('tests/harness/index.ts', 'export const harness = true\n')
  files.set('tests/harness/canary.ts', 'export const canary = true\n')

  // Every suite owns a spec, including the blueprint-only one: its tier is a
  // claim about what SHIPS, not about what kind of runner it has, and #2b must
  // still be able to catch it shipping.
  for (const s of SUITES) files.set(`tests/${s}/${s}.spec.ts`, `export const ${s} = true\n`)
  files.set(`tests/${BP_ONLY_SUITE}/${BP_ONLY_SUITE}.spec.ts`, 'export const bponly = true\n')
  files.set(`tests/${TS_SUITE}/${TS_SUITE}.spec.ts`, 'export const spec = true\n')

  return files
}

/**
 * The gate and the workflow as the baseline builds them.
 *
 * They took a SUBSET of suites until TASK-047, so a case could drop one suite
 * from either and watch the control name it. With one blanket run proving every
 * suite, that perturbation is not expressible: there is no per-suite line to
 * remove. What replaced those cases is in manifest.spec.ts, and the reason is
 * recorded there rather than left as two deleted tests.
 */
export const gateFor = gate
export const workflowFor = workflow

/**
 * Write a tree into the scenario's workspace, commit it, and return its root.
 *
 * `postCommit` is applied AFTER the commit, so the working tree and HEAD
 * disagree — which is the only way to express "the tier declares one thing and
 * the archive does another", since #2b reads HEAD and the derivation reads the
 * working tree.
 */
export async function materialize(
  s: Scenario,
  name: string,
  files: Map<string, string>,
  postCommit: Map<string, string | null> = new Map(),
): Promise<string> {
  const repo = await s.gitRepo(name)
  for (const [rel, content] of files) await s.fs.write(join(name, rel), content)
  await repo.commitAll('fixture blueprint')
  for (const [rel, content] of postCommit) {
    if (content === null) await s.fs.rm(join(name, rel))
    else await s.fs.write(join(name, rel), content)
  }
  return repo.dir
}
