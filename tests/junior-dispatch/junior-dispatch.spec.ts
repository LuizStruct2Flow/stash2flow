/**
 * TASK-082 — local junior-persona runs are first-class feed producers.
 *
 * Ollama is always a fixture shim here. A regression suite must not spend model
 * tokens, depend on a locally installed model, or publish into the operator's
 * activity feed while proving the dispatcher.
 */

import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'

const DISPATCHER = join(REPO_ROOT, 'scripts/junior-dispatch.mts')

const ROSTER = `# Agent Roster

## Members

| Role | Name | Backing agent | Model |
|---|---|---|---|
| Back-End-4 (junior) | Nils | Ollama | qwen3-coder-64k:latest |
| Back-End-2 | Andreas | Codex | frontier-3:medium |
`

async function fixture(s: Scenario, name: string, stub: string | null) {
  const root = await s.fs.mkdirp(name)
  await s.fs.write(`${name}/AGENT_ROSTER.md`, ROSTER)
  const brief = await s.fs.write(`${name}/brief.md`, 'Return a short answer.\n')
  const shims = await s.shimDir(`${name}/shims`)
  if (stub !== null) await shims.add('ollama', stub)

  const env = {
    PATH: stub === null ? await s.pathWithout(['ollama']) : shims.path(),
    BP_STATE_ROOT: root,
    AGENT_FEED_LOG: join(root, 'fixture-feed.log'),
  }
  const run = (persona = 'Nils') =>
    s.run('node', [DISPATCHER, '--persona', persona, '--brief', brief], {
      cwd: root,
      env,
    })

  return {
    root,
    brief,
    feed: `${name}/fixture-feed.log`,
    runLog: `${name}/logs/state/ollama-runs.log`,
    run,
  }
}

describe('TASK-082 — junior Ollama dispatcher', () => {
  it('labels each cleaned output line in the shared feed and preserves cleaned raw output', async () => {
    await scenario('junior-dispatch-output', async (s) => {
      const f = await fixture(
        s,
        'repo',
        `cat >/dev/null
printf '\\033[?25l\\033[2Kfirst line\\nsecond line\\033[?25h\\n'
`,
      )

      const r = await f.run()
      expect(r.code, r.output).toBe(0)
      const feed = await s.fs.read(f.feed)
      const runLog = await s.fs.read(f.runLog)
      expect(r.stdout).toBe('first line\nsecond line\n')
      expect(runLog).toBe('first line\nsecond line\n')

      expect(feed).toContain(
        `[Nils - Ollama] dispatched — ${f.brief}, model qwen3-coder-64k:latest`,
      )
      expect(feed).toContain('[Nils - Ollama] first line')
      expect(feed).toContain('[Nils - Ollama] second line')
      expect(feed).not.toContain('\u001b')
      expect(feed).toMatch(/\[Nils - Ollama\] finished \(exit 0, \d+s\)/)
    })
  })

  it('returns the Ollama failure and records FAILED with its exit status', async () => {
    await scenario('junior-dispatch-failure', async (s) => {
      const f = await fixture(s, 'repo', `cat >/dev/null
printf 'model refused\n'
exit 23
`)

      const r = await f.run()
      expect(r.code).toBe(23)
      expect(r.stdout).toBe('model refused\n')
      expect(await s.fs.read(f.feed)).toContain('[Nils - Ollama] FAILED (exit 23)')
      expect(await s.fs.read(f.runLog)).toBe('model refused\n')
    })
  })

  it('closes the feed lifecycle with the spawn error when Ollama is unavailable', async () => {
    await scenario('junior-dispatch-spawn-failure', async (s) => {
      const f = await fixture(s, 'repo', null)

      const r = await f.run()
      expect(r.code).not.toBe(0)
      expect(r.stderr).toContain('junior-dispatch: spawn ollama ENOENT')

      const feed = await s.fs.read(f.feed)
      const lifecycle = feed
        .split('\n')
        .filter((line) => line.includes('[Nils - Ollama]'))
      expect(lifecycle.at(0)).toContain('[Nils - Ollama] dispatched —')
      expect(lifecycle.at(-1)).toContain('[Nils - Ollama] FAILED (spawn ollama ENOENT)')
      expect(lifecycle.filter((line) => / (?:finished|FAILED) \(/.test(line))).toHaveLength(1)
    })
  })

  it('renders Ollama redraws without spinner, duplicate, or empty feed lines', async () => {
    await scenario('junior-dispatch-terminal', async (s) => {
      const sample = await readFile(join(REPO_ROOT, 'tests/junior-dispatch/fixtures/ollama-raw-sample.bin'))
      const encoded = sample.toString('base64')
      const stub = ['cat >/dev/null', `printf '%s' '${encoded}' | base64 -d`, ''].join('\n')
      const f = await fixture(s, 'repo', stub)

      const r = await f.run()
      expect(r.code, r.output).toBe(0)
      const output = await s.fs.read(f.feed)
      expect(output).not.toMatch(/[\u2800-\u28ff]/u)
      expect(output).not.toContain('[Nils - Ollama] \n')
      expect(output).not.toContain('ctx.skip() skips the current test execution')
      expect(output).toContain('`it.skip(...)` skips the entire test suite before it runs, while')
      expect(output).toContain('`ctx.skip()` skips only the current test case during execution.')
    })
  })

  it('refuses a persona whose roster backing is not Ollama', async () => {
    await scenario('junior-dispatch-backing', async (s) => {
      const f = await fixture(s, 'repo', `echo 'must not run' >&2
exit 99
`)

      const r = await f.run('Andreas')
      expect(r.code).not.toBe(0)
      expect(r.output).toContain("Andreas: backing agent is 'Codex', not Ollama")
      expect(await s.fs.exists(f.feed)).toBe(false)
      expect(await s.fs.exists(f.runLog)).toBe(false)
    })
  })

  it('passes the brief on stdin and the roster model as Ollama argv', async () => {
    await scenario('junior-dispatch-contract', async (s) => {
      const f = await fixture(s, 'repo', `printf 'argv=%s|%s|%s\n' "$1" "$2" "$3"
printf 'brief='
cat
`)

      const r = await f.run()
      expect(r.code, r.output).toBe(0)
      expect(r.stdout).toBe('argv=run|--nowordwrap|qwen3-coder-64k:latest\nbrief=Return a short answer.\n')
    })
  })
})
