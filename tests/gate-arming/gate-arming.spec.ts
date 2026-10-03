/**
 * tests/gate-arming/gate-arming.spec.ts — BUG-004 and BUG-032: the pre-push gate
 * must ARM ITSELF in a fresh clone.
 *
 * Parallelism hazard: none. Every case builds its own clone-shaped fixture inside
 * its own scenario workspace, and the two cases that start the activity feed stop
 * it again — a survivor fails the scenario, which is stricter than the shell
 * suite could be.
 *
 * THE DEFECT. `core.hooksPath` is repo-LOCAL config. `scripts/new-project.sh`
 * sets it at bootstrap, so a BOOTSTRAPPED project is gated — but a CLONE never
 * runs bootstrap, so `.githooks/pre-push` is present, correct, tested, and
 * completely inert. CLAUDE.md and the hook header itself claimed a `postinstall`
 * auto-wires it; there is no root `package.json`, so nothing ever did. Not
 * hypothetical: in this repo `core.hooksPath` was UNSET and the first push of 12
 * commits went out COMPLETELY UNGATED while the gate was being run by hand and
 * reported green (A-22).
 *
 * THE FIX SHAPE (agreed cross-stream, pattern P-13): an idempotent `arm_gate`
 * invoked from paths that ALREADY run on every wake — the activity feed and the
 * `blueprint` sync CLI — so arming is code on an existing path rather than an
 * instruction someone must remember.
 *
 * WHERE THE §3.3 LINE FALLS, AND IT IS THE CENTRAL QUESTION FOR THIS SUITE.
 * TASK-018-TARGET §3.3 exempts the pre-push hook's shell ENTRY POINT from the
 * TypeScript migration, because a TypeScript gate cannot report its own absence
 * when `npm ci` has not run. This suite does not port that entry point.
 * BUG-152's port moved `scripts/lib/gate.sh` to `scripts/lib/gate.mts`, and
 * TASK-088 deleted the shell adapter: the feed and the CLI now run the `.mts`
 * with node, and the cases below drive the real committed bytes the same way
 * (`callGate` runs `node gate.mts <subcommand>`), so what they prove about the
 * gate policy is unchanged.
 *
 * THE FIXTURE IS BUILT FROM `HEAD`, NOT FROM THE WORKING TREE. A clone carries
 * what is committed, so that is what a clone-shaped fixture must carry. The shell
 * suite did this for the fixture and then sourced the WORKING TREE copy for #8
 * and #10d, which is an inconsistency rather than a decision; every case here
 * uses the committed copy.
 *
 * EQUIVALENCE RECORD (R6). The retiring `tests/gate-arming/test.sh` and this spec
 * were run over the healthy repo plus one mutant of the gate helper per
 * assertion, and the per-case verdict sets diffed mechanically. The helper was
 * `scripts/lib/gate.sh` then; it is `scripts/lib/gate.mts` now, reached through
 * the sourced adapter, and the recipe below names the function and the
 * behaviour rather than the file for exactly that reason. One deliberate
 * divergence, recorded rather than smoothed over:
 *
 *   #9 INJECTS THE FAILING CONFIG WRITE RATHER THAN REMOVING WRITE PERMISSION.
 *   The shell version did `chmod a-w .git` and then SKIPPED ITSELF as root,
 *   because root ignores the mode bits. R7 forbids a skipped test, and a suite
 *   that silently covers less in CI containers (which commonly run as root) than
 *   on a developer's laptop is the BUG-005 shape. A `git` shim that fails ONLY
 *   the `config --local core.hooksPath` write reproduces the same condition
 *   deterministically for every uid, so the case now runs everywhere.
 *
 * MUTATION RECIPE (R6), each applied to the gate helper (gate.mts, through
 * the adapter) and committed to a fixture HEAD:
 *
 *   M1  `arm_gate` arms unconditionally (drop the `-n "$_ag_cur"` branch)
 *       Red: #5.
 *   M2  drop the `[ ! -x .githooks/pre-push ]` guard
 *       Red: #6.
 *   M3  `arm_gate` echoes nothing when already armed
 *       Red: #4.
 *   M4  `arm_gate` returns 1 outside a git work tree
 *       Red: #8.
 *   M5  `arm_gate` is silent outside a git work tree
 *       Red: #8.
 *   M6  the failed-write branch prints nothing
 *       Red: #9.
 *   M7  the failed-write branch propagates the non-zero status
 *       Red: #9.
 *   M8  `arm_push_keepalive` clobbers a foreign `core.sshCommand`
 *       Red: #10c.
 *   M9  `arm_push_keepalive` re-announces on every call
 *       Red: #10b.
 *   M10 remove the `arm_gate` call from `scripts/agent-activity.sh`
 *       Red: #2, #3.
 *   M11 remove the `arm_gate` call from `scripts/blueprint`
 *       Red: #7.
 *   M12 call `arm_gate` from the `--status` branch
 *       Red: #1.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'

/** `core.hooksPath` value that means "our gate is live". */
const OURS = '.githooks'

/**
 * A clone-shaped fixture: real committed content, `core.hooksPath` never set —
 * exactly what `git clone` gives you.
 *
 * Copies the SHIPPED artefacts straight out of `HEAD` rather than doing a full
 * archive-and-commit dance: `core.hooksPath` is settable on an empty repo, so no
 * commit is needed, and six full fixtures cost about nine seconds.
 */
async function mkClone(
  s: Scenario,
  name: string,
): Promise<{ dir: string; hooksPath(): Promise<string>; sshCommand(): Promise<string> }> {
  const repo = await s.gitRepo(name)

  const show = async (path: string): Promise<string> => {
    const r = await s.run('git', ['-C', REPO_ROOT, 'show', `HEAD:${path}`], {
      cwd: s.workspace.root,
    })
    if (r.code !== 0) throw new Error(`git show HEAD:${path} failed:\n${r.output}`)
    return r.stdout
  }

  for (const exe of ['.githooks/pre-push', 'scripts/agent-activity.sh']) {
    await s.fs.write(`${name}/${exe}`, await show(exe), { mode: 0o755 })
  }
  await s.fs.write(`${name}/scripts/blueprint.mts`, await show('scripts/blueprint.mts'))

  // THE WHOLE OF scripts/lib/, NEVER A NAMED FILE (the R12a lesson). Naming
  // gate.sh alone meant that adding any other lib the CLI sources silently broke
  // this fixture instead of testing it — which is exactly what happened when
  // placeholders.sh arrived in A-07 R5.
  const libs = await s.run('git', ['-C', REPO_ROOT, 'ls-tree', '--name-only', 'HEAD', 'scripts/lib/'], {
    cwd: s.workspace.root,
  })
  expect(libs.code, libs.output).toBe(0)
  const libPaths = libs.stdout.split('\n').filter(Boolean)
  expect(libPaths.length, 'HEAD carries no scripts/lib/ — the fixture would be useless').toBeGreaterThan(0)
  for (const lib of libPaths) {
    await s.fs.write(`${name}/${lib}`, await show(lib), { mode: 0o644 })
  }

  await s.fs.write(`${name}/AGENT_ROSTER.example.md`, await show('AGENT_ROSTER.example.md'))
  await s.fs.write(
    `${name}/AGENT_SIGNAL.md`,
    '# Agent Signal\n\n| Field | Value |\n|---|---|\n| Holder | S |\n| State | ACTIVE |\n| Task | fixture |\n',
  )
  await s.fs.mkdirp(`${name}/logs`)

  // GUARANTEE THE CLONE-SHAPED PRECONDITION, and prove the repo is real while
  // doing it. Several cases below assert `core.hooksPath` is EMPTY, and `git
  // config --get` prints nothing both for "unset in a working repo" and for
  // "there is no usable repo here at all" — so a fixture that silently failed to
  // initialise would make every one of those cases pass while testing nothing.
  // `makeFixtureRepo` already throws on a failed `git init`; reading back an
  // identity it wrote proves config writes FUNCTION here, which is the half that
  // matters.
  await repo.git(['config', '--unset', 'core.hooksPath'])
  expect(
    await repo.config('user.name'),
    `${name} is not a working git repo — every "hooksPath is empty" assertion would pass vacuously`,
  ).not.toBe('')

  return {
    dir: repo.dir,
    hooksPath: () => repo.config('core.hooksPath'),
    sshCommand: () => repo.config('core.sshCommand'),
  }
}

/** Run the fixture's committed `gate.mts` the way its callers do. */
async function callGate(
  s: Scenario,
  fixtureDir: string,
  call: string,
  options: { env?: Record<string, string | undefined>; cwd?: string } = {},
): Promise<{ code: number | null; output: string }> {
  // `call` is `<shell function> [<JSON-quoted path>]`; the function name maps
  // to the gate.mts subcommand both real callers run (agent-activity.sh and
  // blueprint.mts: `node scripts/lib/gate.mts arm-gate|arm-push-keepalive ROOT`).
  const [fn = '', ...rest] = call.split(' ')
  const sub = fn.replaceAll('_', '-')
  const args = rest.length > 0 ? [JSON.parse(rest.join(' ')) as string] : []
  const r = await s.run(process.execPath, [`${fixtureDir}/scripts/lib/gate.mts`, sub, ...args], {
    cwd: options.cwd ?? fixtureDir,
    env: options.env ?? {},
    timeoutMs: 60_000,
  })
  return { code: r.code, output: r.output }
}

describe('BUG-004 — the gate arms itself on paths that already run', () => {
  it('#1 --status does NOT arm (asking a question must not change config)', async () => {
    await scenario('gate-arming-1', async (s) => {
      const c = await mkClone(s, 'c1')
      expect(await c.hooksPath(), 'fixture wrong: the clone is already armed').toBe('')

      const r = await s.run('bash', [`${c.dir}/scripts/agent-activity.sh`, '--status'], {
        cwd: c.dir,
        timeoutMs: 60_000,
      })

      expect(
        await c.hooksPath(),
        `--status armed the gate; arming must not be a side effect of asking whether the feed runs\n${r.output}`,
      ).not.toBe(OURS)
    })
  })

  it('#1b --stop does NOT arm, tested on a fixture nothing armed first', async () => {
    await scenario('gate-arming-1b', async (s) => {
      // --stop needs its OWN unset fixture. Running it after --daemon cannot
      // distinguish "stop preserved unset" from "stop armed it", because the
      // daemon already armed that clone — the assertion would pass either way.
      const c = await mkClone(s, 'c1b')

      const r = await s.run('bash', [`${c.dir}/scripts/agent-activity.sh`, '--stop'], {
        cwd: c.dir,
        timeoutMs: 60_000,
      })

      expect(
        await c.hooksPath(),
        `--stop armed the gate; stopping the feed must not change git config\n${r.output}`,
      ).toBe('')
    })
  })

  it('#2 the feed arms an unarmed clone, and #3 says so out loud', async () => {
    await scenario('gate-arming-2', async (s) => {
      // #3 is asserted on the same run rather than in its own case: it is a
      // property of THIS output, and starting a second daemon to re-read it
      // would pay ~1.5 s for a string already in hand.
      const c = await mkClone(s, 'c2')

      const start = await s.run('bash', [`${c.dir}/scripts/agent-activity.sh`, '--daemon'], {
        cwd: c.dir,
        timeoutMs: 120_000,
      })
      const stop = await s.run('bash', [`${c.dir}/scripts/agent-activity.sh`, '--stop'], {
        cwd: c.dir,
        timeoutMs: 120_000,
      })

      expect(
        await c.hooksPath(),
        `BUG-004: a clone stayed UNGATED after the feed ran\n${start.output}\n${stop.output}`,
      ).toBe(OURS)
      // Founder decision: the gate state is REPORTED, not silent. A whole session
      // was spent believing the gate was armed when it was not, so "armed" must be
      // visible rather than something you have to go check.
      expect(
        start.output.toLowerCase(),
        'gate arming was silent — the founder asked for it to be explicit',
      ).toContain('gate')
    })
  })

  it('#4 already-armed state is confirmed explicitly, not silently assumed', async () => {
    await scenario('gate-arming-4', async (s) => {
      // #2 already proves the FEED calls arm_gate. The boundary cases from here
      // on exercise arm_gate directly instead of paying a daemon start/stop cycle
      // each. Composition: "the feed calls arm_gate" + "arm_gate behaves" covers
      // the integration.
      const c = await mkClone(s, 'c3')
      const set = await s.run('git', ['-C', c.dir, 'config', 'core.hooksPath', OURS], {
        cwd: c.dir,
      })
      expect(set.code, set.output).toBe(0)

      const r = await callGate(s, c.dir, `arm_gate ${JSON.stringify(c.dir)}`)

      expect(
        r.output.toLowerCase(),
        `an already-armed gate reported nothing — "explicit" must mean every run, not only on change\n${r.output}`,
      ).toContain('gate')
    })
  })

  it('#5 a deliberate foreign hooksPath is preserved AND warned about', async () => {
    await scenario('gate-arming-5', async (s) => {
      // Someone using husky or a shared hooks dir must not have their git config
      // silently rewritten by our feed (redcare's leg #2).
      const c = await mkClone(s, 'c4')
      await s.fs.mkdirp('c4/.other-hooks')
      await s.run('git', ['-C', c.dir, 'config', 'core.hooksPath', '.other-hooks'], { cwd: c.dir })

      const r = await callGate(s, c.dir, `arm_gate ${JSON.stringify(c.dir)}`)

      expect(
        await c.hooksPath(),
        `CLOBBERED a deliberate foreign core.hooksPath — silent config overwrite\n${r.output}`,
      ).toBe('.other-hooks')
      expect(
        r.output,
        'foreign hooksPath preserved but silently — the operator must be told the gate is not ours',
      ).toMatch(/warn|not armed|foreign|leaving/i)
    })
  })

  it('#6 does not arm when .githooks/pre-push is missing', async () => {
    await scenario('gate-arming-6', async (s) => {
      // Never point core.hooksPath at a directory that cannot gate — a dangling,
      // non-gating hooksPath reads as armed to everyone who checks.
      const c = await mkClone(s, 'c5')
      await s.fs.rm('c5/.githooks/pre-push')

      const r = await callGate(s, c.dir, `arm_gate ${JSON.stringify(c.dir)}`)

      expect(
        await c.hooksPath(),
        `armed a hooks dir with no pre-push\n${r.output}`,
      ).toBe('')
    })
  })

  it('#7 the blueprint CLI also arms an unarmed clone', async () => {
    await scenario('gate-arming-7', async (s) => {
      // The second call site, and the founder's reason for it: a derived
      // project's non-orchestrator sessions run `blueprint drift` at wake but are
      // told NOT to start the feed, so the CLI is the only covering path there.
      const c = await mkClone(s, 'c6')

      const r = await s.run('node', [`${c.dir}/scripts/blueprint.mts`, 'drift'], {
        cwd: c.dir,
        timeoutMs: 120_000,
      })

      expect(
        await c.hooksPath(),
        `the blueprint CLI left the clone UNGATED\n${r.output}`,
      ).toBe(OURS)
    })
  })

  it('#8 outside a git work tree: rc=0 AND it says so', async () => {
    await scenario('gate-arming-8', async (s) => {
      // arm_gate must never break its caller, and both legs are asserted
      // independently: rc=0 alone is not the contract, because a silent success
      // is exactly the "could not arm" / "never ran" ambiguity BUG-004 is about.
      //
      // Driven through arm_gate itself rather than through `--status`: by design
      // (#1) --status never calls arm_gate, so it exercises no degradation path
      // in the helper at all.
      const c = await mkClone(s, 'src')
      const notARepo = await s.workspace.dir('notarepo')

      const r = await callGate(s, c.dir, 'arm_gate', { cwd: notARepo })

      expect(r.code, `arm_gate returned ${r.code} outside a git repo — it would break every caller`).toBe(0)
      expect(
        r.output,
        '"reports the gate state ALWAYS" must hold on the failure paths too',
      ).toMatch(/not a git work tree|nothing to arm/i)
    })
  })

  it('#9 a failing config write degrades to a warning, caller unharmed', async () => {
    await scenario('gate-arming-9', async (s) => {
      // DIVERGENCE FROM THE SHELL SUITE, deliberate: that version removed write
      // permission from `.git` and then SKIPPED ITSELF as root, because root
      // ignores the mode bits. R7 forbids a skipped test, and covering less in a
      // root CI container than on a laptop is the BUG-005 shape.
      //
      // A `git` shim that fails ONLY the `config --local core.hooksPath` write —
      // and delegates everything else to the real git — reproduces the same
      // condition for every uid. It is also a closer model of the real-world
      // shape: a read-only checkout, a `config.lock` someone else holds.
      const c = await mkClone(s, 'c9')
      const shims = await s.shimDir('gitshim')
      const realGit = await s.run('sh', [await s.fs.write('which-git.sh', 'command -v git\n')], {
        cwd: s.workspace.root,
      })
      expect(realGit.stdout.trim(), 'no git on PATH').not.toBe('')

      await shims.add(
        'git',
        `for a in "$@"; do\n` +
          `  case "$a" in core.hooksPath) exit 1 ;; esac\n` +
          `done\n` +
          `exec ${JSON.stringify(realGit.stdout.trim())} "$@"\n`,
      )

      // NON-VACUITY: prove the shim is reached and that it fails the write while
      // leaving reads working, or this case is #2 with extra steps.
      const probe = await s.run(
        'sh',
        [
          await s.fs.write(
            'probe-shim.sh',
            `git -C ${JSON.stringify(c.dir)} config --local core.hooksPath .githooks\n` +
              `echo "WRITE_RC=$?"\n` +
              `git -C ${JSON.stringify(c.dir)} rev-parse --show-toplevel >/dev/null\n` +
              `echo "READ_RC=$?"\n`,
          ),
        ],
        { cwd: s.workspace.root, env: { PATH: shims.path() } },
      )
      expect(probe.output, 'the shim did not refuse the hooksPath write').toContain('WRITE_RC=1')
      expect(probe.output, 'the shim broke ordinary git reads — the case would fail for the wrong reason').toContain(
        'READ_RC=0',
      )

      const r = await callGate(s, c.dir, `arm_gate ${JSON.stringify(c.dir)}`, {
        env: { PATH: shims.path() },
      })

      expect(r.code, `arm_gate returned ${r.code} when the config write failed — must never fail its caller`).toBe(0)
      expect(
        r.output,
        'the config write failed but nothing said so — a silent non-arm reads as armed',
      ).toMatch(/could not set|NOT active/i)
      expect(await c.hooksPath(), 'the write was supposed to fail, yet the value landed').toBe('')
    })
  })
})

describe('BUG-152 — an absolute core.hooksPath resolving to our own .githooks is armed', () => {
  // A worktree-isolated agent launch rewrites core.hooksPath from `.githooks`
  // to an ABSOLUTE path (the worktree feature must make the value work from a
  // linked worktree, and the local config is shared across them, so it
  // absolutises). The hooks still fire — the path resolves to the same
  // directory — but a literal string compare in arm_gate read the absolutised
  // value as "someone else's hooks dir" and cried wolf on every wake. The fix
  // compares RESOLVED paths, not strings. Both cases below drive arm_gate
  // directly; the feed/CLI integration is #2/#7 and composes with these.

  it("#11 BUG-152: an absolute core.hooksPath resolving to the repo's own .githooks reports ARMED", async () => {
    await scenario('gate-arming-11', async (s) => {
      const c = await mkClone(s, 'c11')
      // Exactly what the worktree launch writes: the same directory, spelled
      // absolutely (no symlink games — resolution, not string identity, is
      // what the fix compares).
      const abs = join(c.dir, '.githooks')
      await s.run('git', ['-C', c.dir, 'config', 'core.hooksPath', abs], { cwd: c.dir })

      const r = await callGate(s, c.dir, `arm_gate ${JSON.stringify(c.dir)}`)

      expect(r.code, `arm_gate must never fail its caller\n${r.output}`).toBe(0)
      expect(
        r.output,
        `an absolute hooksPath that resolves to our own .githooks read as foreign — the BUG-152 false alarm\n${r.output}`,
      ).toMatch(/armed/i)
      expect(r.output, 'a resolved-own path must not draw the foreign-path warning').not.toMatch(/NOT active/i)
      // The value is LEFT alone: the worktree launch needs the absolute
      // spelling, so "accept" means "report armed", never "rewrite to relative".
      expect(await c.hooksPath()).toBe(abs)
    })
  })

  it('#12 BUG-152: a foreign absolute core.hooksPath is still refused', async () => {
    await scenario('gate-arming-12', async (s) => {
      // The other half of the fix's contract: "accept what resolves to ours"
      // must not become "accept anything absolute". Someone deliberately
      // pointing at husky, a shared hooks dir, or a test rig keeps the
      // BUG-004 non-clobber protection.
      const c = await mkClone(s, 'c12')
      const foreign = join(s.workspace.path('foreign-hooks'), 'hooks')
      await s.fs.mkdirp('foreign-hooks/hooks')
      await s.run('git', ['-C', c.dir, 'config', 'core.hooksPath', foreign], { cwd: c.dir })

      const r = await callGate(s, c.dir, `arm_gate ${JSON.stringify(c.dir)}`)

      expect(await c.hooksPath(), `CLOBBERED a deliberate foreign core.hooksPath\n${r.output}`).toBe(foreign)
      expect(
        r.output,
        'a foreign absolute path was preserved silently — the operator must be told the gate is not ours',
      ).toMatch(/leaving it alone|NOT active/i)
    })
  })
})

describe('BUG-032 — the push keepalive arms on the same paths, with the same non-clobber rule', () => {
  // git opens the SSH connection, THEN runs pre-push, THEN transfers on that
  // same connection. A ~380 s gate outlives the remote's idle timeout, so the
  // gate prints PASSED and the push dies with "Connection to <host> closed by
  // remote host" — or with nothing at all. It is armed beside the gate because it
  // is repo-LOCAL config and a clone therefore starts without it: the identical
  // trap as core.hooksPath, and the reason BUG-004 exists.

  it('#10 an unset core.sshCommand is armed with a keepalive', async () => {
    await scenario('gate-arming-10', async (s) => {
      const c = await mkClone(s, 'c10')
      expect(await c.sshCommand(), 'fixture wrong: the clone already carries a keepalive').toBe('')

      const r = await callGate(s, c.dir, `arm_push_keepalive ${JSON.stringify(c.dir)}`)

      expect(
        await c.sshCommand(),
        `core.sshCommand was left without a keepalive — a gate longer than the remote's idle timeout kills the push after a green run\n${r.output}`,
      ).toContain('ServerAliveInterval')
    })
  })

  it('#10b arming an already-armed keepalive is a silent no-op', async () => {
    await scenario('gate-arming-10b', async (s) => {
      // It runs on every wake, so it must be silent once armed — otherwise the
      // line becomes noise and the operator stops reading the block it is in.
      const c = await mkClone(s, 'c10b')
      const first = await callGate(s, c.dir, `arm_push_keepalive ${JSON.stringify(c.dir)}`)
      expect(first.output, 'the FIRST arm said nothing — #10b would pass vacuously').not.toBe('')

      const second = await callGate(s, c.dir, `arm_push_keepalive ${JSON.stringify(c.dir)}`)

      expect(second.output.trim(), `a second arm printed output: ${second.output}`).toBe('')
    })
  })

  it('#10c a deliberate core.sshCommand is preserved, and the operator is told', async () => {
    await scenario('gate-arming-10c', async (s) => {
      // Same contract as #5 for core.hooksPath. Silently rewriting another tool's
      // transport is worse than a slow push.
      const c = await mkClone(s, 'c10c')
      await s.run('git', ['-C', c.dir, 'config', 'core.sshCommand', 'ssh -i /custom/key'], {
        cwd: c.dir,
      })

      const r = await callGate(s, c.dir, `arm_push_keepalive ${JSON.stringify(c.dir)}`)

      expect(await c.sshCommand(), `CLOBBERED a deliberate core.sshCommand\n${r.output}`).toBe(
        'ssh -i /custom/key',
      )
      expect(
        r.output,
        'it preserved the setting but said nothing — a silent non-arm reads as armed',
      ).toMatch(/leaving it alone/i)
    })
  })

  it('#10d arm_push_keepalive returns 0 even outside a repo', async () => {
    await scenario('gate-arming-10d', async (s) => {
      // It runs on the wake path, where an exit would take the feed or drift down
      // with it.
      const c = await mkClone(s, 'src')
      const gone = s.workspace.path('nonexistent-dir-for-bug-032')

      const r = await callGate(s, c.dir, `arm_push_keepalive ${JSON.stringify(gone)}`)

      expect(r.code, `returned ${r.code} outside a repo — this runs on every wake\n${r.output}`).toBe(0)
    })
  })
})
