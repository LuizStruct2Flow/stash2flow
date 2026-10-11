/**
 * tests/private-values-check.spec.ts — FEATURE-001, slice 1.
 *
 * The repository is public and no tracked file may carry anything about one
 * installation (docs/concept/principles.md#public-repository). The pre-push
 * gate's stage "private values · FEATURE-001" runs
 * scripts/private-values-check.mts over what a push publishes, with the
 * values read from the untracked `.private-values`. This suite drives the
 * script the way the stage does, over fixture repositories, with invented
 * values only.
 *
 * At the top level of tests/ because it is this project's own regression test
 * (tests/manifest #1): every subdirectory is a suite the blueprint ships.
 */

import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { REPO_ROOT, scenario, type Scenario } from './harness/index.js'

const SCRIPT = join(REPO_ROOT, 'scripts/private-values-check.mts')

const ACCOUNT = 'quibblewick@example.test'
const NAME = 'Mablewood'
const LIST = `# invented\n${ACCOUNT}\n${NAME}\n`

/** A repo with the list in place (untracked) and one clean commit. */
async function fixture(s: Scenario, list: string | null = LIST) {
  const repo = await s.gitRepo('project')
  await s.fs.write('project/.gitignore', '.private-values\n')
  await s.fs.write('project/notes.md', 'nothing personal here\n')
  if (list !== null) await s.fs.write('project/.private-values', list)
  await repo.commitAll('base')
  const check = (...ranges: string[]) =>
    s.run('node', [SCRIPT, '--repo', repo.dir, ...ranges.flatMap((r) => ['--range', r])], { cwd: repo.dir })
  return { repo, check }
}

describe('FEATURE-001 — a push carrying a private value is refused', () => {
  it('#1 a value in a tracked file is refused, named by file and line, and never printed in full', async () => {
    await scenario('pv-file', async (s) => {
      const { repo, check } = await fixture(s)
      await s.fs.write('project/notes.md', `nothing personal here\nmail from ${ACCOUNT.toUpperCase()}\n`)
      await repo.commitAll('add a line')
      const r = await check('HEAD~1..HEAD')
      expect(r.code).toBe(1)
      expect(r.output).toContain('notes.md:2')
      expect(r.output).toContain('.private-values:2 (q***t)')
      expect(r.output.toLowerCase()).not.toContain(ACCOUNT)
    })
  })

  it('#2 a value in a commit message is refused, named by commit, and never printed in full', async () => {
    await scenario('pv-message', async (s) => {
      const { repo, check } = await fixture(s)
      const sha = await repo.commitAll(`tidy the ${NAME.toLowerCase()} folder`)
      const r = await check('HEAD~1..HEAD')
      expect(r.code).toBe(1)
      expect(r.output).toContain(`commit ${sha} message`)
      expect(r.output).toContain('.private-values:3 (M***d)')
      expect(r.output.toLowerCase()).not.toContain(NAME.toLowerCase())
    })
  })

  it('#3 a value added in one commit and removed in the next is still refused: it is in the history', async () => {
    await scenario('pv-history', async (s) => {
      const { repo, check } = await fixture(s)
      await s.fs.write('project/notes.md', `nothing personal here\nsee ${NAME}\n`)
      const sha = await repo.commitAll('slip')
      await s.fs.write('project/notes.md', 'nothing personal here\n')
      await repo.commitAll('undo the slip')
      const r = await check('HEAD~2..HEAD')
      expect(r.code).toBe(1)
      expect(r.output).toContain(`commit ${sha} notes.md:2`)
      expect(r.output).not.toContain(NAME)
    })
  })

  it('#4 a clean push passes and says what it checked', async () => {
    await scenario('pv-clean', async (s) => {
      const { repo, check } = await fixture(s)
      await s.fs.write('project/notes.md', 'nothing personal here\nstill nothing\n')
      await repo.commitAll('add a clean line')
      const r = await check('HEAD~1..HEAD')
      expect(r.code).toBe(0)
      expect(r.output).toContain('PASS')
      expect(r.output).toContain('checked 2 tracked file(s) at the tip, 1 commit message(s) and 1 added line(s)')
    })
  })

  it('#5 a letters-only value matches whole words only; an address matches anywhere', async () => {
    await scenario('pv-words', async (s) => {
      const { repo, check } = await fixture(s)
      await s.fs.write('project/notes.md', `a ${NAME}ian pattern, un${NAME}\n`)
      await repo.commitAll('longer words')
      expect((await check('HEAD~1..HEAD')).code).toBe(0)
      await s.fs.write('project/notes.md', `<${ACCOUNT}>\n`)
      await repo.commitAll('an address in brackets')
      expect((await check('HEAD~1..HEAD')).code).toBe(1)
    })
  })

  it('#6 a missing list is reported as NOT CHECKED and does not block', async () => {
    await scenario('pv-missing', async (s) => {
      const { check } = await fixture(s, null)
      const r = await check('HEAD')
      expect(r.code).toBe(0)
      expect(r.output).toContain('NOT CHECKED')
      expect(r.output).toContain('.private-values')
      expect(r.output).not.toContain('PASS')
    })
  })

  it('#7 a list with no value is refused: it exists to check and checked nothing', async () => {
    await scenario('pv-empty', async (s) => {
      const { check } = await fixture(s, '# nothing yet\n\n')
      const r = await check('HEAD')
      expect(r.code).toBe(1)
      expect(r.output).toContain('holds no value')
    })
  })

  it('#8 a value under four characters with a digit or a sign is refused when the list is read, by line, without printing it', async () => {
    await scenario('pv-short', async (s) => {
      const { check } = await fixture(s, `${ACCOUNT}\nab1\n`)
      const r = await check('HEAD')
      expect(r.code).toBe(1)
      expect(r.output).toContain('.private-values:2')
      expect(r.output).toContain('4 is the minimum')
      expect(r.output).not.toContain('ab1')
      await s.fs.write('project/.private-values', `${ACCOUNT}\na-b\n`)
      const signed = await check('HEAD')
      expect(signed.code).toBe(1)
      expect(signed.output).toContain('4 is the minimum')
      expect(signed.output).not.toContain('a-b')
    })
  })

  it('#8b a three-letter word is accepted and found as a whole word only; two letters are refused', async () => {
    await scenario('pv-short-word', async (s) => {
      const { repo, check } = await fixture(s, `${ACCOUNT}\nabc\n`)
      await s.fs.write('project/notes.md', 'abcd and xabc and dabcd\n')
      await repo.commitAll('inside longer words')
      expect((await check('HEAD~1..HEAD')).code).toBe(0)
      await s.fs.write('project/notes.md', 'with ABC here\n')
      await repo.commitAll('the word itself')
      const r = await check('HEAD~1..HEAD')
      expect(r.code).toBe(1)
      expect(r.output).toContain('notes.md:1')
      expect(r.output).toContain('.private-values:2 (a***c)')
      await s.fs.write('project/.private-values', `${ACCOUNT}\nab\n`)
      const two = await check('HEAD')
      expect(two.code).toBe(1)
      expect(two.output).toContain('.private-values:2')
      expect(two.output).toContain('3 is the minimum')
    })
  })

  it('#9 a new branch (bare sha) is judged over its whole history', async () => {
    await scenario('pv-new-branch', async (s) => {
      const { repo, check } = await fixture(s)
      await repo.commitAll(`about ${NAME}`)
      await repo.commitAll('clean on top')
      const tip = (await repo.git(['rev-parse', 'HEAD'])).stdout.trim()
      const r = await check(tip)
      expect(r.code).toBe(1)
      expect(r.output).toContain('3 commit message(s)')
    })
  })

  it('#10 the gate wires the stage after the blueprint marker, and skips with a reason without a list', async () => {
    const hook = await readFile(join(REPO_ROOT, '.githooks/pre-push-project'), 'utf8')
    const own = hook.split('# BLUEPRINT:END')[1] ?? ''
    expect(own).toContain('pipe_stage "private values · FEATURE-001" _st_private_values')
    expect(own).toContain('scripts/private-values-check.mts')
    expect(own).toMatch(/pipe_skip "private values · FEATURE-001" "[^"]*NOT CHECKED/)
  })
})
