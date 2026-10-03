/**
 * tests/codex-session/codex-session.spec.ts — TASK-060.
 *
 * A Codex persona's feed label showed the ROSTER's idea of what model it was
 * running, never what Codex actually ran with. The roster cell is a request:
 * `-m <slug> -c model_reasoning_effort=<effort>` on the command line. Codex is
 * free to fall back, and an operator's `config.toml` can override it at
 * runtime — the founder's real dispatch on 2026-09-17 showed `gpt-5.6-terra`
 * in Codex's own session file while the feed showed the roster's alias.
 *
 * The only record of what actually ran is Codex's own session rollout file
 * (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`), read by
 * `scripts/lib/codex-session.sh`. This suite pins that lib directly against
 * FIXTURES in the real record shape (the `session_meta` / `turn_context`
 * fields below are copied from the founder's real file, anonymised — a fake
 * session id, a fixture `cwd`, a fixture model), plus the launcher call sites
 * that wire it in (TASK-060) and `bp_roster_label`'s generalised `ran`
 * override (no forked label rule — see scripts/lib/roster.sh).
 *
 * IDENTITY, NOT GUESSING — the first version of this resolved a rollout file
 * by "newest file, newer than a marker, matching cwd". The coordinator found
 * better evidence: `grep -a` over the vendored Codex binary shows the event
 * type `thread.started` and the field `thread_id` as real strings in the
 * compiled binary, and the founder's real rollout's filename suffix
 * (`rollout-…-01a0af76-4bc7-78b0-a4b4-2304889063e0.jsonl`) IS its own
 * `session_meta.payload.id`. So the launcher now tees codex's raw --json
 * stream, reads the FIRST `thread.started` event's `thread_id` from it, and
 * looks up the rollout named for that exact id — never the newest file, never
 * matched by cwd alone. #1–#4 pin exactly that: a decoy rollout for a
 * DIFFERENT thread, however new, must never be picked (#4) — the class of
 * check that would have caught the old "newest match" bug had one existed
 * before.
 *
 * What is still UNVERIFIED without a live dispatch: whether `thread_id` sits
 * at the top level of the `thread.started` JSON event exactly as assumed
 * here. See scripts/lib/codex-session.sh's header.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { unescapeTsShellText } from '../helpers/wake-command.js'

const SUBJECT = process.env.BP_SPEC_ROOT ?? REPO_ROOT
// TASK-083 — a migrated launcher is a two-line shim; read its `.mts` TARGET.
const LAUNCHER = join(SUBJECT, 'scripts/start-codex-signal-watch.mts')
const LIB = join(SUBJECT, 'scripts', 'lib', 'codex-session.sh')
const ROSTER_LIB = join(SUBJECT, 'scripts', 'lib', 'roster.sh')

async function code(path: string): Promise<string> {
  const raw = await readFile(path, 'utf8').catch(() => '')
  const stripped = raw.replace(/^[ \t]*#.*$/gm, '')
  return path.endsWith('.mts') ? unescapeTsShellText(stripped) : stripped
}

/** A rollout record, shaped like the real file: `session_meta` first, then one
 * or more `turn_context` records. Only the fields the lib reads are kept —
 * the rest of a real rollout is base_instructions text, tool schemas, and
 * conversation content, none of which this lib touches. */
function fixtureRollout(cwd: string, sessionId: string, turns: Array<{ model: string; effort: string }>): string {
  const meta = {
    timestamp: '2026-09-17T13:02:40.632Z',
    ordinal: 0,
    type: 'session_meta',
    payload: {
      session_id: sessionId,
      id: sessionId,
      timestamp: '2026-09-17T13:02:40.588Z',
      cwd,
      originator: 'codex_exec',
      cli_version: '0.154.0',
      source: 'exec',
    },
  }
  const lines = [JSON.stringify(meta)]
  for (const t of turns) {
    lines.push(
      JSON.stringify({
        timestamp: '2026-09-17T13:02:42.938Z',
        ordinal: lines.length,
        type: 'turn_context',
        payload: { turn_id: `${sessionId}-turn`, cwd, model: t.model, effort: t.effort },
      }),
    )
  }
  return lines.join('\n') + '\n'
}

/** A fixture of codex exec --json's raw stdout: a `thread.started` event (if
 * `threadId` is given) among the other event types the feed filter already
 * reads, in the same shape codex-feed-filter.sh expects (`.type`, `.item`,
 * `.usage`). This is the "shimmed codex binary" stream — what a real `codex`
 * process's stdout would tee into RAW_JSON before the feed filter consumes
 * it. */
function fixtureRawJsonStream(threadId: string | null): string {
  const lines: string[] = []
  if (threadId) lines.push(JSON.stringify({ type: 'thread.started', thread_id: threadId }))
  lines.push(JSON.stringify({ type: 'turn.started' }))
  lines.push(
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'hello' } }),
  )
  lines.push(JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 12 } }))
  return lines.join('\n') + '\n'
}

async function lib(s: Scenario, snippet: string) {
  const runner = await s.fs.write('run.sh', `. "${LIB}"\n${snippet}\n`)
  return s.run('bash', [runner], { cwd: s.workspace.root })
}

describe('TASK-060 — the Codex feed label names the model that actually ran', () => {
  it('#1 bp_codex_thread_id_from_stream reads the thread_id from a thread.started event, among other event types', async () => {
    await scenario('codex-session-1', async (s) => {
      const stream = await s.fs.write('raw.jsonl', fixtureRawJsonStream('01a0af76-real-thread'))
      const r = await lib(s, `bp_codex_thread_id_from_stream "${stream}"`)
      expect(r.stdout).toBe('01a0af76-real-thread')
    })
  })

  it('#2 bp_codex_thread_id_from_stream refuses (rc 1) when no thread.started event was seen', async () => {
    await scenario('codex-session-2', async (s) => {
      const stream = await s.fs.write('raw.jsonl', fixtureRawJsonStream(null))
      const r = await lib(s, `bp_codex_thread_id_from_stream "${stream}"; echo "rc=$?"`)
      expect(r.stdout.trim()).toBe('rc=1')
    })
  })

  it('#3 bp_codex_rollout_for_thread finds the rollout NAMED for that exact thread id, and confirms its own session_meta.payload.id', async () => {
    await scenario('codex-session-3', async (s) => {
      const home = await s.fs.mkdirp('codex-home')
      const cwd = await s.fs.mkdirp('project')
      const wanted = await s.fs.write(
        'codex-home/sessions/2026/09/17/rollout-2026-09-17T15-02-40-target-id.jsonl',
        fixtureRollout(cwd, 'target-id', [{ model: 'gpt-test-mock', effort: 'medium' }]),
      )
      const r = await lib(s, `bp_codex_rollout_for_thread "${home}" "target-id"`)
      expect(r.stdout).toBe(wanted)
    })
  })

  it('#4 a DECOY rollout for a different thread id is never picked, even if newer and same cwd', async () => {
    // This is the exact class the old "newest matching-cwd file" version could
    // get wrong: a second, more recent Codex session in the same project. An
    // id-based lookup must ignore it outright because its filename does not
    // carry the id being asked for.
    await scenario('codex-session-4', async (s) => {
      const home = await s.fs.mkdirp('codex-home')
      const cwd = await s.fs.mkdirp('project')
      await s.fs.write(
        'codex-home/sessions/2026/09/17/rollout-2026-09-17T16-00-00-decoy-id.jsonl',
        fixtureRollout(cwd, 'decoy-id', [{ model: 'wrong-model', effort: 'high' }]),
      )
      const wanted = await s.fs.write(
        'codex-home/sessions/2026/09/17/rollout-2026-09-17T15-02-40-target-id.jsonl',
        fixtureRollout(cwd, 'target-id', [{ model: 'gpt-test-mock', effort: 'medium' }]),
      )
      const r = await lib(s, `bp_codex_rollout_for_thread "${home}" "target-id"`)
      expect(r.stdout).toBe(wanted)
    })
  })

  it('#4b a filename that carries the id but whose OWN session_meta.payload.id disagrees is refused (rc 1)', async () => {
    // The filename is a naming convention, not proof — a truncated or
    // colliding name must not be trusted on its own.
    await scenario('codex-session-4b', async (s) => {
      const home = await s.fs.mkdirp('codex-home')
      const cwd = await s.fs.mkdirp('project')
      await s.fs.write(
        'codex-home/sessions/2026/09/17/rollout-2026-09-17T15-02-40-target-id.jsonl',
        fixtureRollout(cwd, 'not-actually-target-id', [{ model: 'gpt-test-mock', effort: 'medium' }]),
      )
      const r = await lib(s, `bp_codex_rollout_for_thread "${home}" "target-id"; echo "rc=$?"`)
      expect(r.stdout.trim()).toBe('rc=1')
    })
  })

  it('#5 bp_codex_model_effort reads the LAST turn_context record in the file', async () => {
    await scenario('codex-session-5', async (s) => {
      const cwd = await s.fs.mkdirp('project')
      const rollout = await s.fs.write(
        'rollout.jsonl',
        fixtureRollout(cwd, 'multi-turn-session', [
          { model: 'first-model', effort: 'low' },
          { model: 'gpt-test-mock', effort: 'medium' },
        ]),
      )

      const r = await lib(s, `bp_codex_model_effort "${rollout}"`)
      expect(r.stdout).toBe('gpt-test-mock\tmedium')
    })
  })

  it('#6 bp_codex_model_effort refuses (rc 1) on a file with no turn_context', async () => {
    await scenario('codex-session-6', async (s) => {
      const rollout = await s.fs.write('rollout.jsonl', fixtureRollout('/nowhere', 'no-turn-session', []))
      const r = await lib(s, `bp_codex_model_effort "${rollout}"; echo "rc=$?"`)
      expect(r.stdout.trim()).toBe('rc=1')
    })
  })

  it('#7 the lib is exposed under the names the launcher calls', async () => {
    for (const fn of ['bp_codex_thread_id_from_stream', 'bp_codex_rollout_for_thread', 'bp_codex_model_effort']) {
      await scenario(`codex-session-7-${fn}`, async (s) => {
        const r = await s.run('bash', ['-c', `. "${LIB}" && command -v ${fn} >/dev/null 2>&1`], {
          cwd: s.workspace.root,
        })
        expect(r.code, `${fn} is not defined by codex-session.sh`).toBe(0)
      })
    }
  })

  it('#8 the launcher sources codex-session.sh guarded, never unconditionally', async () => {
    // Same FAILS-OPEN rule as roster.sh (BUG-021): a missing lib must cost the
    // resolved model, never the dispatch.
    expect(
      await code(LAUNCHER),
      'the launcher sources codex-session.sh unguarded — a tree without it loses the dispatch',
    ).toMatch(/\[ -r "\$ROOT\/scripts\/lib\/codex-session\.sh" \]/)
  })

  it('#8 the launcher tees the raw --json stream and resolves by thread id, never by guessing', async () => {
    const src = await code(LAUNCHER)
    expect(src, 'the launcher does not capture the raw --json stream (no tee into RAW_JSON)').toMatch(
      /tee\s+(-a\s+)?"\$RAW_JSON"/,
    )
    expect(src, 'the launcher never calls bp_codex_thread_id_from_stream').toMatch(
      /bp_codex_thread_id_from_stream/,
    )
    expect(src, 'the launcher never calls bp_codex_rollout_for_thread').toMatch(/bp_codex_rollout_for_thread/)
    expect(src, 'the launcher never calls bp_codex_model_effort').toMatch(/bp_codex_model_effort/)
    expect(
      src,
      'the old marker/cwd guessing functions are still referenced — they were meant to be removed entirely',
    ).not.toMatch(/bp_codex_dispatch_marker|bp_codex_rollout_for_dispatch/)
  })

  it('#8 the launcher logs the requested model, and either the actual model or "unknown" with a reason', async () => {
    const src = await code(LAUNCHER)
    expect(src, 'no "requested model=" log line at dispatch time').toMatch(/requested model=/)
    expect(src, 'no "actual model=" log line once the session is known').toMatch(/actual model=/)
    expect(src, 'no "unknown" fallback when the thread id/rollout could not be resolved').toMatch(
      /actual model: unknown/,
    )
  })

  it('#8 the launcher reuses bp_roster_label for the actual-model relabel — no forked label rule', async () => {
    const src = await code(LAUNCHER)
    // Must pass the ACTUAL model/effort through the SAME function the feed and
    // the requested-model label already use, not build a second "<name> - <x> -
    // <y>" string by hand.
    expect(src, 'the launcher builds the actual-model label without bp_roster_label').toMatch(
      /bp_roster_label\s+"\$BP_STATE_ROOT"\s+"\$\{AGENT_SIGNAL_HOLDER:-Codex\}"\s+"\$ACTUAL_MODEL"\s+"\$ACTUAL_EFFORT"/,
    )
  })

  // Fixture matching tests/roster-models' own pattern: a Codex persona's Model
  // cell resolves through a models_cache.json, so the roster and the cache
  // must agree, not a literal model name typed into the roster.
  const ROSTER_9 = `# Roster

## Members

| Role | Name | Backing agent | Model |
|---|---|---|---|
| QA-2 | Slava | Codex | frontier:low |
`
  const MODELS_9 = JSON.stringify({
    models: [{ slug: 'gpt-requested', visibility: 'list', priority: 1, supported_reasoning_levels: [{ effort: 'low' }] }],
  })

  async function project9(s: Scenario): Promise<{ dir: string; env: Record<string, string> }> {
    const dir = await s.fs.mkdirp('proj')
    await s.fs.write('proj/AGENT_ROSTER.md', ROSTER_9)
    await s.fs.write('codex/models_cache.json', MODELS_9)
    return { dir, env: { CODEX_HOME: s.workspace.path('codex') } }
  }

  it('#9 bp_roster_label: ran + ran_effort override the roster cell for a CODEX-backed persona, not just Claude Code', async () => {
    // The generalisation this task required: the old code only let the third
    // argument win when the persona's backing was literally "Claude Code". A
    // Codex persona calling with its own actual model/effort must win too.
    await scenario('codex-session-9', async (s) => {
      const { dir, env } = await project9(s)
      const r = await s.run(
        'bash',
        ['-c', `. "${ROSTER_LIB}"; bp_roster_label "${dir}" "Slava" "gpt-test-mock" "medium"`],
        { cwd: s.workspace.root, env },
      )
      expect(r.stdout).toBe('Slava - gpt-test-mock - medium')
    })
  })

  it('#9 bp_roster_label: with no ran/ran_effort the roster cell still wins, unchanged', async () => {
    await scenario('codex-session-9b', async (s) => {
      const { dir, env } = await project9(s)
      const r = await s.run('bash', ['-c', `. "${ROSTER_LIB}"; bp_roster_label "${dir}" "Slava"`], {
        cwd: s.workspace.root,
        env,
      })
      expect(r.stdout).toBe('Slava - gpt-requested - low')
    })
  })
})
