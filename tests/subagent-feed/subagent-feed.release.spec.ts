/**
 * tests/subagent-feed/subagent-feed.release.spec.ts — BUG-027.
 *
 * The feed goes dark for the whole duration of any Claude-persona run. Measured
 * 2026-08-18: 28 tool calls over 4 minutes produced two lines, while 165 KB and
 * 190 KB subagent transcripts sat on disk being written. The founder watched work
 * happen in the UI with the feed blank.
 *
 * It punishes the rule it serves — delegating to a persona buys a blackout, so
 * working solo keeps the feed live.
 *
 * TWO INDEPENDENT CAUSES, and either one alone still produces a useless feed, so
 * both are asserted end to end against a REAL supervisor reading a REAL fixture
 * transcript. The source checks at the bottom are a backstop against the specific
 * idioms, never the coverage — the whole defect was two functions that each looked
 * correct in isolation.
 *
 *   1. `project_jsonl` filtered `.isSidechain != true` for every file it read.
 *      EVERY assistant record in a subagent's own transcript is sidechain, so the
 *      projection dropped 100% of them. The same filter is CORRECT on the session
 *      transcript, which also carries those records and would otherwise show each
 *      subagent line twice. One function, two files, opposite requirements — so
 *      the cases below assert BOTH directions, or a fix that simply deletes the
 *      filter passes.
 *
 *   2. The label came from `.subagent_type`, which is the agent TYPE
 *      (`general-purpose`), never the roster persona — fourteen identical rows in
 *      `.subagent-map`. The persona is only in the dispatch description, in the
 *      transcript's sibling `agent-<id>.meta.json`.
 *
 * EQUIVALENCE RECORD (R6, and this migration's own evidence).
 *
 * Trees carrying one injected defect each, plus the healthy control and negative
 * controls, were built once and BOTH implementations run over each: the retiring
 * `tests/subagent-feed/test.sh`, copied into the tree, and this spec with
 * `BP_SPEC_ROOT` pointed at it. The per-id verdict sets were compared
 * mechanically; the TASK-018 report lists every divergence.
 *
 * TWO THINGS THE PORT CHANGES, both recorded because a silent change is still a
 * change:
 *
 *   - `#6` (a roster lib that never returns) bounds the hook with the HARNESS's
 *     process timeout rather than with `timeout(1)` resolved at run time, and
 *     therefore no longer SKIPS where no `timeout(1)` exists. R7: a skipped test
 *     fails the build. The hook still needs `timeout(1)` internally to bound its
 *     own lookup, so its absence is now a FAILURE with a message saying so rather
 *     than a silent gap in coverage on that host.
 *   - `#7` (the shim pin for BUG-031) is gone: TASK-088 deleted the shell file,
 *     and the hook is TypeScript run with node, so no `sh` option can kill it.
 */

import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { feedFixture, type FeedFixture } from '../helpers/feed-fixture.js'

/**
 * The tree under test. `BP_SPEC_ROOT` repoints it at a perturbed copy, which is
 * how the equivalence driver runs this spec and the retiring shell suite over the
 * same bytes. It selects the SUBJECT, never the sandbox.
 */
const SUBJECT = process.env.BP_SPEC_ROOT ?? REPO_ROOT

const FEED = join(SUBJECT, 'scripts', 'agent-activity.sh')
// TASK-088: the hook is scripts/log-activity.mts, run with node; its shell file
// is deleted.
const HOOK_IMPL = join(SUBJECT, 'scripts', 'log-activity.mts')
const ROSTER_LIB = join(SUBJECT, 'scripts', 'lib', 'roster.sh')

/** A script's source with comments stripped — this suite's own header names the idioms. */
async function code(path: string): Promise<string> {
  const raw = await readFile(path, 'utf8').catch(() => '')
  return raw.replace(/^[ \t]*#.*$/gm, '').replace(/[ \t]#.*$/gm, '')
}

/**
 * A roster of our OWN, never the repo's.
 *
 * A persona literal from someone's real fleet in a test is the BUG-010
 * contamination class in fixture form, and the assertions must not depend on which
 * names this engineer happens to run. Every row below earns its place:
 *
 *   Nadia / Pike        the description names TWO personas, which is the ordinary
 *                       shape ("<X> implements <Y>'s prescription"), and Pike sits
 *                       HIGHER in the table — so a resolver that returns the first
 *                       roster ROW rather than the earliest MENTION is caught.
 *   Bo / Bonnie         a short name that is a PREFIX of a longer one. A bare
 *                       substring match resolves 'Bonnie' to 'Bo', stably and
 *                       wrongly.
 *   Mary Jane / Mary    a name containing a SPACE, and one that is a prefix of it
 *                       at the same position with clean boundaries — so the
 *                       longest match has to win the tie.
 *   O'Neil              a name containing PUNCTUATION. The first implementation
 *                       tokenised the description and compared each token to the
 *                       WHOLE name, so any name holding a space or an apostrophe
 *                       could never equal one token and resolved to nothing,
 *                       silently, for every such fleet.
 */
const ROSTER = `# Roster

## Members

| Role | Name | Backing agent |
|---|---|---|
| Orchestrator | Wren | Claude Code |
| Senior Architect | Pike | Claude Code |
| Back-End-1 | Nadia | Claude Code |
| Front-End-2 | Bo | Codex |
| Front-End-1 | Bonnie | Claude Code |
| Data-1 | Mary Jane | Claude Code |
| Data-2 | Mary | Codex |
| QA-1 | O'Neil | Codex |
`

/** Resolve a description to a persona through the shared lookup. */
async function nameInText(s: Scenario, rosterDir: string, text: string) {
  return s.run(
    'bash',
    ['-c', `. "${ROSTER_LIB}"; bp_roster_name_in_text "${rosterDir}" "$1"`, 'x', text],
    { cwd: s.workspace.root },
  )
}

/** One assistant record as Claude Code writes it. */
const rec = (text: string, isSidechain: boolean): string =>
  `${JSON.stringify({
    type: 'assistant',
    isSidechain,
    message: { content: [{ type: 'text', text }] },
  })}\n`

/** Same, but with a `message.model` — what makes a real record ran-model-bearing. */
const recWithModel = (text: string, isSidechain: boolean, model: string): string =>
  `${JSON.stringify({
    type: 'assistant',
    isSidechain,
    message: { model, content: [{ type: 'text', text }] },
  })}\n`

/**
 * A roster with a Model cell for Nadia (TASK-059 reopened). Kept separate from
 * the shared ROSTER above — which has no Model column on purpose, so every
 * other case in this file keeps asserting the plain "<Name> - <Backing>" shape
 * unaffected by this one persona's tier.
 */
const MODEL_ROSTER = `# Roster

## Members

| Role | Name | Backing agent | Model |
|---|---|---|---|
| Orchestrator | Wren | Claude Code | session-based |
| Back-End-1 | Nadia | Claude Code | frontier:high |

Claude models, best first: fable, opus, sonnet, haiku
`

interface Transcripts {
  /** The session transcript — carries the orchestrator's own records AND sidechain copies. */
  readonly mainRel: string
  /** The subagent's own transcript — every record in it is sidechain. */
  readonly subRel: string
}

/** The session transcript Claude Code writes for a fixture, under the scenario's HOME. */
const sessionRel = (f: FeedFixture): string =>
  `home/.claude/projects/${f.repo.replace(/\//g, '-')}/sess.jsonl`

/**
 * A subagent's sibling meta file, as Claude Code writes it beside the session
 * transcript. THE DISPATCH DESCRIPTION IN IT IS THE ONLY CARRIER OF THE PERSONA,
 * and `parentAgentId` (present only on a nested dispatch) the only link from a
 * helper to the agent that started it. Shape recorded 2026-09-15 (BUG-124).
 */
async function writeMeta(
  s: Scenario,
  session: string,
  agentId: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await s.fs.write(
    session.replace(/\.jsonl$/, `/subagents/agent-${agentId}.meta.json`),
    `${JSON.stringify({ agentType: 'general-purpose', toolUseId: 'toolu_x', spawnDepth: 1, ...meta })}\n`,
  )
}

/**
 * The transcript tree Claude Code actually writes, under the scenario's HOME.
 *
 * The project directory is the repo path with every `/` replaced by `-`, which is
 * how the real client names it; deriving it rather than hardcoding is what makes
 * the fixture follow the workspace instead of agreeing with it by coincidence.
 */
async function transcripts(
  s: Scenario,
  f: FeedFixture,
  agentId: string,
  meta: Record<string, unknown> = { description: "Nadia implements Pike's prescription" },
): Promise<Transcripts> {
  const mainRel = sessionRel(f)
  const subRel = mainRel.replace(/\.jsonl$/, `/subagents/agent-${agentId}.jsonl`)

  await s.fs.write(mainRel, '', { append: true })
  await s.fs.write(subRel, '')
  await writeMeta(s, mainRel, agentId, meta)
  return { mainRel, subRel }
}

/**
 * The hook payloads Claude Code ACTUALLY sends — recorded from a live dispatch on
 * 2026-09-15 (BUG-124), trimmed to the fields that matter.
 *
 * NEITHER CARRIES THE DISPATCH DESCRIPTION. The previous #4 fed the hook a
 * `description` field that no real payload has, so it passed while every real
 * bookend in the feed read `[general-purpose - Claude Code]`. And at SubagentStart
 * the meta file that does carry it is not there yet: measured absent across a 2 s
 * poll from inside the hook, i.e. it is written after the hook RETURNS. At
 * SubagentStop it is present every time.
 */
function hookPayload(
  event: 'SubagentStart' | 'SubagentStop',
  sessionJsonl: string,
  agentId: string,
  agentType = 'general-purpose',
): Record<string, unknown> {
  const start = {
    session_id: 'sess',
    transcript_path: sessionJsonl,
    cwd: '/',
    agent_id: agentId,
    agent_type: agentType,
    hook_event_name: event,
  }
  if (event === 'SubagentStart') return start
  return {
    ...start,
    stop_hook_active: false,
    agent_transcript_path: sessionJsonl.replace(/\.jsonl$/, `/subagents/agent-${agentId}.jsonl`),
    last_assistant_message: 'OK',
  }
}

/** A standalone tree holding only the hook, its libs and a roster — for #5 and #6. */
async function hookTree(s: Scenario, name: string, rosterLib: string): Promise<string> {
  const dir = await s.fs.mkdirp(name)
  await s.fs.mkdirp(`${name}/logs`)
  await s.fs.write(`${name}/.blueprint-source`, '')
  await s.fs.copyIn(HOOK_IMPL, `${name}/scripts/log-activity.mts`)
  const libs = await s.run('sh', ['-c', `ls "${join(SUBJECT, 'scripts', 'lib')}"`], {
    cwd: s.workspace.root,
  })
  for (const lib of libs.stdout.split('\n').filter((l) => l.endsWith('.sh'))) {
    await s.fs.copyIn(join(SUBJECT, 'scripts', 'lib', lib), `${name}/scripts/lib/${lib}`)
  }
  await s.fs.write(`${name}/AGENT_ROSTER.md`, ROSTER)
  // The poison goes in LAST, so it overwrites the real lib rather than racing it.
  await s.fs.write(`${name}/scripts/lib/roster.sh`, rosterLib)
  return dir
}

/** Feed a hook payload to the hook, as Claude Code does, and wait for it to exit. */
async function fireHook(
  s: Scenario,
  dir: string,
  payload: Record<string, unknown>,
  env: Record<string, string | undefined> = {},
  timeoutMs = 30_000,
) {
  return s.run(
    'sh',
    ['-c', `printf '%s' "$1" | node "${join(dir, 'scripts', 'log-activity.mts')}"`, 'x', JSON.stringify(payload)],
    { cwd: dir, env, timeoutMs },
  )
}

describe('BUG-027 — delegated work is visible in the feed, under its persona', () => {
  // =========================================================================
  // #0 — the roster resolver, the ONE derivation both readers share.
  // =========================================================================
  it('#0 bp_roster_name_in_text is exposed by the roster lib', async () => {
    await scenario('sf-0-exposed', async (s) => {
      const r = await s.run(
        'bash',
        ['-c', `. "${ROSTER_LIB}" && command -v bp_roster_name_in_text >/dev/null 2>&1`],
        { cwd: s.workspace.root },
      )
      expect(
        r.code,
        'no shared text→persona lookup — the feed and the hook must each grow one, and drift',
      ).toBe(0)
    })
  })

  it('#0 the EARLIEST persona named wins, not the highest roster row', async () => {
    await scenario('sf-0-earliest', async (s) => {
      const dir = await s.fs.mkdirp('proj')
      await s.fs.write('proj/AGENT_ROSTER.md', ROSTER)
      // Resolving by table order would answer Pike, who sits higher. Wrong, and
      // STABLY wrong, which is worse than a visible miss.
      const r = await nameInText(s, dir, "Nadia implements Pike's prescription")
      expect(r.stdout).toBe('Nadia')
    })
  })

  it("#0 matches whole words — 'Bonnie' is not read as 'Bo'", async () => {
    await scenario('sf-0-prefix', async (s) => {
      const dir = await s.fs.mkdirp('proj')
      await s.fs.write('proj/AGENT_ROSTER.md', ROSTER)
      const r = await nameInText(s, dir, 'Bonnie reviews the diff')
      expect(r.stdout).toBe('Bonnie')
    })
  })

  it('#0 a description naming no persona resolves nothing (rc!=0)', async () => {
    await scenario('sf-0-none', async (s) => {
      const dir = await s.fs.mkdirp('proj')
      await s.fs.write('proj/AGENT_ROSTER.md', ROSTER)
      const r = await nameInText(s, dir, 'nobody by name here')
      expect(r.code, 'a description naming no persona still resolved one').not.toBe(0)
      expect(r.stdout).toBe('')
    })
  })

  it('#0 a name containing a SPACE resolves', async () => {
    await scenario('sf-0-space', async (s) => {
      const dir = await s.fs.mkdirp('proj')
      await s.fs.write('proj/AGENT_ROSTER.md', ROSTER)
      const r = await nameInText(s, dir, 'Mary Jane reviews')
      expect(r.stdout).toBe('Mary Jane')
    })
  })

  it('#0 a name containing PUNCTUATION resolves', async () => {
    await scenario('sf-0-punct', async (s) => {
      const dir = await s.fs.mkdirp('proj')
      await s.fs.write('proj/AGENT_ROSTER.md', ROSTER)
      const r = await nameInText(s, dir, "O'Neil reviews")
      expect(r.stdout).toBe("O'Neil")
    })
  })

  it('#0 earliest mention still wins with multi-word names', async () => {
    await scenario('sf-0-earliest-multi', async (s) => {
      const dir = await s.fs.mkdirp('proj')
      await s.fs.write('proj/AGENT_ROSTER.md', ROSTER)
      // The roster is ordered so that resolving by row would answer 'Mary Jane'.
      const r = await nameInText(s, dir, "O'Neil reviews Mary Jane's plan")
      expect(r.stdout).toBe("O'Neil")
    })
  })

  it('#0 a name that is a PREFIX of a longer one still resolves to the longer', async () => {
    await scenario('sf-0-tie', async (s) => {
      const dir = await s.fs.mkdirp('proj')
      await s.fs.write('proj/AGENT_ROSTER.md', ROSTER)
      // 'Mary' and 'Mary Jane' both start at position 1 with clean boundaries, so
      // the boundary check alone cannot decide it — the specific name has to win
      // the tie. Bo/Bonnie above covers the other direction.
      const r = await nameInText(s, dir, "Mary Jane's plan lands")
      expect(r.stdout).toBe('Mary Jane')
    })
  })

  // =========================================================================
  // #1-#3 — THE REPRODUCER, against a real supervisor.
  // =========================================================================
  it('#1 a sidechain record in a subagent transcript reaches the feed', async () => {
    await scenario('sf-1', async (s) => {
      const f = await feedFixture(s, 'repo', { source: SUBJECT, roster: ROSTER, holder: 'Wren' })
      const t = await transcripts(s, f, 'abc123def456')

      await f.withFeed(async () => {
        // The handshake, on the very file the case will use: `wait_sup` proves a
        // supervisor is RESIDENT, not that it has seeded THIS transcript, and a
        // payload written before the seed is skipped PERMANENTLY (BUG-038). Without
        // it this case reports "nothing emitted", which reads exactly like the
        // blackout it exists to detect.
        await f.readerReady(t.subRel, { wrap: (tag) => rec(tag, true) })
        await s.fs.write(t.subRel, rec('SUBAGENT-VISIBLE-LINE', true), { append: true })

        await f.expectLine('SUBAGENT-VISIBLE-LINE')
      })
    })
  })

  it("#2 labelled '[Nadia - Claude Code]' — persona + backing, from the roster", async () => {
    await scenario('sf-2', async (s) => {
      // Asserting the persona ALONE would pass against a label built by any means;
      // the backing agent is what proves it went through bp_roster_label.
      // `.subagent_type` is the agent TYPE (general-purpose) for every persona.
      const f = await feedFixture(s, 'repo', { source: SUBJECT, roster: ROSTER, holder: 'Wren' })
      const t = await transcripts(s, f, 'abc123def456')

      await f.withFeed(async () => {
        await f.readerReady(t.subRel, { wrap: (tag) => rec(tag, true) })
        await s.fs.write(t.subRel, rec('LABELLED-LINE', true), { append: true })
        await f.expectLine('LABELLED-LINE')

        expect(await f.read()).toContain('[Nadia - Claude Code] LABELLED-LINE')
      })
    })
  })

  it('#2b TASK-059 reopened: a streamed subagent line upgrades from the alias to the ran model, and stays there', async () => {
    await scenario('sf-2b', async (s) => {
      // The transcript is discovered (and its offset seeded) BEFORE it has any
      // assistant record, exactly like a real dispatch: the meta file lands
      // first, the model only shows up once the first assistant turn is
      // written. Before the fix, the label resolved at discovery — with no ran
      // model yet — and was cached for the stream's whole life, so every later
      // line kept reading the roster alias ("fable") even after the transcript
      // started recording the real model.
      const f = await feedFixture(s, 'repo', { source: SUBJECT, roster: MODEL_ROSTER, holder: 'Wren' })
      const t = await transcripts(s, f, 'abc123def456')

      await f.withFeed(async () => {
        await f.readerReady(t.subRel, { wrap: (tag) => rec(tag, true) })

        // No model yet: the roster alias wins.
        await s.fs.write(t.subRel, rec('BEFORE-MODEL-LINE', true), { append: true })
        await f.expectLine('BEFORE-MODEL-LINE')
        expect(await f.read()).toContain('[Nadia - fable - high] BEFORE-MODEL-LINE')

        // First assistant record carrying a model — the transcript now KNOWS.
        await s.fs.write(t.subRel, recWithModel('MODEL-LANDS-LINE', true, 'claude-ran-7'), { append: true })
        await f.expectLine('MODEL-LANDS-LINE')
        expect(await f.read()).toContain('[Nadia - claude-ran-7 - high] MODEL-LANDS-LINE')

        // Every line after that keeps naming the ran model — one resolution to
        // pick it up, then cached for good, not a jq per tick forever.
        await s.fs.write(t.subRel, rec('AFTER-MODEL-LINE', true), { append: true })
        await f.expectLine('AFTER-MODEL-LINE')
        expect(await f.read()).toContain('[Nadia - claude-ran-7 - high] AFTER-MODEL-LINE')
        expect(
          await f.count('[Nadia - fable - high] MODEL-LANDS-LINE'),
          'the alias must never re-appear once the ran model is known',
        ).toBe(0)
      })
    })
  })

  it('BUG-137 a subagent transcript that already has a line when the supervisor first discovers it is not truncated', async () => {
    await scenario('sf-137', async (s) => {
      // Live probe, 2026-09-17 19:52: a nested helper's transcript held TWO
      // Bash-call records by the time the supervisor's glob scan found it, and
      // the feed showed only the second. `seed_offset` seeded the file at its
      // CURRENT size on discovery — correct for a file that predates the
      // supervisor, wrong for one born while it is already running, since
      // every byte in it was written during this supervisor's own lifetime.
      const f = await feedFixture(s, 'repo', { source: SUBJECT, roster: ROSTER, holder: 'Wren' })
      const mainRel = sessionRel(f)
      await s.fs.write(mainRel, '', { append: true })

      await f.withFeed(async () => {
        // Prove the supervisor has completed at least one full scan cycle
        // BEFORE the subagent transcript exists at all. Without this, the
        // file could land on the supervisor's very first scan by chance,
        // which is the OTHER case (see the control case below) and would
        // prove nothing about a later discovery.
        await f.readerReady(mainRel, { wrap: (tag) => rec(tag, false) })

        const agentId = 'bug137aaaaaa'
        const subRel = mainRel.replace(/\.jsonl$/, `/subagents/agent-${agentId}.jsonl`)
        await writeMeta(s, mainRel, agentId, { description: "Nadia implements Pike's prescription" })
        // Written as ONE call, with its first record already in it — exactly
        // like a nested helper whose transcript is created mid-run, already
        // carrying whatever it wrote before the next scan finds it. Never
        // `{ append: true }` against an empty file first: that would give the
        // supervisor a chance to discover an EMPTY file before this content
        // lands, which is a different (and already-covered) race.
        await s.fs.write(subRel, rec('FIRST-BUG137-LINE', true))

        await f.expectLine('FIRST-BUG137-LINE')

        await s.fs.write(subRel, rec('SECOND-BUG137-LINE', true), { append: true })
        await f.expectLine('SECOND-BUG137-LINE')
      })
    })
  })

  it('BUG-137 control: a subagent transcript present at the supervisor\'s first scan is still not replayed', async () => {
    await scenario('sf-137-control', async (s) => {
      // The fix must not turn EVERY subagent transcript into a zero-seed —
      // only ones discovered after the supervisor's first pass. A file that
      // is already there when the supervisor starts (a finished agent from
      // an earlier run, say) must keep the old EOF-seed behaviour.
      const f = await feedFixture(s, 'repo', { source: SUBJECT, roster: ROSTER, holder: 'Wren' })
      const t = await transcripts(s, f, 'bug137control')
      await s.fs.write(t.subRel, rec('PRE-EXISTING-BUG137-must-not-replay', true))

      await f.withFeed(async () => {
        await f.readerReady(t.subRel, { wrap: (tag) => rec(tag, true) })
        await s.fs.write(t.subRel, rec('BUG137-CONTROL-SENTINEL', true), { append: true })
        await f.expectLine('BUG137-CONTROL-SENTINEL')

        expect(await f.count('PRE-EXISTING-BUG137-must-not-replay')).toBe(0)
      })
    })
  })

  it("#3 the session transcript's own records still stream", async () => {
    await scenario('sf-3a', async (s) => {
      const f = await feedFixture(s, 'repo', { source: SUBJECT, roster: ROSTER, holder: 'Wren' })
      const t = await transcripts(s, f, 'abc123def456')

      await f.withFeed(async () => {
        await f.readerReady(t.mainRel, { wrap: (tag) => rec(tag, false) })
        await s.fs.write(t.mainRel, rec('MAIN-OWN-LINE', false), { append: true })

        await f.expectLine('MAIN-OWN-LINE')
      })
    })
  })

  it('#3 sidechain records in the SESSION transcript are still dropped (no duplicates)', async () => {
    await scenario('sf-3b', async (s) => {
      // WITHOUT THIS, DELETING THE FILTER OUTRIGHT PASSES #1 — and every subagent
      // line then appears twice, the second time under the orchestrator's label.
      const f = await feedFixture(s, 'repo', { source: SUBJECT, roster: ROSTER, holder: 'Wren' })
      const t = await transcripts(s, f, 'abc123def456')

      await f.withFeed(async () => {
        await f.readerReady(t.mainRel, { wrap: (tag) => rec(tag, false) })
        await s.fs.write(t.mainRel, rec('MAIN-SIDECHAIN-COPY', true), { append: true })
        // An absence assertion needs a LATER positive to bound it, or it cannot
        // tell "dropped" from "not read yet". The sentinel is written after the
        // sidechain record and to the same file, so its arrival proves the
        // sidechain record was seen and discarded rather than still queued.
        await s.fs.write(t.mainRel, rec('MAIN-BOUND-SENTINEL', false), { append: true })
        await f.expectLine('MAIN-BOUND-SENTINEL')

        expect(
          await f.count('MAIN-SIDECHAIN-COPY'),
          'the sidechain filter was removed rather than made per-file — every ' +
            'subagent line will now appear twice, the second time mislabelled',
        ).toBe(0)
      })
    })
  })

  // =========================================================================
  // #4 — the hook labels its bookends from the same lookup.
  // =========================================================================
  const hookFixture = (s: Scenario) =>
    feedFixture(s, 'repo', { source: SUBJECT, roster: ROSTER, holder: 'Wren', withHook: true })

  it('#4 BUG-124: the dispatch bookend carries the persona, although its meta file is written after the hook returns', async () => {
    await scenario('sf-4a', async (s) => {
      // Two labels that agree only by coincidence is the BUG-010/BUG-021 shape.
      const f = await hookFixture(s)
      const session = join(s.workspace.root, sessionRel(f))

      const r = await fireHook(s, f.repo, hookPayload('SubagentStart', session, 'abc123def456'), {
        ...f.env,
        AGENT_FEED_LOG: f.log,
      })
      expect(r.code, r.output).toBe(0)
      // Only NOW, as the real client does it.
      await writeMeta(s, sessionRel(f), 'abc123def456', { description: "Nadia implements Pike's prescription" })

      await f.expectLine('[Nadia - Claude Code] → dispatched')
      expect(await f.count('→ dispatched'), 'one dispatch, one bookend').toBe(1)
    })
  })

  it('#4 BUG-124: the finish bookend carries the persona', async () => {
    await scenario('sf-4b', async (s) => {
      const f = await hookFixture(s)
      await writeMeta(s, sessionRel(f), 'abc123def456', { description: "Nadia implements Pike's prescription" })

      const r = await fireHook(
        s,
        f.repo,
        hookPayload('SubagentStop', join(s.workspace.root, sessionRel(f)), 'abc123def456'),
        { ...f.env, AGENT_FEED_LOG: f.log },
      )
      expect(r.code, r.output).toBe(0)

      expect(await f.read()).toContain('[Nadia - Claude Code] ← finished')
    })
  })

  it("#4 BUG-124: a helper a persona starts is labelled with that persona, not only the helper's type", async () => {
    await scenario('sf-4c', async (s) => {
      // The 23:04 case: Christian started a claude-code-guide helper, and its
      // bookends and 43 lines read `[claude-code-guide - Claude Code]` with
      // nothing tying them to him. `parentAgentId` is the tie.
      const f = await hookFixture(s)
      await writeMeta(s, sessionRel(f), 'abc123def456', { description: "Nadia implements Pike's prescription" })
      await writeMeta(s, sessionRel(f), 'fed654cba321', {
        agentType: 'claude-code-guide',
        description: 'Check missing import behaviour',
        parentAgentId: 'abc123def456',
        spawnDepth: 2,
      })

      const r = await fireHook(
        s,
        f.repo,
        hookPayload('SubagentStop', join(s.workspace.root, sessionRel(f)), 'fed654cba321', 'claude-code-guide'),
        { ...f.env, AGENT_FEED_LOG: f.log },
      )
      expect(r.code, r.output).toBe(0)

      expect(await f.read()).toContain('[Nadia › claude-code-guide - Claude Code] ← finished')
    })
  })

  it("#4 BUG-124: a helper's STREAMED lines carry the same parent label", async () => {
    await scenario('sf-4d', async (s) => {
      const f = await feedFixture(s, 'repo', { source: SUBJECT, roster: ROSTER, holder: 'Wren' })
      await transcripts(s, f, 'abc123def456')
      const t = await transcripts(s, f, 'fed654cba321', {
        agentType: 'claude-code-guide',
        description: 'Check missing import behaviour',
        parentAgentId: 'abc123def456',
        spawnDepth: 2,
      })

      await f.withFeed(async () => {
        await f.readerReady(t.subRel, { wrap: (tag) => rec(tag, true) })
        await s.fs.write(t.subRel, rec('HELPER-LINE', true), { append: true })
        await f.expectLine('HELPER-LINE')

        expect(await f.read()).toContain('[Nadia › claude-code-guide - Claude Code] HELPER-LINE')
      })
    })
  })

  it('#4 a meta file that never appears costs the label, not the bookend', async () => {
    await scenario('sf-4e', async (s) => {
      const f = await hookFixture(s)
      const r = await fireHook(
        s,
        f.repo,
        hookPayload('SubagentStart', join(s.workspace.root, sessionRel(f)), 'abc123def456'),
        { ...f.env, AGENT_FEED_LOG: f.log, BP_SUBAGENT_META_WAIT: '1' },
      )
      expect(r.code, r.output).toBe(0)

      await f.expectLine('[general-purpose - Claude Code] → dispatched')
    })
  })

  // =========================================================================
  // #5 / #6 — a broken roster lib must cost the LABEL, never the tool call.
  // =========================================================================
  it('#5 a roster lib that exits cannot take the hook down', async () => {
    await scenario('sf-5', async (s) => {
      // Found by the cross-provider reviewer: absent, unreadable and
      // non-zero-return all degraded safely, and a bare `exit` inside the lib did
      // not — it took the hook down with it, and a hook that dies fails the tool
      // call it was only there to observe.
      //
      // THIS REPLACES A SOURCE CHECK on the guard's SHAPE. The shape was the wrong
      // thing to assert: one attempt at it passed a correct implementation and
      // another failed one, both for reasons of formatting rather than behaviour.
      // Poison the lib and see what happens — that cannot be fooled by where a
      // line break falls.
      const dir = await hookTree(s, 'poison', 'exit 3\n')
      const feedLog = join(await s.fs.mkdirp('poison/logs'), 'feed.log')
      // The meta is PRESENT, so the hook really runs the lookup through the lib.
      await writeMeta(s, 'poison/sess.jsonl', 'deadbeef', { description: 'Nadia does a thing' })

      const r = await fireHook(
        s,
        dir,
        hookPayload('SubagentStop', join(dir, 'sess.jsonl'), 'deadbeef'),
        { AGENT_FEED_LOG: feedLog },
      )

      // The hook's stderr is KEPT, not discarded. This assertion used to swallow it
      // and report `rc=2` alone, which is how it failed in CI for a whole day while
      // passing on every developer machine: the number named the symptom and
      // nothing else. An assertion that cannot say WHY is the same defect this
      // suite exists to fix.
      expect(
        r.code,
        `a roster lib that calls exit killed the hook — it would fail the tool call.\n` +
          `hook stderr:\n${r.stderr}`,
      ).toBe(0)
      expect(
        (await readFile(feedLog, 'utf8').catch(() => '')).length,
        'the hook survived but logged nothing — the bookend is what makes a dispatch visible at all',
      ).toBeGreaterThan(0)
    })
  })

  it('#6 a roster lib that never returns is bounded; the line still lands, labelled by agent type', async () => {
    await scenario('sf-6', async (s) => {
      // THE SIBLING OF #5, AND THE ONE MODE THE SUBSHELL DOES NOT COVER: a subshell
      // contains an `exit`, it does not contain an infinite loop. Measured at
      // rc=124 under an external 2s bound, no feed line, no map row, while every
      // other broken-library mode degraded correctly. A hook that HANGS is worse
      // than one that dies: it stalls the tool call it was only there to observe.
      const dir = await hookTree(s, 'hang', 'while :; do :; done\n')
      const feedLog = join(await s.fs.mkdirp('hang/logs'), 'feed.log')
      await writeMeta(s, 'hang/sess.jsonl', 'hang01', { description: 'Nadia does a thing' })

      // The outer bound is the HARNESS's, deliberately several times the hook's, so
      // a regression shows up as a failure and never as a suite that never returns.
      // It replaces the shell version's run-time search for `timeout(1)`, which
      // SKIPPED the case where none was found — R7 makes a skip a build failure.
      const r = await fireHook(
        s,
        dir,
        hookPayload('SubagentStop', join(dir, 'sess.jsonl'), 'hang01'),
        { AGENT_FEED_LOG: feedLog, BP_ROSTER_LOOKUP_TIMEOUT: '1' },
        20_000,
      )

      expect(
        r.code,
        `a hook must always exit 0. A roster lib that never returns must not hang it.\n` +
          `hook stderr:\n${r.stderr}`,
      ).toBe(0)
      expect(
        await readFile(feedLog, 'utf8').catch(() => ''),
        'the hook survived the hang but did not land the bookend labelled by agent type',
      ).toContain('[general-purpose - Claude Code] ← finished')
    })
  })

  // =========================================================================
  // Source backstops. Cheap guards against the exact idioms, not the coverage.
  // =========================================================================
  it('static: subagent transcripts are pumped under their own kind', async () => {
    expect(await code(FEED)).toMatch(/pump .*subagent|pump "\$f" jsonl-sub/)
  })

  it('static: the hook and the feed label a subagent through the one shared function', async () => {
    // The BUG-010 shape: two copies of a rule are two rules. BUG-124 was exactly
    // that — the hook derived its label apart from the feed, and they disagreed.
    expect(await code(HOOK_IMPL)).toMatch(/bp_roster_subagent_label/)
    expect(await code(HOOK_IMPL)).toMatch(/ROSTER_LIB/)
    expect(await code(FEED)).toMatch(/bp_roster_subagent_label/)
  })

  it('static: the hook resolves its timeout provider through scripts/lib/staleness.sh', async () => {
    // That question has one answer. A second way to find a timeout command is a
    // second rule that will disagree with the first on some host.
    expect(await code(HOOK_IMPL)).toMatch(/bp_staleness_timeout_cmd/)
  })
})

/**
 * Alex's cross-provider review, 2026-09-16, finding 4: the deferred child is the
 * only part of this hook that outlives the tool call, and it inherited the
 * caller's open descriptors, took its bound from an unvalidated variable, and had
 * no cap on how many could be waiting at once.
 */
describe('BUG-124 — the deferred bookend child holds nothing and is bounded', () => {
  const deferFixture = (s: Scenario) =>
    feedFixture(s, 'repo', { source: SUBJECT, roster: ROSTER, holder: 'Wren', withHook: true })

  /**
   * Deferred children of THIS scenario, by cwd — never machine-wide (BUG-089).
   *
   * Returns the matching `ps` lines rather than a bare count: a cap assertion
   * that fails with "expected 9 to be <= 8" cannot say WHICH ninth process it
   * counted, and that number is the whole evidence.
   */
  async function children(s: Scenario, repo: string): Promise<string[]> {
    const r = await s.run(
      'sh',
      [
        '-c',
        `. "${join(REPO_ROOT, 'tests', 'helpers', 'proc-cwd.sh')}"
         bp_proc_cwd_available || { echo NO-PROC-CWD-MECHANISM; exit 1; }
         ps -eo pid,args 2>/dev/null | grep -E '[l]og-activity\.(sh|mts)' | while read -r p rest; do
           case "$(bp_proc_cwd "$p")" in "$1"*) printf '%s %s\\n' "$p" "$rest" ;; esac
         done`,
        'x',
        repo,
      ],
      { cwd: repo },
    )
    if (r.stdout.includes('NO-PROC-CWD-MECHANISM')) {
      throw new Error(
        'this host has neither /proc nor lsof, so the deferred child cannot be counted. ' +
          'Every count would be 0 — which is what these cases assert — so the suite refuses ' +
          'to answer rather than reporting clean over nothing (BUG-089).',
      )
    }
    return r.stdout.split('\n').filter((l) => l.trim() !== '')
  }

  const start = (s: Scenario, f: FeedFixture, id: string): string =>
    JSON.stringify(hookPayload('SubagentStart', join(s.workspace.root, sessionRel(f)), id))

  it('#8 an inherited descriptor is released when the hook returns, not when the child finishes', async () => {
    await scenario('sf-8', async (s) => {
      // The hook redirects 0, 1 and 2 only, so everything above 2 went to the
      // child — including a lock. A dispatch lock could therefore be held for the
      // whole meta wait, long after the hook exited.
      const f = await deferFixture(s)
      await s.fs.write('lock', '')
      const lock = join(s.workspace.root, 'lock')
      const driver = await s.fs.write(
        'hold-fd.sh',
        `exec 9>${JSON.stringify(lock)}\n` +
          `flock -n 9 || exit 3\n` +
          `printf '%s' "$1" | node ${JSON.stringify(join(f.repo, 'scripts/log-activity.mts'))}\n` +
          `exec 9>&-\n`,
      )

      const r = await s.run('sh', [driver, start(s, f, 'abc123def456')], {
        cwd: f.repo,
        env: { ...f.env, AGENT_FEED_LOG: f.log, BP_SUBAGENT_META_WAIT: '5' },
      })
      expect(r.code, `the fixture never took the lock\n${r.output}`).toBe(0)

      // While the child is still waiting for a meta file that never comes.
      const probe = await s.run('flock', ['-w', '2', lock, 'true'], { cwd: f.repo })
      expect(
        probe.code,
        'the lock was still held after the hook returned — the deferred child inherited it',
      ).toBe(0)
      await f.expectLine('→ dispatched', 15_000)
      await vi.waitFor(
        async () => {
          const alive = await children(s, f.repo)
          if (alive.length > 0) throw new Error(`still running:\n${alive.join('\n')}`)
        },
        { timeout: 20_000, interval: 250 },
      )
    })
  })

  it('#9 an out-of-range meta wait is capped, so the child cannot outlive the dispatch by hours', async () => {
    await scenario('sf-9', async (s) => {
      const f = await deferFixture(s)
      const r = await s.run(
        'sh',
        ['-c', `printf '%s' "$1" | node ${JSON.stringify(join(f.repo, 'scripts/log-activity.mts'))}`, 'x', start(s, f, 'abc123def456')],
        { cwd: f.repo, env: { ...f.env, AGENT_FEED_LOG: f.log, BP_SUBAGENT_META_WAIT: '999999' } },
      )
      expect(r.code, r.output).toBe(0)
      expect(
        (await children(s, f.repo)).length,
        'no child was deferred, so this case proves nothing',
      ).toBeGreaterThan(0)

      // PROCESS EXIT, not marker arrival: the bookend lands on the way out, so a
      // case that waits for the line says nothing about the process behind it.
      await vi.waitFor(
        async () => {
          const alive = await children(s, f.repo)
          if (alive.length > 0) throw new Error(`still running:\n${alive.join('\n')}`)
        },
        { timeout: 30_000, interval: 250 },
      )
      expect(await f.read()).toContain('→ dispatched')
    })
  })

  it('#10 a meta wait that is not a number costs neither the bookend nor the hook', async () => {
    await scenario('sf-10', async (s) => {
      // Unvalidated, the value reached shell arithmetic, where a non-numeric name
      // is an error under `set -u` — killing the child before it emits anything.
      const f = await deferFixture(s)
      const r = await s.run(
        'sh',
        ['-c', `printf '%s' "$1" | node ${JSON.stringify(join(f.repo, 'scripts/log-activity.mts'))}`, 'x', start(s, f, 'abc123def456')],
        { cwd: f.repo, env: { ...f.env, AGENT_FEED_LOG: f.log, BP_SUBAGENT_META_WAIT: 'soon' } },
      )
      expect(r.code, `a hook must always exit 0\n${r.output}`).toBe(0)
      await f.expectLine('→ dispatched', 15_000)
      // THE LINE LANDS MICROSECONDS BEFORE THE CHILD EXITS, so waiting for the
      // line alone leaves a live process at teardown — a survivor fails the
      // scenario, and this case was the only deferring one not to wait for it
      // (#9, #13 and #14 all do). Latent until the child's startup grew a source
      // and shifted the race; the gap was always here.
      await vi.waitFor(
        async () => {
          const alive = await children(s, f.repo)
          if (alive.length > 0) throw new Error(`still running:\n${alive.join('\n')}`)
        },
        { timeout: 20_000, interval: 250 },
      )
    })
  })

  it('#11 a burst of dispatches is capped, and every bookend still lands', async () => {
    await scenario('sf-11', async (s) => {
      const f = await deferFixture(s)
      const ids = Array.from({ length: 12 }, (_, i) => `burst${i}0000000`)
      for (const id of ids) {
        const r = await s.run(
          'sh',
          ['-c', `printf '%s' "$1" | node ${JSON.stringify(join(f.repo, 'scripts/log-activity.mts'))}`, 'x', start(s, f, id)],
          { cwd: f.repo, env: { ...f.env, AGENT_FEED_LOG: f.log, BP_SUBAGENT_META_WAIT: '20' } },
        )
        expect(r.code, r.output).toBe(0)
      }

      // Unbounded, all twelve sit waiting for twenty seconds each. The cap makes
      // the surplus emit at once instead — labelled by agent type, never dropped.
      const waiting = await children(s, f.repo)
      expect(
        waiting.length,
        `every dispatch in the burst deferred a waiting child; nothing caps them:\n${waiting.join('\n')}`,
      ).toBeLessThanOrEqual(8)
      await vi.waitFor(
        async () => {
          const n = await f.count('→ dispatched')
          if (n !== ids.length) throw new Error(`${n} of ${ids.length} bookends have landed`)
        },
        { timeout: 40_000, interval: 250 },
      )
    })
  })

  // --- Alexey's review of the fix, 2026-09-16 ------------------------------

  it('#12 twelve SIMULTANEOUS dispatches reserve at most the cap, and the knob cannot raise it', async () => {
    await scenario('sf-12', async (s) => {
      // #11 fires its twelve in sequence, so it only ever sees one claim at a
      // time: it cannot fail on a check-then-create race, which is what the cap
      // actually is. These twelve wait on a barrier and are released together.
      // BP_SUBAGENT_DEFER_MAX is 999 here, so the ceiling must be the hook's own.
      const f = await deferFixture(s)
      const go = s.workspace.path('go')
      const hook = join(f.repo, 'scripts/log-activity.mts')
      const runs = []
      for (let i = 0; i < 12; i += 1) {
        const driver = await s.fs.write(
          `race-${i}.sh`,
          `while [ ! -e ${JSON.stringify(go)} ]; do sleep 0.02; done\n` +
            `printf '%s' "$1" | node ${JSON.stringify(hook)}\n`,
        )
        runs.push(
          s.run('sh', [driver, start(s, f, `race${i}00000000`)], {
            cwd: f.repo,
            env: {
              ...f.env,
              AGENT_FEED_LOG: f.log,
              BP_SUBAGENT_META_WAIT: '10',
              BP_SUBAGENT_DEFER_MAX: '999',
            },
          }),
        )
      }
      await s.fs.write('go', '')
      for (const r of await Promise.all(runs)) expect(r.code, r.output).toBe(0)

      const alive = await children(s, f.repo)
      expect(
        alive.length,
        `more children than the cap — counting slots and then creating one is a race, not a limit:\n${alive.join('\n')}`,
      ).toBeLessThanOrEqual(8)
      await vi.waitFor(
        async () => {
          const n = await f.count('→ dispatched')
          if (n !== 12) throw new Error(`${n} of 12 bookends have landed`)
        },
        { timeout: 40_000, interval: 250 },
      )
    })
  })

  for (const shell of ['node']) {
    it(`#13 ${shell}: an inherited fd 19 is released AND the bookend still lands`, async () => {
      await scenario(`sf-13-${shell}`, async (s) => {
        // #8 uses fd 9. A multi-digit descriptor is the boundary: `eval "exec
        // 19>&-"` under dash is an attempted exec of a command named 19, which
        // exits 127 and takes the child with it — so the dispatch vanished with
        // the foreground hook still returning 0.
        const f = await deferFixture(s)
        await s.fs.write('lock', '')
        const lock = join(s.workspace.root, 'lock')
        const driver = await s.fs.write(
          `hold-19-${shell}.sh`,
          `exec 19>${JSON.stringify(lock)}\n` +
            `flock -n 19 || exit 3\n` +
            `printf '%s' "$1" | ${shell} ${JSON.stringify(join(f.repo, 'scripts/log-activity.mts'))}\n` +
            `exec 19>&-\n`,
        )

        // The DRIVER runs under bash, deliberately: dash cannot even open fd 19
        // (`exec 19>file` is an attempted exec of `19`), so a dash driver would
        // fail before the hook ran. The SUBJECT shell is the one that varies.
        const r = await s.run('bash', [driver, start(s, f, 'abc123def456')], {
          cwd: f.repo,
          env: { ...f.env, AGENT_FEED_LOG: f.log, BP_SUBAGENT_META_WAIT: '5' },
        })
        expect(r.code, `the fixture never took the lock\n${r.output}`).toBe(0)

        const probe = await s.run('flock', ['-w', '2', lock, 'true'], { cwd: f.repo })
        expect(probe.code, 'fd 19 was still held after the hook returned').toBe(0)
        await f.expectLine('→ dispatched', 15_000)
        // The child is a real process now, not a subshell of the hook, so the
        // bookend can land a moment before it exits. The harness reaps nothing
        // at ppid 1, and a survivor there is a failure in its own right.
        await vi.waitFor(
          async () => {
            const alive = await children(s, f.repo)
            if (alive.length > 0) throw new Error(`still running:\n${alive.join('\n')}`)
          },
          { timeout: 20_000, interval: 250 },
        )
      })
    })
  }

  for (const wait of ['08', '0009', '99999999999999999999999999']) {
    it(`#14 a wait of ${wait} keeps the bookend and leaves no child behind`, async () => {
      await scenario(`sf-14-${wait.length}-${wait[1] ?? 'x'}`, async (s) => {
        // Digit strings pass the old validation unnormalised: `08` is not a
        // decimal 8 to shell arithmetic, it is a bad octal, and a 26-digit value
        // makes the clamp comparison print "integer expected" and skip. Both
        // lose the bookend — the silent-loss class `soon` was meant to close.
        const f = await deferFixture(s)
        const r = await s.run(
          'sh',
          [
            '-c',
            `printf '%s' "$1" | node ${JSON.stringify(join(f.repo, 'scripts/log-activity.mts'))}`,
            'x',
            start(s, f, 'abc123def456'),
          ],
          { cwd: f.repo, env: { ...f.env, AGENT_FEED_LOG: f.log, BP_SUBAGENT_META_WAIT: wait } },
        )
        expect(r.code, `a hook must always exit 0\n${r.output}`).toBe(0)
        await f.expectLine('→ dispatched', 20_000)
        await vi.waitFor(
          async () => {
            const alive = await children(s, f.repo)
            if (alive.length > 0) throw new Error(`still running:\n${alive.join('\n')}`)
          },
          { timeout: 30_000, interval: 250 },
        )
      })
    })
  }

  it('#15 a dispatch past the cap says so, instead of degrading the label in silence', async () => {
    await scenario('sf-15', async (s) => {
      // Alexey's informational 8: over the cap the line is kept but the persona
      // is not, and nothing said so. A lost label with no notice reads exactly
      // like a subagent that has no persona.
      const f = await deferFixture(s)
      const r = await s.run(
        'sh',
        [
          '-c',
          `printf '%s' "$1" | node ${JSON.stringify(join(f.repo, 'scripts/log-activity.mts'))}`,
          'x',
          start(s, f, 'abc123def456'),
        ],
        { cwd: f.repo, env: { ...f.env, AGENT_FEED_LOG: f.log, BP_SUBAGENT_DEFER_MAX: '0' } },
      )
      expect(r.code, r.output).toBe(0)
      await f.expectLine('→ dispatched', 15_000)
      expect(
        r.stderr,
        'the label was degraded with no notice — stderr is where a hook says such things (--debug shows it)',
      ).toMatch(/cap|label/i)
    })
  })

  // --- Codex's review of the fix, 2026-09-16 (S2) ---------------------------

  it('#16 two SIMULTANEOUS callers cannot both reclaim one stale slot', async () => {
    await scenario('sf-16', async (s) => {
      // #12 proves `mkdir` of a fixed name admits one caller. It says nothing
      // about RECLAMATION, which was a separate, non-atomic step: select the
      // stale directories, then remove them. Between those two instants another
      // hook can replace a selected directory with a FRESH reservation, which
      // the first caller then deletes — and reserves the same slot itself. Both
      // return 0 with the identical path, and the cap is undone by the very
      // sweep that exists to keep it honest.
      //
      // The defer dir comes from the PROJECT root (`bp_state_root`), never from
      // AGENT_STATE_HOME — so it is <repo>/subagent-defer.
      const f = await deferFixture(s)
      await s.fs.mkdirp('repo/subagent-defer/slot-0')
      // Aged well past any whole-minute rounding, so the stale sweep selects it.
      // `-t` rather than `-d`: BSD touch has no `-d '-10 minutes'`.
      await s.run('touch', ['-t', '202001010000', join(f.repo, 'subagent-defer', 'slot-0')], {
        cwd: f.repo,
      })

      // THE INTERLEAVING IS INSTRUMENTED, THE HOOK IS NOT. The first removal of a
      // stale slot pauses; every later one runs at once. That makes the race a
      // schedule rather than a coin toss — the same witness by hand is a flake.
      const gate = s.workspace.path('rm-gate')
      const shims = await s.shimDir('repo/shims')
      await shims.add(
        'rm',
        `case "$*" in\n` +
          `  *subagent-defer*)\n` +
          `    if [ ! -e ${JSON.stringify(gate)} ]; then\n` +
          `      : >${JSON.stringify(gate)}\n` +
          `      sleep 3\n` +
          `    fi\n` +
          `    ;;\n` +
          `esac\n` +
          `exec /bin/rm "$@"`,
      )

      const hook = JSON.stringify(join(f.repo, 'scripts/log-activity.mts'))
      const env = {
        ...f.env,
        AGENT_FEED_LOG: f.log,
        BP_SUBAGENT_META_WAIT: '10',
        // ONE slot, so "both reclaimed it" is the only way to get two children.
        BP_SUBAGENT_DEFER_MAX: '1',
        PATH: shims.path(),
      }
      const call = (id: string) =>
        s.run('sh', ['-c', `printf '%s' "$1" | node ${hook}`, 'x', start(s, f, id)], {
          cwd: f.repo,
          env,
        })

      const a = call('aaaa00000000')
      await vi.waitFor(
        async () => {
          if (!(await s.fs.exists('rm-gate'))) {
            throw new Error(
              'caller A never reached a removal of the stale slot. If reclamation no ' +
                'longer runs an external `rm`, this case needs a different pause point — ' +
                'it must not silently stop being a race.',
            )
          }
        },
        { timeout: 15_000, interval: 50 },
      )
      // B runs while A is held inside its reclamation.
      const rb = await call('bbbb00000000')
      expect(rb.code, rb.output).toBe(0)
      const ra = await a
      expect(ra.code, ra.output).toBe(0)

      const alive = await children(s, f.repo)
      expect(alive.length, 'nothing was deferred at all, so this case proves nothing').toBeGreaterThan(0)
      expect(
        alive.length,
        `two callers own one slot — the stale sweep deleted the other's fresh ` +
          `reservation and took the name for itself:\n${alive.join('\n')}`,
      ).toBeLessThanOrEqual(1)

      // The cap degrades the LABEL, never the line: both bookends still land.
      await vi.waitFor(
        async () => {
          const n = await f.count('→ dispatched')
          if (n !== 2) throw new Error(`${n} of 2 bookends have landed`)
        },
        { timeout: 40_000, interval: 250 },
      )
    })
  })

  it('BUG-153 case 1: an unreadable pid file on a LIVE slot must not read as unowned', async () => {
    await scenario('sf-153', async (s) => {
      // #16 proves the two-instant select-then-remove race. BUG-153 is a
      // narrower, deterministic mechanism into the SAME slot: a read failure
      // on `slot-0/pid` other than "no such file" must not read as "no
      // owner".
      //
      // Caller A reserves slot-0 for real, with a real background child that
      // stays alive for the whole test (BP_SUBAGENT_META_WAIT is generous).
      // The port (scripts/log-activity.mts) then reads that pid file
      // in-process with `readFileSync` (BUG-153, TASK-067) — there is no
      // external `cat` to shim any more, so the injection has to land the
      // failure INSIDE that same call. Replacing the pid FILE with a pid
      // DIRECTORY of the same name does exactly that: `readFileSync` on a
      // directory throws EISDIR unconditionally, for every uid (the same
      // root-safe trick as tests/bug-numbers #4), never ENOENT — so this is
      // still "a read failure on a slot that exists", the case #16 does not
      // cover.
      //
      // On the buggy hook (readSlotPid folding every non-ENOENT error into
      // "no owner"), caller B reads through the failure, treats slot-0 as
      // stale, deletes it and reclaims it for its OWN child — leaving two
      // live children sharing a cap of one. Proven RED against a reverted
      // fail-closed branch (see the fix commit's body for how).
      const f = await deferFixture(s)

      const callA = await s.run(
        'sh',
        ['-c', `printf '%s' "$1" | node ${JSON.stringify(join(f.repo, 'scripts/log-activity.mts'))}`, 'x', start(s, f, 'aaaa00000000')],
        {
          cwd: f.repo,
          env: { ...f.env, AGENT_FEED_LOG: f.log, BP_SUBAGENT_META_WAIT: '10', BP_SUBAGENT_DEFER_MAX: '1' },
        },
      )
      expect(callA.code, callA.output).toBe(0)

      // A's reservation is live before B is let anywhere near it.
      let ownerPid = ''
      await vi.waitFor(
        async () => {
          const raw = await s.fs
            .read('repo/subagent-defer/slot-0/pid')
            .catch(() => '')
          const p = raw.trim()
          if (!p) throw new Error('caller A never recorded an owner pid for slot-0')
          ownerPid = p
        },
        { timeout: 10_000, interval: 50 },
      )
      const running = async (pid: string): Promise<boolean> =>
        (
          await s.run('sh', ['-c', 'kill -0 "$1" 2>/dev/null && echo YES || echo NO', 'x', pid], {
            cwd: f.repo,
          })
        ).stdout.includes('YES')
      expect(await running(ownerPid), `A's slot-0 owner ${ownerPid} was never alive`).toBe(true)

      // The injection: swap the real pid FILE for a same-named DIRECTORY, so
      // the very next in-process read of it throws EISDIR — never ENOENT.
      await s.fs.rm('repo/subagent-defer/slot-0/pid')
      await s.fs.mkdirp('repo/subagent-defer/slot-0/pid')

      const callB = await s.run(
        'sh',
        ['-c', `printf '%s' "$1" | node ${JSON.stringify(join(f.repo, 'scripts/log-activity.mts'))}`, 'x', start(s, f, 'bbbb00000000')],
        {
          cwd: f.repo,
          env: { ...f.env, AGENT_FEED_LOG: f.log, BP_SUBAGENT_META_WAIT: '10', BP_SUBAGENT_DEFER_MAX: '1' },
        },
      )
      expect(callB.code, callB.output).toBe(0)

      // The injection actually fired: on the fixed hook, the fail-closed
      // branch never reaches the reclaim step (`rm -rf slot` + recreate), so
      // the directory this case planted is still there afterward. Were it
      // gone, B would have reclaimed the slot without this case ever having
      // exercised the failing read at all.
      expect(
        await s.fs.exists('repo/subagent-defer/slot-0/pid'),
        'the injected pid directory is gone — B reclaimed the slot without the injection firing',
      ).toBe(true)

      // A's owner is STILL alive — a live slot's read failure must never
      // look like "no owner" — so at most one child may be running against a
      // cap of one.
      const alive = await children(s, f.repo)
      expect(alive.length, 'nothing was deferred at all, so this case proves nothing').toBeGreaterThan(0)
      expect(
        alive.length,
        `a read failure on slot-0's LIVE owner pid let caller B reclaim it:\n${alive.join('\n')}`,
      ).toBeLessThanOrEqual(1)
      expect(await running(ownerPid), "A's original owner was killed off by B's reclaim").toBe(true)
    })
  })

  it('BUG-153 case 2: present-but-unparseable pid content must not read as unowned', async () => {
    await scenario('sf-153-2', async (s) => {
      // readSlotPid's error branch (case 1, above) is not the only way
      // "owner unknown" can be missed. A successful read that returns ''
      // (the pid file exists but was observed between its creation and the
      // write of its content) or garbage (not an integer) left `unknown:
      // false` before this fix — only a THROWN read failed closed. The
      // caller then treats present-but-unparseable content exactly like
      // ENOENT: `pid` is falsy or `Number.isInteger(Number(pid))` is false,
      // so the liveness check is skipped, `alive` stays `false`, and the
      // slot is reclaimed even though a real owner may be mid-write.
      //
      // No live child, no injection shim needed: the slot is seeded directly
      // with unparseable content, and the fixed hook must leave it alone.
      const f = await deferFixture(s)
      await s.fs.mkdirp('repo/subagent-defer')
      await s.fs.write('repo/subagent-defer/slot-0/pid', 'not-a-pid')

      const call = await s.run(
        'sh',
        ['-c', `printf '%s' "$1" | node ${JSON.stringify(join(f.repo, 'scripts/log-activity.mts'))}`, 'x', start(s, f, 'cccc00000000')],
        {
          cwd: f.repo,
          env: { ...f.env, AGENT_FEED_LOG: f.log, BP_SUBAGENT_META_WAIT: '10', BP_SUBAGENT_DEFER_MAX: '1' },
        },
      )
      expect(call.code, call.output).toBe(0)

      // Fail closed: the garbage-content slot was never reclaimed, so its
      // content is untouched, and the caller's own dispatch was NOT deferred
      // into it — with the cap already "occupied" by an unknown owner, there
      // is no slot for the caller to take, so it must have emitted
      // synchronously instead of spawning a deferred child.
      expect(await s.fs.read('repo/subagent-defer/slot-0/pid')).toBe('not-a-pid')
      const alive = await children(s, f.repo)
      expect(
        alive.length,
        `a present-but-unparseable pid was read as "no owner" and reclaimed:\n${alive.join('\n')}`,
      ).toBe(0)
      await f.expectLine('→ dispatched', 15_000)
    })
  })

  it('BUG-153 case 3: a failed pid-file write kills its child, so no live owner is orphaned', async () => {
    await scenario('sf-153-3', async (s) => {
      // Cases 1 and 2 close every way a REAL owner's pid can be misread as
      // absent. This one is the write side: `mkdirSync(slot)` claims the
      // slot on disk, a real detached child spawns, and only THEN can the
      // `writeFileSync(slot/pid, …)` that records its owner fail (ENOSPC, an
      // I/O error). The old hook swallowed that failure and kept the slot —
      // no pid file, but a live child still running behind it. The NEXT
      // caller's read is a genuine ENOENT (the file really is absent), which
      // correctly reads as "no owner" and reclaims the slot out from under
      // the live child: BUG-153's exact failure, through the write side
      // instead of the read side.
      //
      // The write is made to fail deterministically, with no shim and no
      // race: `deferDir` (repo/subagent-defer) is pre-created here, with
      // ordinary permissions, before the hook ever runs — so the hook's own
      // `mkdirSync(deferDir, {recursive:true})` is a no-op on it. Caller A
      // then runs under `umask 0222`, which affects only what IT creates
      // fresh: `slot-0`, made for the first time inside deferSpawn's loop,
      // lands at mode 0555 (r-xr-xr-x — searchable and readable, never
      // writable). `mkdirSync(slot)` itself only needs write on the PARENT
      // (deferDir, left normal), so it still succeeds; the write that then
      // fails is `writeFileSync(slot/pid, …)`, which needs write on slot
      // itself. Asymmetric on purpose: a later reader can still `stat`/open
      // slot-0 and get a real ENOENT on the missing pid file (mode 0555
      // keeps read+search open), reproducing the exact ENOENT the bug
      // report names — a symmetric "no permission at all" would instead
      // surface as a read failure, which round 1 already fails closed on
      // and would prove nothing about THIS path.
      const f = await deferFixture(s)
      await s.fs.mkdirp('repo/subagent-defer')
      // Every fresh thing caller A's process creates lands under its
      // restrictive umask — not just slot-0, which is the ONE fresh thing
      // this case means to target. Two others are fresh too if left alone,
      // and both are pre-created here with ordinary permissions to keep the
      // umask scoped to the one write this case is actually about:
      //
      //  - `.lock`, the flock mutex `writeFileSync(lockPath, '', {flag:'a'})`
      //    would otherwise create at mode 0444, so caller B's OWN handshake
      //    would fail for a reason that has nothing to do with BUG-153.
      //  - `logs/agent-activity.log`, the feed file itself: `feed_append`
      //    creates it on first use, and under A's umask that first use also
      //    lands at 0444. `feed_append` is explicitly best-effort (never
      //    fails the hook), so a caller B whose OWN deferred child later
      //    tries to append its OWN bookend to a read-only feed file loses
      //    that line SILENTLY — not a reclaim hazard, but it would sink this
      //    case's own "both bookends land" assertion for a reason that is
      //    a fixture artifact, not the thing under test. (Found by instru-
      //    menting feed_append's call site directly: exactly one append
      //    landed — caller A's — and the feed file's mode read 0444.)
      //
      // `writeFileSync(…, {flag:'a'})` and `feed_append`'s own `>>` both only
      // APPLY a mode on first creation; pre-creating either file here with
      // the harness's own (unaffected-by-any-subshell-umask) fs means A's
      // `umask 0222` never touches them.
      await s.fs.write('repo/subagent-defer/.lock', '')
      await s.fs.write('repo/logs/agent-activity.log', '')

      const hook = JSON.stringify(join(f.repo, 'scripts/log-activity.mts'))
      const callA = await s.run(
        'sh',
        ['-c', `umask 0222; printf '%s' "$1" | node ${hook}`, 'x', start(s, f, 'aaaa00000000')],
        {
          cwd: f.repo,
          env: { ...f.env, AGENT_FEED_LOG: f.log, BP_SUBAGENT_META_WAIT: '10', BP_SUBAGENT_DEFER_MAX: '1' },
        },
      )
      expect(callA.code, `a hook must always exit 0\n${callA.output}`).toBe(0)

      // The injection actually fired, and through the write path specifically
      // — not "deferral never ran" (which would make every check below pass
      // vacuously) and not "no flock(1)" (a different message, #18). With a
      // fresh deferDir and a cap of 1, the ONLY way deferSpawn() can return
      // false here — the precondition for this notice — is the write-failure
      // branch: nothing pre-existing could make `mkdirSync(slot-0)` collide,
      // so a false return has no other cause available to it in this setup.
      expect(
        callA.stderr,
        'no "deferral failed" notice landed — the injected write failure never reached deferSpawn() at all',
      ).toMatch(/no deferred slot free/i)

      // THE FIX'S OWN CLAIM: no live, unrecorded owner is left running. On
      // the buggy hook this would still show a live deferred child (the one
      // `writeFileSync` failed to record) — the exact hazard BUG-153 names.
      await vi.waitFor(
        async () => {
          const alive = await children(s, f.repo)
          if (alive.length > 0) {
            throw new Error(`a child whose pid write failed was left running, unrecorded:\n${alive.join('\n')}`)
          }
        },
        { timeout: 10_000, interval: 100 },
      )

      // The hook still emits synchronously — a hook must never fail the
      // tool call just because its OWN bookkeeping write failed.
      await f.expectLine('→ dispatched', 15_000)

      // A second, ordinary caller is not blocked by the mess A left behind:
      // it gets a fresh slot-0 (the fix released it) and its own child ends
      // up the only one alive — never two, which is what "B reclaimed a
      // live slot" would look like.
      const callB = await s.run(
        'sh',
        ['-c', `printf '%s' "$1" | node ${hook}`, 'x', start(s, f, 'bbbb00000000')],
        {
          cwd: f.repo,
          env: { ...f.env, AGENT_FEED_LOG: f.log, BP_SUBAGENT_META_WAIT: '10', BP_SUBAGENT_DEFER_MAX: '1' },
        },
      )
      expect(callB.code, callB.output).toBe(0)
      await vi.waitFor(
        async () => {
          const alive = await children(s, f.repo)
          if (alive.length !== 1) {
            throw new Error(`expected exactly B's one child, saw ${alive.length}:\n${alive.join('\n')}`)
          }
        },
        { timeout: 10_000, interval: 100 },
      )
      await vi.waitFor(
        async () => {
          const n = await f.count('→ dispatched')
          if (n !== 2) throw new Error(`${n} of 2 bookends have landed`)
        },
        { timeout: 40_000, interval: 250 },
      )
    })
  })

  it('#17 BUG-133: a signalled child dies with its slot, and leaves no sleep behind', async () => {
    await scenario('sf-17', async (s) => {
      // The handler removed the slot on HUP/INT/TERM with no explicit exit, and
      // a shell RESUMES after such a handler — measured: the child kept running
      // its full wait with its slot already gone. So the slot was reusable while
      // its owner was still alive, and cleanup was never a lifetime bound.
      const f = await deferFixture(s)
      const r = await s.run(
        'sh',
        [
          '-c',
          `printf '%s' "$1" | node ${JSON.stringify(join(f.repo, 'scripts/log-activity.mts'))}`,
          'x',
          start(s, f, 'abc123def456'),
        ],
        { cwd: f.repo, env: { ...f.env, AGENT_FEED_LOG: f.log, BP_SUBAGENT_META_WAIT: '15' } },
      )
      expect(r.code, r.output).toBe(0)

      let pid = ''
      await vi.waitFor(
        async () => {
          const deferred = await children(s, f.repo)
          if (deferred.length !== 1) {
            throw new Error(`expected one deferred child, saw ${deferred.length}`)
          }
          pid = deferred[0]!.split(' ')[0]!
        },
        { timeout: 10_000, interval: 100 },
      )

      // THE OWNER IS FOLLOWED BY PID, never through the cwd-filtered listing.
      // The question is whether THIS process is still running, and a helper that
      // answers "not one of mine" for a process it cannot inspect would answer
      // "gone" — which is the assertion this case exists to make. Measured: it
      // does exactly that here, and the first version of this case passed
      // against a child that was demonstrably still alive.
      const running = async (): Promise<boolean> =>
        (
          await s.run('sh', ['-c', 'kill -0 "$1" 2>/dev/null && echo YES || echo NO', 'x', pid], {
            cwd: f.repo,
          })
        ).stdout.includes('YES')

      expect(await running(), `pid ${pid} was already gone before the signal`).toBe(true)

      // THE GROUP, captured before the signal — by this point the deferred
      // child is a double-forked orphan (its `defer_spawn` subshell parent
      // already exited), so its process group has exactly two members: the
      // child itself and its current `sleep 0.1 &`. Measured directly against
      // this fixture: `ps -eo pid,ppid,pgid,args` filtered to this pgid showed
      // only those two lines, never the scenario's own top-level `sh` (already
      // reaped by the time this poll finds the child). Asserting non-empty
      // catches the case where that assumption stops holding on some host.
      const pgidR = await s.run('sh', ['-c', 'ps -o pgid= -p "$1" | tr -d " "', 'x', pid], { cwd: f.repo })
      const pgid = pgidR.stdout.trim()
      expect(pgid, `could not read a process group for pid ${pid}`).not.toBe('')

      await s.run('kill', ['-TERM', pid], { cwd: f.repo })

      // WELL INSIDE THE 15 s WAIT, so "it is gone" means the signal ended it
      // rather than the wait expiring on its own.
      await vi.waitFor(
        async () => {
          if (await running()) {
            throw new Error(`pid ${pid} released its slot and kept running`)
          }
        },
        { timeout: 5_000, interval: 100 },
      )

      // THE TITLE'S OWN CLAIM: "leaves no sleep behind". The check above only
      // proves the CHILD is gone — its background `sleep` is a separate
      // process that the trap signals but does not wait on, so it can still be
      // dying (or, on a stale-pid trap, never signalled at all) after the
      // child's own pid has vanished. Poll the whole group, not the one pid:
      // `kill -0 -- -<pgid>` fails only once every member — child and sleep
      // alike — is gone. Without this, the scenario's own teardown is what
      // ends up sampling the still-dying sleep, under CI-level host load
      // (BUG-133's CI flake).
      await vi.waitFor(
        async () => {
          const groupRunning = (
            await s.run('sh', ['-c', 'kill -0 -- "-$1" 2>/dev/null && echo YES || echo NO', 'x', pgid], {
              cwd: f.repo,
            })
          ).stdout.includes('YES')
          if (groupRunning) {
            throw new Error(
              `process group ${pgid} outlived the signalled child ${pid} — a member ` +
                `(the sleep) is still running after its owner exited`,
            )
          }
        },
        { timeout: 5_000, interval: 100 },
      )
    })
  })

  it('#18 with no flock the bookend still lands, and the feed says why exactly once', async () => {
    await scenario('sf-18', async (s) => {
      // macOS ships no flock(1), and the founder works on a Mac. Deferral is off
      // there, so every subagent bookend falls back to the agent type — which is
      // the symptom BUG-124 was filed for ("I cannot see <persona>'s activity").
      // The cap notice claimed "no deferred slot free (cap 8)", naming a
      // mechanism that was working fine and hiding the one that was missing:
      // the BUG-041/042 misdirection class.
      //
      // So the degradation has to be LEGIBLE where the founder is looking. The
      // feed is that place — hook stderr is discarded outside --debug — and it
      // says so ONCE, because a line per dispatch is noise that gets muted.
      const f = await deferFixture(s)
      const hook = JSON.stringify(join(f.repo, 'scripts/log-activity.mts'))
      // BP_FLOCK_FALLBACKS is the test seam for the Homebrew keg paths the hook
      // probes after PATH: `brew install util-linux` is keg-only, so flock is
      // NOT symlinked onto PATH and the command name alone would miss it on the
      // one platform that needs the probe. Emptied here so hiding flock from
      // PATH hides it completely, on a Mac as well as on Linux.
      const env = {
        ...f.env,
        AGENT_FEED_LOG: f.log,
        PATH: await s.pathWithout(['flock']),
        BP_FLOCK_FALLBACKS: '',
      }
      const call = (id: string) =>
        s.run('sh', ['-c', `printf '%s' "$1" | node ${hook}`, 'x', start(s, f, id)], {
          cwd: f.repo,
          env,
        })

      const r1 = await call('nofl00000000')
      expect(r1.code, `a hook must always exit 0\n${r1.output}`).toBe(0)
      await f.expectLine('→ dispatched', 15_000)
      expect(
        r1.stderr,
        'the notice blamed the cap for a missing tool — it must name flock, and say how to get it',
      ).toMatch(/flock/i)

      const r2 = await call('nofl11111111')
      expect(r2.code, r2.output).toBe(0)
      await vi.waitFor(
        async () => {
          if ((await f.count('→ dispatched')) !== 2) throw new Error('both bookends have not landed')
        },
        { timeout: 15_000, interval: 250 },
      )
      expect(
        await f.count('flock'),
        'the feed must explain the type-labelled bookends exactly once — never per dispatch, and never not at all',
      ).toBe(1)
    })
  })

  it('#19 BUG-131: a dispatch leaves the tree clean — the slot dir is ignored by the SHIPPED .gitignore', async () => {
    await scenario('sf-19', async (s) => {
      // The slot directory sits at `<repo>/subagent-defer` BY DESIGN (#16): it
      // comes from `bp_state_root`, the project root, never from
      // AGENT_STATE_HOME. BUG-131 is not that path — it is that NOTHING IGNORED
      // it, so every project that dispatched a subagent carried a permanently
      // untracked directory. That erodes the clean-tree precondition the
      // pre-push gate and `blueprint drift` both lean on, and a `git status`
      // that is always dirty is one nobody reads.
      //
      // THE WITNESS RUNS AGAINST THE SHIPPED FILE, copied into a real
      // repository, rather than against a rule retyped here: `.gitignore` is
      // seeded into every derived project at bootstrap, so the file under test
      // must be the one those projects actually receive. A `git check-ignore`
      // against a hand-written fixture would pass over a rule that never ships.
      const f = await deferFixture(s)
      await s.fs.copyIn(join(SUBJECT, '.gitignore'), 'repo/.gitignore')

      const git = (args: string[]) => s.run('git', args, { cwd: f.repo })
      expect((await git(['init', '-q', '--initial-branch=main', '.'])).code).toBe(0)
      expect((await git(['add', '-A'])).code).toBe(0)
      const commit = await git([
        '-c',
        'user.name=Fixture Operator',
        '-c',
        'user.email=fixture@example.test',
        'commit',
        '-qm',
        'fixture project',
      ])
      expect(commit.code, commit.output).toBe(0)

      const porcelain = async (): Promise<string> =>
        (await git(['status', '--porcelain', '--untracked-files=all'])).stdout.trim()

      // ORDER MATTERS. A tree already dirty before the dispatch would make a
      // dirty tree afterwards prove nothing about the slot directory.
      expect(
        await porcelain(),
        'the fixture was dirty BEFORE any dispatch, so the assertion below would be measuring the fixture',
      ).toBe('')

      const r = await s.run(
        'sh',
        [
          '-c',
          `printf '%s' "$1" | node ${JSON.stringify(join(f.repo, 'scripts/log-activity.mts'))}`,
          'x',
          start(s, f, 'clean0000000'),
        ],
        { cwd: f.repo, env: { ...f.env, AGENT_FEED_LOG: f.log, BP_SUBAGENT_META_WAIT: '5' } },
      )
      expect(r.code, `a hook must always exit 0\n${r.output}`).toBe(0)
      await f.expectLine('→ dispatched', 15_000)

      // VACUITY GUARD, and it is conditional for a reason rather than skipped.
      // `defer_spawn` probes `bp_flock_cmd` BEFORE it creates the directory, so
      // a host without flock(1) — macOS, which is #18's whole subject — defers
      // nothing and creates nothing. On such a host this case would pass while
      // demonstrating nothing about the ignore rule, so the guard asserts the
      // reservation happened exactly where it CAN happen, and the clean-tree
      // assertion below runs on every host either way.
      const hasFlock = (await s.run('sh', ['-c', 'command -v flock || true'], { cwd: f.repo })).stdout.trim()
      if (hasFlock !== '') {
        expect(
          await s.fs.exists('repo/subagent-defer'),
          'nothing was reserved on a host that HAS flock — the case would prove nothing about ignoring the slot dir',
        ).toBe(true)
      }

      expect(
        await porcelain(),
        'the deferral slot directory dirties the tree of every project that dispatches a subagent (BUG-131)',
      ).toBe('')
    })
  })
})
