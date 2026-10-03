/**
 * tests/codex-dispatch-status/codex-dispatch-status.spec.ts — BUG-143.
 *
 * A truncated Codex dispatch reported `finished` while pointing at the
 * PREVIOUS run's `codex-last-message.md`, so a run that died read exactly
 * like one that completed. Observed live 2026-09-20/21, two independent
 * causes plus a second mechanism that bit even a run that succeeded:
 *
 * (1) `codex exec` sat in a pipeline (`| tee | codex-feed-filter.sh | while
 *     read …`), and the wake command runs under dash (`sh -c`, no
 *     PIPESTATUS, no `set -o pipefail`), so its real exit status was lost —
 *     the launcher unconditionally printed "codex exec finished".
 * (2) `--output-last-message` is written by codex ONLY when the process
 *     exits, so a run that died never touched it, and the PREVIOUS run's
 *     file survived looking current — worse than empty, because staleness
 *     is invisible.
 * (3) Even a run that SUCCEEDED could mislead: the dispatched agent hands
 *     the mic back (via signal-set.sh) before codex exec itself exits and
 *     writes its report, so a mic-flip read lands on the previous run's
 *     file seconds before the real one arrives.
 *
 * THE FIX IS TWO MECHANISMS, not one:
 *   - the exit-status-file pattern already proven in
 *     start-kimi-signal-watch.mts (TASK-063 cross-provider review): a command
 *     group writes `$?` to a status file right after codex exits, before its
 *     stdout (feeding the pipe) reaches EOF, so the file is always complete
 *     by the time the downstream stages finish. Closes (1).
 *   - `$OUTPUT_LAST` is stamped with an honest in-progress marker BEFORE
 *     codex runs at all, so a died run leaves an honest "not reported yet"
 *     marker rather than a stale previous report (closes 2), and a
 *     premature read during the mic-flip race sees the SAME honest marker
 *     instead of stale prose (closes 3) — the fix is "make a stale read
 *     impossible to mistake for this run", not merely "don't lose (2)".
 *
 * The dispatch body is run exactly as tests/dispatch-identity does: extracted
 * verbatim from the launcher's own single-quoted AGENT_WAKE_COMMAND, staged
 * with a fake CODEX_BIN standing in for the real CLI, and AGENT_SIGNAL_HOLDER
 * / AGENT_SIGNAL_TASK set inside the command string (the harness refuses
 * undeclared AGENT_* overrides — same reason tests/codex-persona-label and
 * tests/dispatch-identity do it this way).
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { feedFixture } from '../helpers/feed-fixture.js'
import { extractWakeCommand, unescapeTsShellText } from '../helpers/wake-command.js'

const SUBJECT = process.env.BP_SPEC_ROOT ?? REPO_ROOT
// TASK-083 — a migrated launcher is a two-line shim; read its `.mts` TARGET
//, same as tests/state-dir.
const LAUNCHER = join(SUBJECT, 'scripts/start-codex-signal-watch.mts')

/** A script's source with comments stripped — the static checks need the code. */
async function code(path: string): Promise<string> {
  const raw = await readFile(path, 'utf8').catch(() => '')
  const stripped = raw.replace(/^[ \t]*#.*$/gm, '')
  return path.endsWith('.mts') ? unescapeTsShellText(stripped) : stripped
}

/**
 * The wake body, read fresh from the launcher's own bytes on every call — the
 * same extraction tests/dispatch-identity and tests/codex-persona-label use.
 */
async function extractWake(): Promise<string> {
  const src = await readFile(LAUNCHER, 'utf8')
  const wake = extractWakeCommand(src)
  expect(wake, `could not extract the dispatch body from ${LAUNCHER}`).toBeDefined()
  return wake!
}

async function initializeGit(s: Scenario, repo: string, withInitialCommit = false): Promise<void> {
  const commands = [
    ['init', '-q', '--initial-branch', 'main'],
    ['config', 'user.name', 'Fixture Operator'],
    ['config', 'user.email', 'fixture@example.test'],
  ]
  if (withInitialCommit) commands.push(['add', '-A'], ['commit', '-qm', 'fixture: initial'])
  for (const args of commands) {
    const git = await s.run('git', args, { cwd: repo })
    expect(git.code, `fixture git ${args.join(' ')} failed:\n${git.output}`).toBe(0)
  }
}

/** Same invented fixture roster shape as the other codex-launcher suites. */
const FIXTURE_ROSTER = `# Roster

## Members

| Role | Name | Backing agent |
|---|---|---|
| Orchestrator | Jesko | Claude Code |
| QA-2 | Slava | Codex |
`

/**
 * A fake `codex exec` that understands just enough of the real CLI's surface
 * to drive the launcher's status-capture and marker-stamping logic:
 * `--output-last-message <path>` names where a REAL run would write its final
 * report, and `FAKE_CODEX_EXIT` (read from the environment, not a flag —
 * nothing in the real dispatch would ever pass it) controls the outcome.
 * Exit 0 writes a report to that path, exactly like a real completed run.
 * Non-zero exits WITHOUT writing it, exactly like a run that dies mid-flight
 * and never reaches the point where codex itself writes `--output-last-message`.
 */
const FAKE_CODEX = `#!/bin/sh
out=""
if [ -n "\${FAKE_CODEX_ARGS:-}" ]; then
  printf '%s\\n' "$@" >"$FAKE_CODEX_ARGS"
fi
while [ $# -gt 0 ]; do
  case "$1" in
    --output-last-message) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
code="\${FAKE_CODEX_EXIT:-0}"
if [ "$code" != "0" ]; then
  exit "$code"
fi
[ -n "$out" ] && printf 'fake codex real report\\n' >"$out"
exit 0
`

describe('BUG-143 — a Codex dispatch never reports finished for a run it did not verify', () => {
  it('TASK-066: grants a linked worktree only its git common directory', async () => {
    await scenario('codex-commit-git-dir', async (s) => {
      const f = await feedFixture(s, 'proj', { roster: FIXTURE_ROSTER, extraScripts: ['codex-feed-filter.sh'] })
      const wake = await extractWake()
      const fakeCodex = await s.fs.write('fake-codex.sh', FAKE_CODEX, { mode: 0o755 })
      const argsFile = join(s.workspace.root, 'fake-codex.args')
      const linked = join(s.workspace.root, 'linked-worktree')

      await initializeGit(s, f.repo, true)
      for (const args of [['worktree', 'add', '-q', '-b', 'linked', linked]]) {
        const git = await s.run('git', args, { cwd: f.repo })
        expect(git.code, `fixture git ${args.join(' ')} failed:\n${git.output}`).toBe(0)
      }

      const r = await s.run(
        'bash',
        [
          '-c',
          'export AGENT_SIGNAL_HOLDER=Slava AGENT_SIGNAL_TASK="TASK-066 git directory probe"; exec sh -c "$1"',
          'x',
          wake,
        ],
        {
          cwd: s.workspace.root,
          env: {
            ROOT: linked,
            CODEX_BIN: fakeCodex,
            AGENT_STATE_HOME: f.stateDir,
            FAKE_CODEX_ARGS: argsFile,
          },
        },
      )
      expect(r.code, `the dispatch body itself failed:\n${r.output}`).toBe(0)

      const args = (await readFile(argsFile, 'utf8')).split('\n')
      const addDir = args.indexOf('--add-dir')
      expect(addDir, `codex did not receive --add-dir:\n${args.join('\n')}`).toBeGreaterThan(-1)
      expect(args[addDir + 1]).toBe(join(f.repo, '.git'))
      expect(args[addDir + 1]).not.toBe(join(linked, '.git'))
    })
  })

  it('a dying dispatch reports FAILED distinctly, never "finished"', async () => {
    await scenario('codex-status-1', async (s) => {
      const f = await feedFixture(s, 'proj', { roster: FIXTURE_ROSTER, extraScripts: ['codex-feed-filter.sh'] })
      const wake = await extractWake()
      const fakeCodex = await s.fs.write('fake-codex.sh', FAKE_CODEX, { mode: 0o755 })
      await initializeGit(s, f.repo)

      const r = await s.run(
        'bash',
        [
          '-c',
          'export AGENT_SIGNAL_HOLDER=Slava AGENT_SIGNAL_TASK="BUG-143 dying dispatch"; exec bash -c "$1"',
          'x',
          wake,
        ],
        {
          cwd: s.workspace.root,
          env: { ROOT: f.repo, CODEX_BIN: fakeCodex, AGENT_STATE_HOME: f.stateDir, FAKE_CODEX_EXIT: '7' },
        },
      )
      expect(r.code, `the dispatch body itself failed:\n${r.output}`).toBe(0)

      const runLog = await readFile(join(f.stateDir, 'codex-runs.log'), 'utf8').catch(() => '')
      expect(runLog, `run log never recorded the failure:\n${runLog}`).toMatch(/FAILED \(exit 7\)/)
      expect(runLog, `a dying run must never read as "finished":\n${runLog}`).not.toMatch(
        /codex exec finished/,
      )
    })
  })

  it('a dying dispatch does not leave a PREVIOUS run’s report looking current', async () => {
    await scenario('codex-status-2', async (s) => {
      const f = await feedFixture(s, 'proj', { roster: FIXTURE_ROSTER, extraScripts: ['codex-feed-filter.sh'] })
      const wake = await extractWake()
      const fakeCodex = await s.fs.write('fake-codex.sh', FAKE_CODEX, { mode: 0o755 })
      await initializeGit(s, f.repo)

      // A stale artefact, exactly as the bug report describes: the file left
      // behind by a PREVIOUS, unrelated run.
      const stale = 'STALE: this is Alexey’s earlier review, two hours old'
      await s.fs.write('proj/state/codex-last-message.md', stale)

      const r = await s.run(
        'bash',
        [
          '-c',
          'export AGENT_SIGNAL_HOLDER=Slava AGENT_SIGNAL_TASK="BUG-143 stale-file probe"; exec bash -c "$1"',
          'x',
          wake,
        ],
        {
          cwd: s.workspace.root,
          env: { ROOT: f.repo, CODEX_BIN: fakeCodex, AGENT_STATE_HOME: f.stateDir, FAKE_CODEX_EXIT: '7' },
        },
      )
      expect(r.code, `the dispatch body itself failed:\n${r.output}`).toBe(0)

      const lastMessage = await readFile(join(f.stateDir, 'codex-last-message.md'), 'utf8').catch(() => '')
      expect(
        lastMessage,
        `a dead run must not leave the previous run's report readable as current:\n${lastMessage}`,
      ).not.toContain(stale)
      expect(
        lastMessage,
        `the file must carry an honest in-progress marker instead:\n${lastMessage}`,
      ).toMatch(/in-progress/)
    })
  })

  it('a successful dispatch still reports "finished" and the real report survives', async () => {
    await scenario('codex-status-3', async (s) => {
      const f = await feedFixture(s, 'proj', { roster: FIXTURE_ROSTER, extraScripts: ['codex-feed-filter.sh'] })
      const wake = await extractWake()
      const fakeCodex = await s.fs.write('fake-codex.sh', FAKE_CODEX, { mode: 0o755 })
      await initializeGit(s, f.repo)

      const r = await s.run(
        'bash',
        [
          '-c',
          'export AGENT_SIGNAL_HOLDER=Slava AGENT_SIGNAL_TASK="BUG-143 healthy dispatch"; exec bash -c "$1"',
          'x',
          wake,
        ],
        {
          cwd: s.workspace.root,
          env: { ROOT: f.repo, CODEX_BIN: fakeCodex, AGENT_STATE_HOME: f.stateDir, FAKE_CODEX_EXIT: '0' },
        },
      )
      expect(r.code, `the dispatch body itself failed:\n${r.output}`).toBe(0)

      const runLog = await readFile(join(f.stateDir, 'codex-runs.log'), 'utf8').catch(() => '')
      expect(runLog, `a healthy run must still say "finished":\n${runLog}`).toMatch(/codex exec finished/)
      expect(runLog, `a healthy run must not report FAILED:\n${runLog}`).not.toMatch(/FAILED/)

      const lastMessage = await readFile(join(f.stateDir, 'codex-last-message.md'), 'utf8').catch(() => '')
      expect(
        lastMessage,
        `a healthy run's real report must survive, not the in-progress marker:\n${lastMessage}`,
      ).toContain('fake codex real report')
    })
  })

  it('the launcher captures the real exit status via a status file, not the pipeline’s', async () => {
    // Static pin of the mechanism (cause 1): the command group around codex
    // exec, writing `$?` to a status file before the downstream pipe sees EOF
    // — the same shape as start-kimi-signal-watch.mts, since the wake command
    // runs under dash with no PIPESTATUS and no pipefail.
    expect(
      await code(LAUNCHER),
      'the launcher no longer captures codex exec’s real exit status via a status file',
    ).toMatch(/CODEX_STATUS_FILE/)
    expect(
      await code(LAUNCHER),
      'the "finished" report is not gated on the captured exit status',
    ).toMatch(/if \[ "\$\{CODEX_STATUS:-1\}" = "0" \]/)
  })

  it('the launcher stamps an in-progress marker before codex exec ever runs', async () => {
    // Static pin of the mechanism (causes 2 and 3): the marker write must
    // precede the codex exec invocation in the source, not merely exist
    // somewhere in the file.
    const src = await code(LAUNCHER)
    const markerIdx = src.indexOf('>"$OUTPUT_LAST"')
    const dispatchIdx = src.indexOf('"$CODEX_BIN" exec --json')
    expect(markerIdx, 'no in-progress marker write to $OUTPUT_LAST found').toBeGreaterThan(-1)
    expect(dispatchIdx, 'could not find the codex exec invocation').toBeGreaterThan(-1)
    expect(
      markerIdx,
      'the in-progress marker is stamped AFTER codex exec runs — a died or still-running dispatch can still read stale content',
    ).toBeLessThan(dispatchIdx)
  })
})
