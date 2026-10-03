/**
 * tests/dispatch-identity/dispatch-identity.spec.ts — BUG-142.
 *
 * `agent-activity.sh --whoami` answers with the Orchestrator inside a dispatch.
 * Observed twice live on 2026-09-20: with the baton reading `Holder=Florian`,
 * a dispatched Kimi ran `--whoami` and got `Eto - Claude Code`. It resolves
 * the roster's Orchestrator row and has no notion of dispatch context — right
 * for the primary session, wrong for every dispatched one. Both runs recovered
 * by reading the baton instead; that recovery is the hazard, not the
 * mitigation.
 *
 * THE FIX IS A BRIDGE, NOT A NEW RESOLVER. `resolve_identity` already honours
 * an `AGENT_PERSONA` override, and `signal-watch.mts` already exports
 * `AGENT_SIGNAL_HOLDER` into every wake command. The launchers simply never
 * connected the two. Each launcher now exports `AGENT_PERSONA` from
 * `AGENT_SIGNAL_HOLDER`, so the CLI it spawns inherits the override and
 * `--whoami` answers with the dispatched persona. There is deliberately NO
 * second identity path inside `--whoami` itself: two copies of one rule are
 * two rules, which is the shape BUG-010 and BUG-021 each landed on.
 *
 * WHY THE BEHAVIOURAL CASE DRIVES THE KIMI LAUNCHER. That is where the defect
 * was seen live, and the launcher's wake body is executable without a real
 * CLI: the body is extracted from the launcher bytes (read fresh from the
 * tree under test, never from memory), a fake `kimi` binary stands in for the
 * CLI and does exactly one thing — ask `--whoami` — and the answer lands in
 * `kimi-last-message.md`, the same place a real dispatch leaves its final
 * message. `AGENT_SIGNAL_HOLDER` is set inside the shell command rather than
 * passed as an env override because the harness refuses undeclared AGENT_*
 * overrides (tests/harness/env.ts); setting it in the command string is the
 * same pattern tests/codex-persona-label uses for the same reason.
 *
 * The static cases pin the one-line bridge in ALL THREE launchers (the fix is
 * per-launcher; a future launcher edit can drop one) and pin the forbidden
 * direction too: `--whoami` must not grow an `AGENT_SIGNAL_HOLDER` code path
 * of its own.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { REPO_ROOT, scenario } from '../harness/index.js'
import { feedFixture } from '../helpers/feed-fixture.js'
import { extractWakeCommand, unescapeTsShellText } from '../helpers/wake-command.js'

/**
 * The tree under test. REPO_ROOT for an ordinary run; `BP_SPEC_ROOT` repoints
 * it at a perturbed copy, the same convention every ported suite keeps.
 */
const SUBJECT = process.env.BP_SPEC_ROOT ?? REPO_ROOT

// TASK-083 — a migrated launcher is a two-line shim; the static checks below
// read its `.mts` TARGET, same as
// tests/state-dir. A not-yet-migrated launcher resolves to its own `.sh`
// unchanged.
const CODEX_LAUNCHER = join(SUBJECT, 'scripts/start-codex-signal-watch.mts')
const GEMINI_LAUNCHER = join(SUBJECT, 'scripts/start-gemini-signal-watch.mts')
const KIMI_LAUNCHER = join(SUBJECT, 'scripts/start-kimi-signal-watch.mts')
const FEED = join(SUBJECT, 'scripts', 'agent-activity.sh')

/** A script's source with comments stripped — the static checks need the code. */
async function code(path: string): Promise<string> {
  const raw = await readFile(path, 'utf8').catch(() => '')
  const stripped = raw.replace(/^[ \t]*#.*$/gm, '')
  return path.endsWith('.mts') ? unescapeTsShellText(stripped) : stripped
}

/**
 * The fixture roster. The names are invented rather than taken from anyone's
 * live fleet: a persona literal from a real roster in a test is the BUG-010
 * contamination class in fixture form. `## Members` is load-bearing —
 * `bp_roster_rows` reads only that table.
 */
const FIXTURE_ROSTER = `# Roster

## Members

| Role | Name | Backing agent |
|---|---|---|
| Orchestrator | Jesko | Claude Code |
| QA-2 | Slava | Kimi |
`

/**
 * The wake body a launcher hands to `signal-watch.mts`, read fresh from its
 * bytes. The launcher builds it as a single-quoted string, so the extraction
 * regex anchors on the assignment and the closing quote before `exec` — the
 * same shape tests/codex-persona-label asserts about.
 */
async function extractWake(launcherPath: string): Promise<string> {
  const src = await readFile(launcherPath, 'utf8')
  const wake = extractWakeCommand(src)
  expect(wake, `could not extract the dispatch body from ${launcherPath}`).toBeDefined()
  return wake!
}

describe('BUG-142 — a dispatched persona is itself when it asks --whoami', () => {
  it('BUG-142 a dispatched persona running --whoami answers with its own name, not the Orchestrator', async () => {
    await scenario('dispatch-identity-1', async (s) => {
      const f = await feedFixture(s, 'proj', { roster: FIXTURE_ROSTER })
      const wake = await extractWake(KIMI_LAUNCHER)

      // The fake kimi IS the probe: the only thing the dispatched CLI does is
      // ask who it is. cwd is already $ROOT (the wake body cd's there), and
      // $ROOT is the fixture repo, so this --whoami resolves the FIXTURE
      // roster — never the operator's live one.
      const fakeKimi = await s.fs.write(
        'fake-kimi.sh',
        '#!/bin/sh\nexec bash "$ROOT/scripts/agent-activity.sh" --whoami\n',
        { mode: 0o755 },
      )

      // THE DISPATCH, staged exactly as signal-watch.mts stages it: the holder
      // persona in AGENT_SIGNAL_HOLDER, the task in AGENT_SIGNAL_TASK, both
      // set before the wake body runs. Holder=Slava, a Kimi persona; the
      // Orchestrator row is Jesko. See the header for why these are set in
      // the command string rather than passed as env overrides.
      const r = await s.run(
        'bash',
        [
          '-c',
          'export AGENT_SIGNAL_HOLDER=Slava AGENT_SIGNAL_TASK="BUG-142 whoami probe"; exec bash -c "$1"',
          'x',
          wake,
        ],
        {
          cwd: s.workspace.root,
          env: {
            ROOT: f.repo,
            KIMI_BIN: fakeKimi,
            AGENT_STATE_HOME: f.stateDir,
            // The harness pins AGENT_PERSONA to the scenario escape token on
            // every child (tests/harness/index.ts:206 — the leak-detection
            // half for agent-activity.sh), exactly as an operator shell might
            // carry an ambient override. A REAL dispatch is the bridge's job
            // to win, so leaving the token in place is the stronger fixture;
            // but with the bridge absent (pre-fix) the token is what --whoami
            // would answer, which reads as noise rather than the defect. The
            // un-set models the production case the BUG-142 report names — no
            // override in scope until the launcher exports one.
            AGENT_PERSONA: undefined,
          },
        },
      )
      expect(r.code, `the dispatch body failed:\n${r.output}`).toBe(0)

      // The dispatched CLI final message is where the answer lands — the same
      // file a real dispatch leaves its last message in.
      const lastMessage = await readFile(join(f.stateDir, 'kimi-last-message.md'), 'utf8').catch(() => '')
      const whoamiLine = lastMessage.split('\n')[0]
      expect(
        whoamiLine,
        `a dispatched Slava ran --whoami and the first line of its answer was not ` +
          `'Slava - Kimi' — the persona got the wrong identity. Full answer:\n${lastMessage}`,
      ).toBe('Slava - Kimi')
      expect(
        whoamiLine,
        'the answer names the Orchestrator — dispatch context never reached the override',
      ).not.toContain('Jesko')
    })
  })

  it('BUG-142 the Codex launcher exports AGENT_PERSONA from the dispatch holder', async () => {
    expect(
      await code(CODEX_LAUNCHER),
      'start-codex-signal-watch.mts does not bridge AGENT_SIGNAL_HOLDER to AGENT_PERSONA — a dispatched Codex still answers --whoami as the Orchestrator',
    ).toMatch(/\[ -n "\$\{AGENT_SIGNAL_HOLDER:-\}" \] && export AGENT_PERSONA="\$AGENT_SIGNAL_HOLDER"/)
  })

  it('BUG-142 the Gemini launcher exports AGENT_PERSONA from the dispatch holder', async () => {
    expect(
      await code(GEMINI_LAUNCHER),
      'start-gemini-signal-watch.mts does not bridge AGENT_SIGNAL_HOLDER to AGENT_PERSONA — a dispatched Gemini still answers --whoami as the Orchestrator',
    ).toMatch(/\[ -n "\$\{AGENT_SIGNAL_HOLDER:-\}" \] && export AGENT_PERSONA="\$AGENT_SIGNAL_HOLDER"/)
  })

  it('BUG-142 the Kimi launcher exports AGENT_PERSONA from the dispatch holder', async () => {
    expect(
      await code(KIMI_LAUNCHER),
      'start-kimi-signal-watch.mts does not bridge AGENT_SIGNAL_HOLDER to AGENT_PERSONA — a dispatched Kimi still answers --whoami as the Orchestrator',
    ).toMatch(/\[ -n "\$\{AGENT_SIGNAL_HOLDER:-\}" \] && export AGENT_PERSONA="\$AGENT_SIGNAL_HOLDER"/)
  })

  it('BUG-142 --whoami gains no dispatch-context identity path of its own', async () => {
    // THE FORBIDDEN DIRECTION, pinned so a well-meaning "fix" cannot re-add
    // it: reading AGENT_SIGNAL_HOLDER inside agent-activity.sh would be a
    // second copy of the identity rule, and two copies drift — that is the
    // BUG-010/BUG-021 shape the bridge exists to avoid.
    expect(
      await code(FEED),
      '--whoami grew its own AGENT_SIGNAL_HOLDER identity path — the rule now lives in two places and will drift',
    ).not.toMatch(/AGENT_SIGNAL_HOLDER/)
  })
})
