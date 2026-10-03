/**
 * tests/scratch-tmpdir-dispatch/scratch-tmpdir-dispatch.spec.ts — TASK-083.
 *
 * Most agents broke the .scratch/ rule on 2026-09-24/25 and /tmp filled with
 * their working copies. `.claude/settings.json` now refuses it for Claude
 * Code, but Codex, Kimi and Gemini read no Claude settings — for them the
 * launcher itself has to redirect TMPDIR before the dispatched binary ever
 * runs (scripts/lib/scratch-tmpdir.mts, wired into all three launchers plus
 * junior-dispatch.mts).
 *
 * THE PROOF, per provider: a stub CLI standing in for CODEX_BIN / KIMI_BIN /
 * GEMINI_BIN runs `mktemp -p "$TMPDIR"` and
 * `node -e 'process.stdout.write(require("os").tmpdir())'` — the two
 * mechanisms most tools use to find a scratch directory — and writes each
 * result to a file the test reads back. Both must land under the fixture's
 * `.scratch/tmp`, never `/tmp`. This drives the REAL launcher end to end
 * (baton flip -> signal-watch -> AGENT_WAKE_COMMAND -> the stub binary),
 * not an extracted wake body run in isolation, so it is the launcher
 * PROCESS's own TMPDIR export under test, exactly as a real dispatch sees it.
 *
 * RED BEFORE, GREEN AFTER: before scripts/lib/scratch-tmpdir.mts existed and
 * was wired into the three launchers, `$TMPDIR` was never set by any of
 * them, so `mktemp -p "$TMPDIR"` failed outright (`-p ''` — no such
 * directory) and `os.tmpdir()` read the operator's ambient default (`/tmp`
 * on this host). Both assertions below fail on that tree; reverting the
 * TMPDIR wiring commit and re-running reproduces it.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'

/** Same invented fixture roster shape as the other launcher suites. */
const FIXTURE_ROSTER = `# Roster

## Members

| Role | Name | Backing agent |
|---|---|---|
| Orchestrator | Jesko | Claude Code |
| QA-2 | Slava | Codex |
`

/**
 * A stub provider CLI: ignores every argument (each real launcher passes a
 * different flag set), runs the two TMPDIR probes, and exits 0. Any stdout
 * a real launcher expects (codex's --json stream, a final message) is fine
 * left empty — codex-feed-filter.sh passes an empty stream through as
 * nothing, and the launchers' own status-capture only cares about the exit
 * code, which this always reports as success.
 */
const STUB_CLI = `#!/bin/sh
mktemp -p "$TMPDIR" >"$PROBE_MKTEMP_FILE" 2>"$PROBE_MKTEMP_FILE.err"
node -e 'process.stdout.write(require("os").tmpdir())' >"$PROBE_TMPDIR_FILE" 2>"$PROBE_TMPDIR_FILE.err"
exit 0
`

interface Fixture {
  repo: string
  scratchTmp: string
}

/** Every file a signal-watch dispatch through this launcher needs on disk. */
async function buildFixture(
  s: Scenario,
  name: string,
  launcherRel: string,
  holderState: string,
): Promise<Fixture> {
  const repo = await s.gitRepo(name)
  const rel = (p: string) => join(name, p)

  for (const args of [
    ['config', 'user.name', 'Fixture Operator'],
    ['config', 'user.email', 'fixture@example.test'],
  ]) {
    await s.run('git', args, { cwd: repo.dir })
  }

  const shellScripts = [
    'scripts/signal-watch.mts',
    launcherRel,
    'scripts/codex-feed-filter.sh',
    'scripts/lib/state-dir.sh',
    'scripts/lib/roster.sh',
    'scripts/lib/feed.sh',
  ]
  for (const script of shellScripts) {
    await s.fs.copyIn(join(REPO_ROOT, script), rel(script))
    await s.fs.chmod(rel(script), 0o755)
  }
  for (const lib of ['scripts/lib/spawn-bounded.mts', 'scripts/lib/find-bin.mts', 'scripts/lib/scratch-tmpdir.mts']) {
    await s.fs.copyIn(join(REPO_ROOT, lib), rel(lib))
  }

  await s.fs.write(rel('AGENT_ROSTER.md'), FIXTURE_ROSTER)
  await s.fs.write(
    rel('logs/state/signal.md'),
    [
      '| Field | Value |',
      '|---|---|',
      '| Holder | Slava |',
      `| State | ${holderState} |`,
      '| Task | TASK-083 TMPDIR probe |',
      '',
    ].join('\n'),
  )
  await repo.commitAll('fixture: baseline')

  return { repo: repo.dir, scratchTmp: join(repo.dir, '.scratch', 'tmp') }
}

async function runProbe(
  s: Scenario,
  f: Fixture,
  launcherRel: string,
  binEnvVar: string,
): Promise<{ mktempOut: string; tmpdirOut: string }> {
  const stub = await s.fs.write('stub-provider.sh', STUB_CLI, { mode: 0o755 })
  const mktempFile = join(s.workspace.root, 'probe-mktemp.out')
  const tmpdirFile = join(s.workspace.root, 'probe-tmpdir.out')

  const r = await s.run('node', [join(f.repo, launcherRel), '--poll', '1', '--once'], {
    cwd: f.repo,
    timeoutMs: 60_000,
    env: {
      [binEnvVar]: stub,
      PROBE_MKTEMP_FILE: mktempFile,
      PROBE_TMPDIR_FILE: tmpdirFile,
      AGENT_SIGNAL_SETTLE: '0',
      AGENT_SIGNAL_FILE: undefined,
      AGENT_STATE_HOME: undefined,
    },
  })

  const mktempOut = await readFile(mktempFile, 'utf8').catch(
    (e) => `<read failed: ${String(e)}> — launcher output:\n${r.output}`,
  )
  const tmpdirOut = await readFile(tmpdirFile, 'utf8').catch(
    (e) => `<read failed: ${String(e)}> — launcher output:\n${r.output}`,
  )
  return { mktempOut: mktempOut.trim(), tmpdirOut: tmpdirOut.trim() }
}

describe('TASK-083 — every provider dispatch redirects TMPDIR to .scratch/tmp', () => {
  it('Codex: the dispatched CLI sees TMPDIR under .scratch/tmp', async () => {
    await scenario('scratch-tmpdir-codex', async (s) => {
      const f = await buildFixture(s, 'proj', 'scripts/start-codex-signal-watch.mts', 'OVER_TO_CODEX')
      const { mktempOut, tmpdirOut } = await runProbe(s, f, 'scripts/start-codex-signal-watch.mts', 'CODEX_BIN')

      expect(mktempOut.startsWith(f.scratchTmp), `mktemp -p "$TMPDIR" landed at: ${mktempOut}`).toBe(true)
      expect(tmpdirOut.startsWith(f.scratchTmp), `os.tmpdir() reported: ${tmpdirOut}`).toBe(true)
    })
  })

  it('Kimi: the dispatched CLI sees TMPDIR under .scratch/tmp', async () => {
    await scenario('scratch-tmpdir-kimi', async (s) => {
      const f = await buildFixture(s, 'proj', 'scripts/start-kimi-signal-watch.mts', 'OVER_TO_KIMI')
      const { mktempOut, tmpdirOut } = await runProbe(s, f, 'scripts/start-kimi-signal-watch.mts', 'KIMI_BIN')

      expect(mktempOut.startsWith(f.scratchTmp), `mktemp -p "$TMPDIR" landed at: ${mktempOut}`).toBe(true)
      expect(tmpdirOut.startsWith(f.scratchTmp), `os.tmpdir() reported: ${tmpdirOut}`).toBe(true)
    })
  })

  it('Gemini: the dispatched CLI sees TMPDIR under .scratch/tmp', async () => {
    await scenario('scratch-tmpdir-gemini', async (s) => {
      const f = await buildFixture(s, 'proj', 'scripts/start-gemini-signal-watch.mts', 'OVER_TO_GEMINI')
      const { mktempOut, tmpdirOut } = await runProbe(s, f, 'scripts/start-gemini-signal-watch.mts', 'GEMINI_BIN')

      expect(mktempOut.startsWith(f.scratchTmp), `mktemp -p "$TMPDIR" landed at: ${mktempOut}`).toBe(true)
      expect(tmpdirOut.startsWith(f.scratchTmp), `os.tmpdir() reported: ${tmpdirOut}`).toBe(true)
    })
  })
})
