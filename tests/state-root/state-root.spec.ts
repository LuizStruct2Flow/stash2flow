/**
 * tests/state-root/state-root.spec.ts — TASK-021 Stage A.
 *
 * THE DEFECT THIS PINS. A script's physical location answers "where is my
 * CODE". Every state-dir consumer used it to answer "where is my STATE" as
 * well, which is correct only because `scripts/` currently sits at the
 * repository root. After the `scaffolding/` split those are different
 * directories, and resolving state from the code root yields — measured, in a
 * real post-move tree, all at exit 0:
 *
 *   * a SECOND baton at `scaffolding/logs/state/signal.md` that no dispatcher
 *     watches, published with "signal-set: published … (atomic)";
 *   * a feed split in two, because `agent-activity.sh` writes a script-relative
 *     path while `lib/feed.sh` resolves the real root;
 *   * `session-resume` reporting `0 backlog / 0 doing / 0 waiting-acceptance /
 *     0 done` beside a correct GIT section, warning only about a snapshot
 *     marker;
 *   * `bp_roster_file` falling through to the SHIPPED EXAMPLE roster, so
 *     `--whoami` answers with a template persona name at rc=0.
 *
 * So: two named roots. `BP_CODE_ROOT` is the physical-script anchor every
 * consumer already carries; `bp_state_root` walks UP from it to the enclosing
 * project root. In the flat tree they are the same directory, which is why
 * this lands now — a provable no-op here, rather than something debugged
 * during the move.
 *
 * WHY THE WALK USES NO GIT COMMAND. `git rev-parse --show-toplevel` answers
 * about the caller's exported GIT_DIR, git exports GIT_DIR to every hook, and
 * the gate runs the suites from a pre-push hook. That is BUG-014's mechanism
 * and A-09 is what it reopens; #6c has forbidden it for state-dir consumers
 * since. A filesystem test for `.git` consults no environment at all, which
 * `#B` below demonstrates against a hostile GIT_DIR.
 *
 * MUTATION RECIPE (TASK-018-RULES R6) — observed red, not predicted:
 *
 *   1. Delete the `[ ! -e "$_bsr_d/.git" ]` conjunct from `bp_state_root`.
 *      → #A3 (git-init fixture) and #A5 (.git as a file) go red.
 *   2. Restore the `${BP_CODE_ROOT:-$PWD}` fallback.
 *      → #D goes red: an unset code root silently resolves to cwd.
 *   3. Give `agent_state_dir` back its `${1:-}` positional.
 *      → #C1 goes red: a stale call site resolves instead of failing.
 *   4. Drop `|| exit 9` from any consumer's init line.
 *      → #E goes red: that consumer derives an artefact path at `/`.
 *   5. Drop the `BP_STATE_ROOT_CEILING` comparison from `bp_state_root`.
 *      → #A7 goes red: the walk climbs past the ceiling into a marker above it.
 *      Observed on the parent of the fix, which has no ceiling (BUG-110).
 *
 * DISSOLVED CASE — `#F no fixture constructor builds a project-shaped tree
 * without one` (removed 2026-09-11, TASK-018). Its mutation recipe was "remove
 * one fixture's `.blueprint-source` marker line → #F goes red naming that
 * constructor".
 *
 * #F scanned every `tests/<suite>/test.sh` for a project-shaped fixture
 * constructor (`mkdir -p "$X/scripts…"` with state-resolving code copied in)
 * and required each to write a root terminator. Its SUBJECT was shell fixtures
 * building their own project-shaped trees by hand. The shell-runner retirement
 * deletes every one of them, and the case's own code already named that end
 * condition, in the `catch` around its `readFile`: *"TypeScript suites use the
 * harness, which owns isolation."* With no `.sh` left, every suite takes that
 * branch and the scan has nothing to scan.
 *
 * WHY IT WAS DELETED RATHER THAN LEFT TO PASS VACUOUSLY — and this is the part
 * a reader should not have to rediscover. #F's non-vacuity guard named four
 * anchors (`state-dir`, `watcher-liveness`, `agent-activity-bound`,
 * `subagent-feed`), ALL FOUR of which are shell runners the wave deletes. So at
 * the end state `inScope` is empty and the guard fires — which is the guard
 * working: it was written precisely to refuse a scan that had stopped reaching
 * anything. MEASURED in a scratchpad copy of the finished tree: `#F no longer
 * scans state-dir, whose fixture needs a terminator: expected [] to include
 * 'state-dir'`. Weakening the anchor list to keep the case green would have
 * converted a real non-vacuity guard into a vacuous pass, which is the exact
 * trade CLAUDE.md §"Pre-push tolerance" exists to refuse.
 *
 * WHAT CARRIES THE PROPERTY NOW: `tests/harness/` constructs every fixture
 * tree, so a terminator is written by the harness rather than remembered by
 * each fixture author — structurally present instead of checked for
 * (TASK-018-RULES R3). #A above is what tests that `bp_state_root` terminates
 * where it should, and #A6 that a markerless tree fails loudly rather than
 * climbing into the operator's real checkout.
 */

import { describe, it, expect } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'

const LIB = join(REPO_ROOT, 'scripts', 'lib', 'state-dir.sh')

/**
 * Run a snippet with state-dir.sh sourced.
 *
 * `env -u` strips the harness's own AGENT_STATE_HOME / AGENT_SIGNAL_FILE:
 * those are overrides the production code honours FIRST, so leaving them set
 * would short-circuit the very derivation under test. Every case that needs
 * them is explicit about it.
 */
async function sh(s: Scenario, snippet: string, cwd: string) {
  return s.run(
    'sh',
    ['-c', `env -u AGENT_STATE_HOME -u AGENT_SIGNAL_FILE sh -c '. "${LIB}"; ${snippet}'`],
    { cwd },
  )
}

describe('TASK-021 #A — the state root terminates at the enclosing project root', () => {
  it('#A1 a post-move code root resolves UP to the real repository root', async () => {
    await scenario('state-root-a1', async (s) => {
      const root = await s.fs.mkdirp('bp')
      await s.fs.mkdirp('bp/scaffolding/scripts')
      await s.fs.write('bp/.blueprint-root', '')
      const r = await sh(s, `BP_CODE_ROOT="${root}/scaffolding"; bp_state_root`, root)
      expect(r.stdout.trim()).toBe(root)
    })
  })

  it('#A2 a derived project resolves to itself — the mechanism is a no-op downstream', async () => {
    await scenario('state-root-a2', async (s) => {
      const root = await s.fs.mkdirp('proj')
      await s.fs.mkdirp('proj/scripts')
      await s.fs.write('proj/.blueprint-source', 'config_version = 2\n')
      const r = await sh(s, `BP_CODE_ROOT="${root}"; bp_state_root`, root)
      expect(r.stdout.trim()).toBe(root)
    })
  })

  it('#A3 a fixture with .git and NO marker resolves to the fixture root', async () => {
    // The nine suites Alexey's census found, plus the shape it could not see.
    await scenario('state-root-a3', async (s) => {
      const repo = await s.gitRepo('fixture')
      await s.fs.mkdirp('fixture/scripts/lib')
      const r = await sh(s, `BP_CODE_ROOT="${repo.dir}"; bp_state_root`, repo.dir)
      expect(r.stdout.trim()).toBe(repo.dir)
    })
  })

  it('#A4 a directory nested inside a fixture does not climb out of it', async () => {
    await scenario('state-root-a4', async (s) => {
      const repo = await s.gitRepo('fixture')
      const deep = await s.fs.mkdirp('fixture/a/b/c')
      const r = await sh(s, `BP_CODE_ROOT="${deep}"; bp_state_root`, repo.dir)
      expect(r.stdout.trim()).toBe(repo.dir)
    })
  })

  it('#A5 .git as a FILE terminates — submodules and linked worktrees', async () => {
    // `-e`, not `-d`. A submodule and a `git worktree` both carry a .git FILE.
    await scenario('state-root-a5', async (s) => {
      const root = await s.fs.mkdirp('wt')
      await s.fs.mkdirp('wt/scripts')
      await s.fs.write('wt/.git', 'gitdir: /elsewhere/.git/worktrees/wt\n')
      const r = await sh(s, `BP_CODE_ROOT="${root}"; bp_state_root`, root)
      expect(r.stdout.trim()).toBe(root)
    })
  })

  it('#A6 a markerless, non-git tree FAILS LOUDLY and never reaches a real checkout', async () => {
    await scenario('state-root-a6', async (s) => {
      const deep = await s.fs.mkdirp('bare/a/b')
      const r = await sh(s, `BP_CODE_ROOT="${deep}"; bp_state_root`, deep)
      expect(r.code).not.toBe(0)
      expect(r.stdout.trim()).toBe('')
      expect(r.stderr).toContain('cannot locate the project root')
      // and it names what it searched, so the fix is obvious from the message
      expect(r.stderr).toContain(deep)
    })
  })

  it('#A7 BUG-110 a marker ABOVE the ceiling is never reached — a stray one cannot invert #A6', async () => {
    // #A6 once failed deterministically because an empty `.git` appeared in the
    // system temp dir, one level above every workspace: the walk climbed out,
    // resolved it, and exited 0. The harness hands every child its workspace
    // root as BP_STATE_ROOT_CEILING; here the ceiling sits one level below a
    // planted marker, so the escape is provable without touching the real
    // $TMPDIR. Ported from PR #68 (linkedin-watcher-agent).
    await scenario('state-root-a7', async (s) => {
      await s.fs.mkdirp('outer')
      await s.fs.write('outer/.git', '')
      const ceiling = await s.fs.mkdirp('outer/ws')
      const deep = await s.fs.mkdirp('outer/ws/bare/a/b')
      const r = await sh(
        s,
        `BP_STATE_ROOT_CEILING="${ceiling}"; BP_CODE_ROOT="${deep}"; bp_state_root`,
        deep,
      )
      expect(r.stdout.trim()).toBe('')
      expect(r.code).not.toBe(0)
      expect(r.stderr).toContain('cannot locate the project root')
      expect(r.stderr).toContain(ceiling)
    })
  })
})

describe('TASK-021 #B — the walk consults no git command, so GIT_DIR cannot move it', () => {
  it('#B a hostile exported GIT_DIR does not change the resolved root', async () => {
    await scenario('state-root-b', async (s) => {
      const repo = await s.gitRepo('real')
      const decoy = await s.gitRepo('decoy')
      const sub = await s.fs.mkdirp('real/scripts')

      // Prove the decoy is genuinely hostile — otherwise this case is vacuous,
      // which is the trap tests/state-dir #6b exists to close.
      const old = await s.run(
        'sh',
        ['-c', `GIT_DIR="${decoy.dir}/.git" git rev-parse --show-toplevel 2>/dev/null || echo NONE`],
        { cwd: sub },
      )
      expect(old.stdout.trim()).not.toBe(repo.dir)

      const now = await s.run(
        'sh',
        [
          '-c',
          `env -u AGENT_STATE_HOME GIT_DIR="${decoy.dir}/.git" sh -c '. "${LIB}"; BP_CODE_ROOT="${sub}"; bp_state_root'`,
        ],
        { cwd: sub },
      )
      expect(now.stdout.trim()).toBe(repo.dir)
    })
  })
})

describe('TASK-021 #C — the no-argument API is a boundary, not a default', () => {
  const CASES = ['agent_state_dir', 'agent_signal_file', 'agent_signal_journal'] as const

  for (const fn of CASES) {
    it(`#C1 ${fn} REFUSES a positional root instead of resolving it`, async () => {
      // A tolerant `${1:-...}` would let every existing caller keep passing its
      // own script location — which is exactly the wrong post-move value. The
      // refusal is what turns a stale call site into a failure.
      await scenario(`state-root-c1-${fn}`, async (s) => {
        const repo = await s.gitRepo('proj')
        const r = await sh(s, `${fn} /some/explicit/root`, repo.dir)
        expect(r.code).toBe(2)
        expect(r.stderr).toContain('takes no arguments')
      })
    })
  }

  it('#C2 the named seam still answers, so A-09 stays testable', async () => {
    // tests/state-dir #1/#2/#3 pass synthetic roots to prove two projects
    // derive DIFFERENT state dirs. Removing every parameterised entry point
    // would delete that assertion rather than satisfy it.
    await scenario('state-root-c2', async (s) => {
      const repo = await s.gitRepo('proj')
      const a = await sh(s, 'agent_state_dir_for /tmp/x/proj-A', repo.dir)
      const b = await sh(s, 'agent_state_dir_for /tmp/x/proj-B', repo.dir)
      expect(a.stdout.trim()).toBe('/tmp/x/proj-A/logs/state')
      expect(b.stdout.trim()).toBe('/tmp/x/proj-B/logs/state')
      expect(a.stdout.trim()).not.toBe(b.stdout.trim())
    })
  })
})

describe('TASK-021 #D — an unset code root fails rather than guessing cwd', () => {
  it('#D bp_state_root refuses when BP_CODE_ROOT is unset', async () => {
    // There was a `${BP_CODE_ROOT:-$PWD}` fallback here for one afternoon and
    // it caused a live leak: start-codex-signal-watch.mts's wake command is a
    // single-quoted string run later by `sh -c`, where only EXPORTED variables
    // survive. The fallback resolved to whatever directory the dispatch ran
    // from — the REAL blueprint checkout — so a fixture dispatch wrote
    // codex-last-message.md into live state, silently.
    await scenario('state-root-d', async (s) => {
      const repo = await s.gitRepo('proj')
      const r = await sh(s, 'unset BP_CODE_ROOT; bp_state_root', repo.dir)
      expect(r.code).not.toBe(0)
      expect(r.stdout.trim()).toBe('')
      expect(r.stderr).toContain('BP_CODE_ROOT is unset')
    })
  })
})

describe('TASK-021 #E — the empty-root path is unreachable', () => {
  it('#E no consumer can derive an artefact path at the filesystem root', async () => {
    // THE CONCRETE HARM, asserted rather than argued. Before the once-per-script
    // resolution, `state_dir="$(agent_state_dir)"` discarded a failure status,
    // left the variable EMPTY, and derived `/gemini-runs.log` — agent artefacts
    // at `/`. Every consumer now resolves once at init with `|| exit 9`, so
    // there is no window in which that variable is empty.
    await scenario('state-root-e', async (s) => {
      const markerless = await s.fs.mkdirp('nowhere/scripts')

      // An unresolvable root yields NOTHING on stdout and a non-zero status.
      // The old code returned `<empty>/logs/state`, so the caller's next
      // interpolation produced `/gemini-runs.log` — agent artefacts at `/`.
      const r = await sh(s, `BP_CODE_ROOT="${markerless}"; agent_state_dir`, markerless)
      expect(r.code).not.toBe(0)
      expect(r.stdout.trim()).toBe('')

      // And the status is not merely available, it is CHECKED: every consumer
      // resolves once at init with `|| exit`, so no consumer ever holds the
      // empty value long enough to interpolate it.
      const guarded = await consumersWithInitGuard()
      expect(guarded.missing).toEqual([])
      expect(guarded.checked.length).toBeGreaterThanOrEqual(6)
    })
  })
})

const LAUNCHER_MTS = /^start-(codex|kimi|gemini)-signal-watch\.mts$/

/** Production scripts that call the state API, and whether each guards its init. */
async function consumersWithInitGuard(): Promise<{ missing: string[]; checked: string[] }> {
  const dir = join(REPO_ROOT, 'scripts')
  const names = (await readdir(dir)).filter((n) => n.endsWith('.sh') || LAUNCHER_MTS.test(n))
  const missing: string[] = []
  const checked: string[] = []
  for (const n of names) {
    // TASK-083/088 — the three provider launchers are `.mts` files whose guard
    // text is literal shell inside their AGENT_WAKE_COMMAND template (this
    // particular pattern needs no JS-escaping — it contains no `${`), so the
    // same regex below still applies. NARROWLY scoped to those three:
    // scripts/signal-watch.mts is genuine TypeScript calling the same
    // functions programmatically, not shell text — a shell-syntax regex cannot
    // answer a TS question, and this scan lists shell files only. Its own
    // init-guard property is proven elsewhere (tests/state-dir,
    // tests/codex-dispatch-status), not by this grep.
    const body = await readFile(join(dir, n), 'utf8')
    const stripped = body.replace(/^\s*#.*$/gm, '')
    if (!/\bagent_(state_dir|signal_file|signal_journal)\b/.test(stripped)) continue
    checked.push(n)
    if (!/BP_STATE_ROOT="\$\(bp_state_root\)"\s*\|\|\s*exit/.test(stripped)) missing.push(n)
  }
  return { missing, checked }
}

describe('TASK-021 #G — production code never passes a root to the state API', () => {
  it('#G no production call site supplies a root, INCLUDING via the named seam', async () => {
    // The seam is the opt-in hole if the sweep only forbids the ordinary API:
    // `agent_state_dir_for "$repo_root"` reintroduces exactly what removing the
    // positional was meant to stop. session-resume.sh is the one sanctioned
    // user, because `--root DIR` is an explicit operator override.
    const ALLOWED = new Map([['session-resume.sh', 1]])
    const dir = join(REPO_ROOT, 'scripts')
    const files = [
      ...(await readdir(dir)).filter((n) => n.endsWith('.sh')).map((n) => join(dir, n)),
      ...(await readdir(join(dir, 'lib')))
        .filter((n) => n.endsWith('.sh'))
        .map((n) => join(dir, 'lib', n)),
    ]

    const offenders: string[] = []
    let seamUses = 0

    for (const f of files) {
      if (f.endsWith('lib/state-dir.sh')) continue // the definitions themselves
      const body = await readFile(f, 'utf8')
      const name = f.slice(REPO_ROOT.length + 1)
      body.split('\n').forEach((line, i) => {
        const code = line.replace(/#.*$/, '')
        // An ARGUMENT, not a redirection and not the end of a substitution.
        // `agent_signal_file 2>/dev/null` and `$( … agent_signal_file )` are
        // both zero-argument calls; a first cut matched `\s+\S` and flagged
        // both, which would have made the sweep noise rather than a control.
        if (/\bagent_(state_dir|signal_file|signal_journal)\s+(?![0-9]*[<>|&)}]|$)\S/.test(code)) {
          offenders.push(`${name}:${i + 1} passes a root to the no-argument API`)
        }
        if (/\bagent_(state_dir|signal_file|signal_journal)_for\b/.test(code)) {
          seamUses += 1
          const base = name.split('/').pop() as string
          if (!ALLOWED.has(base)) {
            offenders.push(`${name}:${i + 1} uses the named seam in production`)
          }
        }
      })
    }

    expect(offenders).toEqual([])
    // Non-vacuity: the seam IS used by the sanctioned caller, so a sweep that
    // silently matched nothing would be caught here.
    expect(seamUses).toBeGreaterThanOrEqual(1)
  })
})
