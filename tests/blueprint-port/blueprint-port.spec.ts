/**
 * tests/blueprint-port/blueprint-port.spec.ts — TASK-081 slice 1.
 *
 * Plain unit tests over scripts/blueprint.mts's skeleton primitives: the
 * errexit-context rule, command-not-found/permission-denied mapping, and the
 * signal machinery (deferral to a child's exit, shield, freeze, and
 * serialisation of repeated signals) — plan §2 rules 4 and 7, §3 P1/P2.
 *
 * WHY A PLAIN UNIT TEST, not the scenario()/harness fixture API this repo
 * otherwise requires: like tests/spawn-bounded, these are dependency-free
 * primitives over node:child_process/node:async_hooks with no repo, baton or
 * AGENT_* state that could leak into a fixture (TASK-018-CONVENTIONS.md's
 * guard is about exactly that leak, which nothing here can cause).
 *
 * The differential rows against the shell CLI (dispatch, `files`) live in
 * tests/blueprint-port/blueprint-port.release.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CommandFailedError,
  HELP_TEXT,
  beginChild,
  bpCliLibClosure,
  bpCliLibs,
  bpProspectiveFor,
  capture,
  endChild,
  errexitEnabled,
  extractShLibNames,
  freeze,
  headLines,
  installSignals,
  isTerminating,
  maybeRunHandler,
  recordSignal,
  run,
  setTerminatingHandler,
  shield,
  shieldedWrite,
  unchecked,
  _resetSignalStateForTests,
  _setBlueprintRootForTests,
} from '../../scripts/blueprint.mts'

const BLUEPRINT_MTS = fileURLToPath(new URL('../../scripts/blueprint.mts', import.meta.url))
const PLACEHOLDER_TOKEN = '{{' + 'PROJECT_NAME' + '}}'

beforeEach(() => {
  _resetSignalStateForTests()
})
afterEach(() => {
  _resetSignalStateForTests()
})

describe('plan §9 D — the placeholder hole, Option 1', () => {
  it('scripts/blueprint.mts never spells the project-name placeholder token', () => {
    const src = readFileSync(BLUEPRINT_MTS, 'utf8')
    expect(src).not.toContain(PLACEHOLDER_TOKEN)
  })

  it('HELP_TEXT (the ported header) never spells it either', () => {
    expect(HELP_TEXT).not.toContain(PLACEHOLDER_TOKEN)
  })
})

describe('errexit context (plan §2 rule 4)', () => {
  it('run() rejects a non-zero status by default (errexit on)', async () => {
    await expect(run('sh', ['-c', 'exit 3'], { stdout: 'ignore', stderr: 'ignore' })).rejects.toThrow()
  })

  it('unchecked(fn) continues past a non-zero status instead of rejecting', async () => {
    const result = await unchecked(() => run('sh', ['-c', 'exit 3'], { stdout: 'ignore', stderr: 'ignore' }))
    expect(result.status).toBe(3)
  })

  it('the same call bare, outside unchecked, still rejects — the context does not leak', async () => {
    await unchecked(() => run('sh', ['-c', 'exit 3'], { stdout: 'ignore', stderr: 'ignore' }))
    expect(errexitEnabled()).toBe(true)
    await expect(run('sh', ['-c', 'exit 3'], { stdout: 'ignore', stderr: 'ignore' })).rejects.toThrow()
  })

  it('capture(fn) runs with errexit off and strips trailing newlines like $( )', async () => {
    const out = await capture(async () => {
      const r = await run('sh', ['-c', 'printf "x\\n\\n"; exit 1'], { stdout: 'capture', stderr: 'ignore' })
      return r.stdout
    })
    expect(out).toBe('x')
  })
})

describe('command-not-found / permission-denied mapping (plan §2 rule 4)', () => {
  it('an absent command maps to status 127 with the bash-shaped message', async () => {
    const r = await unchecked(() =>
      run('definitely-not-a-real-command-xyz', [], { stdout: 'ignore', stderr: 'capture' }),
    )
    expect(r.status).toBe(127)
    expect(r.stderr).toContain(': definitely-not-a-real-command-xyz: command not found')
  })

  it('prints nothing under a stderr redirect, as 2>/dev/null would', async () => {
    const r = await unchecked(() =>
      run('definitely-not-a-real-command-xyz', [], { stdout: 'ignore', stderr: 'ignore' }),
    )
    expect(r.status).toBe(127)
    expect(r.stderr).toBe('')
  })

  it('a non-executable file maps to status 126', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bp-port-eacces-'))
    const file = join(dir, 'noexec')
    writeFileSync(file, '#!/bin/sh\necho hi\n')
    chmodSync(file, 0o644)
    try {
      const r = await unchecked(() => run(file, [], { stdout: 'ignore', stderr: 'capture' }))
      expect(r.status).toBe(126)
      expect(r.stderr).toContain('Permission denied')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function tick(n = 1): Promise<void> {
  return (async () => {
    for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r))
  })()
}

function noopKill(): (pid: number, sig: NodeJS.Signals) => void {
  return () => {
    // The test observes state directly; nothing here needs to act.
  }
}

describe('signal machinery (plan §2 rule 7, §3 P1/P2)', () => {
  it('a signal recorded with no child in flight and no shield runs the handler at the next turn', async () => {
    let calls = 0
    installSignals(() => {
      calls++
    }, noopKill())
    recordSignal('SIGTERM')
    await tick(2)
    expect(calls).toBe(1)
  })

  it('deferral: a signal recorded while a child is "in flight" waits for it to end', async () => {
    let calls = 0
    installSignals(() => {
      calls++
    }, noopKill())
    beginChild()
    recordSignal('SIGINT')
    await tick(2)
    expect(calls).toBe(0)
    await endChild()
    expect(calls).toBe(1)
  })

  it('shield: a signal recorded while shielded waits until the shield closes', async () => {
    let calls = 0
    installSignals(() => {
      calls++
    }, noopKill())
    let release: () => void = () => {}
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    const shielded = shield(async () => {
      await gate
    })
    recordSignal('SIGTERM')
    await tick(2)
    expect(calls).toBe(0)
    release()
    await shielded
    expect(calls).toBe(1)
  })

  it('freeze: the main flow stays pending once a signal is recorded before the awaited value settles', async () => {
    // installSignals first, as main() always does before anything can call
    // recordSignal in production — otherwise recordSignal's own scheduled
    // maybeRunHandler() would run with the module's DEFAULT (real) kill
    // function and actually terminate this test process.
    installSignals(() => {}, noopKill())
    let resolveChild: (v: string) => void = () => {}
    const childExit = new Promise<string>((resolveExit) => {
      resolveChild = resolveExit
    })
    const frozen = freeze(childExit)
    let settled = false
    void frozen.then(() => {
      settled = true
    })
    recordSignal('SIGTERM')
    resolveChild('done')
    await tick(3)
    expect(settled).toBe(false)
  })

  it('freeze: resolves normally when no signal was ever recorded', async () => {
    installSignals(() => {}, noopKill())
    const value = await freeze(Promise.resolve('ok'))
    expect(value).toBe('ok')
  })

  it('serialisation: the FIRST recorded signal decides, and the handler runs exactly once', async () => {
    let calls = 0
    let killedWith: NodeJS.Signals | undefined
    installSignals(
      () => {
        calls++
      },
      (_pid, sig) => {
        killedWith = sig
      },
    )
    recordSignal('SIGINT')
    recordSignal('SIGTERM')
    await maybeRunHandler()
    await maybeRunHandler()
    await tick(2)
    expect(calls).toBe(1)
    expect(killedWith).toBe('SIGINT')
  })

  it('BUG-116: setTerminatingHandler(handler, true) resumes — the process is never killed, and a SECOND signal is handled again too', async () => {
    // a2bp's own trap replaces the process-wide handler for one command
    // (setTerminatingHandler(cleanup, true), scripts/blueprint.mts:2596),
    // matching bash's `trap _a2bp_cleanup EXIT INT TERM` at scripts/blueprint:1886:
    // a trap that returns normally, without calling `exit`, does not
    // terminate the script — the command that was interrupted simply
    // continues. Reproduced here, not fixed (plan §3 P5 "kept exactly").
    let calls = 0
    let killed = false
    installSignals(() => {
      // installSignals always arms resume=false; swap it before recording.
    }, () => {
      killed = true
    })
    setTerminatingHandler(() => {
      calls++
    }, true)

    recordSignal('SIGTERM')
    await maybeRunHandler()
    expect(calls, 'the resuming handler did not run').toBe(1)
    expect(killed, 'a resuming handler must never reach dieOfSignal — the run continues').toBe(false)
    expect(isTerminating(), 'resume must clear the pending signal so the command can continue').toBe(false)

    // "the command continues" — the next command in the same a2bp run checks
    // the trap between commands exactly as before, and a SECOND signal is
    // handled again rather than being swallowed by a handler that already ran.
    recordSignal('SIGINT')
    await maybeRunHandler()
    expect(calls, 'a second signal during the same resumed run was not handled').toBe(2)
    expect(killed).toBe(false)
  })
})

// --- slice 3 unit tests (plan §8 row 3) -------------------------------------

function mkFixtureDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('headLines (scripts/blueprint:1658, `head -60`)', () => {
  it('keeps only the first N lines, trailing newline included', () => {
    const text = 'a\nb\nc\nd\n'
    expect(headLines(text, 2)).toBe('a\nb\n')
  })

  it('returns everything when there are fewer than N lines', () => {
    const text = 'a\nb\n'
    expect(headLines(text, 60)).toBe('a\nb\n')
  })

  it('keeps a final line with no trailing newline (as `head` does)', () => {
    const text = 'a\nb\nc'
    expect(headLines(text, 2)).toBe('a\nb\n')
    expect(headLines(text, 3)).toBe('a\nb\nc')
  })

  it('an empty string yields an empty string', () => {
    expect(headLines('', 60)).toBe('')
  })
})

describe('shieldedWrite (plan §3 P2)', () => {
  it('writes a NEW file (dest absent): bytes land, no leftover tmp', async () => {
    const dir = mkFixtureDir('bp-port-shield-new-')
    try {
      const src = join(dir, 'src')
      const dest = join(dir, 'dest')
      writeFileSync(src, 'hello\n')
      const ok = await shieldedWrite(src, dest)
      expect(ok).toBe(true)
      expect(readFileSync(dest, 'utf8')).toBe('hello\n')
      expect(existsSync(`${dest}.bp-new.${process.pid}`)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an existing dest keeps ITS OWN mode when no modeFrom is given (cp -p)', async () => {
    const dir = mkFixtureDir('bp-port-shield-cpp-')
    try {
      const src = join(dir, 'src')
      const dest = join(dir, 'dest')
      writeFileSync(src, 'new bytes\n')
      writeFileSync(dest, 'old bytes\n')
      chmodSync(dest, 0o750)
      const ok = await shieldedWrite(src, dest)
      expect(ok).toBe(true)
      expect(readFileSync(dest, 'utf8')).toBe('new bytes\n')
      expect(statSync(dest).mode & 0o777).toBe(0o750)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('mirrors ONLY the executable bit from modeFrom (BUG-008)', async () => {
    const dir = mkFixtureDir('bp-port-shield-modefrom-')
    try {
      const src = join(dir, 'src')
      const dest = join(dir, 'dest')
      const modeFrom = join(dir, 'mode-from')
      writeFileSync(src, '#!/bin/sh\necho hi\n')
      writeFileSync(modeFrom, '')
      chmodSync(modeFrom, 0o755)
      const ok = await shieldedWrite(src, dest, modeFrom)
      expect(ok).toBe(true)
      expect(statSync(dest).mode & 0o111).not.toBe(0)
      expect(readFileSync(dest, 'utf8')).toBe('#!/bin/sh\necho hi\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a non-executable modeFrom clears the bit (mirrors -x too)', async () => {
    const dir = mkFixtureDir('bp-port-shield-modefrom-off-')
    try {
      const src = join(dir, 'src')
      const dest = join(dir, 'dest')
      const modeFrom = join(dir, 'mode-from')
      writeFileSync(src, 'plain\n')
      writeFileSync(dest, 'plain\n')
      chmodSync(dest, 0o755) // dest starts executable
      writeFileSync(modeFrom, '')
      chmodSync(modeFrom, 0o644) // modeFrom is not
      const ok = await shieldedWrite(src, dest, modeFrom)
      expect(ok).toBe(true)
      expect(statSync(dest).mode & 0o111).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a failing step (an injected PATH shim) leaves the OLD dest intact and cleans up tmp', async () => {
    const dir = mkFixtureDir('bp-port-shield-fail-')
    const shimDir = mkFixtureDir('bp-port-shield-fail-shim-')
    const savedPath = process.env.PATH
    try {
      const src = join(dir, 'src')
      const dest = join(dir, 'dest')
      writeFileSync(src, 'new bytes\n')
      writeFileSync(dest, 'old bytes\n')
      // A `cp` that always fails, ahead of the real one on PATH — the
      // shielded step's own PATH search finds this first.
      const fakeCp = join(shimDir, 'cp')
      writeFileSync(fakeCp, '#!/bin/sh\nexit 7\n')
      chmodSync(fakeCp, 0o755)
      process.env.PATH = `${shimDir}:${savedPath}`
      const ok = await shieldedWrite(src, dest)
      expect(ok).toBe(false)
      // Nothing lost: the write never got past `cp`, so DEST is untouched.
      expect(readFileSync(dest, 'utf8')).toBe('old bytes\n')
      expect(existsSync(`${dest}.bp-new.${process.pid}`)).toBe(false)
    } finally {
      process.env.PATH = savedPath
      rmSync(dir, { recursive: true, force: true })
      rmSync(shimDir, { recursive: true, force: true })
    }
  })
})

describe('bpCliLibs / extractShLibNames — the closure (plan §7)', () => {
  // UNIT ONLY: TASK-088 deleted the shell CLI and its shim, so the closure is
  // seeded from scripts/blueprint.mts alone. The differential rows in
  // blueprint-port.release.spec.ts still drive the historical shell CLI.
  it('extractShLibNames ignores names inside # and // comments', () => {
    const src = ['# see scripts/lib/commented-out.sh', '// also scripts/lib/js-style.sh', 'foo.sh bar.sh'].join('\n')
    expect(extractShLibNames(src)).toEqual(['foo.sh', 'bar.sh'])
  })

  it('names come from the CLI own code, filtered to libs that exist', async () => {
    const root = mkFixtureDir('bp-port-clilibs-plain-')
    try {
      mkdirSync(join(root, 'scripts/lib'), { recursive: true })
      writeFileSync(
        join(root, 'scripts/blueprint.mts'),
        'source scripts/lib/foo.sh\nsource scripts/lib/bar.sh\nsource scripts/lib/not-shipped.sh\n',
      )
      writeFileSync(join(root, 'scripts/lib/foo.sh'), '')
      writeFileSync(join(root, 'scripts/lib/bar.sh'), '')
      // scripts/lib/not-shipped.sh is named but never created — it must not
      // appear in the result (bpCliLibs filters to libs that actually exist).
      _setBlueprintRootForTests(root)
      const libs = await bpCliLibs()
      expect(libs).toEqual(['scripts/lib/bar.sh', 'scripts/lib/foo.sh'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('no scripts/blueprint.mts in the blueprint tree: nothing to bring along, so the result is empty', async () => {
    const root = mkFixtureDir('bp-port-clilibs-nomts-')
    try {
      mkdirSync(join(root, 'scripts/lib'), { recursive: true })
      writeFileSync(join(root, 'scripts/lib/gate.sh'), '')
      _setBlueprintRootForTests(root)
      const libs = await bpCliLibs()
      expect(libs).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('a lib closure is dependency-first across different stems and retains an explicit missing dependency for hold-back', async () => {
    const root = mkFixtureDir('bp-port-clilibs-order-')
    try {
      mkdirSync(join(root, 'scripts/lib'), { recursive: true })
      writeFileSync(join(root, 'scripts/blueprint.mts'), "void 'scripts/lib/a-adapter.sh'\n")
      writeFileSync(
        join(root, 'scripts/lib/a-adapter.sh'),
        '_target="$1/scripts/lib/z-target.mts"\n_missing="$1/scripts/lib/zz-missing.mts"\n',
      )
      writeFileSync(join(root, 'scripts/lib/z-target.mts'), '// target\n')
      _setBlueprintRootForTests(root)

      const closure = await bpCliLibClosure()
      expect(closure.files).toEqual([
        'scripts/lib/z-target.mts',
        'scripts/lib/zz-missing.mts',
        'scripts/lib/a-adapter.sh',
      ])
      expect(closure.needs.get('scripts/lib/a-adapter.sh')).toEqual([
        'scripts/lib/z-target.mts',
        'scripts/lib/zz-missing.mts',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('bpProspectiveFor callers (plan §2 rule 4 — Codex review finding #1)', () => {
  // `bpProspectiveFor(f, out)` reads `f` as the PROJECT path — relative to
  // `process.cwd()`, not to the fixture root — so the two "new" branch tests
  // below need an `f` that is guaranteed absent at whatever directory the
  // suite happens to run from. `CLAUDE.md` (this repo's own file) used to
  // fill that role and broke exactly this way: run from the blueprint's own
  // root instead of `tests/` (the canonical `npm --prefix tests test`
  // invocation), `existsSync('CLAUDE.md')` is TRUE, `bpProspectivePull` takes
  // the "copy" branch instead of "new", and the assertion below sees
  // `mode: 'copy'` — not a divergence from the shell, a fixture that
  // collided with a real file outside its own control. A name no tracked
  // file will ever have removes the collision instead of merely working
  // around it from one cwd.
  const NONEXISTENT_PROJECT_FILE = 'bp-port-prospective-fixture-does-not-exist.md'

  // The shell calls bp_prospective_pull / bp_prospective_for ONLY as an `if`
  // condition (scripts/blueprint:1394, :1572, :1639), so errexit is off for
  // its whole dynamic extent: an inner `cp` failing there does not abort
  // drift/pull, it just continues past the failed command. Reproduced by
  // wrapping the three call sites in `unchecked()` (drift's, selection's and
  // the write's) — this proves the MECHANISM those three sites now share:
  // called bare, an inner cp failure rejects; called through unchecked(), it
  // does not. A regression that drops any of the three `unchecked()` wraps
  // reproduces the bare case and would crash drift/pull instead of
  // continuing past the failure, exactly as this test's bare case does.
  it("bare (no unchecked): a failing inner cp makes bpProspectiveFor's promise reject", async () => {
    const root = mkFixtureDir('bp-port-prospective-bare-root-')
    const shimDir = mkFixtureDir('bp-port-prospective-bare-shim-')
    const savedPath = process.env.PATH
    try {
      expect(existsSync(NONEXISTENT_PROJECT_FILE)).toBe(false)
      writeFileSync(join(root, NONEXISTENT_PROJECT_FILE), 'blueprint content\n')
      _setBlueprintRootForTests(root)
      const fakeCp = join(shimDir, 'cp')
      writeFileSync(fakeCp, '#!/bin/sh\nexit 9\n')
      chmodSync(fakeCp, 0o755)
      process.env.PATH = `${shimDir}:${savedPath}`

      const out = join(shimDir, 'out')
      // The project file does not exist, so bpProspectivePull takes the
      // "new" branch: `await run('cp', [bp, out]); return {mode: 'new', ...}`
      // — a bare, unwrapped `run()` call, ambient errexit-on by default.
      await expect(bpProspectiveFor(NONEXISTENT_PROJECT_FILE, out)).rejects.toBeInstanceOf(CommandFailedError)
    } finally {
      process.env.PATH = savedPath
      rmSync(root, { recursive: true, force: true })
      rmSync(shimDir, { recursive: true, force: true })
    }
  })

  it('unchecked(): the SAME failing cp is absorbed — the call continues and resolves, as bash does', async () => {
    const root = mkFixtureDir('bp-port-prospective-unchecked-root-')
    const shimDir = mkFixtureDir('bp-port-prospective-unchecked-shim-')
    const savedPath = process.env.PATH
    try {
      expect(existsSync(NONEXISTENT_PROJECT_FILE)).toBe(false)
      writeFileSync(join(root, NONEXISTENT_PROJECT_FILE), 'blueprint content\n')
      _setBlueprintRootForTests(root)
      const fakeCp = join(shimDir, 'cp')
      writeFileSync(fakeCp, '#!/bin/sh\nexit 9\n')
      chmodSync(fakeCp, 0o755)
      process.env.PATH = `${shimDir}:${savedPath}`

      const out = join(shimDir, 'out')
      const p = await unchecked(() => bpProspectiveFor(NONEXISTENT_PROJECT_FILE, out))
      // Reproduces the shell bug-for-bug: the function's own last statement
      // is an explicit `return 0`, so it reports success even though the cp
      // inside it failed and `out` was never written. This new-file branch is
      // deliberately different from copy/backup-copy, where cp really is the
      // last command and its failure becomes the function's status.
      expect(p.mode).toBe('new')
      expect(p.ok).toBe(true)
      expect(existsSync(out)).toBe(false)
    } finally {
      process.env.PATH = savedPath
      rmSync(root, { recursive: true, force: true })
      rmSync(shimDir, { recursive: true, force: true })
    }
  })
})
