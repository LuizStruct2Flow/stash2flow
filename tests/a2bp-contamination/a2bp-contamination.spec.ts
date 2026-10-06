/**
 * tests/a2bp-contamination/a2bp-contamination.spec.ts — A-07, in TypeScript
 * (TASK-018).
 *
 * `blueprint a2bp` must not launder a project's specifics into the generic
 * blueprint. This is the door BUG-002 and A-09 came through, and it carries more
 * assertions than any other suite in the repo for that reason.
 *
 * The original defect: cmd_a2bp copied a project file into the blueprint with a
 * bare `cp`. Two consequences, both observed in the wild:
 *
 *   1. NO REVERSE-SUBSTITUTION. `blueprint pull` substitutes {{PROJECT_NAME}}
 *      into the project's copy; a2bp copied that substituted text straight back,
 *      so one project's name was baked into the generic file and fanned out to
 *      every OTHER project on their next pull. This is exactly how BUG-002 put
 *      `~/.linkedin-watcher-agent` into scripts/agent-activity.sh.
 *   2. NO CONTAMINATION SCAN. Host home paths, foreign project state dirs and
 *      operator emails rode along silently — the A-01 / A-09 / A-14 shapes.
 *
 * NOTHING HERE REACHES GITHUB OR THE REAL BLUEPRINT REMOTE. `gh` is a shim
 * inside the scenario workspace; the "blueprint" is a bare repository beside it.
 * The harness pins HOME, TMPDIR and every AGENT_* variable per scenario, and its
 * canary asserts the real baton, feed and `.git/config` are byte-unchanged after
 * every case.
 *
 * WHAT CHANGED FROM THE SHELL SUITE, and why each change is a strengthening
 * rather than a loss:
 *
 *   - FIXTURES ARE PER CASE, NOT SHARED. The shell suite built one blueprint and
 *     one remote and reset them between cases, because re-initialising cost
 *     ~0.35 s × 15 and took the suite from 2.3 s to 6.0 s against a 30 s budget.
 *     That budget is gone (CLAUDE.md §"Pre-push tolerance": coverage is decided
 *     on risk, never on the clock), and shared fixtures are what made the shell
 *     suite's stale-branch bug possible in the first place. R3/R5 isolation is
 *     the point; the cost is seconds.
 *   - CASE #0 EXECUTES ITS PROPERTY INSTEAD OF GREPPING FOR IT. In the shell
 *     suite #0 read its own source to prove no caller wrapped the helper in a
 *     command substitution — because a subshell swallowed the helper's
 *     `FAILED=1` and the suite printed PASS while a2bp had pushed to main
 *     (BUG-048; proven by mutation, 28 failures printed and exit 0). Here the
 *     equivalent property is DRIVEN: #0 hands the helper a stand-in CLI that
 *     really does move main, and requires the helper to fail. A guard that runs
 *     beats a guard that reads source.
 *
 * EQUIVALENCE RECORD (R6): `BP_SUBJECT_ROOT` points both implementations at one
 * perturbed copy of the blueprint. The catalogue is docs/waiting-acceptance/TASK-018-EQUIVALENCE-a2bp/ — 38 of
 * 38 assertions here have a mutant that was RUN and OBSERVED to turn them red,
 * #0 included: the only thing that can falsify #0 is removing the helper's
 * main-moved assertion, so that is the mutant, and it is injected into this
 * file.
 *
 * #21 WAS SATISFIED BY THE WRONG GUARD (BUG-104, closed). It names the R3-F3
 * fail-closed check on `diff`'s exit status, and removing that check left it
 * GREEN: with the alignment empty, staging passes the unrestored bytes through
 * and the RESIDUAL-PROJECT-NAME scan blocked them instead, so the case was proof
 * about a different guard than the one in its title. Its line now carries an
 * `a2bp-allow` marker — the product's own sanctioned override, which suppresses
 * the scan on that line — so the fail-closed check is the only thing left
 * standing. Observed: `C15` alone reds it.
 *
 * #30 IS NEW (BUG-105). It closes product behaviour that NOTHING watched in
 * either implementation: `cmd_a2bp`'s required-libs refusal degrading to a
 * `continue` (`E7`). #29 covered a `scaffolding/` base coordinate, removed
 * with that resolver when TASK-021 dropped the move.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type RunResult, type Scenario } from '../harness/index.js'

const SUBJECT_ROOT = process.env.BP_SUBJECT_ROOT ?? REPO_ROOT
const CLI = join(SUBJECT_ROOT, 'scripts/blueprint.mts')
const PLACEHOLDERS = join(SUBJECT_ROOT, 'scripts/lib/placeholders.sh')

/** A real MANAGED_FILES entry with low-stakes content. */
const CARRIER = 'docs/mocks/README.md'
const SENTINEL = 'SENTINEL — blueprint copy untouched\n'

/** a2bp's exit statuses (must match request-file.sh). */
const RC = { OK: 0, PENDING: 3, BLOCKED: 4, FAILED: 5, NOTHING: 6 } as const

interface A2bpResult {
  /** The status, with PENDING mapped onto 0 — see `runner()`. */
  rc: number
  /** The raw status, unmapped, for the cases that assert on 4 or 6 directly. */
  raw: number
  out: string
}

interface Fixture {
  /** The bare "blueprint remote" every request is filed against. */
  readonly remote: string
  /** A working checkout of it — how a case authors the blueprint's side. */
  readonly bp: string
  /** The default derived project. Its BASENAME is the project name. */
  readonly proj: string
  /** PATH with the gh shim first. */
  readonly ghPath: string

  /** Write a file under the blueprint checkout. */
  writeBp(rel: string, content: string): Promise<string>
  /** Write a file under a project directory (absolute). */
  writeIn(dir: string, rel: string, content: string): Promise<string>
  /** Read the blueprint checkout's copy of `rel` ('' when absent). */
  readBp(rel?: string): Promise<string>
  /** Is the blueprint's carrier still the untouched sentinel? */
  untouched(): Promise<boolean>
  /** Create a derived project directory with a v2 config pointing at `remote`. */
  makeProject(relDir: string): Promise<string>
  /** Run `blueprint a2bp` in `dir`. See `runner()` for what happens around it. */
  a2bp(dir: string, args: string[], opts?: { pathPrefix?: string; cli?: string }): Promise<A2bpResult>
  /** Run `blueprint pull` in `dir`. */
  pull(dir: string, args: string[]): Promise<RunResult>
}

/**
 * Build the fixture: a bare blueprint remote, a working checkout of it, a derived
 * project, and a `gh` that can reach a real "filed" state.
 *
 * WHY gh IS SHIMMED AT ALL (BUG-011). The remote here is a local bare repo, so
 * `gh pr create` against it is impossible by construction. That used to be
 * invisible: the pr-create failure branch returned 3, this suite maps 3 to 0
 * ("filed"), and 27 cases silently read "the PR step failed" as "the request was
 * filed" — the very defect BUG-011 describes, fooling the suite meant to guard
 * this path. Now that a failed pr-create correctly returns 5, the fixture has to
 * supply a gh that can succeed. It is also more honest: these cases ask "did the
 * contamination guard let this content through?", and that must not depend on
 * whether GitHub is reachable from the test host.
 */
async function fixture(s: Scenario, projectName = 'acme-flow'): Promise<Fixture> {
  const remote = s.workspace.path('blueprint-remote.git')
  const initBare = await s.run('git', ['init', '-q', '--bare', '-b', 'main', remote], {
    cwd: s.workspace.root,
  })
  expect(initBare.code, initBare.output).toBe(0)

  const bpRepo = await s.gitRepo('blueprint')
  const addRemote = await bpRepo.git(['remote', 'add', 'origin', remote])
  expect(addRemote.code, addRemote.output).toBe(0)

  // BUG-029 — `tests/` is a managed DIRECTORY and expanding it to nothing is a
  // hard failure by design, so a stand-in blueprint has to ship suites for
  // `pull` to run against it at all (#24 drives a real pull).
  await s.fs.write('blueprint/tests/fixture/test.sh', 'echo fixture\n')
  await s.fs.write(`blueprint/${CARRIER}`, SENTINEL)
  await bpRepo.commitAll('fixture suites')

  const shims = await s.shimDir('gh-shim')
  await shims.add(
    'gh',
    [
      `case "$1 $2" in`,
      `  "pr list")   exit 0 ;;`,
      // A REALISTIC PR URL. Real `gh pr create` prints
      // .../<owner>/<repo>/pull/<n>, and a2bp now requires that shape before it
      // will report a request as filed (Codex R2-F1: a zero exit with unusable
      // output is not evidence). The old fake, ".../pr/1", was not a URL gh
      // would ever emit.
      `  "pr create") echo "https://example.invalid/acme/blueprint/pull/1"; exit 0 ;;`,
      `esac`,
      `exit 0`,
    ].join('\n'),
  )
  const ghPath = shims.path()

  const bp = bpRepo.dir

  const config = (): string =>
    [
      'config_version   = 2',
      `blueprint_source = ${bp}`,
      `blueprint_remote = ${remote}`,
      'blueprint_branch = main',
      'bootstrap_sha    = test-fixture',
      'bootstrap_date   = test-fixture',
      '',
    ].join('\n')

  /**
   * Every a2bp/** ref on the remote, sorted.
   *
   * `**`, not `*`: for-each-ref matches with WM_PATHNAME, so a single `*` does
   * not cross '/' and would silently match nothing against a2bp/<project>/<digest>.
   *
   * The status is checked for the same reason `revParse` checks it — an empty
   * result here reads as "no branch was pushed", which is a verdict several cases
   * assert directly.
   */
  const a2bpRefs = async (): Promise<string[]> => {
    const r = await s.run(
      'git',
      ['-C', remote, 'for-each-ref', '--format=%(refname)', 'refs/heads/a2bp/**'],
      { cwd: s.workspace.root },
    )
    expect(r.code, `the fixture could not list request refs\n${r.output}`).toBe(0)
    return r.stdout.split('\n').filter(Boolean).sort()
  }

  /**
   * A ref's sha, with the fixture's OWN command checked.
   *
   * THE UNCHECKED VERSION OF THIS IS FAIL-OPEN, and it is the reason this
   * function asserts rather than returning whatever `stdout` held. The headline
   * invariant below compares main before and after; if both rev-parse calls
   * failed transiently, both would be `''`, the comparison would hold, and the
   * one assertion this whole suite rests on would pass over nothing. The
   * single-failure direction is merely flaky — one such false red was observed
   * while running this suite against a mutant under load, which is what led here.
   *
   * Same rule the repo already states for pushes: "Never trust a push's exit code
   * through a pipe" (TASK-018-TARGET §7). A fixture's own commands need their
   * status read, or the fixture can report on a measurement it never took.
   */
  const revParse = async (ref: string): Promise<string> => {
    const r = await s.run('git', ['-C', remote, 'rev-parse', ref], { cwd: s.workspace.root })
    expect(r.code, `the fixture could not read ${ref} on its own remote\n${r.output}`).toBe(0)
    const sha = r.stdout.trim()
    expect(sha, `rev-parse ${ref} succeeded but printed nothing`).toMatch(/^[0-9a-f]{7,}$/)
    return sha
  }

  const makeProject = async (relDir: string): Promise<string> => {
    const dir = await s.fs.mkdirp(relDir)
    await s.fs.mkdirp(join(relDir, 'docs/mocks'))
    await s.fs.write(join(relDir, '.blueprint-source'), config())
    return dir
  }

  const proj = await makeProject(projectName)

  /**
   * Three things happen around the CLI call, and they are what let every case
   * below stay written the way the shell suite wrote it:
   *
   *   BEFORE — whatever the case wrote into the blueprint checkout is committed
   *   and pushed as the base. Cases author the blueprint's side by writing that
   *   file, and it has to reach the remote, because the guard aligns against the
   *   FETCHED base rather than a local checkout.
   *
   *   AFTER — main is checked. Nothing a2bp does may move the branch every
   *   project pulls from. This used to be a precondition of the design ("it
   *   writes into the blueprint, so make sure it wrote the right thing"); it is
   *   now the headline invariant, so it is asserted on EVERY run rather than in
   *   the cases that happened to think of it.
   *
   *   THEN — the request branch's content is materialised back into the
   *   blueprint checkout. After that, that file means "what this request
   *   PROPOSES the blueprint should become", which is exactly what every
   *   assertion below already asks of it. A blocked run pushes no branch, so the
   *   SENTINEL survives and the "blueprint copy untouched" checks keep working.
   */
  const runner = async (
    dir: string,
    args: string[],
    opts: { pathPrefix?: string; cli?: string } = {},
  ): Promise<A2bpResult> => {
    const add = await bpRepo.git(['add', '-A'])
    expect(add.code, add.output).toBe(0)
    await bpRepo.git(['commit', '-q', '-m', 'base', '--allow-empty'])
    const push = await bpRepo.git(['push', '-q', '-f', 'origin', 'main'])
    expect(push.code, push.output).toBe(0)

    const mainBefore = await revParse('main')
    // Branches from earlier runs persist on the remote, so only a branch THIS
    // run created counts. Materialising "the first a2bp/* branch" replayed a
    // STALE request's content in the shell suite and made unrelated cases fail
    // on a diff they never produced.
    const refsBefore = await a2bpRefs()

    const path = opts.pathPrefix ? `${opts.pathPrefix}:${ghPath}` : ghPath
    // The real CLI (or a copy of it) is a .mts run with node; the rogue
    // stand-in of #0 is an executable shell script run directly.
    const cli = opts.cli ?? CLI
    const [cmd, ...pre] = cli.endsWith('.mts') ? ['node', cli] : [cli]
    const r = await s.run(cmd!, [...pre, 'a2bp', ...args], {
      cwd: dir,
      env: { PATH: path },
    })

    // THE HEADLINE INVARIANT, asserted on every single run. In the shell suite
    // this assertion lived inside the helper and was DISARMED for most of the
    // suite's life, because every caller read the helper's status through a
    // command substitution — a subshell, so `FAILED=1` died with the child
    // (BUG-048). Here it is an `expect` in the test's own context and there is no
    // subshell to lose it in. #0 proves it can still fire.
    const mainAfter = await revParse('main')
    expect(
      mainAfter,
      'a2bp MOVED THE BLUEPRINT\'S MAIN BRANCH — a request must never land',
    ).toBe(mainBefore)

    const refsAfter = await a2bpRefs()
    const newRef = refsAfter.find((ref) => !refsBefore.includes(ref))
    if (newRef !== undefined) {
      // Materialise EVERY path the request proposes, not just the carrier — some
      // cases file other files and would otherwise assert against a copy that
      // was never updated.
      const changed = await s.run(
        'git',
        ['-C', remote, 'diff', '--name-only', 'main', newRef],
        { cwd: s.workspace.root },
      )
      for (const p of changed.stdout.split('\n').filter(Boolean)) {
        const show = await s.run('git', ['-C', remote, 'show', `${newRef}:${p}`], {
          cwd: s.workspace.root,
        })
        if (show.code === 0) await s.fs.write(join('blueprint', p), show.stdout)
      }
    }

    // a2bp returns 3 (decision-pending) when a request IS filed — non-zero on
    // purpose, so no script can read "filed" as "landed". Every case here asks a
    // different question: did the contamination guard let this content through?
    // Mapping the filed status onto 0 keeps each case expressing that question
    // instead of restating a2bp's status table 27 times. `raw` is kept for the
    // three cases that do assert on the table.
    return { rc: r.code === RC.PENDING ? 0 : (r.code ?? -1), raw: r.code ?? -1, out: r.output }
  }

  const readBp = async (rel = CARRIER): Promise<string> => {
    try {
      return await s.fs.read(join('blueprint', rel))
    } catch {
      // Nothing landed at that path in the blueprint. Empty is the asserted state.
      return ''
    }
  }

  return {
    remote,
    bp,
    proj,
    ghPath,
    writeBp: (rel, content) => s.fs.write(join('blueprint', rel), content),
    writeIn: (dir, rel, content) => s.fs.write(join(dir.slice(s.workspace.root.length + 1), rel), content),
    readBp,
    async untouched() {
      return (await readBp()).startsWith('SENTINEL')
    },
    makeProject,
    a2bp: runner,
    // TASK-025 — pull reads the blueprint by its ADDRESS, so what a case wrote
    // into the blueprint checkout has to reach the remote first, exactly as the
    // a2bp runner above publishes it before every request.
    async pull(dir, args) {
      const add = await bpRepo.git(['add', '-A'])
      expect(add.code, add.output).toBe(0)
      await bpRepo.git(['commit', '-q', '-m', 'base', '--allow-empty'])
      const push = await bpRepo.git(['push', '-q', '-f', 'origin', 'main'])
      expect(push.code, push.output).toBe(0)
      return s.run('node', [CLI, 'pull', ...args], { cwd: dir, env: { PATH: ghPath } })
    },
  }
}

/** Run a placeholders.sh function positionally. */
function ph(s: Scenario, script: string, args: string[]): Promise<RunResult> {
  return s.run('bash', ['-c', `. "${PLACEHOLDERS}"\n${script}`, '_', ...args], {
    cwd: s.workspace.root,
  })
}

const captured = (r: RunResult): string => r.stdout.replace(/\n+$/, '')

describe('A-07 — a2bp reverse-substitutes and refuses to launder project specifics', () => {
  it("#0 the helper's headline assertion can fail the suite (BUG-048)", async () => {
    await scenario('a2bp-contam-0', async (s) => {
      // In the shell suite this case read its own source for `rc=$(run_a2bp …)`,
      // because that command substitution is a subshell and swallowed the
      // helper's `FAILED=1` — so the suite printed PASS while a2bp had pushed to
      // main. Proven by mutation: the pre-fix suite reported the failure 28 times
      // on stdout and still exited 0.
      //
      // A source grep is the wrong shape of check for that (BUG-047: a control
      // whose population is decided by what comments say rather than by what
      // code does — the shell version had to strip comments to stop matching the
      // prose describing it). So the property is EXECUTED instead: hand the
      // helper a stand-in CLI that really does move main, and require it to fail.
      const f = await fixture(s)
      const rogue = await s.fs.write(
        'rogue-cli',
        [
          '#!/bin/sh',
          '# A stand-in "blueprint" that lands a change on main — the one thing',
          '# a2bp must never be able to do.',
          `cd "$(dirname "$0")" || exit 1`,
          `git init -q -b main rogue-work 2>/dev/null`,
          `git -C rogue-work config user.email r@local`,
          `git -C rogue-work config user.name r`,
          `git -C rogue-work config commit.gpgsign false`,
          `echo landed > rogue-work/landed.txt`,
          `git -C rogue-work add -A`,
          `git -C rogue-work commit -q -m landed`,
          // The remote is baked in rather than read from the environment: the
          // runner hands a CLI only PATH, exactly as it hands the real one only
          // PATH, so a stand-in that needed extra variables would be testing a
          // different call than the one under test.
          `git -C rogue-work push -q -f "${f.remote}" main:main`,
          // Exit 3 — "filed, awaiting a decision". The worst case: a status that
          // claims success while a change has landed on main.
          'exit 3',
        ].join('\n'),
        { mode: 0o755 },
      )

      let failure: unknown
      try {
        await f.a2bp(f.proj, [CARRIER], { cli: rogue })
      } catch (err) {
        failure = err
      }
      expect(
        String(failure),
        'the helper did not notice main moving — its headline assertion is disarmed, which is BUG-048',
      ).toContain("MOVED THE BLUEPRINT'S MAIN BRANCH")
    })
  })

  it('#1 lowercase project name reverse-substituted to {{PROJECT_NAME}}', async () => {
    await scenario('a2bp-contam-1', async (s) => {
      // THE REPRODUCER. The project's copy has the project name where the
      // blueprint carries a placeholder. a2bp must put the placeholder BACK, or
      // this project's name fans out to every other project on their next pull
      // (BUG-002's mechanism).
      const f = await fixture(s)
      // Provenance lives in the blueprint's own copy: these are the placeholder
      // lines that `pull` substituted into the project in the first place.
      // Without them there is nothing to reverse TO, and the guard correctly
      // fails closed instead of guessing — that is case #8.
      await f.writeBp(
        CARRIER,
        '# Mocks\nGeneric guidance for the {{PROJECT_NAME}} project.\nEnvironment override: {{PROJECT_NAME_UPPER}}_HOME\n',
      )
      // The last line is load-bearing. Reverse-substitution with NO other change
      // produces content byte-identical to the base — a no-op request, which a2bp
      // correctly refuses to file. Without a genuine change alongside, no branch
      // is pushed and the restored bytes are unobservable.
      await f.writeIn(
        f.proj,
        CARRIER,
        '# Mocks\nGeneric guidance for the acme-flow project.\nEnvironment override: ACME_FLOW_HOME\nA genuinely new generic line.\n',
      )

      const r = await f.a2bp(f.proj, [CARRIER])
      expect(r.rc, `a2bp exited on a legitimately generic file\n${r.out}`).toBe(0)
      expect(await f.untouched(), 'a2bp did not copy the file at all').toBe(false)

      const copy = await f.readBp()
      expect(
        copy,
        "the project name survived into the blueprint copy — no reverse-substitution (this IS BUG-002's mechanism)",
      ).not.toContain('acme-flow')
      expect(copy, 'the name was not restored to a placeholder').toContain('{{PROJECT_NAME}}')
    })
  })

  it('#1b UPPER-cased project name reverse-substituted to {{PROJECT_NAME_UPPER}}', async () => {
    await scenario('a2bp-contam-1b', async (s) => {
      // BUG-002 was literally LINKEDIN_WATCHER_AGENT_HOME.
      const f = await fixture(s)
      await f.writeBp(
        CARRIER,
        '# Mocks\nGeneric guidance for the {{PROJECT_NAME}} project.\nEnvironment override: {{PROJECT_NAME_UPPER}}_HOME\n',
      )
      await f.writeIn(
        f.proj,
        CARRIER,
        '# Mocks\nGeneric guidance for the acme-flow project.\nEnvironment override: ACME_FLOW_HOME\nA genuinely new generic line.\n',
      )

      const r = await f.a2bp(f.proj, [CARRIER])
      expect(r.rc, r.out).toBe(0)

      const copy = await f.readBp()
      expect(
        copy,
        'the UPPER-cased project name survived — reverse-substitution missed the {{PROJECT_NAME_UPPER}} form',
      ).not.toContain('ACME_FLOW_HOME')
      expect(copy).toContain('{{PROJECT_NAME_UPPER}}_HOME')
    })
  })

  it('#2 host path blocks the copy, exits non-zero, and the offending line is named', async () => {
    await scenario('a2bp-contam-2', async (s) => {
      // Same rule the repo already enforces on .claude/settings.json (the
      // pre-push host-path guard, added for A-01) — a2bp is the other door into
      // the same tree and was unguarded.
      const f = await fixture(s)
      await f.writeIn(
        f.proj,
        CARRIER,
        '# Mocks\nRun the tool from /home/someuser/sources/thing before review.\n',
      )

      const r = await f.a2bp(f.proj, [CARRIER])
      expect(
        await f.untouched(),
        'a host path was copied into the blueprint — contamination scan absent or not blocking',
      ).toBe(true)
      expect(
        r.rc,
        "a blocked back-propagation must fail loudly (BUG-003's lesson: never report a refusal as success)",
      ).not.toBe(0)
      expect(r.out, 'the operator cannot act on a refusal that does not quote the line').toContain(
        '/home/someuser',
      )
    })
  })

  it('#3 literal per-project state dir blocks the copy', async () => {
    await scenario('a2bp-contam-3', async (s) => {
      // The exact shape verified live on A-07 ($HOME/.acme-flow copied in with
      // zero warning) and the shape A-09 spent 8 review rounds on.
      const f = await fixture(s)
      await f.writeIn(
        f.proj,
        CARRIER,
        '# Mocks\nState is kept under $HOME/.other-project/state for now.\n',
      )

      const r = await f.a2bp(f.proj, [CARRIER])
      expect(
        await f.untouched(),
        'a literal per-project state dir was copied into the blueprint — this is the A-09 contamination re-entering',
      ).toBe(true)
      expect(r.rc, 'rejected the copy but exited 0').not.toBe(0)
    })
  })

  it('#4 clean generic content still back-propagates (no over-blocking)', async () => {
    await scenario('a2bp-contam-4', async (s) => {
      // Guards the fix from the opposite failure: a scan so eager that nobody can
      // back-propagate anything is a scan that gets bypassed by habit.
      const f = await fixture(s)
      await f.writeIn(
        f.proj,
        CARRIER,
        '# Mocks\n\nDesign mockups and throwaway prototypes live here. Keep spike code out of\n' +
          'production `src/` trees — see CLAUDE.md §"Work-item folder rule".\n' +
          'Well-known tool dirs such as ~/.config and ~/.local/bin are fine to mention.\n',
      )

      const r = await f.a2bp(f.proj, [CARRIER])
      expect(r.rc, `a clean generic file was rejected — false positive\n${r.out}`).toBe(0)
      expect(await f.untouched(), 'a clean generic file was not copied').toBe(false)
    })
  })

  it('#5 --force is refused, naming a2bp-allow as the way through (BUG-064)', async () => {
    await scenario('a2bp-contam-5', async (s) => {
      // THIS EXPECTATION IS INVERTED, deliberately. --force existed to waive the
      // guard and copy anyway, coherent while a2bp landed bytes: detection is
      // heuristic, so an override had to exist or a false positive would block
      // real work permanently. A request is read by a person before anything
      // lands, so the reviewer IS the override. Silently ignoring the flag would
      // be the worst outcome: an operator who passes --force believes the guard
      // was waived, and would read a block as a tool malfunction.
      const f = await fixture(s)
      await f.writeIn(
        f.proj,
        CARRIER,
        '# Mocks\nRun the tool from /home/someuser/sources/thing before review.\n',
      )

      const r = await f.a2bp(f.proj, ['--force', CARRIER])
      expect(r.rc, '--force still waived the guard and filed the request').not.toBe(0)
      // THE assertion. Every other branch here is satisfied by a plain
      // contamination block, which this fixture also triggers — so without this
      // line, deleting the `--force)` arm entirely and letting the flag fall
      // through as a silent no-op still printed ok. Verified by mutation.
      expect(
        r.out,
        'BUG-064: --force was SILENTLY IGNORED — the run was refused for the contamination in the fixture, not for the flag',
      ).toContain('--force is gone')
      expect(r.out, '--force was parsed as a FILENAME rather than refused as a flag').not.toMatch(
        /reject.*--force/,
      )
      expect(r.out, '--force was refused without naming the sanctioned alternative').toContain(
        'a2bp-allow',
      )
      expect(await f.untouched(), '--force still reached the blueprint').toBe(true)
    })
  })

  it('#6 substitution-implementing files are exempt from reverse-substitution', async () => {
    await scenario('a2bp-contam-6', async (s) => {
      // scripts/blueprint.mts and the placeholder libs carry the placeholder tokens
      // as CODE; the CLI already exempts them on the pull side via
      // _should_substitute. The a2bp side must honour the SAME exemption, or
      // back-propagating the CLI corrupts the CLI.
      //
      // THE BLUEPRINT-SIDE COPY IS PART OF THE ASSERTION, and it used to be a
      // bare `SENTINEL\n`. Reverse-substitution is alignment-based: a project
      // line is restored only when it matches the forward-substituted blueprint
      // line it aligns to. A one-line SENTINEL shares no line with the project's
      // file, so diff aligned NOTHING and no line was ever restored — with or
      // without the exemption. Removing the exemption outright left this case
      // printing ok. The blueprint copy below therefore carries the GENERIC form
      // of the project's line 2; its extra final line is what "was this filed at
      // all?" reads.
      const f = await fixture(s)
      const rel = 'scripts/blueprint.mts'
      await f.writeBp(
        rel,
        '#!/bin/bash\n' +
          '# Bootstrap. Mentions {{PROJECT_NAME}} only as example text.  a2bp-allow: example text in a comment, not a path\n' +
          'sed -e "s/{{PROJECT_NAME}}/${proj}/g" "$f"\n' +
          'SENTINEL — blueprint copy untouched\n',
      )
      await f.writeIn(
        f.proj,
        rel,
        '#!/bin/bash\n' +
          '# Bootstrap. Mentions acme-flow only as example text.  a2bp-allow: example text in a comment, not a path\n' +
          'sed -e "s/{{PROJECT_NAME}}/${proj}/g" "$f"\n',
      )

      const r = await f.a2bp(f.proj, [rel])
      const copy = await f.readBp(rel)
      expect(copy, `scripts/blueprint.mts was not filed\n${r.out}`).not.toMatch(/^SENTINEL/m)
      expect(
        copy,
        'BUG-064: it WAS reverse-substituted — the pull-side _should_substitute exemption is not mirrored on the a2bp side, so back-propagating the CLI would corrupt it',
      ).toContain('acme-flow')
      expect(copy, "the file's own {{PROJECT_NAME}} code token was mangled").toContain(
        '{{PROJECT_NAME}}',
      )
    })
  })

  it("#7 a common-word project name blocks its own generic prose, naming the line (R4-F2's cost)", async () => {
    await scenario('a2bp-contam-7', async (s) => {
      // Codex F1 — a one-word project name must not CORRUPT prose. The first
      // implementation ran a global `sed s/${proj_name}/{{PROJECT_NAME}}/g` and
      // called it "the exact inverse". For a project legitimately named
      // `blueprint`, every occurrence of the word "blueprint" in generic prose
      // was silently rewritten and copied through with no finding at all.
      //
      // IT ALSO USED TO CLAIM the line was not false-blocked, and that half was
      // passing vacuously: the project and the stand-in blueprint were the SAME
      // DIRECTORY, so a2bp saw identical files and exited early as "same",
      // never running the guard. Separated, the real behaviour appears: the line
      // DOES block. A-07 R4-F2 removed the alignment-derived exemption, because
      // that was the one path by which a misattributed line could wave
      // contamination through — so every staged line is scanned, including lines
      // identical to the base. For a project named after a common word, generic
      // prose containing that word therefore blocks and needs an explicit
      // a2bp-allow. That is a real ergonomic cost, now visible instead of hidden.
      const f = await fixture(s)
      const wordProj = await f.makeProject('w/blueprint')
      await f.writeBp(CARRIER, '# Mocks\nThe blueprint documentation explains blueprint sync.\n')
      await f.writeIn(
        wordProj,
        CARRIER,
        '# Mocks\nThe blueprint documentation explains blueprint sync.\nA new generic line about mockups.\n',
      )

      const r = await f.a2bp(wordProj, [CARRIER])
      expect(
        r.rc,
        'expected a BLOCK for a project named after a common word; a2bp filed the request instead',
      ).not.toBe(0)
      expect(r.out, 'blocked, but not for the name-collision reason').toContain(
        'project name survived reverse-substitution',
      )
      // The sentinel was deliberately replaced with prose here, so the leak has
      // to be detected by the request's own new line arriving.
      expect(await f.readBp(), 'the blocked content reached the blueprint anyway').not.toContain(
        'A new generic line',
      )
    })
  })

  it('#7b a marked benign collision files with the prose verbatim — no global-sed corruption (F1)', async () => {
    await scenario('a2bp-contam-7b', async (s) => {
      // THE HALF THAT MATTERS: no silent corruption. With the collision marked as
      // benign — the sanctioned escape, and the only one now that --force is
      // gone — the request is filed and the staged bytes become observable. A
      // global-sed inverse would have rewritten every "blueprint" to
      // {{PROJECT_NAME}} here and shipped it with no finding at all, which is the
      // F1 defect. Blocking is an inconvenience; this would be corruption.
      const f = await fixture(s)
      const wordProj = await f.makeProject('w/blueprint')
      await f.writeBp(CARRIER, '# Mocks\nThe blueprint documentation explains blueprint sync.\n')
      await f.writeIn(
        wordProj,
        CARRIER,
        '# Mocks\n' +
          'The blueprint documentation explains blueprint sync.  <!-- a2bp-allow: generic prose; the project is merely named after the word -->\n' +
          'A new generic line about mockups.\n',
      )

      const r = await f.a2bp(wordProj, [CARRIER])
      expect(r.rc, `a marked benign collision did not file\n${r.out}`).toBe(0)

      const copy = await f.readBp()
      expect(
        copy,
        "CORRUPTION: the word 'blueprint' in generic prose was rewritten to {{PROJECT_NAME}} — this is Codex F1, the global-sed inverse",
      ).not.toContain('{{PROJECT_NAME}}')
      expect(copy, 'the unchanged prose line did not survive intact').toContain(
        'The blueprint documentation explains blueprint sync.',
      )
      expect(copy, 'the newly added generic line was not filed').toContain('A new generic line')
    })
  })

  it('#8 an edited line carrying the project name blocks for explicit operator resolution (F1)', async () => {
    await scenario('a2bp-contam-8', async (s) => {
      // Provenance only exists for lines that match the blueprint's copy. For
      // anything the operator changed, the tool must refuse rather than assume.
      const f = await fixture(s)
      await f.writeBp(CARRIER, '# Mocks\nState lives under the {{PROJECT_NAME}} home.\n')
      await f.writeIn(
        f.proj,
        CARRIER,
        '# Mocks\nState lives under the acme-flow home, newly reworded.\n',
      )

      const r = await f.a2bp(f.proj, [CARRIER])
      expect(
        r.rc,
        'an edited line still carrying the literal project name was copied — the tool guessed instead of failing closed',
      ).not.toBe(0)

      const copy = await f.readBp()
      expect(copy, 'the project name reached the blueprint').not.toContain('acme-flow')
      expect(copy, "the blueprint's original placeholder line was lost").toContain(
        '{{PROJECT_NAME}}',
      )
    })
  })

  it('#9 a project name with regex metacharacters is treated as data, not a pattern (F1)', async () => {
    await scenario('a2bp-contam-9', async (s) => {
      // The old code interpolated the name straight into a sed pattern, so a
      // legal directory name like `acme.flow` matched `acmeXflow` too.
      const f = await fixture(s)
      const rxProj = await f.makeProject('acme.flow')
      const line = '# Mocks\nGeneric line mentioning acmeXflow which is unrelated.\n'
      await f.writeBp(CARRIER, line)
      await f.writeIn(rxProj, CARRIER, line)

      const r = await f.a2bp(rxProj, [CARRIER])
      expect(
        await f.readBp(),
        "'acmeXflow' was treated as a match for project 'acme.flow' — the name is being compiled as a regex",
      ).not.toContain('{{PROJECT_NAME}}')
      if (r.rc !== 0) {
        expect(
          r.out,
          "unrelated text 'acmeXflow' was reported as the project name — unescaped regex metacharacter",
        ).not.toContain('acmeXflow')
      }
    })
  })

  it('#10 the prose exception survives the staged-temp-file path (F2)', async () => {
    await scenario('a2bp-contam-10', async (s) => {
      // Codex F2 — the Markdown/prose exception keyed off the extension of the
      // scanned file, but a2bp scans an extensionless mktemp staging copy, so
      // `is_prose` was always false in production while the unit tests, calling
      // the helper directly with a real .md path, stayed green. That gap is
      // exactly why this case drives the CLI.
      const f = await fixture(s)
      await f.writeIn(
        f.proj,
        CARRIER,
        '# Mocks\nDispatcher output lands in `~/.{{PROJECT_NAME}}/codex-runs.log` by convention.\n',
      )

      const r = await f.a2bp(f.proj, [CARRIER])
      expect(
        r.rc,
        `legitimate Markdown documenting ~/.{{PROJECT_NAME}} was BLOCKED — the prose exception is dead in the real a2bp path\n${r.out}`,
      ).toBe(0)
      expect(await f.untouched(), 'the Markdown file was not copied').toBe(false)
    })
  })

  it('#11 the prose exception is extension-scoped; a script hardcoding the literal path still blocks (F2)', async () => {
    await scenario('a2bp-contam-11', async (s) => {
      // The prose exception must be an extension rule, not a blanket hole.
      const f = await fixture(s)
      await f.writeBp('scripts/log-activity.sh', 'SENTINEL\n')
      await f.writeIn(
        f.proj,
        'scripts/log-activity.sh',
        '#!/bin/sh\nstate_dir="$HOME/.{{PROJECT_NAME}}"\n',
      )

      const r = await f.a2bp(f.proj, ['scripts/log-activity.sh'])
      expect(
        r.rc,
        'a SCRIPT hardcoding $HOME/.{{PROJECT_NAME}} was copied — that is the A-09 defect, and the prose exception has become a blanket hole',
      ).not.toBe(0)
    })
  })

  it('BUG-155 a known dotdir inside a shell default `${VAR:-$HOME/.codex}` files, ~/.kimi-code files, a script\'s ~/.<placeholder> still blocks', async () => {
    await scenario('a2bp-contam-bug155', async (s) => {
      // THE REPRODUCER. The dot-dir pass extracted `[A-Za-z0-9_.{}-]*` after
      // `/.`, so the closing brace of a shell default-value expansion became
      // part of the name: `codex}` is not on the known list although `codex`
      // is, and CI went red on a line that is not contamination (4a2b7e2).
      // `~/.kimi-code` is the Kimi CLI's own home — the same class as `codex`
      // and `gemini`, missing only because Kimi joined after the list was
      // written. Braces stay meaningful as a WHOLE placeholder: #11's A-09
      // shape must block exactly as before, which the third run pins.
      const f = await fixture(s)
      const rel = 'scripts/log-activity.sh'
      const file = async (body: string): Promise<A2bpResult> => {
        await f.writeBp(rel, 'SENTINEL\n')
        await f.writeIn(f.proj, rel, `#!/bin/sh\n${body}\n`)
        return f.a2bp(f.proj, [rel])
      }

      const codex = await file('CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"')
      expect(
        codex.rc,
        `BUG-155: a known dotdir inside \${VAR:-…} was BLOCKED — the brace was read as part of the name\n${codex.out}`,
      ).toBe(0)

      const kimi = await file('KIMI_BIN="$HOME/.kimi-code/bin/kimi"')
      expect(kimi.rc, `BUG-155: the Kimi CLI's own home dir was BLOCKED as a per-project state dir\n${kimi.out}`).toBe(0)

      // This suite SHIPS, so the CI push scan judges these two lines as added
      // lines of a script file — exactly the shape they plant.
      const placeholder = await file('state_dir="$HOME/.{{PROJECT_NAME}}"') // a2bp-allow: fixture plant, the A-09 shape this run pins
      expect(
        placeholder.rc,
        'a SCRIPT hardcoding $HOME/.{{PROJECT_NAME}} was filed — the A-09 shape must still block (#11)', // a2bp-allow: names the fixture plant above
      ).not.toBe(0)
      expect(placeholder.out).toContain('literal per-project state dir')
    })
  })

  it('#12 one contaminated file refuses the WHOLE request; nothing is filed (F3)', async () => {
    await scenario('a2bp-contam-12', async (s) => {
      // THIS EXPECTATION IS INVERTED FROM WHAT IT USED TO BE, deliberately. While
      // a2bp copied into a working tree, letting the clean file through and
      // refusing the dirty one was strictly better. A request is not a copy: it
      // is filed as ONE unit, under one branch, with one PR title naming what the
      // operator asked for. Filing the clean subset would file something they did
      // not ask for, described by a title that says they did.
      const f = await fixture(s)
      await f.writeBp('docs/config/README.md', 'SENTINEL2\n')
      await f.writeIn(f.proj, CARRIER, '# Mocks\nPerfectly generic guidance.\n')
      await f.writeIn(
        f.proj,
        'docs/config/README.md',
        '# Config\nSee /home/someuser/notes for details.\n',
      )

      const r = await f.a2bp(f.proj, [CARRIER, 'docs/config/README.md'])
      expect(
        r.rc,
        'a request containing a contaminated file was FILED — an agent reading only the exit code would never see the refusal',
      ).not.toBe(0)
      expect(
        await f.readBp('docs/config/README.md'),
        'the CONTAMINATED file reached the blueprint',
      ).toMatch(/^SENTINEL2/)
      expect(
        await f.untouched(),
        'the clean file was filed anyway — a partial request is a DIFFERENT request, filed under a title claiming otherwise',
      ).toBe(true)
      expect(r.out, 'the finding that caused the refusal was not reported').toContain(
        'someuser/notes',
      )
    })
  })

  it('#13 suppression is exact per line number, including multi-digit (F3)', async () => {
    await scenario('a2bp-contam-13', async (s) => {
      // THE ORDER OF THE TWO LINES IS THE WHOLE CASE, and it used to be
      // backwards. The suppression set is built as "|11|" and tested with
      // `case $set in *"|$ln|"*`. Drop the delimiters — `*"$ln"*` — and "1"
      // matches inside "|11|", so the MARKER ON THE HIGHER LINE swallows the
      // finding on the lower one. The reverse never happens: "11" is not a
      // substring of "|2|". The previous fixture had them the other way round, so
      // both the correct and the delimiter-less forms behaved identically on it.
      const f = await fixture(s)
      const lines = [
        'Line 1 mentions /home/someuser/one with no marker at all',
        ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => `filler line ${i}`),
        'Line 11 mentions /home/someuser/two — a2bp-allow: deliberate fixture line',
        '',
      ]
      await f.writeIn(f.proj, CARRIER, lines.join('\n'))

      const r = await f.a2bp(f.proj, [CARRIER])
      expect(
        r.rc,
        "BUG-064: line 1 was suppressed by line 11's marker — the suppression set is matching substrings, not whole line numbers",
      ).not.toBe(0)
      expect(r.out, 'BUG-064: the unsuppressed line 1 finding was not reported').toContain(
        'someuser/one',
      )
      expect(
        r.out,
        'BUG-064: the a2bp-allow marker on line 11 did not suppress its finding',
      ).not.toContain('someuser/two')
    })
  })

  it('#14 a suppression without a justification does not suppress (F3)', async () => {
    await scenario('a2bp-contam-14', async (s) => {
      // AGENTS.md §Security requires suppressions to carry a reason; an
      // unenforced requirement is a comment, not a rule.
      const f = await fixture(s)
      await f.writeIn(f.proj, CARRIER, '# Mocks\nSee /home/someuser/x  a2bp-allow:\n')

      const r = await f.a2bp(f.proj, [CARRIER])
      expect(
        r.rc,
        "a bare 'a2bp-allow:' with no justification suppressed the finding — the justification requirement is not enforced",
      ).not.toBe(0)
    })
  })

  it('#15 a file with no final newline round-trips byte-exactly (F3)', async () => {
    await scenario('a2bp-contam-15', async (s) => {
      // The reversal streams line by line; a naive `printf '%s\n'` per line would
      // silently append a newline the operator never wrote.
      const f = await fixture(s)
      const content = '# Mocks\nNo trailing newline here.'
      await f.writeIn(f.proj, CARRIER, content)

      const r = await f.a2bp(f.proj, [CARRIER])
      expect(r.rc, r.out).toBe(0)
      expect(await f.readBp(), 'not copied byte-exactly').toBe(content)
    })
  })

  it('#16 colliding forward forms keep their occurrence identity (R2-F1)', async () => {
    await scenario('a2bp-contam-16', async (s) => {
      // The round-1 fix keyed a map on line CONTENT: substituted-form → upstream
      // line. When the blueprint holds BOTH a `{{PROJECT_NAME}}` line and a
      // literal `acme-flow` line that render to the same bytes, the placeholder
      // line owned the key and EVERY matching project line was rewritten —
      // including the legitimate literal that never came from a placeholder.
      // Positional alignment is what fixes it.
      const f = await fixture(s)
      await f.writeBp(CARRIER, '{{PROJECT_NAME}}\nacme-flow\n')
      await f.writeIn(f.proj, CARRIER, 'acme-flow\nacme-flow\n')

      const r = await f.a2bp(f.proj, [CARRIER])
      const got = (await f.readBp()).replace(/\n+$/, '')
      expect(
        got,
        'CORRUPTION: the literal second occurrence was rewritten to {{PROJECT_NAME}} — provenance is keyed on content, not position',
      ).not.toBe('{{PROJECT_NAME}}\n{{PROJECT_NAME}}')
      expect(got, `unexpected staged result (exit ${r.rc})`).toBe('{{PROJECT_NAME}}\nacme-flow')
    })
  })

  it('#17 a relocated/duplicated risky line is judged as newly introduced (R2-F2)', async () => {
    await scenario('a2bp-contam-17', async (s) => {
      // A content-keyed exemption would wave it through just because those bytes
      // appear upstream once — and relocation can turn quoted prose into an
      // operative path.
      const f = await fixture(s)
      const hist = 'Historical note: the old tool wrote to /home/someuser/state.\n'
      await f.writeBp(CARRIER, `# Mocks\n${hist}`)
      await f.writeIn(f.proj, CARRIER, `# Mocks\n${hist}${hist}`)

      const r = await f.a2bp(f.proj, [CARRIER])
      expect(
        r.rc,
        "a duplicated host-path line was copied — the exemption is a content set, so a NEW occurrence inherited the old one's pass",
      ).not.toBe(0)
      const copy = await f.readBp()
      expect(
        copy.split('\n').filter((l) => l.includes('someuser')),
        'blueprint copy was modified despite the block',
      ).toHaveLength(1)
    })
  })

  it('#18 with no exemption list, even an untouched upstream risky line is scanned (R4-F2)', async () => {
    await scenario('a2bp-contam-18', async (s) => {
      // CONTRACT CHANGE at R4. There is no longer an alignment-derived exemption:
      // every staged line is scanned. Codex R4-F2 showed that an exemption list
      // is the one place a misattributed alignment can actually leak — a
      // relocated risky line inherits the pass of the line it aligned to. So the
      // exemption is gone, and the cost is exactly this case: an upstream line
      // that would itself trip a check now blocks even when untouched.
      //
      // That is the safe direction (a false BLOCK, never a false PASS) and it is
      // overridable per line.
      const f = await fixture(s)
      const hist = 'Historical note: the old tool wrote to /home/someuser/state.\n'
      await f.writeBp(CARRIER, `# Mocks\n${hist}`)
      await f.writeIn(f.proj, CARRIER, `# Mocks\n${hist}A newly added, perfectly generic line.\n`)

      const r = await f.a2bp(f.proj, [CARRIER])
      expect(
        r.rc,
        'an upstream host-path line passed unchecked — the alignment is still granting scan exemptions, which is the R4-F2 leak path',
      ).not.toBe(0)
      expect(
        /a2bp-allow/.test(r.out) || /someuser/.test(r.out),
        'blocked, but the output does not name the offending line or the way out',
      ).toBe(true)
    })
  })

  it('#18b ordinary edits to clean files still back-propagate', async () => {
    await scenario('a2bp-contam-18b', async (s) => {
      // Removing the exemption must not turn into "block everything".
      const f = await fixture(s)
      await f.writeBp(CARRIER, '# Mocks\nPerfectly ordinary upstream guidance.\n')
      await f.writeIn(
        f.proj,
        CARRIER,
        '# Mocks\nPerfectly ordinary upstream guidance.\nA newly added, perfectly generic line.\n',
      )

      const r = await f.a2bp(f.proj, [CARRIER])
      expect(r.rc, `a clean edit to a clean file was blocked\n${r.out}`).toBe(0)
      expect(await f.readBp(), 'the new generic line was not copied').toContain('newly added')
    })
  })

  it('#19 an ambiguous layout copies generic content only; the literal never lands (R3-F1)', async () => {
    await scenario('a2bp-contam-19', async (s) => {
      // Codex R3-F1 — an LCS match is not edit history. Insert a literal
      // `acme-flow` where the old placeholder line was, AND edit the original
      // placeholder line. `diff` aligns the INSERTED literal with the upstream
      // placeholder, so the round-2 code rewrote it to {{PROJECT_NAME}} and
      // exempted it from scanning — both from a tie-break, not from evidence.
      //
      // CONTRACT, narrowly. Codex proved across R1–R4 that no content-derived
      // matching recovers edit history, so the alignment WILL sometimes
      // misattribute and this fixture is one of those layouts. What is asserted
      // is the narrow invariant Codex agreed this case can legitimately evidence
      // (R5-F2): ON THE DEFAULT PATH, the literal project basename does not land
      // upstream. It is NOT evidence for any broader "no project-specific bytes
      // ever" claim — a2bp-allow and the NOTICE class both deliberately let
      // things through, and case #6 files a name-bearing file through a marked
      // line.
      const f = await fixture(s)
      await f.writeBp(CARRIER, 'HEAD\n{{PROJECT_NAME}}\nTAIL\n')
      await f.writeIn(f.proj, CARRIER, 'HEAD\nacme-flow\nedited-placeholder\nTAIL\n')

      const r = await f.a2bp(f.proj, [CARRIER])
      const copy = await f.readBp()
      expect(
        copy,
        'the literal project name reached the blueprint — this is the leak the whole guard exists to stop',
      ).not.toContain('acme-flow')
      // Either outcome is acceptable and both fail safe: the generic content is
      // copied, or the ambiguity is refused outright.
      expect(
        copy.includes('edited-placeholder') || r.rc !== 0,
        'nothing was copied yet a2bp exited 0',
      ).toBe(true)
    })
  })

  it('#20 an incomplete final line aligns, restores, and stays incomplete (R3-F2)', async () => {
    await scenario('a2bp-contam-20', async (s) => {
      // Codex R3-F2 — `%L` preserves the missing newline, so the last record was
      // unterminated and `while read` never saw it: the counters desynchronised
      // and the line was silently left unaligned. Case #15 only proved byte
      // preservation of an unchanged line; this proves RESTORATION on an
      // incomplete final line.
      //
      // The preceding line genuinely CHANGES, so this is a real request rather
      // than a no-op — restoration alone produces content identical to the base,
      // which a2bp now refuses to file, leaving nothing to inspect.
      const f = await fixture(s)
      await f.writeBp(CARRIER, 'first line\n{{PROJECT_NAME}}')
      await f.writeIn(f.proj, CARRIER, 'first line, edited\nacme-flow')

      const r = await f.a2bp(f.proj, [CARRIER])
      expect(
        r.rc,
        `an incomplete final line blocked — the record protocol is inheriting the input's line endings\n${r.out}`,
      ).toBe(0)
      const copy = await f.readBp()
      expect(
        copy.split('\n').at(-1),
        'the placeholder was not restored on an incomplete final line',
      ).toBe('{{PROJECT_NAME}}')
      expect(
        copy.endsWith('\n'),
        'a trailing newline was added that the operator never wrote',
      ).toBe(false)
    })
  })

  it('#21 a diff capability/runtime failure fails closed (R3-F3)', async () => {
    await scenario('a2bp-contam-21', async (s) => {
      // Codex R3-F3 — the GNU --*-line-format switches are extensions.
      // Swallowing an error into an empty alignment reads as "nothing is
      // attributable", and wholly unrestored project bytes then travel upstream.
      //
      // THE LINE CARRIES AN a2bp-allow MARKER, AND THAT IS THE POINT (BUG-104).
      // Without it this case was satisfied by the WRONG GUARD: with the
      // fail-closed check removed, staging passes the unrestored bytes through
      // and the RESIDUAL-PROJECT-NAME scan blocks them, so the case stayed green
      // over the defect in its own title and was red only under a mutant that
      // removed both. `a2bp-allow` is the product's one sanctioned override and
      // suppresses every check on its line — which is exactly the situation in
      // which the diff guard is the only thing left. Observed: C15 alone now
      // reds this (the request is FILED, carrying the literal name), and the
      // real tree still blocks.
      const f = await fixture(s)
      const allow = '<!-- a2bp-allow: the project name is this line\'s worked example -->'
      await f.writeBp(CARRIER, `# Mocks\nGeneric guidance for the {{PROJECT_NAME}} project. ${allow}\n`)
      await f.writeIn(f.proj, CARRIER, `# Mocks\nGeneric guidance for the acme-flow project. ${allow}\n`)

      const broken = await s.shimDir('broken-diff')
      await broken.add('diff', 'exit 2')

      const r = await f.a2bp(f.proj, [CARRIER], { pathPrefix: broken.dir })
      expect(
        await f.readBp(),
        "a broken 'diff' let UNRESTORED project bytes reach the blueprint",
      ).not.toContain('acme-flow')
      expect(
        r.rc,
        "staging failure exited 0 — a tool that could not run must never read as a clean pass (BUG-003's rule)",
      ).not.toBe(0)
    })
  })

  // #22 — R5-F1: ONE substitution semantics. The round-trip check is the
  // load-bearing safety property, and it used bash ${//} to verify what pull's
  // sed would later produce. Those differ for legal directory names:
  //
  //   name       bash ${//}           sed                  correct
  //   foo\bar    foo\bar              foobar               foo\bar
  //   a&b        a{{PROJECT_NAME}}b   a{{PROJECT_NAME}}b   a&b
  //
  // `&` means "the whole match" in a sed replacement, and bash 5.2 gave it the
  // same meaning — so BOTH were wrong, differently.
  //
  // THE SET IS SPLIT, and the split is a real constraint the request flow
  // introduces. The branch name carries the project name so a reviewer can see
  // whose request it is, and slugging it into something valid is forbidden — a
  // slug that differs from the real name destroys exactly the provenance the ref
  // exists to carry. So a project whose basename cannot be a git ref component
  // can file no request at all: `foo\bar` and `x*y` are legal directory names and
  // legal project names for pull, and are NOT legal refs. That is #22b.
  for (const meta of ['a&b', 'p.q']) {
    it(`#22[${meta}] a ref-legal metacharacter name round-trips through one substitution semantics (R5-F1)`, async () => {
      await scenario(`a2bp-contam-22-${Buffer.from(meta).toString('hex')}`, async (s) => {
        const f = await fixture(s)
        const mp = await f.makeProject(meta)
        await f.writeBp(CARRIER, '# Mocks\nName={{PROJECT_NAME}}\n')
        // The added line is load-bearing. With ONLY the name line, restoring the
        // placeholder makes the staged content byte-identical to the base, a2bp
        // correctly reports "nothing to request", and no branch is pushed —
        // leaving the staged bytes unobservable and this case asserting nothing.
        await f.writeIn(mp, CARRIER, `# Mocks\nName=${meta}\nA new generic line.\n`)

        const r = await f.a2bp(mp, [CARRIER])
        expect(
          r.rc,
          `a2bp exited for a legal basename containing a substitution metacharacter\n${r.out}`,
        ).toBe(0)
        const copy = await f.readBp()
        expect(
          copy,
          'the literal project name reached the blueprint — the placeholder was not restored',
        ).not.toContain(meta)
        expect(copy, 'placeholder not restored').toContain('{{PROJECT_NAME}}')
      })
    })
  }

  for (const meta of ['foo\\bar', 'x*y']) {
    it(`#22b[${meta}] a name that cannot be a ref component is refused, naming both the name and the reason`, async () => {
      await scenario(`a2bp-contam-22b-${Buffer.from(meta).toString('hex')}`, async (s) => {
        // The failure mode being excluded is silence: mangling the name into
        // something ref-legal, or failing with a raw git error that names neither
        // the project nor the reason. Either would leave the operator guessing
        // why their project alone cannot file requests.
        const f = await fixture(s)
        const mp = await f.makeProject(join('nr', meta))
        await f.writeBp(CARRIER, '# Mocks\nName={{PROJECT_NAME}}\n')
        await f.writeIn(mp, CARRIER, `# Mocks\nName=${meta}\nA new generic line.\n`)

        const r = await f.a2bp(mp, [CARRIER])
        expect(
          r.rc,
          'a project name that cannot be a ref component filed a request anyway — the name must have been mangled',
        ).not.toBe(0)
        expect(r.out, 'refused without naming the ref reason').toContain('not a valid branch name')
        expect(r.out, 'the refusal does not name the project').toContain(meta)
      })
    })
  }

  for (const meta of ['foo\\bar', 'a&b', 'p.q', 'x*y']) {
    it(`#23[${meta}] the project name is substituted as literal data (R5-F1)`, async () => {
      await scenario(`a2bp-contam-23-${Buffer.from(meta).toString('hex')}`, async (s) => {
        // The primitive itself must be literal in both directions, and pull must
        // agree with it. This is the assertion that would have caught the
        // divergence: substituting a placeholder with a metacharacter name must
        // yield the name verbatim, not sed's or bash 5.2's interpretation.
        const r = await ph(
          s,
          'bp_substitute_line "$1" "$2" "$(bp_placeholder_upper "$2")"',
          ['Name={{PROJECT_NAME}}', meta],
        )
        expect(r.code, r.output).toBe(0)
        expect(captured(r), 'substitution is not literal').toBe(`Name=${meta}`)
      })
    })
  }

  for (const meta of ['a&b', 'p.q']) {
    it(`#24[${meta}] pull → a2bp round-trips byte-identically and is recognised as a no-op (R5-F1)`, async () => {
      await scenario(`a2bp-contam-24-${Buffer.from(meta).toString('hex')}`, async (s) => {
        // THE case that actually catches it. #22 drives a2bp alone, and on the
        // parent commit a2bp used bash ${//} on BOTH sides, so it agreed with
        // itself and passed. The divergence Codex found is between a2bp's
        // verifier and PULL's sed, so the regression has to cross that boundary:
        // pull the file down into a project whose basename carries a
        // metacharacter, then push it straight back untouched. The blueprint must
        // be byte-identical afterwards.
        //
        // Ref-legal names only, for the reason at #22: a name that cannot be a
        // ref component never reaches the round-trip, so testing one here would
        // only re-assert #22b at the wrong layer.
        const f = await fixture(s)
        const mp = await f.makeProject(join('rt', meta))
        const original = '# Mocks\nName={{PROJECT_NAME}}\nUpper={{PROJECT_NAME_UPPER}}\n'
        await f.writeBp(CARRIER, original)

        const pulled = await f.pull(mp, [CARRIER, '--yes'])
        const projCopy = await s.fs.read(join('rt', meta, CARRIER)).catch(() => '')
        expect(
          projCopy,
          `pull did not substitute the name literally\n${pulled.output}`,
        ).toContain(`Name=${meta}`)

        // Under the request flow, agreement between pull and a2bp shows up as a
        // distinct, stronger signal than it used to: the round-trip is DETECTED
        // as a no-op and refused with "nothing to request" (6), instead of
        // quietly filing a request whose diff happens to be empty. Disagreement
        // shows up as a block (4) or as a filed request that changes the file.
        const r = await f.a2bp(mp, [CARRIER])
        expect(
          r.raw,
          `a2bp BLOCKED an untouched pull→a2bp round-trip — pull and the verifier disagree on this name\n${r.out}`,
        ).not.toBe(RC.BLOCKED)
        expect(
          r.raw,
          `expected 'nothing to request' (${RC.NOTHING}) for an untouched round-trip\n${r.out}`,
        ).toBe(RC.NOTHING)
        expect(await f.readBp(), 'pull→a2bp was not a no-op').toBe(original)
      })
    })
  }

  it('#25 a project name containing the token itself is not re-scanned (R6-F1)', async () => {
    await scenario('a2bp-contam-25', async (s) => {
      // Codex R6-F1 — the two tokens must be resolved in ONE pass. Replacing
      // UPPER and then feeding the result to the lowercase pass is a pipeline,
      // and a pipeline re-scans its own output: for a project named
      // `x{{PROJECT_NAME}}y` the bytes emitted by the first pass were
      // re-interpreted by the second, giving Xx{{PROJECT_NAME}}yY instead of
      // X{{PROJECT_NAME}}Y — contradicting the library's own claim that
      // replacement data is never re-scanned.
      const name = 'x{{PROJECT_NAME}}y'
      const r = await ph(
        s,
        'bp_substitute_line "$1" "$2" "$(bp_placeholder_upper "$2")"',
        ['{{PROJECT_NAME_UPPER}}', name],
      )
      expect(r.code, r.output).toBe(0)
      expect(captured(r), 'emitted replacement bytes were re-scanned').toBe('X{{PROJECT_NAME}}Y')
    })
  })

  it('#25b both tokens on one line resolve once each, earliest-first (R6-F1)', async () => {
    await scenario('a2bp-contam-25b', async (s) => {
      const r = await ph(s, 'bp_substitute_line "$1" "$2" "$3"', [
        'a{{PROJECT_NAME}}b{{PROJECT_NAME_UPPER}}c',
        'zz',
        'ZZ',
      ])
      expect(r.code, r.output).toBe(0)
      expect(captured(r), 'one-pass scan mis-ordered the tokens').toBe('azzbZZc')
    })
  })

  it('#26 an unrepresentable project name is refused explicitly (R6-F1)', async () => {
    await scenario('a2bp-contam-26', async (s) => {
      // A newline-bearing basename is legal on the filesystem; the substitution,
      // the diff alignment and the scan are all line-oriented. It used to be
      // silently truncated by `$(basename ...)`.
      const r = await ph(s, 'bp_validate_project_name "$1"', ['a\nb'])
      expect(
        r.code,
        'a newline-bearing project name was accepted — sync cannot represent it and would mangle it silently',
      ).not.toBe(0)
    })
  })

  it('#26b an ordinary project name is accepted', async () => {
    await scenario('a2bp-contam-26b', async (s) => {
      const r = await ph(s, 'bp_validate_project_name "$1"', ['perfectly-normal'])
      expect(r.code, 'the validator is too strict').toBe(0)
    })
  })

  it('#27 NUL-bearing content is refused, not silently truncated (R6-F2)', async () => {
    await scenario('a2bp-contam-27', async (s) => {
      // Codex R6-F2 — shell variables cannot hold NUL, so a bash rewrite silently
      // discards it and everything after: `printf 'A\0{{PROJECT_NAME}}\0Z'` came
      // back as a lone `A`. The old sed path preserved those bytes, so routing
      // pull through the primitive could have TRUNCATED a managed file.
      const f = await s.fs.write('nul-input', 'A\0{{PROJECT_NAME}}\0Z')
      const r = await ph(s, 'bp_substitute_stream "$1" "$2" > "$3"', [
        f,
        'acme-flow',
        s.workspace.path('nul-out'),
      ])
      expect(
        r.code,
        'a NUL-bearing file was substituted rather than refused — output would be truncated',
      ).not.toBe(0)
    })
  })

  it('#27b a refused in-place substitution leaves the file byte-identical (R6-F2)', async () => {
    await scenario('a2bp-contam-27b', async (s) => {
      const original = 'A\0{{PROJECT_NAME}}\0Z'
      await s.fs.write('nul-input', original)
      const target = await s.fs.write('nul-inplace', original)
      await ph(s, 'bp_substitute_in_place "$1" "$2" || true', [target, 'acme-flow'])
      expect(
        await s.fs.read('nul-inplace'),
        'the file was modified despite the refusal — half-written output',
      ).toBe(original)
    })
  })

  it('#28 a 4000-line file substitutes completely (R6-F2 streaming)', async () => {
    await scenario('a2bp-contam-28', async (s) => {
      // A behavioural floor (it completes, and byte-exactly), not a memory probe.
      const big = Array.from(
        { length: 4000 },
        (_, i) => `line ${i} mentions {{PROJECT_NAME}} in passing`,
      ).join('\n')
      const input = await s.fs.write('big-input', big + '\n')
      const outPath = s.workspace.path('big-out')

      const r = await ph(s, 'bp_substitute_stream "$1" "$2" > "$3"', [input, 'acme-flow', outPath])
      expect(r.code, `substitution failed on a 4000-line file\n${r.output}`).toBe(0)

      const produced = await s.fs.read('big-out')
      expect(
        produced.split('\n').filter((l) => l.includes('acme-flow')),
        'large-file substitution lost lines',
      ).toHaveLength(4000)
      expect(produced, 'large-file substitution left unresolved tokens').not.toContain(
        '{{PROJECT_NAME}}',
      )
    })
  })

  it('#30 BUG-105: a missing request library REFUSES the run, it does not file an unscanned request', async () => {
    await scenario('a2bp-contam-30', async (s) => {
      // THE SECOND HOLE BUG-105 RECORDS. `cmd_a2bp`'s required-libs loop could be
      // changed from `die` to `continue` and NOTHING went red in either
      // implementation, while the guard's own comment cites BUG-003 — "a guard
      // that cannot run is not a guard that passed". The `FAIL: scripts/lib/… is
      // missing` line the shell runners print is the SUITE checking its own
      // preconditions, not the CLI's behaviour.
      //
      // THE PATH MATTERS: `tests/*` is managed and NOT substituted, so with
      // contamination.mts absent and the refusal downgraded, staging is a plain
      // `cp` and the scan is reached only through the lib's import — so the
      // request would be filed with the scan having never run. That is the door
      // BUG-002 and A-09 came through, standing open. Any substitutable path
      // would instead fail in staging and be rejected for a different reason,
      // which is why this case does not use the carrier.
      const f = await fixture(s)
      const contaminated = 'tests/fixture/test.sh'
      const hostPath = '/home/someone/dev/acme-flow/secret'
      await f.writeIn(f.proj, contaminated, `echo fixture\n# see ${hostPath}\n`)

      const copyCli = async (rel: string, drop?: string): Promise<string> => {
        const dir = await s.fs.mkdirp(rel)
        // The copy needs its lib tree beside it (the CLI resolves libs from
        // its own directory), or every run here dies on a missing lib instead
        // of exercising the guard under test.
        for (const part of ['blueprint.mts', 'lib']) {
          const cp = await s.run('cp', ['-a', join(SUBJECT_ROOT, 'scripts', part), dir], {
            cwd: s.workspace.root,
          })
          expect(cp.code, `the fixture could not copy scripts/${part}\n${cp.output}`).toBe(0)
        }
        if (drop !== undefined) {
          const rm = await s.run('rm', ['-f', join(dir, 'lib', drop)], { cwd: s.workspace.root })
          expect(rm.code, rm.output).toBe(0)
          const gone = await s.run('test', ['-e', join(dir, 'lib', drop)], {
            cwd: s.workspace.root,
          })
          expect(gone.code, `${drop} is still present — this case would be vacuous`).not.toBe(0)
        }
        return join(dir, 'blueprint.mts')
      }

      // NON-VACUITY: the same copied CLI, complete, must reach the scan and
      // block. Without this, "nothing was filed" is satisfied by a CLI copy that
      // is broken for any reason at all.
      const control = await f.a2bp(f.proj, [contaminated], { cli: await copyCli('cli-whole') })
      expect(
        control.raw,
        `the copied CLI did not reach the contamination scan — the case below would be vacuous\n${control.out}`,
      ).toBe(RC.BLOCKED)
      expect(control.out.toUpperCase(), 'the control run reported no finding').toContain('BLOCK')

      const r = await f.a2bp(f.proj, [contaminated], {
        cli: await copyCli('cli-no-guard', 'contamination.mts'),
      })

      expect(
        await f.readBp(contaminated),
        'A REQUEST WAS FILED WITH THE CONTAMINATION GUARD ABSENT — the scan never ran',
      ).not.toContain(hostPath)
      expect(r.rc, `a2bp ran with its guard missing\n${r.out}`).not.toBe(0)
      expect(
        r.out,
        'refused, but not by the required-libs guard — a downstream failure is not the same as a refusal (BUG-003)',
      ).toContain('scripts/lib/contamination.mts is missing')
    })
  })
})
