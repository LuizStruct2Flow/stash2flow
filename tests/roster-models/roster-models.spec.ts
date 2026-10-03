/**
 * tests/roster-models/roster-models.spec.ts — TASK-059.
 *
 * A persona's roster Model cell is `<tier>:<effort>`, resolved against the
 * provider's own ranked list, never a hardcoded version. One case per control:
 *
 *   #1 the resolver maps tiers for both providers;
 *   #2 an effort the model does not support is refused, naming the persona;
 *   #3 the generator writes the Claude subagent definition;
 *   #4 a feed line carries the model and the effort;
 *   #5 `session-based` resolves only on the Orchestrator role.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { readFile, readdir } from 'node:fs/promises'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'

const SUBJECT = process.env.BP_SPEC_ROOT ?? REPO_ROOT
const LIB = join(SUBJECT, 'scripts', 'lib', 'roster.sh')

const ROSTER = `# Roster

## Members

| Role | Name | Backing agent | Model |
|---|---|---|---|
| Orchestrator | Ada | Claude Code | frontier:max |
| QA-1 | Nadia | Claude Code | frontier-2:medium |
| Architect | Olek | Codex | frontier-1:high |
| QA-2 | Pim | Codex | frontier-3:ultra |

Claude models, best first: fable, opus, sonnet, haiku
`

/** Priority order is NOT file order, and a hidden model sits between listed ones. */
const MODELS = JSON.stringify({
  models: [
    { slug: 'm-third', visibility: 'list', priority: 9, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
    { slug: 'm-best', visibility: 'list', priority: 1, supported_reasoning_levels: [{ effort: 'high' }] },
    { slug: 'm-hidden', visibility: 'hide', priority: 2, supported_reasoning_levels: [{ effort: 'high' }] },
    { slug: 'm-second', visibility: 'list', priority: 5, supported_reasoning_levels: [{ effort: 'high' }] },
    { slug: 'm-fourth', visibility: 'list', priority: 12, supported_reasoning_levels: [{ effort: 'low' }] },
  ],
})

async function project(s: Scenario): Promise<{ dir: string; env: Record<string, string> }> {
  const dir = await s.fs.mkdirp('proj')
  await s.fs.write('proj/AGENT_ROSTER.md', ROSTER)
  await s.fs.write('proj/.blueprint-source', '')
  await s.fs.write('codex/models_cache.json', MODELS)
  return { dir, env: { CODEX_HOME: s.workspace.path('codex') } }
}

async function lib(s: Scenario, snippet: string) {
  const { dir, env } = await project(s)
  return s.run('bash', ['-c', `. "${LIB}"; ${snippet.replace(/@/g, dir)}`], { cwd: s.workspace.root, env })
}

describe('TASK-059 — roster Model tiers', () => {
  it('#1 tiers resolve against each provider list', async () => {
    await scenario('rm-1', async (s) => {
      const r = await lib(s, 'for p in Ada Nadia Olek; do bp_roster_model_for_name "@" "$p"; done')
      expect(r.stdout, r.stderr).toBe(
        'Claude Code\tfable\tmax\n' + 'Claude Code\tsonnet\tmedium\n' + 'Codex\tm-second\thigh\n',
      )
    })
  })

  it('#2 an effort the model does not support is refused, naming the persona', async () => {
    await scenario('rm-2', async (s) => {
      const r = await lib(s, 'bp_roster_model_for_name "@" Pim')
      expect(r.code).not.toBe(0)
      expect(r.stdout).toBe('')
      expect(r.stderr).toMatch(/Pim: effort 'ultra' is not supported by m-fourth/)
    })
  })

  it('#3 the generator writes one agent file per Claude persona, not the Orchestrator', async () => {
    await scenario('rm-3', async (s) => {
      const { dir, env } = await project(s)
      await s.fs.copyIn(join(SUBJECT, 'scripts', 'claude-agents.sh'), 'proj/scripts/claude-agents.sh')
      for (const f of ['roster.sh', 'state-dir.sh']) {
        await s.fs.copyIn(join(SUBJECT, 'scripts', 'lib', f), `proj/scripts/lib/${f}`)
      }
      const r = await s.run('bash', [join(dir, 'scripts', 'claude-agents.sh')], { cwd: dir, env })
      expect(r.code, r.output).toBe(0)
      expect(await readdir(join(dir, '.claude', 'agents'))).toEqual(['nadia.md'])
      expect(await readFile(join(dir, '.claude', 'agents', 'nadia.md'), 'utf8')).toMatch(
        /^---\nname: nadia\ndescription: QA-1\nmodel: sonnet\neffort: medium\n---\n/,
      )
    })
  })

  it('#3b a hand-written agent file with a persona name is kept, and a generated one is replaced', async () => {
    await scenario('rm-3b', async (s) => {
      const { dir, env } = await project(s)
      await s.fs.copyIn(join(SUBJECT, 'scripts', 'claude-agents.sh'), 'proj/scripts/claude-agents.sh')
      for (const f of ['roster.sh', 'state-dir.sh']) {
        await s.fs.copyIn(join(SUBJECT, 'scripts', 'lib', f), `proj/scripts/lib/${f}`)
      }
      const own = '---\nname: nadia\ndescription: mine\n---\nHand-written project instructions\n'
      await s.fs.write('proj/.claude/agents/nadia.md', own)
      const r = await s.run('bash', [join(dir, 'scripts', 'claude-agents.sh')], { cwd: dir, env })
      expect(await readFile(join(dir, '.claude', 'agents', 'nadia.md'), 'utf8'), r.output).toBe(own)
      expect(r.output).toMatch(/nadia\.md.*not generated/)

      // A file this script generated earlier is still its own to replace.
      await s.fs.write(
        'proj/.claude/agents/nadia.md',
        '---\nname: nadia\nmodel: opus\n---\n<!-- generated by scripts/claude-agents.sh from AGENT_ROSTER.md -->\n',
      )
      await s.run('bash', [join(dir, 'scripts', 'claude-agents.sh')], { cwd: dir, env })
      expect(await readFile(join(dir, '.claude', 'agents', 'nadia.md'), 'utf8')).toMatch(/model: sonnet/)
    })
  })

  it('#4 a subagent feed line reads [Name - model it ran on - effort]', async () => {
    await scenario('rm-4', async (s) => {
      const { dir, env } = await project(s)
      await s.fs.copyIn(join(SUBJECT, 'scripts', 'log-activity.mts'), 'proj/scripts/log-activity.mts')
      for (const f of await readdir(join(SUBJECT, 'scripts', 'lib'))) {
        if (f.endsWith('.sh')) await s.fs.copyIn(join(SUBJECT, 'scripts', 'lib', f), `proj/scripts/lib/${f}`)
      }
      const sub = 'proj/sess/subagents/agent-feed01'
      await s.fs.write(`${sub}.meta.json`, JSON.stringify({ agentType: 'general-purpose', description: 'Nadia checks it' }))
      await s.fs.write(`${sub}.jsonl`, JSON.stringify({ type: 'assistant', message: { model: 'claude-ran-7' } }) + '\n')
      const log = join(await s.fs.mkdirp('proj/logs'), 'feed.log')
      const payload = JSON.stringify({
        hook_event_name: 'SubagentStop',
        agent_id: 'feed01',
        agent_type: 'general-purpose',
        transcript_path: join(dir, 'sess.jsonl'),
        agent_transcript_path: join(dir, `${sub.slice('proj/'.length)}.jsonl`),
      })
      const r = await s.run(
        'sh',
        ['-c', `printf '%s' "$1" | node "${join(dir, 'scripts', 'log-activity.mts')}"`, 'x', payload],
        { cwd: dir, env: { ...env, AGENT_FEED_LOG: log } },
      )
      expect(r.code, r.output).toBe(0)
      expect(await readFile(log, 'utf8')).toContain('[Nadia - claude-ran-7 - medium] ← finished')
    })
  })

  it('#4b a REAL dispatch-by-persona meta (agentType is the persona slug, description names the task, not the persona)', async () => {
    // TASK-059 rejected: a real `Agent({subagent_type: "nadia", ...})` dispatch
    // writes agentType: "nadia" (the slug scripts/claude-agents.sh names
    // .claude/agents/nadia.md by) and a description that is the TASK, which
    // routinely does not mention "Nadia" at all — unlike #4's fixture, which
    // borrowed the general-purpose-agent shape (agentType left generic,
    // persona only in free-text description) and so never exercised this path.
    await scenario('rm-4b', async (s) => {
      const { dir, env } = await project(s)
      await s.fs.copyIn(join(SUBJECT, 'scripts', 'log-activity.mts'), 'proj/scripts/log-activity.mts')
      for (const f of await readdir(join(SUBJECT, 'scripts', 'lib'))) {
        if (f.endsWith('.sh')) await s.fs.copyIn(join(SUBJECT, 'scripts', 'lib', f), `proj/scripts/lib/${f}`)
      }
      const sub = 'proj/sess/subagents/agent-feed02'
      await s.fs.write(
        `${sub}.meta.json`,
        JSON.stringify({ agentType: 'nadia', description: 'Fix persona model label in feed', toolUseId: 'toolu_x', spawnDepth: 1 }),
      )
      await s.fs.write(`${sub}.jsonl`, JSON.stringify({ type: 'assistant', message: { model: 'claude-ran-9' } }) + '\n')
      const log = join(await s.fs.mkdirp('proj/logs'), 'feed.log')
      const payload = JSON.stringify({
        hook_event_name: 'SubagentStop',
        agent_id: 'feed02',
        agent_type: 'nadia',
        transcript_path: join(dir, 'sess.jsonl'),
        agent_transcript_path: join(dir, `${sub.slice('proj/'.length)}.jsonl`),
      })
      const r = await s.run(
        'sh',
        ['-c', `printf '%s' "$1" | node "${join(dir, 'scripts', 'log-activity.mts')}"`, 'x', payload],
        { cwd: dir, env: { ...env, AGENT_FEED_LOG: log } },
      )
      expect(r.code, r.output).toBe(0)
      expect(await readFile(log, 'utf8')).toContain('[Nadia - claude-ran-9 - medium] ← finished')
    })
  })

  it('#5 session-based resolves only on the Orchestrator role', async () => {
    await scenario('rm-5', async (s) => {
      const roster = `# Roster

## Members

| Role | Name | Backing agent | Model |
|---|---|---|---|
| Orchestrator | Sylvia | Claude Code | session-based |
| QA-1 | Nadia | Claude Code | session-based |

Claude models, best first: fable, opus, sonnet, haiku
`
      const dir = await s.fs.mkdirp('proj')
      await s.fs.write('proj/AGENT_ROSTER.md', roster)
      await s.fs.write('proj/.blueprint-source', '')
      const run = (snippet: string) =>
        s.run('bash', ['-c', `. "${LIB}"; ${snippet.replace(/@/g, dir)}`], { cwd: s.workspace.root })

      const orch = await run('bp_roster_model_for_name "@" Sylvia')
      expect(orch.code, orch.output).toBe(2)
      expect(orch.stdout).toBe('')

      const label = await run('bp_roster_label "@" Sylvia')
      expect(label.stdout, label.output).toBe('Sylvia - Claude Code')
      expect(label.stderr).toBe('')

      const persona = await run('bp_roster_model_for_name "@" Nadia')
      expect(persona.code).not.toBe(0)
      expect(persona.stderr).toMatch(/Nadia:.*session-based.*Orchestrator/)
    })
  })

  it('#7 TASK-063: a Kimi tier resolves order from the roster and efforts from config.toml', async () => {
    await scenario('rm-7', async (s) => {
      const roster = `# Roster

## Members

| Role | Name | Backing agent | Model |
|---|---|---|---|
| Back-End-1 | Mira | Kimi | frontier:high |
| Back-End-2 | Nils | Kimi | frontier-3:high |

Kimi models, best first: kimi-code/k3, kimi-code/k3-256k, kimi-code/kimi-for-coding, kimi-code/kimi-for-coding-highspeed
`
      const dir = await s.fs.mkdirp('proj')
      await s.fs.write('proj/AGENT_ROSTER.md', roster)
      await s.fs.write('proj/.blueprint-source', '')
      const kimiHome = await s.fs.mkdirp('kimi')
      await s.fs.write(
        'kimi/config.toml',
        [
          '[models."kimi-code/k3"]',
          'model = "k3"',
          'support_efforts = [ "low", "high", "max" ]',
          '',
          '[models."kimi-code/kimi-for-coding-highspeed"]',
          'model = "kimi-for-coding-highspeed"',
          'max_context_size = 262144',
        ].join('\n') + '\n',
      )
      const env = { KIMI_CODE_HOME: kimiHome }
      const run = (snippet: string) =>
        s.run('bash', ['-c', `. "${LIB}"; ${snippet.replace(/@/g, dir)}`], { cwd: s.workspace.root, env })

      const ok = await run('bp_roster_model_for_name "@" Mira')
      // The alias is provider-qualified because that is what `kimi -m` accepts:
      // `-m k3` is refused ("Model "k3" is not configured in config.toml"),
      // `-m kimi-code/k3` runs. Measured on kimi 2.0.2.
      expect(ok.stdout, ok.output).toBe('Kimi\tkimi-code/k3\thigh\n')

      // frontier-3 lands on kimi-for-coding-highspeed, which has no
      // support_efforts key in config.toml — refused, not silently allowed.
      const noEfforts = await run('bp_roster_model_for_name "@" Nils')
      expect(noEfforts.code).not.toBe(0)
      expect(noEfforts.stdout).toBe('')
      expect(noEfforts.stderr).toMatch(/Nils: no support_efforts for kimi-code\/kimi-for-coding-highspeed/)
    })
  })

  it('#6 TASK-059 reopened: a nested subagent (rc-2 "who") labels with the model it ran on, no invented effort', async () => {
    await scenario('rm-6', async (s) => {
      const { dir, env } = await project(s)
      // Nadia dispatches a plain general-purpose helper — parentAgentId ties the
      // helper back to her, but the helper itself is never a roster name, so
      // there is no Model cell and no effort to show for it (bp_roster_subagent_label
      // rc-2 branch). Before the fix this always read "... - Claude Code", even
      // once the helper's own transcript recorded the model it ran on.
      await s.fs.write(
        'proj/sess/subagents/agent-parent1.meta.json',
        JSON.stringify({ agentType: 'general-purpose', description: 'Nadia coordinates the audit' }),
      )
      await s.fs.write(
        'proj/sess/subagents/agent-child1.meta.json',
        JSON.stringify({ agentType: 'general-purpose', description: 'check one file', parentAgentId: 'parent1' }),
      )
      await s.fs.write(
        'proj/sess/subagents/agent-child1.jsonl',
        JSON.stringify({ type: 'assistant', message: { model: 'claude-ran-7' } }) + '\n',
      )
      const r = await s.run(
        'bash',
        ['-c', `. "${LIB}"; bp_roster_subagent_label "$1" "$1/sess/subagents/agent-child1.meta.json"`, 'x', dir],
        { cwd: s.workspace.root, env },
      )
      expect(r.code, r.output).toBe(0)
      expect(r.stdout).toBe('Nadia › general-purpose - claude-ran-7')
    })
  })
})
