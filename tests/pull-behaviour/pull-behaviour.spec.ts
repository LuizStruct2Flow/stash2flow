/**
 * tests/pull-behaviour/pull-behaviour.spec.ts — BUG-016, BUG-018, BUG-054.
 *
 * `pull` is the product's core verb: the one thing every derived project runs
 * against this repo. Three of its defects were reported from a real downstream
 * project, and all three have the same shape — the command DECLINES to do
 * something and reports success for declining.
 *
 *   BUG-016  a SINGLE-FILE pull advanced bootstrap_sha to blueprint HEAD, so
 *            every later `drift` said "0 commits since sync" while the project
 *            was still behind on every other managed file. The lie is durable:
 *            nothing recomputes that number.
 *   BUG-018  `read -r ans </dev/tty` was unguarded, so any non-interactive
 *            context crashed with "No such device or address".
 *   BUG-054  the case for BUG-018 let the ENVIRONMENT choose which code path it
 *            ran. `</dev/null` answers "is stdin a terminal"; the guard asks
 *            about /dev/tty, which is about the CONTROLLING TERMINAL. So the
 *            case tested the refusal path when launched detached (green) and the
 *            broken path when launched from a terminal — which is every
 *            `git push` a human types. It reported green on exactly the runs
 *            that mattered.
 *
 * BUG-054 IS WHY #1 PROVIDES A PTY INSTEAD OF INHERITING ONE. The harness
 * spawns with stdio 'ignore', which is neither of the two conditions: a child
 * may or may not inherit vitest's controlling terminal depending on how the gate
 * was launched. `script` supplies one unconditionally, with stdin redirected to
 * /dev/null INSIDE it — terminal present, stdin not a terminal, which is the
 * pre-push gate's own shape and the combination both previous fixes got wrong.
 *
 * PORTED FROM tests/pull-behaviour/test.sh, WHICH STAYS IN THE GATE until the
 * central retirement pass. BUG-017 does not reproduce at HEAD; the evidence is
 * in README-BUG-017.md and there is deliberately no case for it.
 *
 * Parallelism hazard: none. Every case owns a scenario workspace; the fixture
 * blueprint and project are built per case, and `script` runs inside it.
 *
 * EQUIVALENCE RECORD (R6, and the migration's own evidence).
 *
 * "Ported" is a claim, so it was measured rather than reviewed. Five perturbed
 * trees were built and BOTH implementations run over each — the retiring
 * `tests/pull-behaviour/test.sh` and this spec — with the per-case verdict sets
 * compared mechanically. THE VERDICTS AGREED ON ALL FIVE. The sets are OBSERVED,
 * not predicted.
 *
 *   Mutant P1: advance bootstrap_sha even on a partial pull — BUG-016 verbatim.
 *     shell #2 · spec #2 · AGREE. #3 stays GREEN, which is the point of having
 *     it: it stops the #2 fix from being satisfied by never advancing at all.
 *   Mutant P2: never advance it (the over-correction).
 *     shell #3 · spec #3 · AGREE, with #2 green — the mirror image.
 *   Mutant P3: refuse, print the right advice, and exit 0 anyway — BUG-018's
 *     FIRST fix, the one acceptance testing rejected.
 *     shell #1 · spec #1 · AGREE. Only the exit-status arm fires; the other two
 *     stay satisfied, which is exactly how that fix passed its own test.
 *   Mutant P4: no guard, and `read -r ans </dev/tty` restored — the original
 *     crash.
 *     shell #1 · spec #1 · AGREE.
 *   Mutant P5: every pull reports a refusal — the opposite error to P3.
 *     shell #1b · spec #1b #2 #3 · AGREE on the verdict, and the spec names
 *     three cases where the shell names one. Not a strengthening, a REPORTING
 *     difference: the shell runner's `#2`/`#3` read bootstrap_sha through a
 *     helper that returns the old value when nothing was pulled, so they go
 *     green on a pull that did nothing. #1b is what catches it in both. Recorded
 *     because a difference in what a failure NAMES is still a difference.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { withCttyNoStdin } from '../helpers/tty.js'

const CLI = join(REPO_ROOT, 'scripts/blueprint.mts')

async function git(s: Scenario, cwd: string, args: string[]) {
  return s.run('git', args, { cwd })
}

async function initRepo(s: Scenario, dir: string) {
  await git(s, dir, ['init', '-q', '-b', 'main', '.'])
  await git(s, dir, ['config', 'user.email', 't@local'])
  await git(s, dir, ['config', 'user.name', 't'])
  await git(s, dir, ['config', 'commit.gpgsign', 'false'])
}

interface Fixture {
  /** The fixture blueprint's root. */
  bp: string
  /** The sha the project claims to have bootstrapped from (one commit back). */
  first: string
  /** The blueprint's HEAD — what a FULL pull must advance the project to. */
  head: string
}

/**
 * A blueprint with TWO managed files and TWO commits.
 *
 * The two commits are what make #2 expressible at all: the project bootstraps
 * from the FIRST and is behind on CLAUDE.md, so "did a single-file pull claim a
 * full sync?" has a distinguishable answer. With one commit, `first` and `head`
 * are equal and the assertion is vacuous — asserted below rather than assumed.
 *
 * `tests/fixture/test.sh` is mandatory, not decoration: `tests/` is a managed
 * DIRECTORY whose expansion is fail-closed (BUG-029), so a fixture blueprint
 * that ships no suites is refused before pull does anything.
 */
async function fixtureBlueprint(s: Scenario, tag: string): Promise<Fixture> {
  const bp = await s.workspace.dir(tag, 'bp')
  await s.fs.write(join(bp, 'docs/DoD.md'), '# DoD\nowner {{PROJECT_NAME}}\nversion two\n')
  await s.fs.write(join(bp, 'CLAUDE.md'), '# CLAUDE\nfor {{PROJECT_NAME}}\n')
  await s.fs.write(join(bp, 'tests/fixture/test.sh'), 'echo fixture\n')
  await s.fs.write(join(bp, '.blueprint-root'), '')
  await initRepo(s, bp)
  await git(s, bp, ['add', '-A'])
  await git(s, bp, ['commit', '-q', '-m', 'one'])
  const first = (await git(s, bp, ['rev-parse', 'HEAD'])).stdout.trim()

  await s.fs.write(join(bp, 'CLAUDE.md'), '# CLAUDE\nfor {{PROJECT_NAME}}\nsecond commit\n')
  await git(s, bp, ['add', '-A'])
  await git(s, bp, ['commit', '-q', '-m', 'two'])
  const head = (await git(s, bp, ['rev-parse', 'HEAD'])).stdout.trim()

  expect(first, 'the fixture has one commit — #2 and #3 cannot differ').not.toBe(head)
  return { bp, first, head }
}

/** A project bootstrapped from `f.first`, i.e. one commit behind. */
async function newProject(s: Scenario, tag: string, name: string, f: Fixture) {
  const p = await s.workspace.dir(tag, name)
  await s.fs.write(join(p, 'docs/DoD.md'), '# DoD\nowner proj\nOLD\n')
  await s.fs.write(join(p, 'CLAUDE.md'), '# CLAUDE\nfor proj\n')
  await s.fs.write(
    join(p, '.blueprint-source'),
    [
      'config_version   = 2',
      `blueprint_remote = ${f.bp}`,
      'blueprint_branch = main',
      `bootstrap_sha    = ${f.first}`,
      'bootstrap_date   = 2026-01-01',
      '',
    ].join('\n'),
  )
  await initRepo(s, p)
  await git(s, p, ['add', '-A'])
  await git(s, p, ['commit', '-q', '-m', 'init'])
  return p
}

/** The bootstrap_sha the project currently records. */
async function shaOf(proj: string): Promise<string> {
  const text = await readFile(join(proj, '.blueprint-source'), 'utf8')
  const line = text.split('\n').find((l) => l.startsWith('bootstrap_sha'))
  return (line ?? '').split('=').slice(1).join('=').trim()
}

// withCttyNoStdin (BUG-054's fix: a controlling terminal, non-interactive
// stdin) now lives in tests/helpers/tty.ts, shared with TASK-081's
// differential harness (tests/blueprint-port), which drives the same
// interactive-prompt path on both the shell CLI and the ported one.

describe('BUG-016 / BUG-018 — pull records only what it synced, and survives having no TTY', () => {
  it('#1 with no TTY: no device error, an actionable message, and a NON-ZERO exit', async () => {
    await scenario('pull-behaviour-1', async (s) => {
      const f = await fixtureBlueprint(s, 'a')
      const p = await newProject(s, 'a', 'p18', f)

      // The real CLI, not a copy inside the fixture. The shell suite copied
      // the CLI into its fixture blueprint; both spellings run the
      // same bytes, and not copying means a mutant applied to the checkout
      // reaches this case the same way it reaches #1b/#2/#3.
      const r = await withCttyNoStdin(
        s,
        p,
        `node '${CLI}' pull docs/DoD.md </dev/null 2>&1`,
      )

      // THREE INDEPENDENT PROPERTIES, because each previous fix satisfied some
      // of them and the case passed on the strength of the others.
      expect(r.output, 'pull crashed on /dev/tty — it must degrade, as drift already does').not.toContain(
        '/dev/tty',
      )
      expect(
        r.output,
        'pull refused with no TTY but never said why — the operator cannot act on it',
      ).toMatch(/not interactive|no terminal|--yes/i)
      expect(
        r.code,
        'pull REFUSED to pull and still exited 0 — a caller cannot tell that ' +
          'from a successful sync (this is what acceptance rejected)',
      ).not.toBe(0)
    })
  })

  it('#1b an in-sync pull still exits 0 — the refusal code did not swallow the success case', async () => {
    await scenario('pull-behaviour-1b', async (s) => {
      // The converse control. Without it, "make the refusal non-zero" could be
      // satisfied by making every quiet pull look broken, which is the opposite
      // error and just as useless to a caller.
      const f = await fixtureBlueprint(s, 'b')
      const p = await newProject(s, 'b', 'p18b', f)

      const first = await s.run('node', [CLI, 'pull', '--yes', 'docs/DoD.md'], { cwd: p })
      expect(first.code, first.output).toBe(0)
      const second = await s.run('node', [CLI, 'pull', '--yes', 'docs/DoD.md'], { cwd: p })
      expect(
        second.code,
        `an in-sync pull exited ${second.code} — the non-zero refusal was ` +
          `over-applied to a legitimate no-op:\n${second.output}`,
      ).toBe(0)
    })
  })

  it('#2 a single-file pull leaves bootstrap_sha alone, so drift still reports the real gap', async () => {
    await scenario('pull-behaviour-2', async (s) => {
      const f = await fixtureBlueprint(s, 'c')
      const p = await newProject(s, 'c', 'p16', f)

      const r = await s.run('node', [CLI, 'pull', '--yes', 'docs/DoD.md'], { cwd: p })
      expect(r.code, r.output).toBe(0)

      // THE FIXTURE'S OWN PREMISE, FIRST. If CLAUDE.md were not behind there
      // would be nothing for a claimed full sync to be wrong ABOUT, and the
      // assertion below would pass over an empty condition.
      const projClaude = await readFile(join(p, 'CLAUDE.md'), 'utf8')
      const bpClaude = await readFile(join(f.bp, 'CLAUDE.md'), 'utf8')
      expect(
        projClaude,
        'fixture broken — CLAUDE.md is not behind, so the assertion is meaningless',
      ).not.toBe(bpClaude)

      const got = await shaOf(p)
      expect(
        got,
        `a single-file pull advanced bootstrap_sha to blueprint HEAD while ` +
          `CLAUDE.md is still behind — every later drift reports 0 commits ` +
          `since sync`,
      ).not.toBe(f.head)
      expect(got, 'bootstrap_sha became an unexpected value').toBe(f.first)
    })
  })

  it('#3 a full pull still advances bootstrap_sha to blueprint HEAD', async () => {
    await scenario('pull-behaviour-3', async (s) => {
      // Otherwise the #2 fix breaks normal syncing and leaves every project
      // permanently reporting drift it no longer has.
      const f = await fixtureBlueprint(s, 'd')
      const p = await newProject(s, 'd', 'pfull', f)

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })
      expect(r.code, r.output).toBe(0)
      expect(await shaOf(p), 'a full pull did NOT advance bootstrap_sha — the #2 fix broke normal syncing').toBe(
        f.head,
      )
    })
  })

  it('#4 BUG-122: a full pull that REFUSED a file leaves bootstrap_sha alone and names the file', async () => {
    await scenario('pull-behaviour-4', async (s) => {
      const f = await fixtureBlueprint(s, 'e')
      const p = await newProject(s, 'e', 'prefused', f)
      // An END with no open region: bp_marker_structure calls it `bad`, so pull
      // refuses docs/DoD.md while CLAUDE.md, which is behind, still gets pulled.
      await s.fs.write(join(p, 'docs/DoD.md'), '# DoD\n<!-- BLUEPRINT:END -->\n')

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })
      // The fixture's premise: one file pulled, one refused. Without the pull
      // there is no advance to wrongly make; without the refusal, #3's case.
      expect(r.output, 'fixture broken — nothing was pulled').toMatch(/pulled CLAUDE\.md/)
      expect(r.code, `a refused file must still exit 4:\n${r.output}`).toBe(4)

      expect(
        await shaOf(p),
        `a full pull advanced bootstrap_sha while docs/DoD.md was refused — the ` +
          `project now reads as synced to a commit it does not match:\n${r.output}`,
      ).toBe(f.first)
      expect(r.output, 'the message must name the file that held bootstrap_sha back').toMatch(
        /bootstrap_sha left unchanged[\s\S]*docs\/DoD\.md/,
      )
    })
  })
})

describe('TASK-021 §4.2 — a full pull retires what the blueprint stopped shipping, only on content proof', () => {
  it('#5 identical is offered and removed, edited is reported and kept, absent and project-owned are silent', async () => {
    await scenario('pull-behaviour-5', async (s) => {
      const bp = await s.workspace.dir('r', 'bp')
      await s.fs.write(join(bp, 'CLAUDE.md'), '# CLAUDE\nfor {{PROJECT_NAME}}\n')
      await s.fs.write(join(bp, 'tests/fixture/test.sh'), 'echo fixture\n')
      // Removed by deletion, and substituted, so the proof has to substitute too.
      await s.fs.write(join(bp, 'scripts/gone.sh'), 'echo {{PROJECT_NAME}}\n')
      // Removed by a new export-ignore line.
      await s.fs.write(join(bp, 'LICENSE'), 'MIT, the blueprint owner\n')
      await s.fs.write(join(bp, 'docs/edited.md'), 'blueprint text\n')
      await s.fs.write(join(bp, 'docs/absent.md'), 'never reached the project\n')
      // Seeded once and then the project's own: never a candidate, even identical.
      await s.fs.write(join(bp, 'project_config_paths.md'), 'config for {{PROJECT_NAME}}\n')
      // A seed the project edits freely, unedited here (Jesko's reproduction).
      await s.fs.write(join(bp, 'README.md'), 'readme as shipped\n')
      await initRepo(s, bp)
      await git(s, bp, ['add', '-A'])
      await git(s, bp, ['commit', '-q', '-m', 'one'])
      const first = (await git(s, bp, ['rev-parse', 'HEAD'])).stdout.trim()

      await git(s, bp, ['rm', '-q', 'scripts/gone.sh', 'docs/absent.md'])
      await s.fs.write(
        join(bp, '.gitattributes'),
        'LICENSE export-ignore\ndocs/edited.md export-ignore\nproject_config_paths.md export-ignore\nREADME.md export-ignore\n',
      )
      await git(s, bp, ['add', '-A'])
      await git(s, bp, ['commit', '-q', '-m', 'two'])

      const p = await s.workspace.dir('r', 'retiree')
      await s.fs.write(join(p, 'CLAUDE.md'), '# CLAUDE\nfor retiree\n')
      await s.fs.write(join(p, 'scripts/gone.sh'), 'echo retiree\n')
      await s.fs.write(join(p, 'LICENSE'), 'MIT, the blueprint owner\n')
      await s.fs.write(join(p, 'docs/edited.md'), 'blueprint text\nand this project wrote more\n')
      await s.fs.write(join(p, 'project_config_paths.md'), 'config for retiree\n')
      await s.fs.write(join(p, 'README.md'), 'readme as shipped\n')
      await s.fs.write(
        join(p, '.blueprint-source'),
        [
          'config_version   = 2',
          `blueprint_remote = ${bp}`,
          'blueprint_branch = main',
          // Already at the removal commit: candidates come from history, not
          // from the distance between bootstrap_sha and the tip.
          `bootstrap_sha    = ${first}`,
          'bootstrap_date   = 2026-01-01',
          '',
        ].join('\n'),
      )
      await initRepo(s, p)
      await git(s, p, ['add', '-A'])
      await git(s, p, ['commit', '-q', '-m', 'init'])

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })
      expect(r.code, r.output).toBe(0)

      expect(await s.fs.exists(join(p, 'scripts/gone.sh')), `an unedited deleted file was not retired:\n${r.output}`).toBe(false)
      expect(await s.fs.exists(join(p, 'LICENSE')), `an unedited export-ignored file was not retired:\n${r.output}`).toBe(false)
      expect(r.output, 'the retirement was not reported').toMatch(/retired\s+scripts\/gone\.sh/)

      expect(await s.fs.exists(join(p, 'docs/edited.md')), 'an EDITED copy was deleted').toBe(true)
      expect(r.output, 'the edited copy was not reported as the project\'s').toMatch(/yours now\s+docs\/edited\.md/)

      expect(r.output, 'a file the project never had was mentioned').not.toContain('docs/absent.md')
      expect(await s.fs.exists(join(p, 'project_config_paths.md')), 'a project-owned seed was retired').toBe(true)
      expect(r.output, 'a project-owned seed was treated as a candidate').not.toContain('project_config_paths.md')
      expect(await s.fs.exists(join(p, 'README.md')), `an unedited README seed was retired:\n${r.output}`).toBe(true)
      expect(r.output, 'the README seed was treated as a candidate').not.toContain('README.md')

      // A second pull has nothing left to offer, and still says the edited copy is kept.
      const again = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })
      expect(again.code, again.output).toBe(0)
      expect(again.output).not.toMatch(/retired/)
      expect(again.output).toMatch(/yours now\s+docs\/edited\.md/)
    })
  })
})

/**
 * BUG-162 — observed in stash2flow (`git show 12ba44b` there: pull kept
 * `scripts/lib/contamination.sh` with "this copy differs from every version
 * the blueprint shipped"). BUG-155's port moved the substitution exemption
 * from `contamination.sh` to `contamination.mts`
 * (scripts/lib/placeholders.sh), and `bpRetire`'s unedited-proof substituted
 * the shipped blob whenever TODAY's exemption list said so. The deleted .sh
 * lost its exemption, its shipped copies carried literal {{PROJECT_NAME}}
 * tokens (never substituted on arrival, since the OLD list exempted it), the
 * comparison ran against a substituted form, nothing matched, and the file
 * was reported "yours now" and kept forever. The fix: a copy is unedited
 * when it byte-matches EITHER the raw shipped blob OR its substituted form.
 *
 * The fixture reproduces the port's shape exactly: the blueprint ships a
 * token-carrying file, then deletes it; the checkout's real
 * scripts/lib/placeholders.sh (post-BUG-155) is what bpShouldSubstitute
 * reads, so the deleted path is no longer exempt — the same condition every
 * derived project pulls under.
 */
describe('BUG-162 — retire-on-pull proves "unedited" against the raw shipped blob too', () => {
  it('#12 BUG-162: a raw copy of a deleted whose-exemption-moved file is retired, an edited copy stays "yours now"', async () => {
    await scenario('pull-behaviour-12', async (s) => {
      const bp = await s.workspace.dir('r12', 'bp')
      await s.fs.write(join(bp, 'CLAUDE.md'), '# CLAUDE\nfor {{PROJECT_NAME}}\n')
      await s.fs.write(join(bp, 'tests/fixture/test.sh'), 'echo fixture\n')
      // Shipped while exempt, carrying the literal token — the pre-port
      // arrival form, exactly like the blueprint's last
      // scripts/lib/contamination.sh (git show e3fd8d8:scripts/lib/contamination.sh).
      await s.fs.write(join(bp, 'scripts/lib/contamination.sh'), '# contamination for {{PROJECT_NAME}}\n')
      // Same shape, but the project really edited this one: it must stay
      // "yours now" before and after the fix.
      await s.fs.write(join(bp, 'scripts/lib/edited.sh'), '# edited for {{PROJECT_NAME}}\n')
      await initRepo(s, bp)
      await git(s, bp, ['add', '-A'])
      await git(s, bp, ['commit', '-q', '-m', 'one'])
      const first = (await git(s, bp, ['rev-parse', 'HEAD'])).stdout.trim()

      // The port: the file is deleted and its exemption moves to another
      // path. The exemption half lives in the checkout's real
      // scripts/lib/placeholders.sh, which is what the CLI consults.
      await git(s, bp, ['rm', '-q', 'scripts/lib/contamination.sh', 'scripts/lib/edited.sh'])
      await git(s, bp, ['add', '-A'])
      await git(s, bp, ['commit', '-q', '-m', 'two'])

      const p = await s.workspace.dir('r12', 'retiree')
      await s.fs.write(join(p, 'CLAUDE.md'), '# CLAUDE\nfor retiree\n')
      // The RAW shipped bytes: the pull that delivered this file ran while
      // the old path was still exempt, so the token was never substituted.
      await s.fs.write(join(p, 'scripts/lib/contamination.sh'), '# contamination for {{PROJECT_NAME}}\n')
      await s.fs.write(join(p, 'scripts/lib/edited.sh'), '# edited for {{PROJECT_NAME}}\n# and this project wrote more\n')
      await s.fs.write(
        join(p, '.blueprint-source'),
        [
          'config_version   = 2',
          `blueprint_remote = ${bp}`,
          'blueprint_branch = main',
          `bootstrap_sha    = ${first}`,
          'bootstrap_date   = 2026-01-01',
          '',
        ].join('\n'),
      )
      await initRepo(s, p)
      await git(s, p, ['add', '-A'])
      await git(s, p, ['commit', '-q', '-m', 'init'])

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })
      expect(r.code, r.output).toBe(0)

      expect(
        await s.fs.exists(join(p, 'scripts/lib/contamination.sh')),
        `a copy byte-identical to a shipped version was not retired:\n${r.output}`,
      ).toBe(false)
      expect(r.output, 'the retirement was not reported').toMatch(/retired\s+scripts\/lib\/contamination\.sh/)

      expect(await s.fs.exists(join(p, 'scripts/lib/edited.sh')), 'an EDITED copy was deleted').toBe(true)
      expect(r.output, 'the edited copy was not reported as the project\'s').toMatch(/yours now\s+scripts\/lib\/edited\.sh/)
    })
  })
})

/**
 * TASK-081 slice 6 (Vitali review of e943ae5). `cmdPull` only spliced the
 * closure's dependency-first order into `files` when `partial` is true
 * (`if (!rest.includes(lib) && partial) files.push(lib)`); on a FULL pull
 * (`blueprint pull`, no names) `files` kept `bpManagedFiles()`'s archive
 * order — alphabetical by path — which has no relation to which lib sources
 * which. `libNeeds` is built either way, but the hold-back
 * (`failedDependencies.has(need)`) only works if the dependency was already
 * ATTEMPTED by the time its depender is reached. Alphabetically,
 * `scripts/lib/a-adapter.sh` sorts before `scripts/lib/z-target.mts`, so on a
 * full pull the adapter lands before its target is even tried — and if the
 * target then refuses (bad markers), the adapter is stranded: a new
 * `a-adapter.sh` sourcing a `z-target.mts` the project never got.
 */
describe('TASK-081 slice 6 — a full pull orders a lib depender after its dependency, not archive order', () => {
  it('#6 a full pull strands a lib adapter before its refused target', async () => {
    await scenario('pull-behaviour-6', async (s) => {
      const bp = await s.workspace.dir('f6', 'bp')
      await s.fs.write(join(bp, 'tests/fixture/test.sh'), 'echo fixture\n')
      // The fixture CLI names the adapter directly, so the closure's first
      // pass (extractShLibNames on scripts/blueprint.mts) discovers it. The
      // project has no CLI yet, so the pull selects it.
      await s.fs.write(
        join(bp, 'scripts/blueprint.mts'),
        ['// fixture cli (TASK-081 slice 6 reproducer)', 'const lib = "scripts/lib/a-adapter.sh"', ''].join('\n'),
      )
      // The adapter: a non-comment assignment naming its target by literal
      // path — the exact shape extractDependencyLibNames requires for a real
      // edge (dod-gate.sh's own bridge shape, plan §7).
      await s.fs.write(
        join(bp, 'scripts/lib/a-adapter.sh'),
        ['#!/bin/sh', '# scripts/lib/a-adapter.sh — fixture adapter (TASK-081 slice 6)', 'target="scripts/lib/z-target.mts"', '. "$target"', 'echo "a-adapter new"', ''].join(
          '\n',
        ),
      )
      await s.fs.write(join(bp, 'scripts/lib/z-target.mts'), '// z-target new\n')
      await initRepo(s, bp)
      await git(s, bp, ['add', '-A'])
      await git(s, bp, ['commit', '-q', '-m', 'one'])
      const first = (await git(s, bp, ['rev-parse', 'HEAD'])).stdout.trim()

      const p = await s.workspace.dir('f6', 'proj')
      await s.fs.write(join(p, 'scripts/lib/a-adapter.sh'), ['#!/bin/sh', '# old project copy', 'echo "a-adapter old"', ''].join('\n'))
      // An END with no open BEGIN: bp_marker_structure calls this `bad`, so
      // the target refuses regardless of content diff (pull-behaviour #4's
      // pattern) — this is the "unbalanced #BLUEPRINT:BEGIN marker" the
      // review recipe names.
      await s.fs.write(join(p, 'scripts/lib/z-target.mts'), '// z-target old\n// BLUEPRINT:END\n')
      await s.fs.write(
        join(p, '.blueprint-source'),
        [
          'config_version   = 2',
          `blueprint_remote = ${bp}`,
          'blueprint_branch = main',
          `bootstrap_sha    = ${first}`,
          'bootstrap_date   = 2026-01-01',
          '',
        ].join('\n'),
      )
      await initRepo(s, p)
      await git(s, p, ['add', '-A'])
      await git(s, p, ['commit', '-q', '-m', 'init'])

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })

      expect(
        await readFile(join(p, 'scripts/lib/a-adapter.sh'), 'utf8'),
        `a full pull landed a-adapter.sh sourcing a z-target.mts the project ` +
          `never got — its dependency's own refusal must hold it back too:\n${r.output}`,
      ).toContain('a-adapter old')
      expect(r.output, 'no skip line named the held-back adapter').toMatch(
        /skipped\s+scripts\/lib\/a-adapter\.sh.*scripts\/lib\/z-target\.mts/,
      )
      expect(await shaOf(p), 'bootstrap_sha advanced despite a refused dependency').toBe(first)
      expect(r.code, `a held-back file must still exit 4:\n${r.output}`).toBe(4)
    })
  })

  it('#7 two libs naming each other terminate the closure and both still pull', async () => {
    await scenario('pull-behaviour-7', async (s) => {
      const bp = await s.workspace.dir('f7', 'bp')
      await s.fs.write(join(bp, 'tests/fixture/test.sh'), 'echo fixture\n')
      await s.fs.write(
        join(bp, 'scripts/blueprint.mts'),
        ['// fixture cli (TASK-081 slice 6, cycle case)', 'const lib = "scripts/lib/lib-p.sh"', ''].join('\n'),
      )
      await s.fs.write(
        join(bp, 'scripts/lib/lib-p.sh'),
        ['#!/bin/sh', 'q="scripts/lib/lib-q.sh"', '. "$q"', 'echo "p new"', ''].join('\n'),
      )
      await s.fs.write(
        join(bp, 'scripts/lib/lib-q.sh'),
        ['#!/bin/sh', 'p="scripts/lib/lib-p.sh"', '. "$p"', 'echo "q new"', ''].join('\n'),
      )
      await initRepo(s, bp)
      await git(s, bp, ['add', '-A'])
      await git(s, bp, ['commit', '-q', '-m', 'one'])
      const first = (await git(s, bp, ['rev-parse', 'HEAD'])).stdout.trim()

      const p = await s.workspace.dir('f7', 'proj')
      await s.fs.write(join(p, 'scripts/lib/lib-p.sh'), 'echo "p old"\n')
      await s.fs.write(join(p, 'scripts/lib/lib-q.sh'), 'echo "q old"\n')
      await s.fs.write(
        join(p, '.blueprint-source'),
        [
          'config_version   = 2',
          `blueprint_remote = ${bp}`,
          'blueprint_branch = main',
          `bootstrap_sha    = ${first}`,
          'bootstrap_date   = 2026-01-01',
          '',
        ].join('\n'),
      )
      await initRepo(s, p)
      await git(s, p, ['add', '-A'])
      await git(s, p, ['commit', '-q', '-m', 'init'])

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })

      expect(r.code, `a mutual pair with no refusal must still exit 0:\n${r.output}`).toBe(0)
      expect(await readFile(join(p, 'scripts/lib/lib-p.sh'), 'utf8'), `lib-p.sh was dropped from the cycle:\n${r.output}`).toContain(
        'p new',
      )
      expect(await readFile(join(p, 'scripts/lib/lib-q.sh'), 'utf8'), `lib-q.sh was dropped from the cycle:\n${r.output}`).toContain(
        'q new',
      )
    })
  })

  it('#8 a full pull holds a lib back when its explicit dependency is absent from the blueprint', async () => {
    await scenario('pull-behaviour-8', async (s) => {
      const bp = await s.workspace.dir('f8', 'bp')
      await s.fs.write(join(bp, 'tests/fixture/test.sh'), 'echo fixture\n')
      await s.fs.write(
        join(bp, 'scripts/blueprint.mts'),
        ['// fixture cli (TASK-081 slice 6 missing-dependency reproducer)', 'const lib = "scripts/lib/a-adapter.sh"', ''].join('\n'),
      )
      await s.fs.write(
        join(bp, 'scripts/lib/a-adapter.sh'),
        [
          '#!/bin/sh',
          '# scripts/lib/a-adapter.sh — fixture adapter with an absent hard dependency',
          'target="scripts/lib/z-missing.mts"',
          '. "$target"',
          'echo "a-adapter new"',
          '',
        ].join('\n'),
      )
      await initRepo(s, bp)
      await git(s, bp, ['add', '-A'])
      await git(s, bp, ['commit', '-q', '-m', 'one'])
      const first = (await git(s, bp, ['rev-parse', 'HEAD'])).stdout.trim()

      const p = await s.workspace.dir('f8', 'proj')
      await s.fs.write(join(p, 'scripts/lib/a-adapter.sh'), ['#!/bin/sh', '# old project copy', 'echo "a-adapter old"', ''].join('\n'))
      await s.fs.write(
        join(p, '.blueprint-source'),
        [
          'config_version   = 2',
          `blueprint_remote = ${bp}`,
          'blueprint_branch = main',
          `bootstrap_sha    = ${first}`,
          'bootstrap_date   = 2026-01-01',
          '',
        ].join('\n'),
      )
      await initRepo(s, p)
      await git(s, p, ['add', '-A'])
      await git(s, p, ['commit', '-q', '-m', 'init'])

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })

      expect(
        await readFile(join(p, 'scripts/lib/a-adapter.sh'), 'utf8'),
        `a full pull landed a-adapter.sh even though its explicit dependency ` +
          `does not exist in the blueprint:\n${r.output}`,
      ).toContain('a-adapter old')
      expect(r.output, 'the absent dependency was never attempted').toMatch(
        /skip\s+scripts\/lib\/z-missing\.mts\s+\(not in blueprint\)/,
      )
      expect(r.output, 'no skip line named the held-back adapter').toMatch(
        /skipped\s+scripts\/lib\/a-adapter\.sh.*scripts\/lib\/z-missing\.mts/,
      )
      expect(await shaOf(p), 'bootstrap_sha advanced despite an absent dependency').toBe(first)
      expect(r.code, `a held-back file must still exit 4:\n${r.output}`).toBe(4)
    })
  })
})

/**
 * TASK-081 slice 6, round 2 (Vitali review of e943ae5/2a7d720/4247967/1d6c2a3).
 * #6/#7/#8 above all reproduce with the CLI itself missing from the project
 * (`scripts/blueprint.mts` absent), which forces `files.some(namesCli)` true and
 * therefore runs the whole closure/hold-back machinery. Once a project's CLI
 * is byte-identical to the blueprint's — the steady state after any project
 * has been ported once — the full-pull default scan never selects
 * `scripts/blueprint.mts`, `namesCli` is false for
 * every file, and NONE of the dependency analysis in `cmdPull` ran: a lib
 * that gained a dependency on something absent, refused, declined or failed
 * landed with no skip line, exit 0, bootstrap_sha advanced.
 */
describe('TASK-081 slice 6 round 2 — the dependency analysis runs even when the CLI is already current', () => {
  /** scripts/blueprint.mts, byte-identical in bp and p, so a full pull never selects it. */
  async function identicalCli(s: Scenario, bp: string, p: string) {
    const mts = '// fixture mts placeholder, already current on both sides\n'
    await s.fs.write(join(bp, 'scripts/blueprint.mts'), mts)
    await s.fs.write(join(p, 'scripts/blueprint.mts'), mts)
  }

  it('#9 a full pull with an already-current CLI still holds a lib back when its dependency is absent', async () => {
    await scenario('pull-behaviour-9', async (s) => {
      const bp = await s.workspace.dir('f9', 'bp')
      const p = await s.workspace.dir('f9', 'proj')
      await s.fs.write(join(bp, 'tests/fixture/test.sh'), 'echo fixture\n')
      await identicalCli(s, bp, p)
      await s.fs.write(
        join(bp, 'scripts/lib/a-adapter.sh'),
        [
          '#!/bin/sh',
          '# scripts/lib/a-adapter.sh — fixture adapter with an absent hard dependency (round 2)',
          'target="scripts/lib/z-missing.mts"',
          '. "$target"',
          'echo "a-adapter new"',
          '',
        ].join('\n'),
      )
      await initRepo(s, bp)
      await git(s, bp, ['add', '-A'])
      await git(s, bp, ['commit', '-q', '-m', 'one'])
      const first = (await git(s, bp, ['rev-parse', 'HEAD'])).stdout.trim()

      await s.fs.write(join(p, 'scripts/lib/a-adapter.sh'), ['#!/bin/sh', '# old project copy', 'echo "a-adapter old"', ''].join('\n'))
      await s.fs.write(
        join(p, '.blueprint-source'),
        [
          'config_version   = 2',
          `blueprint_remote = ${bp}`,
          'blueprint_branch = main',
          `bootstrap_sha    = ${first}`,
          'bootstrap_date   = 2026-01-01',
          '',
        ].join('\n'),
      )
      await initRepo(s, p)
      await git(s, p, ['add', '-A'])
      await git(s, p, ['commit', '-q', '-m', 'init'])

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })

      expect(
        await readFile(join(p, 'scripts/lib/a-adapter.sh'), 'utf8'),
        `a full pull with an already-current CLI landed a-adapter.sh even ` +
          `though its explicit dependency does not exist in the blueprint:\n${r.output}`,
      ).toContain('a-adapter old')
      expect(r.output, 'the absent dependency was never attempted').toMatch(
        /skip\s+scripts\/lib\/z-missing\.mts\s+\(not in blueprint\)/,
      )
      expect(r.output, 'no skip line named the held-back adapter').toMatch(
        /skipped\s+scripts\/lib\/a-adapter\.sh.*scripts\/lib\/z-missing\.mts/,
      )
      expect(await shaOf(p), 'bootstrap_sha advanced despite an absent dependency').toBe(first)
      expect(r.code, `a held-back file must still exit 4:\n${r.output}`).toBe(4)
    })
  })

  it('#10 a full pull with an already-current CLI strands a lib adapter before its refused target', async () => {
    await scenario('pull-behaviour-10', async (s) => {
      const bp = await s.workspace.dir('f10', 'bp')
      const p = await s.workspace.dir('f10', 'proj')
      await s.fs.write(join(bp, 'tests/fixture/test.sh'), 'echo fixture\n')
      await identicalCli(s, bp, p)
      await s.fs.write(
        join(bp, 'scripts/lib/a-adapter.sh'),
        [
          '#!/bin/sh',
          '# scripts/lib/a-adapter.sh — fixture adapter (round 2)',
          'target="scripts/lib/z-target.mts"',
          '. "$target"',
          'echo "a-adapter new"',
          '',
        ].join('\n'),
      )
      await s.fs.write(join(bp, 'scripts/lib/z-target.mts'), '// z-target new\n')
      await initRepo(s, bp)
      await git(s, bp, ['add', '-A'])
      await git(s, bp, ['commit', '-q', '-m', 'one'])
      const first = (await git(s, bp, ['rev-parse', 'HEAD'])).stdout.trim()

      await s.fs.write(join(p, 'scripts/lib/a-adapter.sh'), ['#!/bin/sh', '# old project copy', 'echo "a-adapter old"', ''].join('\n'))
      // An END with no open BEGIN: the target refuses regardless of content
      // diff (pull-behaviour #4's / #6's pattern).
      await s.fs.write(join(p, 'scripts/lib/z-target.mts'), '// z-target old\n// BLUEPRINT:END\n')
      await s.fs.write(
        join(p, '.blueprint-source'),
        [
          'config_version   = 2',
          `blueprint_remote = ${bp}`,
          'blueprint_branch = main',
          `bootstrap_sha    = ${first}`,
          'bootstrap_date   = 2026-01-01',
          '',
        ].join('\n'),
      )
      await initRepo(s, p)
      await git(s, p, ['add', '-A'])
      await git(s, p, ['commit', '-q', '-m', 'init'])

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })

      expect(
        await readFile(join(p, 'scripts/lib/a-adapter.sh'), 'utf8'),
        `a full pull with an already-current CLI landed a-adapter.sh sourcing ` +
          `a z-target.mts the project never got — its dependency's own refusal ` +
          `must hold it back too:\n${r.output}`,
      ).toContain('a-adapter old')
      expect(r.output, 'no skip line named the held-back adapter').toMatch(
        /skipped\s+scripts\/lib\/a-adapter\.sh.*scripts\/lib\/z-target\.mts/,
      )
      expect(await shaOf(p), 'bootstrap_sha advanced despite a refused dependency').toBe(first)
      expect(r.code, `a held-back file must still exit 4:\n${r.output}`).toBe(4)
    })
  })

  it('#11 a NAMED pull of only the depending lib holds it back when its dependency is absent, CLI untouched', async () => {
    await scenario('pull-behaviour-11', async (s) => {
      const bp = await s.workspace.dir('f11', 'bp')
      const p = await s.workspace.dir('f11', 'proj')
      await s.fs.write(join(bp, 'tests/fixture/test.sh'), 'echo fixture\n')
      // The CLI is not named on the pull command line at all here — this
      // case's point is that a NAMED pull of just the lib gets the same
      // dependency check, with no CLI involvement whatsoever.
      await s.fs.write(join(bp, 'scripts/blueprint.mts'), '// fixture mts placeholder\n')
      await s.fs.write(join(p, 'scripts/blueprint.mts'), '// fixture mts placeholder\n')
      await s.fs.write(
        join(bp, 'scripts/lib/a-adapter.sh'),
        [
          '#!/bin/sh',
          '# scripts/lib/a-adapter.sh — fixture adapter with an absent hard dependency (named pull)',
          'target="scripts/lib/z-missing.mts"',
          '. "$target"',
          'echo "a-adapter new"',
          '',
        ].join('\n'),
      )
      await initRepo(s, bp)
      await git(s, bp, ['add', '-A'])
      await git(s, bp, ['commit', '-q', '-m', 'one'])
      const first = (await git(s, bp, ['rev-parse', 'HEAD'])).stdout.trim()

      await s.fs.write(join(p, 'scripts/lib/a-adapter.sh'), ['#!/bin/sh', '# old project copy', 'echo "a-adapter old"', ''].join('\n'))
      await s.fs.write(
        join(p, '.blueprint-source'),
        [
          'config_version   = 2',
          `blueprint_remote = ${bp}`,
          'blueprint_branch = main',
          `bootstrap_sha    = ${first}`,
          'bootstrap_date   = 2026-01-01',
          '',
        ].join('\n'),
      )
      await initRepo(s, p)
      await git(s, p, ['add', '-A'])
      await git(s, p, ['commit', '-q', '-m', 'init'])

      const r = await s.run('node', [CLI, 'pull', '--yes', 'scripts/lib/a-adapter.sh'], { cwd: p })

      expect(
        await readFile(join(p, 'scripts/lib/a-adapter.sh'), 'utf8'),
        `a named pull landed a-adapter.sh even though its explicit dependency ` +
          `does not exist in the blueprint:\n${r.output}`,
      ).toContain('a-adapter old')
      expect(r.output, 'no skip line named the held-back adapter').toMatch(
        /skipped\s+scripts\/lib\/a-adapter\.sh.*scripts\/lib\/z-missing\.mts/,
      )
      expect(r.code, `a held-back file must still exit 4:\n${r.output}`).toBe(4)
    })
  })
})
