/**
 * tests/codex-model-retry/codex-model-retry.spec.ts — BUG-151.
 *
 * A roster tier can resolve to a Codex model this account's subscription
 * refuses with a live 400 (`docs/doing/BUGS.md` BUG-151, measured live
 * 2026-09-23/25: `gpt-6-sol` / `gpt-6-luna` ranked above usable slugs, and
 * the ranking itself reshuffled WITHIN a session). Before this fix, that
 * refusal killed the whole dispatch — `scripts/start-codex-signal-watch.mts`
 * passed whatever `bp_roster_model_for_name` resolved straight to `codex
 * exec -m <slug>` with no fallback. The fix (PLAN-BUG-151-model-resolution.md
 * §2/§3, plan review by Alexey/Codex and Slava/Kimi) is a bounded retry over
 * a ONE-TIME ranked-list snapshot, a remembered-refusal cache keyed to the
 * models_cache.json signature, and — because a refusal already has its own
 * outcome class (`rotation.mts`'s `persona`, TASK-065, `ce41f99`) — no new
 * classification mechanism.
 *
 * Every case drives the REAL launcher shim end to end (baton flip ->
 * signal-watch -> the launcher's own AGENT_WAKE_COMMAND -> a stub CODEX_BIN),
 * the same shape tests/scratch-tmpdir-dispatch proves TMPDIR with — not an
 * extracted wake body run in isolation, so a bug in how the retry loop's
 * exit status reaches signal-watch's own outcome recorder cannot hide behind
 * a lighter harness.
 *
 * THE FAKE CLI'S FIDELITY MATTERS (Alexey/Slava review point 4): a live
 * `codex exec --json` refusal was captured 2026-09-25 (`.scratch` probe, see
 * the plan) as a STDOUT `--json` event `{"type":"error","message":"<escaped
 * JSON string carrying status:400 and the exact 'is not supported' text>"}`,
 * with `--output-last-message` never written. STUB_CODEX reproduces that
 * exact shape on stdout, not a pre-filtered `⚠` line and not stderr, so the
 * retry decision in the launcher and the classification in rotation.mts are
 * both exercised against the real wire shape, not a shortcut standing in
 * for it.
 */

import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'

/** A Codex persona with a Model cell — none of the other launcher suites carry one. */
const FIXTURE_ROSTER = `# Roster

## Members

| Role | Name | Backing agent | Model |
|---|---|---|---|
| Orchestrator | Jesko | Claude Code | session-based |
| QA-2 | Slava | Codex | frontier:low |
`

/** Three ranked Codex models: m1 (rank 0), m2 (rank 1), m3 (rank 2). */
const MODELS_CACHE = JSON.stringify({
  models: [
    { slug: 'm1', visibility: 'list', priority: 1, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
    { slug: 'm2', visibility: 'list', priority: 2, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
    { slug: 'm3', visibility: 'list', priority: 3, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
  ],
})

/**
 * A stub `codex exec` that emits the exact live refusal shape on STDOUT
 * as a `--json` event, controlled by env — never a shortcut through the
 * `⚠`-prefixed, already-filtered line the real codex-feed-filter.sh
 * produces DOWNSTREAM of this binary.
 *
 * REFUSE_SLUGS: comma-separated slugs to refuse (exit 1, the 400 shape).
 * UNRELATED_FAILURE=1: refuse EVERY slug with a capacity-shaped message
 * that is not the model-refusal shape at all — proves an unrelated
 * failure is never retried.
 * CALL_LOG: every invocation appends `call: <slug>` here, in order.
 */
const STUB_CODEX = `#!/bin/sh
slug=""
outlast=""
while [ $# -gt 0 ]; do
  case "$1" in
    -m) slug="$2"; shift 2 ;;
    --output-last-message) outlast="$2"; shift 2 ;;
    *)
      # The prompt is always the FINAL positional argument codex exec
      # receives, whatever flags preceded it — capture it verbatim so a
      # test can prove the launcher sent the real radio-over prompt, not a
      # placeholder standing in for it.
      if [ $# -eq 1 ] && [ -n "\${PROMPT_LOG:-}" ]; then
        printf '%s' "$1" >"$PROMPT_LOG"
      fi
      shift ;;
  esac
done
[ -n "\${CALL_LOG:-}" ] && printf 'call: %s\\n' "$slug" >>"$CALL_LOG"
if [ "\${UNRELATED_FAILURE:-0}" = "1" ]; then
  echo '{"type":"thread.started","thread_id":"tX"}'
  echo '{"type":"error","message":"Selected model is at capacity, please try again later."}'
  exit 1
fi
case ",\${REFUSE_SLUGS:-}," in
  *",$slug,"*)
    echo '{"type":"thread.started","thread_id":"t1"}'
    msg="{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The '$slug' model is not supported when using Codex with a ChatGPT account.\\"}}"
    jq -nc --arg m "$msg" '{type:"error", message:$m}'
    exit 1
    ;;
esac
echo '{"type":"thread.started","thread_id":"t2"}'
echo '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"ok"}}'
echo '{"type":"turn.completed","usage":{"output_tokens":5}}'
[ -n "$outlast" ] && printf 'fake report\\n' >"$outlast"
exit 0
`

interface Fixture {
  repo: string
  stateDir: string
}

/** Every file the real Codex launcher (and rotation.mts's own recording) needs on disk. */
async function buildFixture(s: Scenario, name: string): Promise<Fixture> {
  const repo = await s.gitRepo(name)
  const rel = (p: string) => join(name, p)

  for (const args of [
    ['config', 'user.name', 'Fixture Operator'],
    ['config', 'user.email', 'fixture@example.test'],
  ]) {
    await s.run('git', args, { cwd: repo.dir })
  }

  const launcherRel = 'scripts/start-codex-signal-watch.mts'
  const shellScripts = [
    'scripts/signal-watch.mts',
    launcherRel,
    'scripts/codex-feed-filter.sh',
    'scripts/lib/state-dir.sh',
    'scripts/lib/roster.sh',
    'scripts/lib/feed.sh',
    'scripts/lib/codex-session.sh',
    'scripts/signal-set.sh',
  ]
  for (const script of shellScripts) {
    await s.fs.copyIn(join(REPO_ROOT, script), rel(script))
    await s.fs.chmod(rel(script), 0o755)
  }
  for (const lib of [
    'scripts/lib/spawn-bounded.mts',
    'scripts/lib/find-bin.mts',
    'scripts/lib/scratch-tmpdir.mts',
  ]) {
    await s.fs.copyIn(join(REPO_ROOT, lib), rel(lib))
  }
  // rotation.mts is what turns the dispatch's own run-log slice into the
  // 'persona' outcome — signal-watch.mts calls it generically after every
  // dispatch (recordDispatchOutcome), so it has to exist in the fixture for
  // that call to do anything at all.
  await s.fs.copyIn(join(REPO_ROOT, 'scripts', 'rotation.mts'), rel('scripts/rotation.mts'))

  await s.fs.write(rel('AGENT_ROSTER.md'), FIXTURE_ROSTER)
  await s.fs.write(rel('codex-home/models_cache.json'), MODELS_CACHE)
  // recordDispatchOutcome (signal-watch.mts) measures growth from an offset
  // captured BEFORE the dispatch — on a run log that does not exist yet that
  // offset is `undefined`, and it treats "cold start" the same as "did not
  // grow" (unrelated to BUG-151; the same precedent tests/mic-recovery's
  // rotation cases seed around by writing a placeholder line first).
  await s.fs.write(rel('logs/state/codex-runs.log'), 'older run\n')
  await s.fs.write(
    rel('logs/state/signal.md'),
    [
      '| Field | Value |',
      '|---|---|',
      '| Holder | Slava |',
      '| State | OVER_TO_CODEX |',
      '| Task | BUG-151 probe |',
      '',
    ].join('\n'),
  )
  await repo.commitAll('fixture: baseline')

  return { repo: repo.dir, stateDir: join(repo.dir, 'logs', 'state') }
}

async function runOnce(
  s: Scenario,
  f: Fixture,
  env: Record<string, string | undefined>,
): Promise<{ code: number | null; output: string }> {
  const stub = await s.fs.write('stub-codex.sh', STUB_CODEX, { mode: 0o755 })
  const r = await s.run('node', [join(f.repo, 'scripts/start-codex-signal-watch.mts'), '--poll', '1', '--once'], {
    cwd: f.repo,
    timeoutMs: 60_000,
    env: {
      CODEX_BIN: stub,
      CODEX_HOME: join(f.repo, 'codex-home'),
      AGENT_SIGNAL_SETTLE: '0',
      AGENT_SIGNAL_FILE: undefined,
      AGENT_STATE_HOME: undefined,
      ...env,
    },
  })
  return { code: r.code, output: r.output }
}

async function runLog(f: Fixture): Promise<string> {
  return readFile(join(f.stateDir, 'codex-runs.log'), 'utf8').catch(() => '')
}

describe('BUG-151 — a refused Codex model falls back through the rest of the ranked list', () => {
  it('the dispatched CLI receives the real radio-over coordination prompt, not a placeholder', async () => {
    // Regression guard (Andreas/Codex code review of 77dbf4d, code-side
    // FINDING): an editing mistake in that commit replaced the whole prompt
    // string with the literal "prompt text $AGENT_SIGNAL_TASK
    // $ORCHESTRATOR_NAME" — every dispatched Codex agent would have lost
    // the baton rules, the required reads, the atomic hand-back instruction
    // and the no-push constraint, while every existing suite (including
    // this file's other three cases, which never inspect the prompt
    // argument) stayed green. This asserts the actual argument content, not
    // just that a dispatch succeeds.
    await scenario('codex-retry-real-prompt', async (s) => {
      const f = await buildFixture(s, 'proj')
      const promptLog = s.workspace.path('prompt.log')
      await runOnce(s, f, { PROMPT_LOG: promptLog })

      const prompt = await readFile(promptLog, 'utf8').catch(() => '')
      expect(prompt, 'codex exec never received a prompt argument at all').not.toBe('')
      expect(prompt, `the prompt must not be a placeholder:\n${prompt}`).not.toMatch(/^prompt text /)
      expect(prompt, `the prompt must carry the radio-over protocol name:\n${prompt}`).toMatch(
        /radio-over coordination protocol/,
      )
      expect(prompt, `the prompt must carry the atomic hand-back instruction:\n${prompt}`).toMatch(
        /hand the mic back by RUNNING scripts\/signal-set\.sh/,
      )
      expect(prompt, `the prompt must carry the no-push constraint:\n${prompt}`).toMatch(
        /Do NOT run git push; only Claude pushes\./,
      )
    })
  })

  it('a refused rank falls back to the next ranked model and completes', async () => {
    await scenario('codex-retry-fallback', async (s) => {
      const f = await buildFixture(s, 'proj')
      const callLog = s.workspace.path('calls.log')
      await runOnce(s, f, { REFUSE_SLUGS: 'm1,m2', CALL_LOG: callLog })

      const log = await runLog(f)
      expect(log, `expected a fallback to rank 2 (m2):\n${log}`).toMatch(/falling back to rank 2: m2/)
      expect(log, `expected a fallback to rank 3 (m3):\n${log}`).toMatch(/falling back to rank 3: m3/)
      expect(log, `expected the dispatch to finish, not fail:\n${log}`).toMatch(/codex exec finished/)
      expect(log, `a dispatch that eventually succeeds must not report FAILED:\n${log}`).not.toMatch(/FAILED/)

      const calls = await readFile(callLog, 'utf8').catch(() => '')
      expect(calls.trim().split('\n')).toEqual(['call: m1', 'call: m2', 'call: m3'])
    })
  })

  it('an unrelated failure (capacity-shaped, not the model-refusal shape) is never retried', async () => {
    await scenario('codex-retry-unrelated', async (s) => {
      const f = await buildFixture(s, 'proj')
      const callLog = s.workspace.path('calls.log')
      await runOnce(s, f, { UNRELATED_FAILURE: '1', CALL_LOG: callLog })

      const log = await runLog(f)
      expect(log, `an unrelated failure must not trigger a fallback:\n${log}`).not.toMatch(/falling back/)
      expect(log, `an unrelated failure still reports FAILED once:\n${log}`).toMatch(/FAILED \(exit 1\)/)

      const calls = await readFile(callLog, 'utf8').catch(() => '')
      expect(calls.trim().split('\n'), 'exactly one dispatch attempt, never a retry').toEqual(['call: m1'])
    })
  })

  it('every ranked model refused: the dispatch fails loudly, and rotation.mts still classifies it persona', async () => {
    await scenario('codex-retry-exhausted', async (s) => {
      const f = await buildFixture(s, 'proj')
      const callLog = s.workspace.path('calls.log')
      await runOnce(s, f, { REFUSE_SLUGS: 'm1,m2,m3', CALL_LOG: callLog })

      const log = await runLog(f)
      expect(log, `every rank refused must FAIL, never finish:\n${log}`).toMatch(/FAILED \(exit 1\)/)
      expect(log, `the exhaustion message names the whole span:\n${log}`).toMatch(
        /every Codex model from rank 1 through 3 was refused/,
      )

      const calls = await readFile(callLog, 'utf8').catch(() => '')
      expect(calls.trim().split('\n'), 'all three ranks were actually tried, not skipped').toEqual([
        'call: m1',
        'call: m2',
        'call: m3',
      ])

      // signal-watch.mts's own generic recordDispatchOutcome call — no BUG-151
      // code touches rotation.mts or its classifier; this proves the EXISTING
      // 'persona' class (rotation.mts:237, TASK-065) still fires off the real
      // run-log slice the retry loop produced.
      const rotationLog = await readFile(join(f.stateDir, 'rotation.log'), 'utf8').catch(() => '')
      expect(rotationLog, `expected a 'persona' outcome recorded:\n${rotationLog}`).toMatch(/"class":"persona"/)
    })
  })

  it('a remembered refusal is skipped without dispatch on the next attempt, cache unchanged', async () => {
    await scenario('codex-retry-remembered', async (s) => {
      const f = await buildFixture(s, 'proj')
      const callLog1 = s.workspace.path('calls-1.log')
      await runOnce(s, f, { REFUSE_SLUGS: 'm1,m2', CALL_LOG: callLog1 })
      const calls1 = await readFile(callLog1, 'utf8').catch(() => '')
      expect(calls1.trim().split('\n'), 'first dispatch tries every rank live').toEqual([
        'call: m1',
        'call: m2',
        'call: m3',
      ])

      const cachePath = join(f.stateDir, 'codex-refused-slugs.json')
      expect(existsSync(cachePath), 'the first dispatch should have persisted the refusals').toBe(true)

      // The stub never hands the mic back (unlike a real dispatched agent),
      // so signal-watch's OWN stranded-mic recovery already moved the baton
      // to Holder=Orchestrator/OVER_TO_CLAUDE by the time run 1 returned —
      // unrelated to BUG-151, the same recovery BUG-144 built. Re-arm the
      // SAME baton for a second dispatch; the point under test is the
      // remembered-refusal cache, not the recovery mechanism.
      await s.fs.write(
        'proj/logs/state/signal.md',
        ['| Field | Value |', '|---|---|', '| Holder | Slava |', '| State | OVER_TO_CODEX |', '| Task | second probe |', ''].join(
          '\n',
        ),
      )

      // Second dispatch, same repo, same models_cache.json (never touched
      // between the two calls), same REFUSE_SLUGS — if the remembered-skip
      // mechanism regressed, this would silently re-dispatch m1/m2 live and
      // the call log would show three calls again instead of one.
      const callLog2 = s.workspace.path('calls-2.log')
      await runOnce(s, f, { REFUSE_SLUGS: 'm1,m2', CALL_LOG: callLog2 })

      const log2 = await runLog(f)
      expect(log2, `both remembered ranks should be named as skipped:\n${log2}`).toMatch(
        /rank 1 'm1' already refused by this account \(remembered/,
      )
      expect(log2, `both remembered ranks should be named as skipped:\n${log2}`).toMatch(
        /rank 2 'm2' already refused by this account \(remembered/,
      )
      expect(log2, `the second dispatch should still finish, via m3:\n${log2}`).toMatch(/codex exec finished/)

      const calls2 = await readFile(callLog2, 'utf8').catch(() => '')
      expect(
        calls2.trim().split('\n'),
        'the second dispatch must reach the CLI only for the un-refused rank',
      ).toEqual(['call: m3'])
    })
  })
})
