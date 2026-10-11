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
import type { FixtureRepo } from './harness/fixture-repo.js'

const SCRIPT = join(REPO_ROOT, 'scripts/private-values-check.mts')
// The default target is always the real hook. The override exists so the
// commented-out-stage mutation from the code review can be demonstrated
// against a temporary copy without ever touching the real file.
const HOOK = process.env.PV_CHECK_HOOK ?? join(REPO_ROOT, '.githooks/pre-push-project')

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

/**
 * Register the fixture with a made-up blueprint that ships `managed`, so the
 * check's `blueprint files` call (the project's own CLI, copied in) reads that
 * checkout through BLUEPRINT_ROOT and nothing goes near the network.
 */
async function withBlueprint(s: Scenario, repo: FixtureRepo, managed: string[]) {
  const blueprint = await s.gitRepo('blueprint')
  for (const f of managed) await s.fs.write(`blueprint/${f}`, 'shipped by the blueprint\n')
  await blueprint.commitAll('blueprint tip')
  await s.fs.copyIn(join(REPO_ROOT, 'scripts/blueprint.mts'), 'project/scripts/blueprint.mts')
  await s.fs.write(
    'project/.blueprint-source',
    'config_version = 2\nbootstrap_sha = 0000000\nbootstrap_date = 2026-01-01\n' +
      'blueprint_remote = git@example.test:owner/blueprint.git\nblueprint_branch = main\n',
  )
  for (const f of managed) await s.fs.write(`project/${f}`, 'shipped by the blueprint\n')
  await repo.commitAll('register with the blueprint')
  const env = { BLUEPRINT_ROOT: blueprint.dir }
  const check = (range: string, overrides = env) =>
    s.run('node', [SCRIPT, '--repo', repo.dir, '--range', range], { cwd: repo.dir, env: overrides })
  return check
}

describe('FEATURE-001 — a push carrying a private value is refused', () => {
  const MANAGED = 'scripts/lib/shipped.sh'

  it('#11 a value in a blueprint-managed file is not reported and is counted as exempt; the same value in a project-owned file is refused', async () => {
    await scenario('pv-managed', async (s) => {
      const { repo } = await fixture(s)
      const check = await withBlueprint(s, repo, [MANAGED])
      await s.fs.write(`project/${MANAGED}`, `shipped by the blueprint\nsee ${NAME}\n`)
      await repo.commitAll('a pull adds a line')
      const clean = await check('HEAD~1..HEAD')
      expect(clean.code).toBe(0)
      expect(clean.output).toContain('1 file(s) exempt as blueprint-managed, 2 hit(s) in them suppressed')
      expect(clean.output).not.toContain(NAME)
      await s.fs.write('project/notes.md', `nothing personal here\nsee ${NAME}\n`)
      await repo.commitAll('a line of our own')
      const own = await check('HEAD~1..HEAD')
      expect(own.code).toBe(1)
      expect(own.output).toContain('notes.md:2')
      expect(own.output).not.toContain(`${MANAGED}:2`)
      expect(own.output).toContain('1 file(s) exempt as blueprint-managed, 1 hit(s) in them suppressed')
    })
  })

  it('#12 a value in a commit message is refused even when the commit touches only managed files', async () => {
    await scenario('pv-managed-message', async (s) => {
      const { repo } = await fixture(s)
      const check = await withBlueprint(s, repo, [MANAGED])
      await s.fs.write(`project/${MANAGED}`, 'shipped by the blueprint\nand one more line\n')
      const sha = await repo.commitAll(`tidy the ${NAME.toLowerCase()} folder`)
      const r = await check('HEAD~1..HEAD')
      expect(r.code).toBe(1)
      expect(r.output).toContain(`commit ${sha} message`)
      expect(r.output).toContain('1 file(s) exempt as blueprint-managed')
    })
  })

  it('#13 when the managed set cannot be determined nothing is exempt, the summary says why, and the value in the managed file is refused', async () => {
    await scenario('pv-managed-unknown', async (s) => {
      const { repo } = await fixture(s)
      const check = await withBlueprint(s, repo, [MANAGED])
      await s.fs.write(`project/${MANAGED}`, `shipped by the blueprint\nsee ${NAME}\n`)
      await repo.commitAll('a pull adds a line')
      const r = await check('HEAD~1..HEAD', { BLUEPRINT_ROOT: await s.fs.mkdirp('empty') })
      expect(r.code).toBe(1)
      expect(r.output).toContain(`${MANAGED}:2`)
      expect(r.output).toContain('0 file(s) exempt as blueprint-managed: the managed set could not be determined')
      expect(r.output).not.toContain(NAME)
    })
  })

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
      expect(r.output).toContain('checked 2 tracked file(s) (contents and paths) at the tip, 1 commit message(s), 1 added line(s) and 0 added-or-renamed path(s)')
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

  it('#10 the gate stage really runs: the hook is exercised, and commenting the stage out is caught', async () => {
    await scenario('pv-gate-wiring', async (s) => {
      const hook = await readFile(HOOK, 'utf8')
      // The stage must live in the project-owned region, after the blueprint marker.
      const own = hook.split('# BLUEPRINT:END')[1] ?? ''
      expect(own).toContain('private values · FEATURE-001')

      // Shims stand in for the gate machinery (the renderer, push_log_opts,
      // node). What is proven here is not their behaviour but the stage's:
      // sourcing the hook must schedule the stage, and running the stage must
      // invoke the check — which a raw-text search cannot see, because a
      // commented-out pipe_stage line still contains the string.
      const driver = await s.fs.write(
        'gate/driver.sh',
        [
          'pipe_stage() { echo "STAGE:$1"; "$2"; }',
          'pipe_skip() { echo "SKIP:$1 :: $2"; }',
          'push_log_opts() { echo "HEAD"; }',
          'node() { echo "NODE:$*"; }',
          'BP_CODE_ROOT="$1"',
          '. "$BP_CODE_ROOT/pre-push-project"',
          '',
        ].join('\n'),
      )
      const runHook = (dir: string) => s.run('sh', [driver, dir], { cwd: dir })

      const live = await s.fs.mkdirp('gate/live')
      await s.fs.write('gate/live/pre-push-project', hook)
      await s.fs.write('gate/live/.private-values', 'present so the stage is armed\n')
      const armed = await runHook(live)
      expect(armed.code).toBe(0)
      expect(armed.output).toContain('STAGE:private values · FEATURE-001')
      expect(armed.output).toMatch(/NODE:.*scripts\/private-values-check\.mts --repo .* --range HEAD/)

      await s.fs.rm('gate/live/.private-values')
      const noList = await runHook(live)
      expect(noList.code).toBe(0)
      expect(noList.output).not.toContain('STAGE:private values · FEATURE-001')
      expect(noList.output).toContain('SKIP:private values · FEATURE-001')
      expect(noList.output).toContain('NOT CHECKED')

      // The mutation the review predicted: the stage commented out. The
      // exercise must lose it — the raw-text assertions above would still pass.
      const muted = hook.replace(
        'pipe_stage "private values · FEATURE-001" _st_private_values',
        '# pipe_stage "private values · FEATURE-001" _st_private_values',
      )
      expect(muted).not.toBe(hook)
      const mutedDir = await s.fs.mkdirp('gate/muted')
      await s.fs.write('gate/muted/pre-push-project', muted)
      await s.fs.write('gate/muted/.private-values', 'present so the stage is armed\n')
      const dead = await runHook(mutedDir)
      expect(dead.output).not.toContain('STAGE:private values · FEATURE-001')
      expect(dead.output).not.toMatch(/NODE:.*private-values-check/)
    })
  })

  it('#14 a private value as a folder name is refused, and the printed path masks the value', async () => {
    await scenario('pv-path-folder', async (s) => {
      const { repo, check } = await fixture(s)
      await s.fs.write(`project/${NAME}/notes.md`, 'nothing personal here\n')
      await repo.commitAll('add a folder')
      const r = await check('HEAD~1..HEAD')
      expect(r.code).toBe(1)
      expect(r.output).toContain('M***d/notes.md')
      expect(r.output).not.toContain(NAME)
    })
  })

  it('#15 a private value as a file name is refused', async () => {
    await scenario('pv-path-file', async (s) => {
      const { repo, check } = await fixture(s)
      await s.fs.write(`project/docs/${NAME}.md`, 'nothing personal here\n')
      await repo.commitAll('add a document')
      const r = await check('HEAD~1..HEAD')
      expect(r.code).toBe(1)
      expect(r.output).toContain('docs/M***d.md')
      expect(r.output).not.toContain(NAME)
    })
  })

  it('#16 a value inside a longer word of a path is not a hit', async () => {
    await scenario('pv-path-longer-word', async (s) => {
      const { repo, check } = await fixture(s)
      await s.fs.write(`project/${NAME}ian/notes.md`, 'nothing personal here\n')
      await s.fs.write(`project/docs/un${NAME}.md`, 'nothing personal here\n')
      await repo.commitAll('longer words in paths')
      const r = await check('HEAD~1..HEAD')
      expect(r.code).toBe(0)
      expect(r.output).toContain('2 added-or-renamed path(s)')
    })
  })

  it('#17 a rename to a private name is refused: the new name is in the history', async () => {
    await scenario('pv-path-rename', async (s) => {
      const { repo, check } = await fixture(s)
      await s.fs.write('project/plain.md', 'nothing personal here\n')
      await repo.commitAll('a plain file')
      const mv = await repo.git(['mv', 'plain.md', `${NAME}.md`])
      expect(mv.code).toBe(0)
      await repo.commitAll('rename it')
      const r = await check('HEAD~1..HEAD')
      expect(r.code).toBe(1)
      expect(r.output).toContain('M***d.md')
      expect(r.output).not.toContain(NAME)
    })
  })

  it('#18 a path in the blueprint-managed set is exempt exactly as its content is', async () => {
    await scenario('pv-path-managed', async (s) => {
      const { repo } = await fixture(s)
      const check = await withBlueprint(s, repo, [`${NAME}/shipped.txt`])
      await s.fs.write('project/notes.md', 'nothing personal here\nstill nothing\n')
      await repo.commitAll('a clean line')
      const r = await check('HEAD~1..HEAD')
      expect(r.code).toBe(0)
      expect(r.output).toContain('1 file(s) exempt as blueprint-managed, 1 hit(s) in them suppressed')
      expect(r.output).not.toContain(NAME)
    })
  })
})
