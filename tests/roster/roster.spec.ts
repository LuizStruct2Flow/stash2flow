/**
 * tests/roster/roster.spec.ts — BUG-010.
 *
 * Renaming a persona in `AGENT_ROSTER.md` changes nothing. The defect had two
 * independent halves, and either alone reproduces the symptom.
 *
 *   HALF 1 — NOTHING READ THE ROSTER to decide who this session IS.
 *   `scripts/agent-activity.sh` was `persona="${AGENT_PERSONA:-<a name>}"`: a
 *   hardcoded literal, so renaming the Orchestrator row was invisible and the only
 *   working override was exporting AGENT_PERSONA by hand. `scripts/team-kickoff.sh`
 *   carried all fifteen personas as a literal array — the one script whose
 *   documented job is "confirm the roster after editing it" could not see the
 *   roster at all, and wrote the SHIPPED EXAMPLE's names into the live baton. Both
 *   scripts are in MANAGED_FILES, so the literal shipped to every derived project.
 *
 *   HALF 2 — THE ONE ROSTER READ THAT DID EXIST WAS WHITESPACE-BRITTLE.
 *   `persona_label()` grepped `"| $name |"` with single spaces, so a column-padded
 *   table never matched. Padding is what every markdown formatter produces, so a
 *   cosmetic reformat silently disabled roster lookup — and a lookup miss was
 *   indistinguishable from "no roster at all", so it disabled it QUIETLY.
 *
 * The fixture below carries both halves at once: a roster RENAMED away from every
 * shipped example name and COLUMN-PADDED. A reader that hardcodes a name fails on
 * the first; a reader that greps single-spaced pipes fails on the second.
 *
 * EQUIVALENCE RECORD (R6, and this migration's own evidence).
 *
 * Sixteen trees — one per check carrying exactly the defect it exists to catch,
 * plus the healthy control and two negative controls — were built once and BOTH
 * implementations run over each: the retiring `tests/roster/test.sh`, copied into
 * the tree, and this spec with `BP_SPEC_ROOT` pointed at it. The per-id verdict
 * sets were compared mechanically; the TASK-018 report lists every divergence.
 *
 * TWO DELIBERATE TIGHTENINGS, both recorded because a silent tightening is still
 * a change:
 *
 *   - `#8`'s forbidden-name list is DERIVED FROM `AGENT_ROSTER.example.md` rather
 *     than hardcoded. The shell version named five of the fifteen example
 *     personas, so a literal of any of the other ten shipped unchecked — and the
 *     list had to be edited by hand whenever the example changed, which is the
 *     second-copy-that-drifts shape this suite is about.
 *   - `#12` no longer skips under `--fast`. There is no `--fast` any more: R7
 *     makes a skipped test fail the build, and the reason the skip existed (a 30 s
 *     pre-push ceiling) was retired with BUG-005. The case costs ~1 s here.
 *
 * TIMING (R4). `#12` renames a roster cell under a LIVE supervisor. It waits for
 * the feed to say so, never for a duration — and it reaches the feed through the
 * BUG-038 handshake first, because a supervisor that is resident is not yet a
 * supervisor that is reading.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { feedFixture } from '../helpers/feed-fixture.js'

/**
 * The tree under test. `BP_SPEC_ROOT` repoints it at a perturbed copy, which is
 * how the equivalence driver runs this spec and the retiring shell suite over the
 * same bytes. It selects the SUBJECT, never the sandbox.
 */
const SUBJECT = process.env.BP_SPEC_ROOT ?? REPO_ROOT

const LIB = join(SUBJECT, 'scripts', 'lib', 'roster.sh')
const MANAGED = ['scripts/agent-activity.sh', 'scripts/team-kickoff.sh'] as const

/**
 * A roster that is RENAMED away from every shipped example name and COLUMN-PADDED.
 *
 * The trailing table is not decoration: a roster carries other tables, and parsing
 * every pipe-row would let an unrelated one shadow a real member — a silently
 * wrong answer, which is the failure mode this bug is made of.
 */
const ROSTER = `# Agent Roster

## Members

| Role             | Name      | Backing agent |
|---|---|---|
| Orchestrator     | Alisa     | Claude Code   |
| PO               | Bo        | Codex         |
| QA-1             | Cheng     | Gemini        |

## How identity works on the signal

| Not | A | Member |
|---|---|---|
| this table must not be parsed as roster rows | x | y |
`

/** A script's source with comments stripped — an incident narrative may quote a literal. */
async function code(path: string): Promise<string> {
  const raw = await readFile(path, 'utf8').catch(() => '')
  return raw.replace(/^[ \t]*#.*$/gm, '').replace(/[ \t]#.*$/gm, '')
}

/**
 * Call a roster-lib function against a fixture roster. Returns stdout and stderr.
 *
 * BASH, NOT `sh`, AND THAT IS LOAD-BEARING. `bp_roster_warn`'s key uses
 * `${want// /_}`, which dash rejects as a Bad substitution — so under `sh` a
 * roster MISS puts a shell error on stderr instead of the `[roster] …` warning,
 * and `#5` ("a miss warns") then passes on stderr that is non-empty for entirely
 * the wrong reason. The first draft of this file used `sh` and `#5` passed
 * against a mutant that silenced the warning completely.
 *
 * That is not a defect in the lib: it declares bash, and `scripts/log-activity.sh`
 * — the one caller that runs under `sh` — already invokes the lookup through
 * `bash -c` and says why. It IS a porting hazard worth naming, because the failure
 * looked like a pass.
 */
async function lib(
  s: Scenario,
  snippet: string,
): Promise<{ out: string; err: string }> {
  const dir = await s.fs.mkdirp('proj')
  await s.fs.write('proj/AGENT_ROSTER.md', ROSTER)
  const r = await s.run('bash', ['-c', `. "${LIB}"; ${snippet.replace(/@/g, dir)}`], {
    cwd: s.workspace.root,
  })
  return { out: r.stdout.trim(), err: r.stderr.trim() }
}

/** Every persona name the SHIPPED example roster defines. */
async function exampleNames(): Promise<string[]> {
  const raw = await readFile(join(SUBJECT, 'AGENT_ROSTER.example.md'), 'utf8')
  const names: string[] = []
  let inMembers = false
  for (const line of raw.split('\n')) {
    if (/^\s*#+\s/.test(line)) {
      inMembers = /^\s*#+\s*Members/.test(line)
      continue
    }
    if (!inMembers || !line.trimStart().startsWith('|')) continue
    const cells = line.split('|').map((c) => c.trim())
    const role = cells[1] ?? ''
    const name = cells[2] ?? ''
    if (role === '' || name === '' || role.toLowerCase() === 'role') continue
    if (/^[-:\s]+$/.test(role)) continue
    names.push(name)
  }
  return names
}

describe('BUG-010 — the roster is the single source of persona identity', () => {
  it('#1 scripts/lib/roster.sh exists', async () => {
    // Without it every reader keeps its own copy of the rule, which is exactly how
    // the two halves above drifted apart.
    expect(
      await code(LIB),
      'there is no shared roster parser — every reader grows its own',
    ).not.toBe('')
  })

  it("#2 role Orchestrator resolves to the roster's name on a padded table", async () => {
    await scenario('roster-2a', async (s) => {
      // THE WHOLE BUG IN ONE ASSERTION: the roster says the Orchestrator is Alisa,
      // so every reader must say Alisa.
      const { out } = await lib(s, 'bp_roster_name_for_role "@" Orchestrator')
      expect(out, 'padding, or a hardcoded name').toBe('Alisa')
    })
  })

  it('#2 a non-Orchestrator role resolves too', async () => {
    await scenario('roster-2b', async (s) => {
      const { out } = await lib(s, 'bp_roster_name_for_role "@" QA-1')
      expect(out).toBe('Cheng')
    })
  })

  it('#3 name -> backing agent resolves on a padded table, free text preserved', async () => {
    await scenario('roster-3', async (s) => {
      // The backing column is free text by design (Claude Code, Codex, Gemini,
      // Copilot, Qwen, …), so 'Gemini' must survive verbatim rather than being
      // normalised into a known set.
      const { out } = await lib(s, 'bp_roster_backing_for_name "@" Cheng')
      expect(out).toBe('Gemini')
    })
  })

  it('#4 exactly the 3 member rows are parsed; other tables are ignored', async () => {
    await scenario('roster-4', async (s) => {
      const { out } = await lib(s, 'bp_roster_rows "@"')
      expect(out.split('\n').filter((l) => l !== ''), 'a non-member table leaked in').toHaveLength(3)
    })
  })

  it('#5 a roster miss writes a warning to stderr', async () => {
    await scenario('roster-5', async (s) => {
      // THIS IS WHAT MADE HALF 2 SURVIVE: a failed lookup and "no roster" produced
      // the same output, so nothing ever looked wrong.
      const { err } = await lib(s, 'bp_roster_name_for_role "@" Nonexistent-Role')
      expect(err, 'a roster miss produced NO warning — indistinguishable from success').not.toBe('')
    })
  })

  it("#6 the feed reports the ROSTER's Orchestrator, with its backing agent", async () => {
    await scenario('roster-6', async (s) => {
      // #2 and #3 could pass while the feed still ignored the parser, which is
      // precisely the state the parent commit is in. This runs the real script, in
      // a project whose roster names nobody from the example.
      const f = await feedFixture(s, 'p2', { source: SUBJECT, roster: ROSTER })
      const r = await f.cli(['--whoami'])

      expect(
        r.stdout.trim(),
        r.stdout.includes('Sylvia')
          ? 'the feed still reports the hardcoded example name — BUG-010 verbatim'
          : 'the feed has no --whoami, or resolved the wrong identity',
      ).toBe('Alisa - Claude Code')
    })
  })

  it("#7 AGENT_PERSONA overrides the roster's Orchestrator, backing still resolved", async () => {
    await scenario('roster-7', async (s) => {
      // The demotion is from DEFAULT to OVERRIDE — a spawned persona must still be
      // able to declare itself without editing the founder's gitignored roster.
      const f = await feedFixture(s, 'p2', { source: SUBJECT, roster: ROSTER })
      const r = await s.run('bash', ['scripts/agent-activity.sh', '--whoami'], {
        cwd: f.repo,
        env: { ...f.env, AGENT_PERSONA: 'Cheng' },
      })

      expect(r.stdout.trim()).toBe('Cheng - Gemini')
    })
  })

  it('#8 no managed script hardcodes a persona name in executable code', async () => {
    // Both scripts ship to every derived project, so a name baked into them is
    // BUG-002's contamination in persona form. The example roster is the ONLY place
    // a default name may appear.
    //
    // THE LIST IS DERIVED FROM THE EXAMPLE ROSTER, not hardcoded. The shell version
    // named five of fifteen, so a literal of any of the other ten shipped
    // unchecked — and the list needed hand-editing whenever the example changed,
    // which is the second-copy-that-drifts shape this whole suite is about.
    const names = await exampleNames()
    expect(names.length, 'derived no names from the example roster — this would pass vacuously')
      .toBeGreaterThan(5)

    for (const rel of MANAGED) {
      const body = await code(join(SUBJECT, rel))
      // Non-vacuity: prove the file was actually read before trusting its silence.
      expect(body, `${rel} is empty or missing — the assertion would be vacuous`).not.toBe('')
      const hits = names.filter((n) => new RegExp(`\\b${n}\\b`).test(body))
      expect(hits, `${rel} hardcodes a persona name in executable code`).toEqual([])
    }
  })

  it('#9 kickoff presents exactly the roster’s members, keyed by role', async () => {
    await scenario('roster-9', async (s) => {
      // The behavioural assertion: with a 3-member roster it must present exactly
      // those 3 people, not the shipped 15. `--dry-run` keeps it cheap; the real
      // ceremony sleeps per persona.
      const f = await feedFixture(s, 'p3', {
        source: SUBJECT,
        roster: ROSTER,
        extraScripts: ['team-kickoff.sh'],
      })
      const r = await s.run('bash', ['scripts/team-kickoff.sh', '--dry-run'], {
        cwd: f.repo,
        env: f.env,
      })

      expect(
        r.stdout,
        'team-kickoff has no --dry-run: the ceremony cannot be tested without sleeping through it',
      ).not.toBe('')
      for (const who of ['Alisa', 'Bo', 'Cheng']) {
        expect(r.stdout, `kickoff never presents roster member '${who}'`).toContain(who)
      }
      for (const ghost of await exampleNames()) {
        expect(
          r.stdout,
          `kickoff presents '${ghost}', who is NOT on this roster — it is still reading its literal array`,
        ).not.toContain(ghost)
      }
    })
  })

  it('#10 every reader sources the shared roster parser', async () => {
    // Two readers that agree only by coincidence is how HALF 1 and HALF 2 came to
    // disagree in the first place.
    for (const rel of MANAGED) {
      expect(
        await code(join(SUBJECT, rel)),
        `${rel} does not source scripts/lib/roster.sh — it has its own copy of the rule`,
      ).toMatch(/lib\/roster\.sh/)
    }
  })

  it('#11 CLAUDE.md §"On wake" resolves identity from the roster’s Orchestrator role', async () => {
    // The fourth site. §"On wake" named the default Orchestrator as if it were the
    // answer, so an agent that read the docs correctly still got it wrong.
    const doc = await readFile(join(SUBJECT, 'CLAUDE.md'), 'utf8')
    const wake = /^### On wake[\s\S]*?(?=^## )/m.exec(doc)?.[0] ?? ''

    expect(wake, 'could not locate CLAUDE.md §"On wake" — the assertion would be vacuous').not.toBe('')
    expect(wake, 'it still names a default persona instead of the roster’s Orchestrator row')
      .not.toMatch(/default persona \*\*\w+\*\*/)
    expect(wake, 'it no longer explains how identity is resolved').toMatch(/Orchestrator/i)
  })

  it('#12 a running feed picks up a roster rename without being restarted', async () => {
    await scenario('roster-12', async (s) => {
      // The first fix resolved persona once at startup. `--whoami` (a one-shot)
      // reported the new name immediately, so the fix looked complete — while the
      // long-lived supervisor carried on labelling every line with the name the
      // roster had held when it started. That is BUG-010's own failure shape wearing
      // a different hat: the displayed name and the roster disagree, and nothing
      // says so. Reported by the founder as "you are still logging as <old name>".
      const f = await feedFixture(s, 'p4', { source: SUBJECT, roster: ROSTER })
      const subject = `home/.claude/projects/${f.repo.replace(/\//g, '-')}/sess/subagents/agent-roster-rename.jsonl`
      await s.fs.write(subject, '')

      await f.withFeed(async () => {
        // The supervisor must be READING before the rename, or the evidence that it
        // followed the change cannot be told from it never having looked (BUG-038).
        await f.readerReady(subject, {
          wrap: (tag) => `${JSON.stringify({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: tag }] } })}\n`,
        })

        // The rename, exactly as a founder would make it: one cell in the roster.
        //
        // THE NEW NAME IS A DIFFERENT LENGTH ON PURPOSE. `roster_token` is
        // `file:size:mtime` and `f_mtime` is `stat -c %Y`, i.e. WHOLE SECONDS — so a
        // same-size edit landing in the same second as the previous poll's stat
        // produces an identical token and the running feed never notices. The
        // shell version renamed `Alisa`→`Dara` inside fixed padding (same size) and
        // survived only because it slept 1 s before the edit and 2 s after; ported
        // to a condition-based wait it failed intermittently, one run in three.
        // That is a real property of the feed — the I-3 change-token defect that
        // agent-activity-bound #9b pins for the BATON and nothing pins for the
        // ROSTER — and it is reported rather than papered over. This case is about
        // BUG-010, so it takes the edit that a rename actually produces.
        await s.fs.write('p4/AGENT_ROSTER.md', ROSTER.replace('| Alisa     |', '| Dara |'))

        // The feed's own change line names BOTH identities, so waiting for it
        // asserts the new name AND that the old one was in force beforehand — which
        // is the non-vacuity the shell version's bare `grep Dara` lacked. Matching
        // on 'Dara' alone would also pass against a supervisor that had been
        // labelling itself Dara since boot, i.e. against no fix at all.
        await f.expectLine("[Dara - Claude Code] identity follows the roster: was 'Alisa - Claude Code'")
      })
    })
  })
})
