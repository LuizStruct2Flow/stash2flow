/**
 * tests/mic-recovery/mic-recovery.spec.ts — BUG-144: a failed dispatch must
 * not strand the mic.
 *
 * Observed live: a Kimi dispatch failed on a 403 (quota exhausted). Its wake
 * command exited without ever calling scripts/signal-set.sh, so the baton was
 * left reading exactly what it read before the dispatch — `Holder=Kimi
 * State=OVER_TO_KIMI` — and nothing told the Orchestrator. The mic was gone
 * until a human noticed.
 *
 * THE FIX (Orchestrator decision, in the brief for this item) lives in the
 * POLLER, once, for every provider — not in each of the three launchers. Each
 * launcher's own wake command already swallows its own exit status into a
 * printed finished/FAILED line (BUG-143) and the poller does not need to
 * parse that: it already knows which Holder/State it just dispatched. If the
 * live baton STILL reads exactly that pair once the dispatch call returns,
 * the poller hands the mic to the Orchestrator itself, through
 * scripts/signal-set.sh.
 *
 * This suite reproduces the failure with the simplest possible stand-in for
 * "a dispatch that ends without handing back the mic": a stub wake command
 * that exits 0 having done nothing. That is indistinguishable, from the
 * poller's side, from a crash or a quota refusal — which is exactly the
 * point: the fix does not depend on knowing WHY the dispatch failed to hand
 * back, only THAT it did.
 *
 * ROUND 3 (`findings.md` F-002 shape) fixed the production side — recovery
 * resolves the roster from BP_STATE_ROOT, never from dirname(signalFile) —
 * but left the suite reading the EXPECTED name from the REAL repo-root
 * roster: a per-engineer, gitignored file CI does not have, so the whole
 * file died in beforeAll (BUG-148, run 35841815567 on `1ee7b3d`). Both
 * layouts were wrong for the same reason: they depended on a file outside
 * the fixture. Round 1 fabricated a roster beside the baton (a layout
 * production never has); round 3 reached for the operator's real file.
 *
 * ROUND 4 (BUG-148) — THE FIXTURE OWNS THE WHOLE TREE. Each scenario builds
 * a repo-shaped tree of its own — a root marker (`.blueprint-source`), a
 * fixture-authored roster at THAT tree's root, the baton under its
 * `logs/state` — and runs a COPY of the watcher inside it. The watcher's
 * roster resolution is anchored to its own physical location (BP_CODE_ROOT,
 * never fixture-overridable — BUG-019), so a copied script inside the
 * fixture tree resolves the fixture's roster through the production path:
 * two directories apart, through the real `bp_roster_name_for_role`, with
 * every other resolution (state dir, signal-set.sh, the watcher lock)
 * landing inside the tree too. The expected Orchestrator is resolved per
 * scenario against the fixture's roster — never the operator's live one,
 * which this suite must run without (that is what "green in CI" means).
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { startWatcher, until } from '../harness/watcher.js'

/**
 * The tree under test. `BP_SPEC_ROOT` repoints it at a perturbed copy, which
 * is how the equivalence driver runs this spec over the same bytes (the same
 * precedent tests/watcher-liveness sets).
 */
const SUBJECT = process.env.BP_SPEC_ROOT ?? REPO_ROOT

const ROSTER_LIB = join(SUBJECT, 'scripts', 'lib', 'roster.sh')

/**
 * The fixture's own roster. The Orchestrator is a fixture persona,
 * deliberately distinct from the "Orchy" a handed-back baton names in the
 * negative cases below: if the watcher resolved ANY roster other than this
 * one — the operator's gitignored live roster, or none at all as in CI — the
 * recovery handback would land on a different Holder (or not land), and
 * every positive case goes red.
 */
const FIXTURE_ROSTER =
  '# Fixture roster for tests/mic-recovery (BUG-148). The suite resolves the\n' +
  '# Orchestrator through the real bp_roster_name_for_role against THIS file;\n' +
  '# nothing here reads the operator\'s gitignored AGENT_ROSTER.md.\n' +
  '\n' +
  '## Members\n' +
  '\n' +
  '| Role | Name | Backing agent |\n' +
  '|---|---|---|\n' +
  '| Orchestrator | FixtOrchy | Claude Code |\n' +
  '| Back-End-3 | Kimi | Kimi |\n'

/**
 * A repo-shaped tree inside the workspace (BUG-148): root marker, fixture
 * roster at the root, baton dir under `logs/state` — the production shape,
 * two directories apart.
 *
 * The copy is a live repo in every respect the derivations can see (the same
 * argument tests/watcher-liveness's liveRepo makes): the watcher's
 * BP_CODE_ROOT is its own physical location, so the copy resolves the
 * fixture's root on bp_state_root's first step, and every path it derives —
 * roster, state dir, watcher lock, signal-set.sh — stays inside the tree.
 */
async function liveRepo(s: Scenario, name: string): Promise<{ root: string; watch: string }> {
  const root = await s.fs.mkdirp(name)
  await s.fs.write(`${name}/.blueprint-source`, '')
  await s.fs.write(`${name}/AGENT_ROSTER.md`, FIXTURE_ROSTER)
  const watch = await s.fs.copyIn(
    join(SUBJECT, 'scripts', 'signal-watch.mts'),
    `${name}/scripts/signal-watch.mts`,
  )
  await s.fs.copyIn(join(SUBJECT, 'scripts', 'rotation.mts'), `${name}/scripts/rotation.mts`)
  // recoverStrandedMic hands back through scripts/signal-set.sh, resolved
  // from the SAME copied code root — the fixture copy must carry it, and its
  // mandatory lib/state-dir.sh source with it.
  await s.fs.copyIn(join(SUBJECT, 'scripts', 'signal-set.sh'), `${name}/scripts/signal-set.sh`)
  // The WHOLE lib dir, never named files — feed-fixture.ts records why.
  // TASK-065 (round 3): signal-watch.mts itself now imports a sibling .mts
  // lib (scripts/lib/spawn-bounded.mts), not just the .sh libs it sources
  // through the shell functions above — so the filter has to carry both
  // extensions, or the copied-out watcher fails ERR_MODULE_NOT_FOUND before
  // it ever gets to run.
  const libs = await s.run('sh', ['-c', `ls "${join(SUBJECT, 'scripts', 'lib')}"`], {
    cwd: s.workspace.root,
  })
  for (const n of libs.stdout.split('\n').filter((f) => f.endsWith('.sh') || f.endsWith('.mts'))) {
    await s.fs.copyIn(join(SUBJECT, 'scripts', 'lib', n), `${name}/scripts/lib/${n}`)
  }
  await s.fs.mkdirp(`${name}/logs/state`)
  return { root, watch }
}

/**
 * The exact name recoverStrandedMic must resolve, from the exact mechanism
 * it uses — the real `bp_roster_name_for_role` against the fixture tree's
 * root, never a stand-in and never the operator's roster (BUG-148).
 */
async function orchestratorOf(s: Scenario, root: string): Promise<string> {
  const r = await s.run(
    'bash',
    ['-c', `. "$1"; bp_roster_name_for_role "$2" Orchestrator`, 'bash', ROSTER_LIB, root],
    { cwd: s.workspace.root },
  )
  return r.stdout.trim()
}

async function readField(s: Scenario, signalPath: string, field: string): Promise<string> {
  const content = await s.fs.read(signalPath)
  for (const line of content.split('\n')) {
    const parts = line.split('|')
    if (parts.length < 3) continue
    if ((parts[1] ?? '').trim() === field) return (parts[2] ?? '').trim()
  }
  return ''
}

// GUARDS THE FIXTURE'S SHAPE FROM SILENTLY REGRESSING (Thomas/Kimi review).
// The whole point of the round-3/round-4 layout is that a roster fabricated
// beside the fixture baton proves the fixture, not the mechanism — a future
// edit re-adding `s.fs.write('.../state/AGENT_ROSTER.md', ...)` would quietly
// reopen that blind spot without failing anything, since the suite would go
// back to green for the wrong reason. Called once per scenario, right after
// its baton directory exists. The fixture's real roster sits at the tree
// ROOT, two directories up — this guard is about the state dir never
// carrying one.
async function assertNoRosterBesideBaton(s: Scenario, stateDirRel: string): Promise<void> {
  for (const name of ['AGENT_ROSTER.md', 'AGENT_ROSTER.example.md']) {
    expect(
      await s.fs.exists(`${stateDirRel}/${name}`),
      `${stateDirRel}/${name} exists — this fixture must not fabricate a roster beside the baton (round 3, findings.md F-002; BUG-148)`,
    ).toBe(false)
  }
}

describe('BUG-144 — a failed dispatch must not strand the mic', () => {
  it('TASK-065: records the dispatched run-log slice as quota before recovering the mic', async () => {
    await scenario('mic-recovery-rotation-quota', async (s) => {
      const live = await liveRepo(s, 'mic-recovery-rotation-quota')
      const stateDirRel = 'mic-recovery-rotation-quota/logs/state'
      const agentStateRel = 'state'
      const signalRel = `${stateDirRel}/signal.md`
      const signalPath = s.workspace.path(signalRel)
      const runLogPath = s.workspace.path(`${agentStateRel}/kimi-runs.log`)
      await s.fs.write(signalRel, '# Agent Signal\n\n| Field | Value |\n|---|---|\n| Holder | Kimi |\n| State | OVER_TO_KIMI |\n| Task | do the thing |\n')
      await s.fs.write(`${agentStateRel}/kimi-runs.log`, 'older run\n')
      const stub = await s.fs.write('mic-recovery-rotation-quota/stub-wake', '#!/bin/sh\n' +
        `printf "error: failed to run prompt: provider.auth_error: 403 You've reached your 5-hour usage limit\\nkimi FAILED (exit 1)\\n" >> "${runLogPath}"\n`, { mode: 0o755 })
      const w = startWatcher(s, 'node', [live.watch, '--file', signalPath, '--state', 'OVER_TO_KIMI', '--poll', '0.2', '--', stub], { cwd: s.workspace.root, env: { AGENT_SIGNAL_SETTLE: '0' } })
      await until('quota outcome is recorded', async () => {
        if (!await s.fs.exists(`${agentStateRel}/rotation.log`)) return false
        return (await s.fs.read(`${agentStateRel}/rotation.log`)).includes('"class":"quota"')
      })
      expect(await s.fs.read(`${agentStateRel}/rotation.log`)).toContain('"source":"' + runLogPath + '@10"')
      // TASK-065 slice 5: the recovered mic's Task names the outcome instead
      // of the old generic "read the provider run log" pointer.
      await until('the recovered mic names the outcome', async () => (await readField(s, signalRel, 'Task')).includes("rotation recorded a 'quota' outcome"))
      await w.stop()
    })
  })

  it('TASK-065: records a clean dispatched run-log slice as ok', async () => {
    await scenario('mic-recovery-rotation-ok', async (s) => {
      const live = await liveRepo(s, 'mic-recovery-rotation-ok')
      const stateDirRel = 'mic-recovery-rotation-ok/logs/state'
      const agentStateRel = 'state'
      const signalRel = `${stateDirRel}/signal.md`
      const signalPath = s.workspace.path(signalRel)
      const runLogPath = s.workspace.path(`${agentStateRel}/kimi-runs.log`)
      await s.fs.write(signalRel, '# Agent Signal\n\n| Field | Value |\n|---|---|\n| Holder | Kimi |\n| State | OVER_TO_KIMI |\n| Task | do the thing |\n')
      await s.fs.write(`${agentStateRel}/kimi-runs.log`, '')
      const stub = await s.fs.write('mic-recovery-rotation-ok/stub-wake', '#!/bin/sh\n' +
        `printf 'kimi finished\\n' >> "${runLogPath}"\n`, { mode: 0o755 })
      const w = startWatcher(s, 'node', [live.watch, '--file', signalPath, '--state', 'OVER_TO_KIMI', '--poll', '0.2', '--', stub], { cwd: s.workspace.root, env: { AGENT_SIGNAL_SETTLE: '0' } })
      await until('ok outcome is recorded', async () => (await s.fs.exists(`${agentStateRel}/rotation.log`)) && (await s.fs.read(`${agentStateRel}/rotation.log`)).includes('"class":"ok"'))
      await w.stop()
    })
  })

  it('TASK-065: a missing outcome recorder is logged and mic recovery still runs', async () => {
    await scenario('mic-recovery-rotation-missing', async (s) => {
      const live = await liveRepo(s, 'mic-recovery-rotation-missing')
      const orchestrator = await orchestratorOf(s, live.root)
      const signalRel = 'mic-recovery-rotation-missing/logs/state/signal.md'
      const signalPath = s.workspace.path(signalRel)
      const runLogPath = s.workspace.path('state/kimi-runs.log')
      const rotationPath = join(live.root, 'scripts', 'rotation.mts')
      await s.fs.write(signalRel, '# Agent Signal\n\n| Field | Value |\n|---|---|\n| Holder | Kimi |\n| State | OVER_TO_KIMI |\n| Task | do the thing |\n')
      await s.fs.write('state/kimi-runs.log', '')
      const stub = await s.fs.write('mic-recovery-rotation-missing/stub-wake', '#!/bin/sh\n' +
        `printf 'kimi FAILED (exit 1)\\n' >> "${runLogPath}"\n` +
        `mv "${rotationPath}" "${rotationPath}.gone"\n`, { mode: 0o755 })
      const w = startWatcher(s, 'node', [live.watch, '--file', signalPath, '--state', 'OVER_TO_KIMI', '--poll', '0.2', '--', stub], { cwd: s.workspace.root, env: { AGENT_SIGNAL_SETTLE: '0' } })
      await until('recorder failure is visible and the mic is recovered', async () => {
        const recovered = await readField(s, signalRel, 'Holder') === orchestrator
        const logged = (await s.fs.exists('state/signal.log')) && /rotation outcome recorder failed/.test(await s.fs.read('state/signal.log'))
        return recovered && logged
      })
      await w.stop()
    })
  })

  it('TASK-065: a recorder that hangs forever is timed out and the mic still recovers', async () => {
    // Codex four-eyes finding: recordDispatchOutcome used to run rotation.mts
    // with spawnSync and NO timeout. If the recorder (or anything it shells
    // out to) hangs, that call never returns, so recoverStrandedMic — a few
    // lines below it in triggerIfNeeded — is never reached. One hung recorder
    // then silences mic recovery for every provider (the BUG-001 unbounded-
    // wait class). The stub here overwrites the fixture's copy of
    // rotation.mts with a script that never exits on its own, the simplest
    // stand-in for "the recorder hung" that needs no knowledge of why
    // rotation.mts itself might hang.
    await scenario('mic-recovery-rotation-hang', async (s) => {
      const live = await liveRepo(s, 'mic-recovery-rotation-hang')
      const ORCHESTRATOR = await orchestratorOf(s, live.root)
      expect(ORCHESTRATOR, 'the fixture roster must resolve an Orchestrator').not.toBe('')
      const signalRel = 'mic-recovery-rotation-hang/logs/state/signal.md'
      const signalPath = s.workspace.path(signalRel)
      const runLogPath = s.workspace.path('state/kimi-runs.log')
      const rotationPath = join(live.root, 'scripts', 'rotation.mts')
      await s.fs.write(signalRel, '# Agent Signal\n\n| Field | Value |\n|---|---|\n| Holder | Kimi |\n| State | OVER_TO_KIMI |\n| Task | do the thing |\n')
      await s.fs.write('state/kimi-runs.log', '')
      const stub = await s.fs.write('mic-recovery-rotation-hang/stub-wake', '#!/bin/sh\n' +
        `printf 'kimi finished\\n' >> "${runLogPath}"\n` +
        // Replace the fixture's rotation.mts with a script that keeps the
        // event loop alive forever — the recorder's stand-in for "hung". A
        // bare unresolved top-level-await promise does NOT hang node (it
        // exits fast with "unsettled top-level await", verified directly);
        // a live timer is what actually keeps the process running.
        `printf 'setInterval(() => {}, 1000)\\n' > "${rotationPath}"\n`, { mode: 0o755 })
      const w = startWatcher(s, 'node', [live.watch, '--file', signalPath, '--state', 'OVER_TO_KIMI', '--poll', '0.2', '--', stub], { cwd: s.workspace.root, env: { AGENT_SIGNAL_SETTLE: '0' } })
      // Bounded well above the recorder's own timeout so a fix that bounds
      // the recorder still has room to pass, and well below the 30s default
      // so an unbounded hang (the bug) fails fast rather than after a full
      // `until` timeout.
      await until('the timeout is logged and the mic is recovered', async () => {
        const holder = await readField(s, signalRel, 'Holder')
        const state = await readField(s, signalRel, 'State')
        const recovered = holder === ORCHESTRATOR && state === 'OVER_TO_CLAUDE'
        const logged = (await s.fs.exists('state/signal.log')) && /rotation outcome recorder timed out after \d+ms/.test(await s.fs.read('state/signal.log'))
        return recovered && logged
      }, 15_000)
      await w.stop()
    })
  })

  it('TASK-065: signal-set.sh hanging on the recovery write times out, and the watcher never claims success', async () => {
    // Codex four-eyes re-review, follow-up to the rotation-hang case above:
    // recoverStrandedMic's own hand-back call to scripts/signal-set.sh ran
    // with spawnSync and NO timeout — the same BUG-001 shape, one step later
    // on the SAME recovery path. If signal-set.sh (or anything it shells out
    // to) hangs, the watcher never returns to its poll loop and the mic
    // stays stranded forever, silently — worse than a slow recovery, because
    // nothing ever says recovery failed. The stub overwrites the fixture's
    // own copy of signal-set.sh with a script that never exits, the same
    // "hang" stand-in the rotation case uses, at the one remaining unbounded
    // call on this path.
    await scenario('mic-recovery-signal-set-hang', async (s) => {
      const live = await liveRepo(s, 'mic-recovery-signal-set-hang')
      const signalRel = 'mic-recovery-signal-set-hang/logs/state/signal.md'
      const signalPath = s.workspace.path(signalRel)
      const signalSetPath = join(live.root, 'scripts', 'signal-set.sh')
      await s.fs.write(
        signalRel,
        '# Agent Signal\n\n| Field | Value |\n|---|---|\n| Holder | Kimi |\n| State | OVER_TO_KIMI |\n| Task | do the thing |\n',
      )
      const stub = await s.fs.write(
        'mic-recovery-signal-set-hang/stub-wake',
        '#!/bin/sh\n' +
          // Replace the fixture's signal-set.sh with a script that never
          // exits on its own — the hand-back call's stand-in for "hung".
          // Leaves the baton untouched, so recovery triggers exactly like
          // the "quota exhausted" case above.
          `printf '#!/bin/sh\\nsleep 100\\n' > "${signalSetPath}"\n` +
          `chmod +x "${signalSetPath}"\n`,
        { mode: 0o755 },
      )
      const w = startWatcher(
        s,
        'node',
        [live.watch, '--file', signalPath, '--state', 'OVER_TO_KIMI', '--poll', '0.2', '--', stub],
        { cwd: s.workspace.root, env: { AGENT_SIGNAL_SETTLE: '0' } },
      )
      // Bounded well above the recovery call's own timeout so a fix that
      // bounds it still has room to pass, and well below the 30s default so
      // an unbounded hang (the bug) fails fast rather than after a full
      // `until` timeout.
      await until(
        'the watcher logs that recovering the mic timed out',
        () => /recovering the mic to .* timed out after \d+ms/.test(w.output()),
        15_000,
      )
      w.assertStillRunning('a timed-out recovery must not hang the watcher itself')

      const holder = await readField(s, signalRel, 'Holder')
      const state = await readField(s, signalRel, 'State')
      expect(
        { holder, state },
        'signal-set.sh never completed its atomic rename, so the mic must be left exactly where it was — a timeout must never be read as a successful recovery',
      ).toEqual({ holder: 'Kimi', state: 'OVER_TO_KIMI' })

      await w.stop()
    })
  })

  // Is the OS pid still schedulable? Mirrors tests/harness/process.ts's own
  // `groupAlive` oracle (kill(pid, 0), ESRCH means gone) but on a bare pid
  // rather than a process GROUP — these two reproducers mark a single
  // grandchild by its own pid, not by a group the watcher itself owns, so
  // there is nothing to negate here.
  function pidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      // ESRCH means gone — the only fact this probe needs, and the one
      // TypeScript's DOM-flavoured NodeJS.ErrnoException typing cannot see
      // through a bare `catch` without an explicit cast; a returned `false`
      // is the whole point of the probe, not a swallowed error path.
      return false
    }
  }

  it('TASK-065 (Codex re-review): signal-set.sh hanging via a REAL GRANDCHILD — not the last command bash tail-call-execs away — is fully killed, and the recovery write times out', async () => {
    // The "signal-set.sh hanging" case above used a stub whose ENTIRE body was
    // `sleep 100` — the last (and only) command bash runs from the script.
    // Bash optimises exactly that shape away: when the last command in a
    // script is a simple external command with nothing left to do, bash
    // execve()s into it instead of forking, so `sleep` silently BECOMES the
    // timed-out spawn's DIRECT child (same pid bash had) rather than a
    // grandchild. Killing the direct child then trivially kills `sleep` too —
    // which is why that case passed even before this fix, and why it never
    // exercised the grandchild path recoverStrandedMic's SIGNAL_SET call
    // actually has to survive in production, where signal-set.sh legitimately
    // runs further commands of its own.
    //
    // This stub backgrounds `sleep` and then `wait`s for it — `wait` is a
    // shell BUILTIN, never exec()able, so bash can never tail-call away and
    // must stay alive as the direct child with `sleep` as a genuine
    // grandchild in the same process group. Verified directly against this
    // Node build (see the commit body): a timed-out spawnSync-shaped bound
    // that kills only the direct child returns on schedule but leaves this
    // exact grandchild running indefinitely — the defect this reproducer
    // pins, RED on main.
    await scenario('mic-recovery-signal-set-hang-grandchild', async (s) => {
      const live = await liveRepo(s, 'mic-recovery-signal-set-hang-grandchild')
      const signalRel = 'mic-recovery-signal-set-hang-grandchild/logs/state/signal.md'
      const signalPath = s.workspace.path(signalRel)
      const signalSetPath = join(live.root, 'scripts', 'signal-set.sh')
      const markerRel = 'mic-recovery-signal-set-hang-grandchild/grandchild-pid'
      const markerPath = s.workspace.path(markerRel)
      await s.fs.write(
        signalRel,
        '# Agent Signal\n\n| Field | Value |\n|---|---|\n| Holder | Kimi |\n| State | OVER_TO_KIMI |\n| Task | do the thing |\n',
      )
      const stub = await s.fs.write(
        'mic-recovery-signal-set-hang-grandchild/stub-wake',
        '#!/bin/sh\n' +
          `printf '#!/bin/sh\\nsleep 100 &\\necho $! > \"${markerPath}\"\\nwait\\n' > "${signalSetPath}"\n` +
          `chmod +x "${signalSetPath}"\n`,
        { mode: 0o755 },
      )
      const w = startWatcher(
        s,
        'node',
        [live.watch, '--file', signalPath, '--state', 'OVER_TO_KIMI', '--poll', '0.2', '--', stub],
        { cwd: s.workspace.root, env: { AGENT_SIGNAL_SETTLE: '0' } },
      )

      await until('the grandchild has recorded its own pid', () => s.fs.exists(markerRel))
      const grandchildPid = Number((await s.fs.read(markerRel)).trim())
      expect(grandchildPid, 'the stub should have captured a real pid').toBeGreaterThan(0)
      await until('the grandchild sleep is actually running', () => pidAlive(grandchildPid))

      await until(
        'the watcher logs that recovering the mic timed out',
        () => /recovering the mic to .* timed out after \d+ms/.test(w.output()),
        15_000,
      )
      w.assertStillRunning('a timed-out recovery must not hang the watcher itself')

      // THE CORE ASSERTION (TASK-065): the grandchild must be gone too, not
      // merely the direct child bash was. A bound that only kills the direct
      // child leaves this pid alive forever (it sleeps for 100s); a bound
      // that kills the whole process group reaps it within the same window
      // the watcher's own timeout already proved.
      await until(
        'the leftover grandchild sleep is no longer running',
        () => !pidAlive(grandchildPid),
        5000,
      )

      const holder = await readField(s, signalRel, 'Holder')
      const state = await readField(s, signalRel, 'State')
      expect(
        { holder, state },
        'signal-set.sh never completed its atomic rename, so the mic must be left exactly where it was',
      ).toEqual({ holder: 'Kimi', state: 'OVER_TO_KIMI' })

      await w.stop()
    })
  })

  it('TASK-065 (Codex re-review): roster resolution hanging via a REAL GRANDCHILD that holds the stdout PIPE open still times out, and nothing is left running', async () => {
    // The second bounded probe on the recovery path, and the one that
    // actually READS STDOUT through a pipe (`stdio: ['ignore', 'pipe',
    // 'inherit']`) rather than inheriting it: recoverStrandedMic's own
    // `bp_roster_name_for_role` lookup. Same shape as the signal-set.sh case
    // above — the grandchild is backgrounded and `wait`ed for, never the
    // shell's own tail-call-execed last command — but here the write end of
    // the captured pipe is what a grandchild left open would matter for.
    await scenario('mic-recovery-roster-hang', async (s) => {
      const live = await liveRepo(s, 'mic-recovery-roster-hang')
      const signalRel = 'mic-recovery-roster-hang/logs/state/signal.md'
      const signalPath = s.workspace.path(signalRel)
      const runLogPath = s.workspace.path('state/kimi-runs.log')
      const rosterLibPath = join(live.root, 'scripts', 'lib', 'roster.sh')
      const markerRel = 'mic-recovery-roster-hang/grandchild-pid'
      const markerPath = s.workspace.path(markerRel)
      await s.fs.write(
        signalRel,
        '# Agent Signal\n\n| Field | Value |\n|---|---|\n| Holder | Kimi |\n| State | OVER_TO_KIMI |\n| Task | do the thing |\n',
      )
      await s.fs.write('state/kimi-runs.log', '')
      // The wake command itself finishes fine (it is not what hangs); it
      // overwrites the fixture's OWN copy of roster.sh with a single
      // function whose body backgrounds `sleep` and `wait`s for it, so the
      // recovery roster lookup that runs AFTER this stub exits is what hits
      // the hang.
      const stub = await s.fs.write(
        'mic-recovery-roster-hang/stub-wake',
        '#!/bin/sh\n' +
          `printf 'kimi finished\\n' >> "${runLogPath}"\n` +
          `cat > "${rosterLibPath}" <<'EOS'\n` +
          'bp_roster_name_for_role() {\n' +
          `  sleep 100 & echo $! > "${markerPath}"\n` +
          '  wait\n' +
          '}\n' +
          'EOS\n',
        { mode: 0o755 },
      )
      const w = startWatcher(
        s,
        'node',
        [live.watch, '--file', signalPath, '--state', 'OVER_TO_KIMI', '--poll', '0.2', '--', stub],
        { cwd: s.workspace.root, env: { AGENT_SIGNAL_SETTLE: '0' } },
      )

      await until('the grandchild has recorded its own pid', () => s.fs.exists(markerRel))
      const grandchildPid = Number((await s.fs.read(markerRel)).trim())
      expect(grandchildPid, 'the stub should have captured a real pid').toBeGreaterThan(0)
      await until('the grandchild sleep is actually running', () => pidAlive(grandchildPid))

      await until(
        'the watcher logs that resolving the Orchestrator timed out',
        () => /resolving the Orchestrator timed out after \d+ms/.test(w.output()),
        15_000,
      )
      w.assertStillRunning('a timed-out roster resolution must not hang the watcher itself')

      await until(
        'the leftover grandchild sleep is no longer running',
        () => !pidAlive(grandchildPid),
        5000,
      )

      const holder = await readField(s, signalRel, 'Holder')
      const state = await readField(s, signalRel, 'State')
      expect(
        { holder, state },
        'the roster could not be resolved, so the mic must be left exactly where the stub stranded it',
      ).toEqual({ holder: 'Kimi', state: 'OVER_TO_KIMI' })

      await w.stop()
    })
  })

  it('a stub wake command that exits without flipping the baton is recovered: the mic returns to the Orchestrator', async () => {
    await scenario('mic-recovery-1', async (s) => {
      const live = await liveRepo(s, 'mic-recovery-1')
      const ORCHESTRATOR = await orchestratorOf(s, live.root)
      expect(ORCHESTRATOR, 'the fixture roster must resolve an Orchestrator').not.toBe('')
      const stateDirRel = 'mic-recovery-1/logs/state'
      await assertNoRosterBesideBaton(s, stateDirRel)
      const signalRel = `${stateDirRel}/signal.md`
      const signalPath = s.workspace.path(signalRel)

      await s.fs.write(
        signalRel,
        '# Agent Signal\n\n| Field | Value |\n|---|---|\n' +
          '| Holder | Kimi |\n| State | OVER_TO_KIMI |\n| Task | do the thing |\n',
      )

      // A dispatch that ends without ever touching the baton — the simplest
      // stand-in for "quota exhausted", "crashed" or "forgot to hand back":
      // the poller cannot tell these apart and must not need to.
      const stub = await s.fs.write('mic-recovery-1/stub-wake', '#!/bin/sh\nexit 0\n', {
        mode: 0o755,
      })

      const w = startWatcher(
        s,
        'node',
        [
          live.watch,
          '--file', signalPath,
          '--state', 'OVER_TO_KIMI',
          '--poll', '0.2',
          '--',
          stub,
        ],
        { cwd: s.workspace.root, env: { AGENT_SIGNAL_SETTLE: '0' } },
      )

      await until('the mic is handed back to the Orchestrator', async () => {
        w.assertStillRunning('the watcher must keep polling after recovering the mic')
        const holder = await readField(s, signalRel, 'Holder')
        const state = await readField(s, signalRel, 'State')
        return holder === ORCHESTRATOR && state === 'OVER_TO_CLAUDE'
      })

      const task = await readField(s, signalRel, 'Task')
      expect(task, 'the handback Task should name who stranded the mic').toContain('Kimi')
      expect(
        task,
        'the handback Task should point at the provider run log',
      ).toContain('run log')

      await w.stop()
    })
  })

  it('BUG-144: a stub wake command that claims ACTIVE and then dies is recovered: the mic returns to the Orchestrator', async () => {
    await scenario('mic-recovery-3', async (s) => {
      const live = await liveRepo(s, 'mic-recovery-3')
      const ORCHESTRATOR = await orchestratorOf(s, live.root)
      expect(ORCHESTRATOR, 'the fixture roster must resolve an Orchestrator').not.toBe('')
      const stateDirRel = 'mic-recovery-3/logs/state'
      await assertNoRosterBesideBaton(s, stateDirRel)
      const signalRel = `${stateDirRel}/signal.md`
      const signalPath = s.workspace.path(signalRel)

      await s.fs.write(
        signalRel,
        '# Agent Signal\n\n| Field | Value |\n|---|---|\n' +
          '| Holder | Kimi |\n| State | OVER_TO_KIMI |\n| Task | do the thing |\n',
      )

      // The common failure path (observed live 2026-09-22): the dispatched
      // agent claims the mic first (Holder stays the same, State flips to
      // ACTIVE — every well-behaved agent does this), then its CLI dies
      // before it ever hands the mic back. The wake command exits having
      // left the baton at Holder=Kimi State=ACTIVE, not at the dispatched
      // OVER_TO_KIMI pair.
      const stub = await s.fs.write(
        'mic-recovery-3/stub-wake',
        '#!/bin/sh\n' +
          `printf '# Agent Signal\\n\\n| Field | Value |\\n|---|---|\\n| Holder | Kimi |\\n| State | ACTIVE |\\n| Task | do the thing |\\n' > "${signalPath}"\n` +
          'exit 1\n',
        { mode: 0o755 },
      )

      const w = startWatcher(
        s,
        'node',
        [
          live.watch,
          '--file', signalPath,
          '--state', 'OVER_TO_KIMI',
          '--poll', '0.2',
          '--',
          stub,
        ],
        { cwd: s.workspace.root, env: { AGENT_SIGNAL_SETTLE: '0' } },
      )

      await until('the mic is handed back to the Orchestrator', async () => {
        w.assertStillRunning('the watcher must keep polling after recovering the mic')
        const holder = await readField(s, signalRel, 'Holder')
        const state = await readField(s, signalRel, 'State')
        return holder === ORCHESTRATOR && state === 'OVER_TO_CLAUDE'
      })

      const task = await readField(s, signalRel, 'Task')
      expect(task, 'the handback Task should name who stranded the mic').toContain('Kimi')
      expect(
        task,
        'the handback Task should point at the provider run log',
      ).toContain('run log')

      await w.stop()
    })
  })

  it('BUG-150: a stub wake command that claims ACTIVE with a CHANGED Task and then dies is still recovered', async () => {
    // The docblock's old assumption — "a well-behaved agent claims ACTIVE
    // without touching Task" — is false: every dispatch brief tells the agent
    // to write its own summary when it claims ACTIVE, exactly like mic-recovery-3
    // above except the Task text actually changes (the real-world case, observed
    // live 2026-09-23 with Thomas/Kimi on BUG-148). Round 3's Holder+Task match
    // treated the rewritten Task as "not my dispatch any more" and left the mic
    // stranded — this case must recover exactly like mic-recovery-3 despite the
    // Task no longer reading "do the thing".
    await scenario('mic-recovery-5', async (s) => {
      const live = await liveRepo(s, 'mic-recovery-5')
      const ORCHESTRATOR = await orchestratorOf(s, live.root)
      expect(ORCHESTRATOR, 'the fixture roster must resolve an Orchestrator').not.toBe('')
      const stateDirRel = 'mic-recovery-5/logs/state'
      await assertNoRosterBesideBaton(s, stateDirRel)
      const signalRel = `${stateDirRel}/signal.md`
      const signalPath = s.workspace.path(signalRel)

      await s.fs.write(
        signalRel,
        '# Agent Signal\n\n| Field | Value |\n|---|---|\n' +
          '| Holder | Kimi |\n| State | OVER_TO_KIMI |\n| Task | do the thing |\n',
      )

      // Same shape as mic-recovery-3, except the ACTIVE claim REWRITES Task to
      // the agent's own summary — the thing every real dispatch brief asks the
      // agent to do, and the thing round 3's Holder+Task match could not
      // tolerate.
      const stub = await s.fs.write(
        'mic-recovery-5/stub-wake',
        '#!/bin/sh\n' +
          `printf '# Agent Signal\\n\\n| Field | Value |\\n|---|---|\\n| Holder | Kimi |\\n| State | ACTIVE |\\n| Task | Fixing BUG-148 (own summary, not the dispatch text) |\\n' > "${signalPath}"\n` +
          'exit 1\n',
        { mode: 0o755 },
      )

      const w = startWatcher(
        s,
        'node',
        [
          live.watch,
          '--file', signalPath,
          '--state', 'OVER_TO_KIMI',
          '--poll', '0.2',
          '--',
          stub,
        ],
        { cwd: s.workspace.root, env: { AGENT_SIGNAL_SETTLE: '0' } },
      )

      await until('the mic is handed back to the Orchestrator', async () => {
        w.assertStillRunning('the watcher must keep polling after recovering the mic')
        const holder = await readField(s, signalRel, 'Holder')
        const state = await readField(s, signalRel, 'State')
        return holder === ORCHESTRATOR && state === 'OVER_TO_CLAUDE'
      })

      const task = await readField(s, signalRel, 'Task')
      expect(task, 'the handback Task should name who stranded the mic').toContain('Kimi')
      expect(
        task,
        'the handback Task should point at the provider run log',
      ).toContain('run log')

      await w.stop()
    })
  })

  it('BUG-150: a journal truncated below the marker leaves the mic alone, with the reason logged', async () => {
    // Reviewer finding on the BUG-150 fix: hasNewDispatchSince/journalLines
    // FAILS OPEN when the journal cannot answer "was anything new dispatched"
    // — a missing, unreadable, or shorter-than-the-marker journal degrades to
    // "no new dispatch" and recovery clobbers the baton on top of whatever
    // really happened. The journal had 2 lines when the watcher captured its
    // marker (recoverStrandedMic's `dispatchMarker`); this stub then shrinks
    // it to 1 line — fewer than the marker — before dying, the same shape a
    // half-written truncation or a losing race with log rotation would leave
    // behind. The mic must be left exactly where the stub left it (Kimi,
    // ACTIVE) and the watcher must say why, not silently recover as if
    // nothing had been recorded.
    await scenario('mic-recovery-7', async (s) => {
      const live = await liveRepo(s, 'mic-recovery-7')
      const stateDirRel = 'mic-recovery-7/logs/state'
      await assertNoRosterBesideBaton(s, stateDirRel)
      const signalRel = `${stateDirRel}/signal.md`
      const signalPath = s.workspace.path(signalRel)
      const journalRel = `${stateDirRel}/signal-history.log`
      const journalPath = s.workspace.path(journalRel)

      await s.fs.write(
        signalRel,
        '# Agent Signal\n\n| Field | Value |\n|---|---|\n' +
          '| Holder | Kimi |\n| State | OVER_TO_KIMI |\n| Task | do the thing |\n',
      )
      // Two lines already on the journal BEFORE the watcher starts, so its
      // dispatch marker is 2 by the time it fires on the already-OVER_TO_KIMI
      // baton above.
      await s.fs.write(
        journalRel,
        '[2026-09-23T00:00:00Z] Holder=Kimi State=OVER_TO_KIMI Task=earlier\n' +
          '[2026-09-23T00:00:01Z] Holder=Kimi State=ACTIVE Task=earlier\n',
      )

      const stub = await s.fs.write(
        'mic-recovery-7/stub-wake',
        '#!/bin/sh\n' +
          // Shrinks the journal to ONE line — below the marker (2) — before
          // the baton is left stranded.
          `printf '[2026-09-23T00:00:02Z] Holder=Kimi State=ACTIVE Task=earlier\\n' > "${journalPath}"\n` +
          `printf '# Agent Signal\\n\\n| Field | Value |\\n|---|---|\\n| Holder | Kimi |\\n| State | ACTIVE |\\n| Task | do the thing |\\n' > "${signalPath}"\n` +
          'exit 1\n',
        { mode: 0o755 },
      )

      const w = startWatcher(
        s,
        'node',
        [
          live.watch,
          '--file', signalPath,
          '--state', 'OVER_TO_KIMI',
          '--poll', '0.2',
          '--',
          stub,
        ],
        { cwd: s.workspace.root, env: { AGENT_SIGNAL_SETTLE: '0' } },
      )

      await until('the baton reflects the stub\'s own stranded write', async () => {
        const holder = await readField(s, signalRel, 'Holder')
        const state = await readField(s, signalRel, 'State')
        return holder === 'Kimi' && state === 'ACTIVE'
      })

      // Recovery, if it fires at all, runs synchronously inside the watcher's
      // poll tick (spawnSync all the way down) — so waiting for its OWN
      // announcement is the deterministic signal, not a fixed sleep raced
      // against however long roster resolution + signal-set.sh happen to
      // take. Pre-fix, this line never appears (the anomaly is never
      // detected) and this `until` times out — that IS the red.
      w.assertStillRunning('the watcher must still be polling')
      await until(
        'the watcher explains it left the mic alone because of the journal',
        () => /journal/i.test(w.output()),
        5000,
      )

      const holder = await readField(s, signalRel, 'Holder')
      const state = await readField(s, signalRel, 'State')
      const task = await readField(s, signalRel, 'Task')
      expect(
        { holder, state, task },
        'the baton must be left exactly where the stub put it, not clobbered by a recovery that could not safely reason about the journal',
      ).toEqual({ holder: 'Kimi', state: 'ACTIVE', task: 'do the thing' })

      await w.stop()
    })
  })

  it('BUG-150: a deleted journal leaves the mic alone, with the reason logged', async () => {
    // Same anomaly as above, the other shape the docblock names: the journal
    // is gone entirely (unlink, not truncate) by the time the watcher
    // re-checks — readFileSync throws ENOENT, and a marker > 0 means this is
    // not the legitimate cold-start case (journalLines' own docblock), it is
    // a journal that existed and stopped existing.
    await scenario('mic-recovery-8', async (s) => {
      const live = await liveRepo(s, 'mic-recovery-8')
      const stateDirRel = 'mic-recovery-8/logs/state'
      await assertNoRosterBesideBaton(s, stateDirRel)
      const signalRel = `${stateDirRel}/signal.md`
      const signalPath = s.workspace.path(signalRel)
      const journalRel = `${stateDirRel}/signal-history.log`
      const journalPath = s.workspace.path(journalRel)

      await s.fs.write(
        signalRel,
        '# Agent Signal\n\n| Field | Value |\n|---|---|\n' +
          '| Holder | Kimi |\n| State | OVER_TO_KIMI |\n| Task | do the thing |\n',
      )
      await s.fs.write(
        journalRel,
        '[2026-09-23T00:00:00Z] Holder=Kimi State=OVER_TO_KIMI Task=earlier\n',
      )

      const stub = await s.fs.write(
        'mic-recovery-8/stub-wake',
        '#!/bin/sh\n' +
          `rm -f "${journalPath}"\n` +
          `printf '# Agent Signal\\n\\n| Field | Value |\\n|---|---|\\n| Holder | Kimi |\\n| State | ACTIVE |\\n| Task | do the thing |\\n' > "${signalPath}"\n` +
          'exit 1\n',
        { mode: 0o755 },
      )

      const w = startWatcher(
        s,
        'node',
        [
          live.watch,
          '--file', signalPath,
          '--state', 'OVER_TO_KIMI',
          '--poll', '0.2',
          '--',
          stub,
        ],
        { cwd: s.workspace.root, env: { AGENT_SIGNAL_SETTLE: '0' } },
      )

      await until('the baton reflects the stub\'s own stranded write', async () => {
        const holder = await readField(s, signalRel, 'Holder')
        const state = await readField(s, signalRel, 'State')
        return holder === 'Kimi' && state === 'ACTIVE'
      })

      w.assertStillRunning('the watcher must still be polling')
      await until(
        'the watcher explains it left the mic alone because of the journal',
        () => /journal/i.test(w.output()),
        5000,
      )

      const holder = await readField(s, signalRel, 'Holder')
      const state = await readField(s, signalRel, 'State')
      const task = await readField(s, signalRel, 'Task')
      expect(
        { holder, state, task },
        'the baton must be left exactly where the stub put it, not clobbered by a recovery that could not safely reason about the journal',
      ).toEqual({ holder: 'Kimi', state: 'ACTIVE', task: 'do the thing' })

      await w.stop()
    })
  })

  it('a dispatch that DID hand back the mic is left alone — the poller does nothing', async () => {
    await scenario('mic-recovery-2', async (s) => {
      const live = await liveRepo(s, 'mic-recovery-2')
      const stateDirRel = 'mic-recovery-2/logs/state'
      await assertNoRosterBesideBaton(s, stateDirRel)
      const signalRel = `${stateDirRel}/signal.md`
      const signalPath = s.workspace.path(signalRel)

      await s.fs.write(
        signalRel,
        '# Agent Signal\n\n| Field | Value |\n|---|---|\n' +
          '| Holder | Kimi |\n| State | OVER_TO_KIMI |\n| Task | do the thing |\n',
      )

      // A dispatch that DOES hand back — writes a new baton before exiting,
      // the same shape a genuine agent's own signal-set.sh call produces.
      const stub = await s.fs.write(
        'mic-recovery-2/stub-wake',
        '#!/bin/sh\n' +
          `printf '# Agent Signal\\n\\n| Field | Value |\\n|---|---|\\n| Holder | Orchy |\\n| State | ACTIVE |\\n| Task | done |\\n' > "${signalPath}"\n`,
        { mode: 0o755 },
      )

      const w = startWatcher(
        s,
        'node',
        [
          live.watch,
          '--file', signalPath,
          '--state', 'OVER_TO_KIMI',
          '--poll', '0.2',
          '--',
          stub,
        ],
        { cwd: s.workspace.root, env: { AGENT_SIGNAL_SETTLE: '0' } },
      )

      await until('the dispatch has landed', async () => {
        const holder = await readField(s, signalRel, 'Holder')
        const state = await readField(s, signalRel, 'State')
        return holder === 'Orchy' && state === 'ACTIVE'
      })

      // Give the poller several more iterations to prove it does NOT also
      // fire a recovery on top of a baton that already moved.
      w.assertStillRunning('the watcher must still be polling')
      await until(
        'a few more polls pass with the baton unchanged',
        async () => {
          const holder = await readField(s, signalRel, 'Holder')
          const state = await readField(s, signalRel, 'State')
          const task = await readField(s, signalRel, 'Task')
          return holder === 'Orchy' && state === 'ACTIVE' && task === 'done'
        },
        2000,
      )

      await w.stop()
    })
  })

  it('BUG-144 control: a dispatch that claims ACTIVE then hands off to someone else is left alone', async () => {
    await scenario('mic-recovery-4', async (s) => {
      const live = await liveRepo(s, 'mic-recovery-4')
      const stateDirRel = 'mic-recovery-4/logs/state'
      await assertNoRosterBesideBaton(s, stateDirRel)
      const signalRel = `${stateDirRel}/signal.md`
      const signalPath = s.workspace.path(signalRel)

      await s.fs.write(
        signalRel,
        '# Agent Signal\n\n| Field | Value |\n|---|---|\n' +
          '| Holder | Kimi |\n| State | OVER_TO_KIMI |\n| Task | do the thing |\n',
      )

      // Claims ACTIVE (same as the stranded case) but, unlike it, goes on to
      // hand the mic to someone else before the wake command returns — the
      // baton no longer names Kimi/ACTIVE once the poller checks, so this
      // must NOT be recovered.
      const stub = await s.fs.write(
        'mic-recovery-4/stub-wake',
        '#!/bin/sh\n' +
          `printf '# Agent Signal\\n\\n| Field | Value |\\n|---|---|\\n| Holder | Kimi |\\n| State | ACTIVE |\\n| Task | working |\\n' > "${signalPath}"\n` +
          `printf '# Agent Signal\\n\\n| Field | Value |\\n|---|---|\\n| Holder | Orchy |\\n| State | ACTIVE |\\n| Task | done |\\n' > "${signalPath}"\n`,
        { mode: 0o755 },
      )

      const w = startWatcher(
        s,
        'node',
        [
          live.watch,
          '--file', signalPath,
          '--state', 'OVER_TO_KIMI',
          '--poll', '0.2',
          '--',
          stub,
        ],
        { cwd: s.workspace.root, env: { AGENT_SIGNAL_SETTLE: '0' } },
      )

      await until('the dispatch has landed', async () => {
        const holder = await readField(s, signalRel, 'Holder')
        const state = await readField(s, signalRel, 'State')
        return holder === 'Orchy' && state === 'ACTIVE'
      })

      // Give the poller several more iterations to prove it does NOT also
      // fire a recovery on top of a baton that already moved.
      w.assertStillRunning('the watcher must still be polling')
      await until(
        'a few more polls pass with the baton unchanged',
        async () => {
          const holder = await readField(s, signalRel, 'Holder')
          const state = await readField(s, signalRel, 'State')
          const task = await readField(s, signalRel, 'Task')
          return holder === 'Orchy' && state === 'ACTIVE' && task === 'done'
        },
        2000,
      )

      await w.stop()
    })
  })

  it('BUG-144 F1 (Thomas/Kimi review): the wake command runs under bash, so a roster MISS inside it does not abort', async () => {
    // All three launchers (start-codex/kimi/gemini-signal-watch.mts) build
    // their own AGENT_WAKE_COMMAND string and source scripts/lib/roster.sh
    // INSIDE it to resolve the hand-back Orchestrator name — this is a
    // SEPARATE roster lookup from recoverStrandedMic's own (which already
    // runs under bash from round 3). roster.sh's lookup-MISS path uses
    // `${want// /_}`, a bash-only expansion; the happy path (a role that
    // resolves) never reaches it, which is why this stayed hidden. Reproduces
    // the launchers' own pattern verbatim — source, `command -v` guard,
    // resolve in a `$(...)` subshell — against a role that is guaranteed
    // absent from ANY roster, and proves the miss degrades cleanly (empty
    // result, roster.sh's own warning) rather than aborting the subshell with
    // "Bad substitution" (dash's behaviour, reproduced by hand against this
    // exact library before this fix: see the BUG-144 F1 commit body).
    await scenario('mic-recovery-6', async (s) => {
      const live = await liveRepo(s, 'mic-recovery-6')
      const stateDirRel = 'mic-recovery-6/logs/state'
      const signalRel = `${stateDirRel}/signal.md`
      const signalPath = s.workspace.path(signalRel)

      await s.fs.write(
        signalRel,
        '# Agent Signal\n\n| Field | Value |\n|---|---|\n' +
          '| Holder | Someone |\n| State | OVER_TO_SOMEONE |\n| Task | f1-probe |\n',
      )

      const resolvedPath = s.workspace.path('mic-recovery-6', 'resolved')
      const stderrPath = s.workspace.path('mic-recovery-6', 'roster-stderr')
      const donePath = s.workspace.path('mic-recovery-6', 'done')

      // Verbatim shape of start-codex-signal-watch.mts:159-166 (and its Kimi
      // and Gemini mirrors): source the lib, guard with `command -v`, resolve
      // in a command substitution. The only difference is the role
      // ("BUG144-F1-Missing-Role" instead of "Orchestrator") and that stderr
      // is captured to a file this test can read, instead of the launchers'
      // own `2>/dev/null` — which is exactly what let this hide: dash's
      // abort message never had anywhere to be seen.
      const wakeCommand =
        'set -u\n' +
        `. "${ROSTER_LIB}"\n` +
        'ORCHESTRATOR_NAME=""\n' +
        'if command -v bp_roster_name_for_role >/dev/null 2>&1; then\n' +
        `  ORCHESTRATOR_NAME="$(bp_roster_name_for_role "${live.root}" "BUG144-F1-Missing-Role" 2>"${stderrPath}")"\n` +
        'fi\n' +
        `printf '%s' "$ORCHESTRATOR_NAME" > "${resolvedPath}"\n` +
        `: > "${donePath}"\n`

      const w = startWatcher(
        s,
        'node',
        [live.watch, '--file', signalPath, '--state', 'OVER_TO_SOMEONE', '--poll', '0.2'],
        {
          cwd: s.workspace.root,
          env: { AGENT_SIGNAL_SETTLE: '0', AGENT_WAKE_COMMAND: wakeCommand },
        },
      )

      try {
        await until('the wake command has run to completion', () => s.fs.exists('mic-recovery-6/done'))

        const stderr = await s.fs.read('mic-recovery-6/roster-stderr')
        expect(stderr, 'dash aborted the subshell on the miss instead of returning cleanly').not.toContain(
          'Bad substitution',
        )
        expect(stderr, "roster.sh's own miss warning should still fire").toContain('identity unresolved')

        const resolved = await s.fs.read('mic-recovery-6/resolved')
        expect(resolved, 'a genuine miss should resolve to nothing, not a stray partial value').toBe('')
      } finally {
        await w.stop()
      }
    })
  })
})
