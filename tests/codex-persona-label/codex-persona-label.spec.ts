/**
 * tests/codex-persona-label/codex-persona-label.spec.ts — BUG-021.
 *
 * Codex output reaches the feed as a bare `[CODEX]`, never `[Persona - Codex]`.
 * Measured 2026-08-05: 11 bare vs 2 labelled here, 103 vs 5 in one derived
 * project, and 0 vs 237 in the project that fixed it.
 *
 * THE ROOT CAUSE IS STRUCTURAL, which is why the obvious patch is wrong.
 * `scripts/agent-activity.sh` pumps `codex-runs.log` under a label bound ONCE at
 * daemon start, while the persona is a PER-DISPATCH fact. No string chosen
 * inside the feed can be right, because the feed does not know — and cannot know
 * — who holds the mic for a given line. Only the launcher does, at the moment it
 * dispatches.
 *
 * So the label has to be built where the knowledge is, from the SAME roster
 * lookup the feed uses. `persona_label` lived inside `agent-activity.sh` as a
 * local function, so the launcher could not reuse it and would have had to copy
 * it — two copies of a rule are two rules. This suite pins the shared function
 * AND the two callers.
 *
 * WHY SO MANY CHECKS ARE SOURCE CHECKS, AND WHAT THAT COSTS. #3, #4, #4b and #5
 * assert what the launcher and the feed SAY, not what they do. That is a real
 * limit and it is deliberate: the behavioural half of #3/#4 needs a live Codex
 * dispatch, which needs a Codex. What stands in its place is
 * `tests/subagent-feed`, which drives a real supervisor over a real transcript
 * and asserts the rendered label end to end. So the mechanism is proven
 * behaviourally there and pinned structurally here.
 *
 * EQUIVALENCE RECORD (R6, and this migration's own evidence).
 *
 * "Ported" is a claim, so it was measured rather than reviewed. Eleven trees —
 * one per check carrying exactly the defect that check exists to catch, plus the
 * healthy control — were built once and BOTH implementations were run over each:
 * the retiring `tests/codex-persona-label/test.sh`, copied into the tree, and
 * this spec with `BP_SPEC_ROOT` pointed at it. The per-id verdict sets were
 * compared mechanically. They agreed on all eleven inputs.
 *
 * The negative controls matter as much as the mutants and are listed with them:
 * a defect that is COMMENTED OUT must not be caught (both implementations strip
 * or tolerate comments), and a benign lookalike — `gemini-runs.log` pumped under
 * a static label — must not trip #4, which is about `codex-runs.log` alone.
 *
 * MUTATION RECIPE (R6) — each observed red, not predicted. See
 *
 * `#3`'S OWN NEGATIVE PROOF, added 2026-09-11 after a cross-provider review named
 * it as an assertion with no mutant that reds it. The recorded population was
 * assertion-GROUP coverage; this is assertion coverage.
 *
 * Mutant `C1`: every occurrence of `bp_roster_label` in the launcher renamed to
 * `bp_private_label` — the launcher rolling its own label instead of sharing the
 * feed's, which is the defect this check exists for. OBSERVED, both
 * implementations, and exactly one case each:
 *
 *     shell   FAIL: #3 the launcher does not label its output …
 *     port    × #3 the launcher builds its label from the shared roster lookup
 *
 * Everything else stayed green, `#3 it labels with the holder of the mic AT
 * DISPATCH TIME` included — so the mutant isolates the assertion rather than the
 * group. Harness: `.scratch/markus-feed-r6.sh`.
 *
 * THE FIRST RUN OF IT IS THE USEFUL HALF, and it is a defect in the APPARATUS
 * rather than in either implementation (BUG-096). The mutant landed, the file
 * changed, and the harness's CHANGED-NOTHING guard — asked of the mutant tree's
 * own git, which is the correct thing to ask — answered "changed nothing" and
 * refused the verdict. `scripts/start-codex-signal-watch.mts`, this suite's entire
 * subject, is one of sixteen files the real repo TRACKS while `.gitignore` also
 * names them: tracked beats ignored in the real repo and NOT in the fresh `git
 * init` every harness builds its tree with. `git add -A -f` is the fix, and the
 * guard failing LOUDLY rather than reporting a fabricated finding is the only
 * reason this was cheap.
 *
 * None of this closes BUG-092 part 1: `#3` is a source check, and a launcher
 * that calls `bp_roster_label` with a path holding no roster still passes it.
 * What is now proven is that the check can fail at all.
 *
 * See
 * `.scratch/equiv-codex-persona-label.sh` for the population as run.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { extractWakeCommand, unescapeTsShellText } from '../helpers/wake-command.js'

/**
 * The tree under test.
 *
 * REPO_ROOT for an ordinary run. `BP_SPEC_ROOT` repoints it at a perturbed copy,
 * which is how the equivalence driver runs THIS spec and the retiring shell
 * suite over the same bytes. It selects the SUBJECT, never the sandbox: HOME,
 * TMPDIR and every AGENT_* variable still come from `scenario()`, so there is no
 * path here that escapes R3.
 */
const SUBJECT = process.env.BP_SPEC_ROOT ?? REPO_ROOT

// TASK-083 — a migrated launcher is a two-line shim; read its `.mts` TARGET
//, same as tests/state-dir.
const LAUNCHER = join(SUBJECT, 'scripts/start-codex-signal-watch.mts')
const GEMINI_LAUNCHER = join(SUBJECT, 'scripts/start-gemini-signal-watch.mts')
const FEED = join(SUBJECT, 'scripts', 'agent-activity.sh')
const ROSTER_LIB = join(SUBJECT, 'scripts', 'lib', 'roster.sh')

/**
 * Read a script for a source check, with comments stripped.
 *
 * Stripping is not cosmetic. Both of these files NAME the anti-patterns they
 * forbid, in prose, so a check that cannot tell an explanation from a call would
 * force the explanation to be deleted to stay green — removing the one place a
 * future reader learns why. The shell suite greps the raw file and gets away
 * with it only because its patterns happen not to collide; matching its
 * behaviour exactly would import that luck, so this is deliberately STRICTER and
 * the equivalence record says so.
 */
async function code(path: string): Promise<string> {
  const raw = await readFile(path, 'utf8').catch(() => '')
  const stripped = raw.replace(/^[ \t]*#.*$/gm, '')
  return path.endsWith('.mts') ? unescapeTsShellText(stripped) : stripped
}

/**
 * Call a roster-lib function in the tree under test.
 *
 * BASH, NOT `sh`. `bp_roster_backing_for_name` warns on a miss and its key uses
 * `${want// /_}`, which dash rejects as a Bad substitution — so the unrostered
 * case below would run with a shell error on stderr and only happen to produce
 * the right stdout. The lib declares bash; the one caller that runs under `sh`
 * (`scripts/log-activity.sh`) already routes the lookup through `bash -c`.
 */
async function roster(s: Scenario, snippet: string): Promise<string> {
  const r = await s.run('bash', ['-c', `. "${ROSTER_LIB}"; ${snippet}`], {
    cwd: s.workspace.root,
  })
  return r.stdout
}

/**
 * The fixture roster.
 *
 * The `## Members` heading matters: `bp_roster_rows` reads ONLY that table, so
 * an unrelated table elsewhere cannot shadow a real member. A fixture with any
 * other heading resolves nothing — which is what this suite's first draft did,
 * and it looked exactly like the bug it was written to catch.
 *
 * The names are invented rather than taken from anyone's live fleet: a persona
 * literal from a real roster in a test is the BUG-010 contamination class in
 * fixture form.
 */
const FIXTURE_ROSTER = `# Roster

## Members

| Role | Name | Backing agent |
|---|---|---|
| Orchestrator | Jesko | Claude Code |
| QA-2 | Slava | Codex |
`

describe('BUG-021 — Codex output carries the persona that produced it', () => {
  it('#1 bp_roster_label is exposed by the roster lib', async () => {
    await scenario('codex-label-1', async (s) => {
      // `command -v` inside the same shell that sourced the lib. Asserting the
      // FUNCTION rather than a grep for its name: a comment mentioning it, or a
      // definition guarded behind a branch that never runs, both grep clean.
      const r = await s.run(
        'bash',
        ['-c', `. "${ROSTER_LIB}" && command -v bp_roster_label >/dev/null 2>&1`],
        { cwd: s.workspace.root },
      )
      expect(
        r.code,
        'no shared label function — the launcher must copy the feed’s version',
      ).toBe(0)
    })
  })

  it("#2 a Codex persona resolves to 'Slava - Codex'", async () => {
    await scenario('codex-label-2a', async (s) => {
      const dir = await s.fs.mkdirp('proj')
      await s.fs.write('proj/AGENT_ROSTER.md', FIXTURE_ROSTER)

      expect(await roster(s, `bp_roster_label "${dir}" "Slava"`)).toBe('Slava - Codex')
    })
  })

  it('#2 an unrostered name degrades to the bare name', async () => {
    await scenario('codex-label-2b', async (s) => {
      const dir = await s.fs.mkdirp('proj')
      await s.fs.write('proj/AGENT_ROSTER.md', FIXTURE_ROSTER)

      // A feed line with no label at all is worse than an unqualified one, so a
      // miss must still produce the NAME — never a blank and never an error.
      expect(await roster(s, `bp_roster_label "${dir}" "Nobody"`)).toBe('Nobody')
    })
  })

  it('#3 the launcher builds its label from the shared roster lookup', async () => {
    expect(
      await code(LAUNCHER),
      'the launcher does not label its output — the feed cannot do it for it',
    ).toMatch(/bp_roster_label/)
  })

  it('#3 it labels with the holder of the mic AT DISPATCH TIME', async () => {
    expect(
      await code(LAUNCHER),
      'the launcher never reads AGENT_SIGNAL_HOLDER — the label cannot be per-dispatch',
    ).toMatch(/AGENT_SIGNAL_HOLDER/)
  })

  it('#4 the feed no longer stamps a static [CODEX] label', async () => {
    // THE ASSERTION THAT MAKES THE FIX A FIX RATHER THAN AN ADDITION. Leaving
    // the pump in place would double every line, one labelled and one not, which
    // reads as a bug in the new code rather than the old.
    expect(
      await code(FEED),
      'the feed still pumps codex-runs.log under a static [CODEX] label',
    ).not.toMatch(/pump .*codex-runs\.log.*"CODEX"/)
  })

  it('#4 the feed uses the same shared label function', async () => {
    // The feed's own mic-flip line must keep using the shared function, or the
    // two label formats drift apart while both look correct in isolation.
    expect(
      await code(FEED),
      'the feed kept a private label builder — the two formats will drift',
    ).toMatch(/bp_roster_label/)
  })

  it('#4b the roster lib is sourced only if readable', async () => {
    // THE LABEL FAILS OPEN, and that asymmetry is the point. Unlike
    // .githooks/commit-msg, which must refuse when it cannot load its rule, a
    // missing lib here may cost the LABEL and must never cost the DISPATCH.
    // Sourcing it unguarded aborted the whole wake command in any tree without
    // it — tests/state-dir caught that as a dispatch which simply never
    // happened, far worse than a bare label.
    expect(
      await code(LAUNCHER),
      'the launcher sources roster.sh unguarded — a tree without it loses the dispatch',
    ).toMatch(/\[ -r "\$ROOT\/scripts\/lib\/roster\.sh" \]/)
  })

  it('#4b feed_append degrades to a no-op rather than an unbound command', async () => {
    expect(
      await code(LAUNCHER),
      'no fallback for feed_append — the dispatch dies where feed.sh is absent',
    ).toMatch(/feed_append\(\)\{ :; \}/)
  })

  it('#6 the hand-back preamble no longer hardcodes Holder=Claude Code (TASK-061)', async () => {
    expect(
      await code(LAUNCHER),
      'the launcher still tells Codex to hand back to a literal "Claude Code" holder',
    ).not.toMatch(/--holder set to Claude Code/)
  })

  it('#6 the hand-back preamble resolves the Orchestrator from the roster (TASK-061)', async () => {
    expect(
      await code(LAUNCHER),
      'the launcher does not resolve Holder from the roster’s Orchestrator row',
    ).toMatch(/bp_roster_name_for_role\s+"\$BP_STATE_ROOT"\s+Orchestrator/)
  })

  it('#6 the resolved Holder names the fixture roster’s Orchestrator', async () => {
    // Behavioural, not just a source check: run the launcher's own resolution
    // block (extracted verbatim, bounded by its own start/end markers so a
    // future edit that widens or narrows it is caught rather than silently
    // testing stale lines) against the fixture roster, and assert it lands on
    // Jesko — the fixture's Orchestrator — never a hardcoded name.
    await scenario('codex-label-6a', async (s) => {
      const dir = await s.fs.mkdirp('proj')
      await s.fs.write('proj/AGENT_ROSTER.md', FIXTURE_ROSTER)

      const src = await readFile(LAUNCHER, 'utf8')
      const block = src.match(
        /ORCHESTRATOR_NAME=""[\s\S]*?\nfi\nif \[ -z "\$ORCHESTRATOR_NAME" \][\s\S]*?\nfi\n/,
      )
      expect(block, 'could not locate the Orchestrator-resolution block to extract').not.toBeNull()

      // Written to a script file rather than a `bash -c` string: the extracted
      // block's own printf carries an apostrophe, and a giant interpolated
      // one-liner is the wrong place to reason about shell quoting.
      const runner = await s.fs.write(
        'run.sh',
        `. "${ROSTER_LIB}"\nBP_STATE_ROOT="${dir}"\nRUN_LOG=/dev/null\n${block![0]}\nprintf '%s' "$ORCHESTRATOR_NAME"\n`,
      )
      const r = await s.run('bash', [runner], { cwd: s.workspace.root })
      expect(r.stdout).toBe('Jesko')
    })
  })

  it('#6 a roster with no Orchestrator row falls back visibly, not to a hardcoded name', async () => {
    await scenario('codex-label-6b', async (s) => {
      const dir = await s.fs.mkdirp('proj')
      await s.fs.write(
        'proj/AGENT_ROSTER.md',
        '# Roster\n\n## Members\n\n| Role | Name | Backing agent |\n|---|---|---|\n| QA-2 | Slava | Codex |\n',
      )

      const src = await readFile(LAUNCHER, 'utf8')
      const block = src.match(
        /ORCHESTRATOR_NAME=""[\s\S]*?\nfi\nif \[ -z "\$ORCHESTRATOR_NAME" \][\s\S]*?\nfi\n/,
      )
      expect(block).not.toBeNull()

      const runLog = join(s.workspace.root, 'run.log')
      const runner = await s.fs.write(
        'run.sh',
        `. "${ROSTER_LIB}"\nBP_STATE_ROOT="${dir}"\nRUN_LOG="${runLog}"\n${block![0]}\nprintf '%s' "$ORCHESTRATOR_NAME"\n`,
      )
      const r = await s.run('bash', [runner], { cwd: s.workspace.root })
      expect(r.stdout, 'an unresolved Orchestrator must not silently pick a real persona name').toBe(
        'Orchestrator',
      )
      const log = await readFile(runLog, 'utf8').catch(() => '')
      expect(log, 'the fallback must be logged, not silent').toMatch(/no Orchestrator row resolved/)
    })
  })

  // The dispatch protocol moved from AGENTS.md to AGENT_SIGNAL.md with TASK-084.
  it('AGENT_SIGNAL.md no longer documents a hardcoded Claude Code hand-back (TASK-061)', async () => {
    const agentsMd = await code(join(SUBJECT, 'AGENT_SIGNAL.md'))
    expect(agentsMd, 'AGENT_SIGNAL.md still says the hand-back Holder is literally "Claude Code"').not.toMatch(
      /Holder=Claude Code \/ State=OVER_TO_CLAUDE/,
    )
    expect(agentsMd, 'AGENT_SIGNAL.md does not explain the Holder is the Orchestrator’s roster name').toMatch(
      /Orchestrator.{0,40}roster name/,
    )
  })

  it('BUG-141 #5 a Gemini dispatch writes persona-labelled feed lines, never [GEMINI]', async () => {
    // The prior test held the retired pump in place. This runs the launcher's own
    // dispatch body with a CLI stub: a real Gemini output line must arrive in the
    // feed under the holder's roster label, and a static [GEMINI] line is forbidden.
    await scenario('gemini-label-5', async (s) => {
      const state = await s.fs.mkdirp('gemini-state')
      const feed = join(s.workspace.root, 'gemini-feed.log')
      await s.fs.write('gemini-state/AGENT_ROSTER.md', FIXTURE_ROSTER)
      const gemini = await s.fs.write('fake-gemini.sh', '#!/bin/sh\nprintf "gemini says hello\\n"\n', { mode: 0o755 })
      const source = await readFile(GEMINI_LAUNCHER, 'utf8')
      const wake = extractWakeCommand(source)
      expect(wake, 'could not extract Gemini dispatch body from its launcher').toBeDefined()
      // TASK-083 — the real launcher generates this before building the wake
      // body (writeFileSync in the .mts), so an extracted-and-replayed wake
      // body needs it supplied the same way: `set -u` at the top of the body
      // makes an unset $GEMINI_POLICY_FILE an unbound-variable error, not an
      // empty --policy argument.
      const policy = await s.fs.write('gemini-policy-fixture.toml', '')

      const r = await s.run('bash', ['-c', 'export AGENT_SIGNAL_HOLDER=Slava AGENT_SIGNAL_TASK="label this Gemini dispatch" AGENT_FEED_LOG="$2"; exec bash -c "$1"', 'x', wake!, feed], {
        cwd: s.workspace.root,
        env: {
          ROOT: SUBJECT,
          GEMINI_BIN: gemini,
          AGENT_STATE_HOME: state,
          GEMINI_POLICY_FILE: policy,
        },
      })
      expect(r.code, `Gemini dispatch body failed: ${r.output}`).toBe(0)
      const lines = await readFile(feed, 'utf8')
      expect(lines, 'Gemini output was dropped instead of entering the feed').toMatch(/\[Slava(?: - [^\]]+)?\] gemini says hello/)
      expect(lines, 'Gemini output kept the retired static label').not.toContain('[GEMINI]')
    })
  })
})
