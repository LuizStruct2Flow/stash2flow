/**
 * tests/session-start/session-start.spec.ts — TASK-022 #20: the SessionStart
 * hook, to the contract in PLAN-TASK-022 §4.2.
 *
 * ONE case, and it runs the command exactly as `.claude/settings.json` declares
 * it, from a project whose `scripts/blueprint.mts` behaves like an offline drift:
 * it waits out its fetch timeout, then exits 5. It fails if the feed is chained
 * on drift, if the unreachable result is hidden, or if drift is not bounded
 * well under its 30 s default.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario } from '../harness/index.js'

/** A hook must not hold a session start longer than this. */
const BOUND_MS = 20_000

describe('the SessionStart hook', () => {
  it('starts the feed, reports an unreachable drift as unknown, and returns within a bound', async () => {
    const settings = JSON.parse(await readFile(join(REPO_ROOT, '.claude/settings.json'), 'utf8')) as {
      hooks?: { SessionStart?: Array<{ hooks?: Array<{ command?: string }> }> }
    }
    const commands = (settings.hooks?.SessionStart ?? []).flatMap((e) => (e.hooks ?? []).map((h) => h.command ?? ''))
    const [command] = commands
    expect(commands, 'no SessionStart hook is configured').toHaveLength(1)
    if (command === undefined) return

    await scenario('session-start', async (s) => {
      const proj = join(s.workspace.root, 'proj')
      await s.fs.write(
        'proj/scripts/session-start.sh',
        await readFile(join(REPO_ROOT, 'scripts/session-start.sh'), 'utf8'),
      )
      await s.fs.write('proj/scripts/agent-activity.sh', 'echo invoked "$@" > feed-invoked\n')
      // Offline drift: the real one waits out BP_FETCH_TIMEOUT (default 30 s).
      await s.fs.write(
        'proj/scripts/blueprint.mts',
        'await new Promise((r) => setTimeout(r, Number(process.env.BP_FETCH_TIMEOUT ?? 30) * 1000))\n' +
          'console.error("error: could not read the blueprint. This is NOT a clean drift report")\n' +
          'process.exit(5)\n',
      )

      // Started from a SUBDIRECTORY, as a session opened in tests/ or src/ is.
      const sub = await s.workspace.dir('proj', 'sub')
      const started = Date.now()
      const r = await s.run('sh', ['-c', command], {
        cwd: sub,
        env: { CLAUDE_PROJECT_DIR: proj },
        timeoutMs: 60_000,
      })
      const elapsed = Date.now() - started

      expect(r.code, r.output).toBe(0)
      expect(await s.fs.exists('proj/feed-invoked'), `the feed was not started\n${r.output}`).toBe(true)
      expect(r.stdout, 'the unreachable drift is not visible to the session').toContain('drift: UNKNOWN')
      expect(r.stdout).toContain('NOT a clean drift report')
      expect(elapsed, `the hook held the session start for ${elapsed} ms`).toBeLessThan(BOUND_MS)
    })
  })

  it('every hook runs from the project root, so a session in a subdirectory keeps its guards', async () => {
    const settings = JSON.parse(await readFile(join(REPO_ROOT, '.claude/settings.json'), 'utf8')) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>
    }
    const commands = Object.values(settings.hooks ?? {}).flatMap((es) =>
      es.flatMap((e) => (e.hooks ?? []).map((h) => h.command ?? '')),
    )
    expect(commands.length, 'no hooks configured').toBeGreaterThan(0)
    // A relative `scripts/...` exits 127 from a subdirectory, and a PreToolUse hook
    // that exits 127 does not block: the no-chain guard would silently stop.
    const relative = commands.filter((c) => !c.includes('$CLAUDE_PROJECT_DIR/'))
    expect(relative, 'hook commands resolved against the cwd').toEqual([])
  })
})
