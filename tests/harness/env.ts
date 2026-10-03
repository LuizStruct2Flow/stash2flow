import { realpathSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

/**
 * tests/harness/env.ts — the environment a fixture child process may inherit.
 *
 * WHY THIS FILE EXISTS. BUG-046 and BUG-047 were each a single missing line in
 * a shell suite: a missing `unset AGENT_SIGNAL_FILE`, a missing `unset GIT_DIR`.
 * The consequences were not small — a suite overwrote the LIVE coordination
 * baton mid-review, and another rewrote the real repository's git config,
 * setting `core.hooksPath` and thereby producing the A-22/BUG-004 failure from
 * inside a test.
 *
 * Both were invisible for months, and the guard meant to catch the second
 * selected its population by grepping COMMENTS (git-isolation:118).
 *
 * CLAUDE.md already draws the conclusion this file implements: "a rule that
 * must be remembered at the moment the author is busy is the wrong shape of
 * fix." So scrubbing is not a helper a spec may call — it is the only way to
 * obtain an environment at all. There is no exported path to an unscrubbed one.
 */

/**
 * Every GIT_* / AGENT_* variable this harness knows about, and the KIND of
 * value each one holds.
 *
 * Two families are dangerous to INHERIT, both proven by execution rather than
 * by reasoning:
 *
 *  - git's repo pointers. With GIT_DIR set, `git -C <fixture> init` returns 0,
 *    creates no .git in the fixture, and every later commit lands in the
 *    directory GIT_DIR names — i.e. the real repository (BUG-014, BUG-047).
 *  - the blueprint's own coordination state. signal-set.sh honours
 *    AGENT_SIGNAL_FILE and AGENT_STATE_HOME, and signal-watch.mts exports
 *    AGENT_SIGNAL_FILE into every dispatched wake — which is why BUG-046 struck
 *    during a Codex review and not during ordinary local runs.
 *
 * THE KIND DECIDES WHAT A DELIBERATE OVERRIDE GETS, because one check is not
 * meaningful for all of them:
 *
 *   'path'      scrubbed; an override must resolve inside the workspace.
 *   'path-list' scrubbed; a COLON-SEPARATED list of paths — git accepts
 *               several — validated element by element, because the joined
 *               string is not a path and judging it as one refuses every
 *               legitimate multi-element value.
 *   'opaque'    scrubbed; an override is NOT checked, because a name has
 *               nothing to contain. A containment check here is worse than
 *               none: it rejects `AGENT_PERSONA=Vitali` with a message about
 *               paths, which is the BUG-041/BUG-042 misdirection class — a
 *               guard indicting the thing it was pointed at — rebuilt inside
 *               the guard.
 *   'inert'     NOT scrubbed and not checked. Declared safe both ways: git's
 *               author/committer identity and two feed labels carry no path,
 *               redirect nothing, and are what tests/bootstrap-* and
 *               tests/template-source legitimately pass.
 *   'denied'    scrubbed, and an override is REFUSED outright — there is no
 *               contained form of it. See the GIT_CONFIG_* switches below.
 *   'scenario-path'
 *               the scenario OWNS it: scenarioEnv sets it on every child, an
 *               override must resolve inside the workspace, and it may not be
 *               UNSET either. Not scrubbed, because it is replaced rather than
 *               removed — a child with no HOME does not get "no home", it gets
 *               the operator's real one from getpwuid, and a child with no
 *               TMPDIR writes to /tmp.
 *   'scenario-token'
 *               the scenario owns it AND its value is load-bearing: it carries
 *               the escape token that makes a leak into the operator's real
 *               feed visible (BUG-062). An override must still contain the
 *               token. Dropping it is permitted ONLY when the child has been
 *               handed its own feed AND that feed is provably inside the
 *               workspace — see assertTokenMayBeDropped.
 *
 * AND AN UNDECLARED GIT_* / AGENT_* OVERRIDE IS REFUSED TOO. That is the half
 * this table was missing: it said what happens to the names in it and nothing
 * at all about the rest, so every other variable in both namespaces passed
 * through no check whatsoever — the same shape as GIT_CONFIG_COUNT one level
 * up, and it is how GIT_CONFIG_KEY_<n> was reachable. Declaring a variable is
 * now the only way to pass one, and the refusal says so.
 *
 * The kinds and the scrub list are ONE declaration, not two: FORBIDDEN_ENV is
 * derived from it. A second hand-written copy is how BUG-051, BUG-053 and
 * BUG-061 each went stale — an enumeration cannot see what it was never told
 * about.
 */
const ENV_KIND = {
  // git repo pointers (BUG-014 / BUG-047)
  GIT_DIR: 'path',
  GIT_WORK_TREE: 'path',
  GIT_INDEX_FILE: 'path',
  GIT_OBJECT_DIRECTORY: 'path',
  GIT_ALTERNATE_OBJECT_DIRECTORIES: 'path-list',
  GIT_CEILING_DIRECTORIES: 'path-list',
  // BUG-149 — the variable a VS Code terminal exports: it names the program
  // git execs to prompt for credentials. The AMBIENT population was already
  // scrubbed as an undeclared GIT_* name; declaring it changes only the
  // OVERRIDE arm: a scenario may now set one deliberately, and because the
  // value names a program on disk it is 'path', so the fake must live inside
  // the workspace — which is exactly how tests/ts-bridge #10 reproduces the
  // founder's terminal.
  GIT_ASKPASS: 'path',
  // git identity/config resolution — a fixture must not read the developer's
  // real config, and must not be able to write it either.
  GIT_CONFIG: 'path',
  GIT_CONFIG_GLOBAL: 'path',
  GIT_CONFIG_SYSTEM: 'path',
  // THE CONFIG-INJECTION SWITCHES, and the reason 'opaque' was wrong for the
  // count. "A number redirects no write and names nothing on disk" is true of
  // GIT_CONFIG_COUNT alone, and it is never alone: it is the SWITCH that
  // activates GIT_CONFIG_KEY_<n>/GIT_CONFIG_VALUE_<n>, and GIT_CONFIG_PARAMETERS
  // carries the same pairs inline. Probed on this machine's git before this
  // line was written:
  //
  //   GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath \
  //     GIT_CONFIG_VALUE_0=/tmp/evil-hooks git config --get core.hooksPath
  //   → /tmp/evil-hooks
  //
  // That is A-22/BUG-004 — the failure BUG-047 produced from inside a test —
  // arriving past every containment check in this file, with the guard's own
  // classification saying the value was harmless. Denied rather than validated:
  // a fixture that needs configuration has two contained ways to get it (set it
  // in its own repository, or point GIT_CONFIG_GLOBAL at a file inside the
  // workspace), so validating a third — which would mean modelling what every
  // git config key does with its value — buys nothing.
  GIT_CONFIG_COUNT: 'denied',
  GIT_CONFIG_PARAMETERS: 'denied',
  // THE ROOTS (BUG-066 / BUG-077). `.githooks/pre-push` EXPORTS BP_CODE_ROOT,
  // and the gate runs these suites — so without this line every fixture child
  // inherits the real checkout's code root, and `${BP_CODE_ROOT:-.}/tests/`
  // reads the real suite tree instead of the fixture's. Caught by
  // `bootstrap-gate` #2/#3, which runs a derived project's whole gate: four
  // `dod-gate` cases went green asserting that a BUG with NO regression test
  // and an ABSENT baton both FAIL — they were finding the real repository's
  // tests and the real baton. Same kind as AGENT_SIGNAL_FILE below and the same
  // mechanism as BUG-046: a variable exported for production correctness,
  // inherited into a fixture that was never told about it.
  BP_CODE_ROOT: 'path',
  BP_STATE_ROOT: 'path',
  // BUG-110 — the ceiling on bp_state_root's upward walk. scenarioEnv sets it to
  // the workspace root. 'path', so an ambient value is scrubbed and an override
  // cannot move the ceiling outside the workspace.
  BP_STATE_ROOT_CEILING: 'path',
  // TASK-025 H1 — the documented per-shell override of where `drift` and `pull`
  // read the blueprint, and the CLI's own internal global. An ambient value makes
  // a fixture compare against the operator's real checkout. It is UNPREFIXED, so
  // it reaches FORBIDDEN_ENV through UNPREFIXED_FORBIDDEN below rather than by
  // namespace; declaring it alone scrubbed nothing, because the filter kept only
  // GIT_/AGENT_/BP_ names. 'path': a scenario may set one inside its workspace.
  BLUEPRINT_ROOT: 'path',
  // TASK-025 — the fetch budget in seconds, handed to `timeout`. Names nothing on
  // disk and activates nothing else, so 'opaque'; scrubbed so an operator's value
  // cannot change what a timing case measures.
  BP_FETCH_TIMEOUT: 'opaque',
  // blueprint coordination state (BUG-046 / BUG-030)
  AGENT_SIGNAL_FILE: 'path',
  AGENT_STATE_HOME: 'path',
  AGENT_FEED_LOG: 'path',
  // BUG-140 — signal-set.sh validates --holder against a roster. `bp_roster_file`
  // already accepts a literal file path as its "src" argument, so this override
  // reuses that rather than adding a second resolver: unset, the check reads
  // BP_STATE_ROOT/AGENT_ROSTER.md, which for a script run from its OWN physical
  // location (BASH_SOURCE, never fixture-overridable — BUG-019) is the REAL
  // checkout's live roster. Same shape and same reason as AGENT_SIGNAL_FILE: an
  // ambient value would make a fixture validate against the operator's own
  // per-engineer roster instead of the one the test wrote.
  AGENT_ROSTER_FILE: 'path',
  // THE TWO TIMING KNOBS THE MIC SUITES SET, and 'opaque' is right for a
  // narrow reason worth stating: each is a DURATION IN SECONDS handed to
  // `sleep` or compared against `date +%s`, so it names nothing on disk,
  // activates no second variable, and redirects no write — which is the test
  // the GIT_CONFIG_COUNT paragraph above says 'opaque' must actually pass, not
  // merely "it looks like a number".
  //
  //   AGENT_SIGNAL_SETTLE   scripts/signal-watch.mts's settle window.
  //                         Whole seconds only, because the watcher compares
  //                         `date +%s`; tests/signal-dispatch's header records
  //                         that a sub-second value straddles a second boundary
  //                         and dispatches a stale Task on ~40% of runs. The
  //                         suites pick a value, they do not get to pick a
  //                         fractional one.
  //   AGENT_WAIT_MIC_POLL   scripts/wait-mic.sh's poll interval. Latency, not
  //                         correctness — nothing in that script's behaviour
  //                         depends on it, only on comparing two readings — so
  //                         a suite may run it fast.
  //
  // SCRUBBED rather than 'inert', which is the half that matters. An operator
  // with either set in their shell would otherwise silently change the timing
  // of every fixture watcher, and tests/signal-dispatch is the suite whose
  // whole subject is timing. An ambient value that alters what a timing test
  // measures is the BUG-046 shape with a number instead of a path.
  AGENT_SIGNAL_SETTLE: 'opaque',
  AGENT_WAIT_MIC_POLL: 'opaque',
  // AGENT_SIGNAL_RECOVERY — scripts/signal-watch.mts's BUG-144 mic-recovery
  // opt-out ('0' disables it, unset/anything else leaves it on). 'opaque' for
  // the same reason as the two above: a fixed enumerated flag, names nothing
  // on disk, activates no second variable, redirects no write.
  // tests/signal-dispatch sets it — its dispatcher stub is the documented
  // "backgrounded, fire-and-forget" shape recoverStrandedMic's own docblock
  // excludes, and round 3 made recovery load-bearing enough to actually race
  // that suite's own settle-window assertions (see signal-watch.mts's comment
  // on the call site).
  AGENT_SIGNAL_RECOVERY: 'opaque',
  // AGENT_WAKE_COMMAND / CODEX_WAKE_COMMAND — scripts/signal-watch.mts's own
  // wake hook (BUG-143's engine), and the whole point of a fixture setting it
  // is to run a REAL shell script — one that legitimately sources a REAL
  // repo-relative path (e.g. scripts/lib/roster.sh under REPO_ROOT, never
  // inside the workspace) to reproduce what the three launchers actually run.
  // 'opaque' because it is not a path at all — it is a multi-line shell
  // script that CONTAINS paths among other things, and a containment check
  // built for a single path would reject every legitimate value (the same
  // BUG-041/BUG-042 misdirection the 'opaque' kind's own docblock names).
  // tests/mic-recovery's BUG-144 F1 case sets this to reproduce, verbatim,
  // the launchers' own roster-lookup-in-a-wake-string pattern.
  AGENT_WAKE_COMMAND: 'opaque',
  CODEX_WAKE_COMMAND: 'opaque',
  // THE TWO FEED KNOBS, declared for the same reason and by the same test as the
  // two above: each is a NUMBER handed to `sleep` or compared against a byte
  // count, so it names nothing on disk, activates no second variable, and
  // redirects no write.
  //
  //   AGENT_FEED_TICK          scripts/agent-activity.sh:135 poll interval,
  //                            seconds, default 2. The feed suites turn it down
  //                            so a condition-based wait resolves in one tick
  //                            instead of eight; nothing about the feed's
  //                            correctness depends on the value.
  //   AGENT_FEED_MAX_FRAGMENT  :136 force-flush bound, bytes, default 1 MiB. It
  //                            is the SUBJECT of tests/agent-activity-bound #12
  //                            — a newline-less writer must not re-read forever
  //                            — and proving that at the default would mean
  //                            writing a megabyte without a newline to assert a
  //                            branch that a hundred bytes reaches.
  //
  // SCRUBBED rather than 'inert', which is again the half that matters: an
  // operator with AGENT_FEED_TICK set in their shell would silently change the
  // timing of every fixture feed, and the feed suites are the ones whose subject
  // IS timing.
  AGENT_FEED_TICK: 'opaque',
  AGENT_FEED_MAX_FRAGMENT: 'opaque',
  // THE TWO FAULT-INJECTION SEAMS agent-activity.sh carries for its own suite.
  // Declared because a seam nothing can reach is a seam nothing tests: #10's
  // append-during-read race and #18's short-sink recovery are deterministic only
  // because the reader can be slowed and its capture made to come up short on
  // demand. Guessing at the race instead is the timing-luck R4 forbids.
  //
  //   AGENT_FEED_TEST_SLOW_READ   a flag; widens the bounded read window.
  //   AGENT_FEED_TEST_SHORT_SINK  a SENTINEL PATH; while that file exists the
  //                               capture returns short. 'path', not 'opaque',
  //                               because it names a file — so the containment
  //                               check applies and a scenario cannot arm the seam
  //                               with a path outside its own workspace.
  AGENT_FEED_TEST_SLOW_READ: 'opaque',
  AGENT_FEED_TEST_SHORT_SINK: 'path',
  // A persona NAME, a backing-agent LABEL, and a gate-profile NAME.
  AGENT_PERSONA: 'opaque',
  AGENT_BACKING: 'opaque',
  AGENT_GATE_PROFILE: 'opaque',
  // AGENT_PROVIDER — scripts/rotation.mts:258's override of the roster-derived
  // provider label for a `record` call. Same kind as AGENT_PERSONA just above:
  // a NAME, not a path, names nothing on disk and activates nothing else.
  // tests/rotation's TASK-065 concurrent-append case sets a distinct one per
  // spawned record so 20 concurrent writers can be told apart in the log.
  AGENT_PROVIDER: 'opaque',
  // AGENT_CI_WATCH IS A BEHAVIOURAL SWITCH, NOT A LABEL, and 'inert' was wrong
  // for it in both directions. .githooks/pre-push:569 backgrounds
  // scripts/watch-ci.sh when "${AGENT_CI_WATCH:-1}" is 1 — so an INHERITED 1
  // (or an inherited empty-but-set value, or anything that is not 0) makes a
  // fixture that runs a gate spawn a real CI watcher against the operator's
  // repository, out of a test. Scrubbed for that reason; an override is not
  // checked because "0"/"1" contains nothing to contain, and tests/bootstrap-gate
  // passes 0 deliberately to suppress exactly this.
  AGENT_CI_WATCH: 'opaque',
  // AGENT_FEED_TAG CARRIES THE ESCAPE TOKEN (BUG-062). scenarioEnv sets it to
  // this scenario's token so every gate line pipeline.sh renders carries it and
  // a leak into the operator's real feed is DETECTED. A per-call override that
  // replaced it would turn a detectable leak into the untagged append that
  // BUG-062's row documents as the known, undetected hole — i.e. the fix would
  // have shipped with a one-line route to defeat itself.
  //
  // Dropping it is conditional rather than forbidden — see
  // assertTokenMayBeDropped for the two clauses and why both are needed.
  AGENT_FEED_TAG: 'scenario-token',
  // The two the scenario owns from OUTSIDE both namespaces. R3 requires every
  // scenario to own its HOME and its TMPDIR, and until these were declared here
  // nothing refused `{ env: { HOME: '/home/<operator>' } }`: the override merge
  // in index.ts happens before this check, and this check looked only at GIT_*
  // and AGENT_*. That made "own HOME, own temp dir" a convention again — the
  // exact distinction the harness exists to remove, and the shape of BUG-046
  // and BUG-047, which were each one forgotten line.
  HOME: 'scenario-path',
  TMPDIR: 'scenario-path',
  // TASK-025 H2 — the blueprint cache lives under ${XDG_CACHE_HOME:-$HOME/.cache}.
  // A per-scenario HOME does not cover it: an operator's ambient XDG_CACHE_HOME
  // would put every fixture's cache in their real cache directory. So the
  // scenario owns it the same way it owns HOME.
  XDG_CACHE_HOME: 'scenario-path',
  // Declared safe to inherit as well as to set: git's author/committer identity
  // carries no path, redirects nothing, and is what tests/bootstrap-* and
  // tests/template-source legitimately pass.
  GIT_AUTHOR_NAME: 'inert',
  GIT_AUTHOR_EMAIL: 'inert',
  GIT_COMMITTER_NAME: 'inert',
  GIT_COMMITTER_EMAIL: 'inert',
  // Same reasoning, same 'inert' kind: a timestamp carries no path and
  // redirects nothing. TASK-081's differential harness (plan §5's "same
  // path, twice") pins these on every commit a fixture makes, so two
  // independently-built fixtures with identical content hash to the
  // identical commit SHA regardless of wall-clock skew between the OLD and
  // NEW runs — the precondition plan §5 states for comparing byte-for-byte
  // without normalising a SHA away.
  GIT_AUTHOR_DATE: 'inert',
  GIT_COMMITTER_DATE: 'inert',
} as const satisfies Record<string, EnvKind>

type EnvKind =
  | 'path'
  | 'path-list'
  | 'opaque'
  | 'inert'
  | 'denied'
  | 'scenario-path'
  | 'scenario-token'

export type ForbiddenVar = keyof typeof ENV_KIND

/**
 * Declared hazards OUTSIDE the GIT_/AGENT_/BP_ namespaces that must be scrubbed
 * rather than replaced (TASK-025 H1). Deliberately a short explicit list, not a
 * kind-based filter: a kind filter would drop AGENT_FEED_TAG ('scenario-token')
 * out of FORBIDDEN_ENV, which is a behaviour change nobody asked for.
 *
 * scripts/run-ts-suites.sh unsets these by name after its prefix loop, and
 * tests/ts-bridge #1c imports this list to prove the two agree.
 */
export const UNPREFIXED_FORBIDDEN = ['BLUEPRINT_ROOT'] as const

/**
 * Every DECLARED variable the scrub removes: each GIT_* / AGENT_* / BP_* name
 * that is not 'inert', plus UNPREFIXED_FORBIDDEN.
 *
 * THE NAMESPACE FILTER IS LOAD-BEARING, not decoration. This list feeds
 * assertProcessEnvClean, and the test process always carries HOME — so a
 * scenario-path name in here would refuse every scenario on every machine.
 * HOME, TMPDIR and XDG_CACHE_HOME are REPLACED per scenario rather than removed,
 * which is a different mechanism, checked in a different place.
 *
 * It is not the whole scrub. isForbiddenAmbient below adds every UNDECLARED
 * GIT_* / AGENT_* name, which is what makes a direct vitest run remove what the
 * gate's runner removes (TASK-025 H5).
 */
export const FORBIDDEN_ENV = (Object.keys(ENV_KIND) as ForbiddenVar[]).filter(
  (k) =>
    ENV_KIND[k] !== 'inert' &&
    (/^(GIT|AGENT|BP)_/.test(k) ||
      (UNPREFIXED_FORBIDDEN as readonly string[]).includes(k)),
) as readonly ForbiddenVar[]

/**
 * Must an AMBIENT value of `k` be kept away from a fixture? (TASK-025 H5)
 *
 * True for every declared hazard (FORBIDDEN_ENV) and for every UNDECLARED
 * GIT_* / AGENT_* name; false for declared 'inert' names such as GIT_AUTHOR_NAME,
 * which stay.
 *
 * WHY THE UNDECLARED ARM. overrideKind already REFUSES an undeclared GIT_* / AGENT_*
 * name as an explicit override, but nothing removed one arriving AMBIENT. So
 * GIT_EXEC_PATH, GIT_ASKPASS, GIT_ALLOW_PROTOCOL, GIT_SSH_COMMAND and every git
 * variable nobody has classified yet reached fixtures in a direct `vitest run`,
 * while scripts/run-ts-suites.sh unset the whole prefix population — two run
 * modes, two environments.
 *
 * BP_* IS DELIBERATELY NOT IN THAT ARM, for overrideKind's own reason (BUG-066):
 * it is where ordinary tunables live. That is the one population the bridge
 * scrubs more of than a direct run, and tests/ts-bridge #1c states it.
 */
export function isForbiddenAmbient(k: string): boolean {
  if ((FORBIDDEN_ENV as readonly string[]).includes(k)) return true
  return (
    /^(GIT|AGENT)_/.test(k) &&
    (ENV_KIND as Record<string, EnvKind>)[k] !== 'inert'
  )
}

/**
 * The kind that governs an override of `key`.
 *
 * Undeclared names in the GIT_* / AGENT_* namespaces are DENIED rather than
 * waved through — see the table above. Anything else (PATH, LC_ALL) is not this
 * harness's business and returns undefined; HOME and TMPDIR used to fall in
 * that gap and are now declared, because the scenario owns them.
 */
function overrideKind(key: string): EnvKind | undefined {
  const declared = (ENV_KIND as Record<string, EnvKind>)[key]
  if (declared !== undefined) return declared
  // DELIBERATELY NOT BP_ (BUG-066). GIT_* and AGENT_* are closed namespaces of
  // repo pointers and coordination state, so an undeclared member of either is
  // a hazard nobody has classified yet. BP_* is not: it is also where this
  // repo's ordinary tunables live — BP_NO_PROMPT, BP_STALENESS_TIMEOUT,
  // BP_ROSTER_LOOKUP_TIMEOUT — which specs pass on purpose. Denying the prefix
  // refused four of those cases. The two BP_ names that ARE hazards are
  // declared above and reach FORBIDDEN_ENV by name.
  return /^(GIT|AGENT)_/.test(key) ? 'denied' : undefined
}

/**
 * Does this path, resolved PHYSICALLY, land inside the workspace?
 *
 * The nearest existing ancestor is what gets resolved: the path itself usually
 * does not exist yet — a fixture names where it wants git to write — and a
 * symlink anywhere along the existing part is exactly the redirect this is
 * here to catch (the same reasoning as ScopedFs.resolve, BUG-058).
 */
function resolvesInsideWorkspace(value: string, workspaceRoot: string): boolean {
  const target = resolve(value)
  let ancestor = target
  for (;;) {
    try {
      const physicalAncestor = realpathSync(ancestor)
      const suffix = target.slice(ancestor.length).replace(/^[/\\]+/, '')
      const physicalTarget = resolve(physicalAncestor, suffix)
      return (
        physicalTarget === workspaceRoot ||
        physicalTarget.startsWith(workspaceRoot + sep)
      )
    } catch {
      // This ancestor does not resolve. Try its parent, until one does or the root refuses.
      const parent = dirname(ancestor)
      if (parent === ancestor) return false
      ancestor = parent
    }
  }
}

/**
 * May this call DROP the escape token — i.e. unset AGENT_FEED_TAG?
 *
 * THE RULE. A scenario may drop the token only when it has handed the child its
 * own feed (`AGENT_FEED_LOG` unset in the same call) AND the feed the child
 * will then derive is provably inside the workspace (its cwd is). Both clauses,
 * or the token stays.
 *
 * WHY THE FIRST CLAUSE. The token is not decoration on a contained run — it is
 * what makes a leak VISIBLE when containment fails inside the child, which the
 * harness cannot police. While `AGENT_FEED_LOG` still points at the scenario's
 * feed, a child that resets or ignores that pointer (scripts/lib/feed.sh:35 is
 * the only honest reader; agent-activity.sh:78 ignores it outright) reaches the
 * operator's feed, and the token on the line is the whole detection. So a call
 * that keeps the pointer and drops the token has removed the backstop while
 * claiming the belt still holds.
 *
 * WHY THE SECOND CLAUSE, WHICH THE OBVIOUS RULE MISSES. "Unset the tag whenever
 * the feed pointer is unset too" reads safe and is exactly inverted: unsetting
 * `AGENT_FEED_LOG` is what makes the destination AMBIENT — feed.sh:37 derives it
 * from `git rev-parse --show-toplevel`, falling back to `pwd`. Point the child
 * at the real repository and that resolves to the OPERATOR'S REAL FEED, which is
 * the one place the token exists to be seen. The pair alone would therefore
 * license the single most dangerous combination this file can express. Requiring
 * the cwd to be contained is what turns "derives its own feed" into "derives a
 * feed inside this workspace": the workspace root is an mkdtemp under a base
 * that workspace.ts refuses if any project marker sits at or above it (BUG-110,
 * BUG-121), so it is inside no git tree, and from a contained cwd git either
 * finds a repository inside the workspace or finds none and pwd answers.
 *
 * This is a rule and not an exemption (TASK-018 R5): any scenario that hands a
 * child its own contained feed qualifies, and the one that does today —
 * tests/bootstrap-gate, which runs a derived project's entire gate and whose
 * tests/pipeline #16 greps for the literal `[GATE] PASSED` — qualifies by
 * meeting it, not by being named.
 */
function assertTokenMayBeDropped(
  key: string,
  overrides: Record<string, string | undefined>,
  workspaceRoot: string | undefined,
  cwd: string | undefined,
): void {
  const ownFeed =
    'AGENT_FEED_LOG' in overrides && overrides.AGENT_FEED_LOG === undefined
  const contained =
    cwd !== undefined &&
    workspaceRoot !== undefined &&
    resolvesInsideWorkspace(cwd, workspaceRoot)

  if (ownFeed && contained) return

  throw new Error(
    `Refusing to UNSET ${key}: it carries this scenario's escape token, and ` +
      `without it every gate line a leaking fixture emits becomes the ` +
      `untagged, UNDETECTED append BUG-062's row documents. Dropping it needs ` +
      `BOTH: unset AGENT_FEED_LOG in the same call, so the child derives its ` +
      `own feed rather than writing to one the token is the only guard on; ` +
      `and give it a cwd inside the workspace, so what it derives lands there ` +
      `— an unset AGENT_FEED_LOG makes the destination ambient (feed.sh falls ` +
      `back to \`git rev-parse --show-toplevel\`, then \`pwd\`), and from the ` +
      `real repository that IS the operator's feed. ` +
      (ownFeed
        ? `AGENT_FEED_LOG is unset here, but cwd ${cwd ?? '(missing)'} is not ` +
          `inside ${workspaceRoot ?? '(missing)'}.`
        : `AGENT_FEED_LOG is not being unset here.`) +
      ` If the fixture just needs its own label, COMPOSE it with the token ` +
      `instead — \`\${s.escapeToken}-my-tag\`.`,
  )
}

/**
 * Refuse an override the declared kind does not permit. Silent when it does.
 *
 * Split out of fixtureEnv so the refusal reads as one decision per variable
 * rather than as three nested branches inside a loop.
 */
function assertOverrideAllowed(
  key: string,
  value: string | undefined,
  overrides: Record<string, string | undefined>,
  workspaceRoot?: string,
  escapeToken?: string,
  cwd?: string,
): void {
  const kind = overrideKind(key)

  // UNSETTING IS AN OVERRIDE TOO, and for the two kinds the scenario owns it is
  // the more dangerous one: it looks like removal and behaves like a redirect.
  // With HOME unset git and friends fall back to getpwuid — the operator's real
  // home, the very thing the per-scenario HOME exists to hide; with TMPDIR
  // unset mktemp writes to /tmp, which is the $TMPDIR debris BUG-049 measured
  // at 133 MB; with AGENT_FEED_TAG unset pipeline.sh renders "[GATE]" and every
  // line a leaking fixture emits becomes the untagged, UNDETECTED append.
  //
  // Deleting any other declared variable stays legitimate and is how
  // tests/bootstrap-gate stops a derived gate inheriting this scenario's baton,
  // journal and feed pointers.
  if (value === undefined) {
    if (kind === 'scenario-path') {
      throw new Error(
        `Refusing to UNSET ${key}: the scenario owns it, and its absence is ` +
          `not neutral — an unset HOME resolves to the operator's real home ` +
          `via getpwuid, and an unset TMPDIR sends mktemp to /tmp. Set it to a ` +
          `value inside this scenario instead.`,
      )
    }
    if (kind === 'scenario-token') {
      assertTokenMayBeDropped(key, overrides, workspaceRoot, cwd)
    }
    return
  }

  if (kind === 'scenario-token') {
    if (escapeToken !== undefined && value.includes(escapeToken)) return
    throw new Error(
      `Refusing forbidden environment override ${key}=${value}: the harness ` +
        `sets it to this scenario's escape token so that every gate line ` +
        `pipeline.sh renders carries the token, which is what makes a leak ` +
        `into the operator's real activity feed DETECTABLE (BUG-062). ` +
        `Replacing it restores the untagged-append hole that BUG-062's row ` +
        `documents as the part the canary cannot see. If a fixture needs its ` +
        `own label, COMPOSE it with the token — \`\${s.escapeToken}-my-tag\` — ` +
        `so detection survives.` +
        (escapeToken === undefined
          ? ` (No escape token was supplied to fixtureEnv, so no override of ` +
            `${key} can be checked here; go through scenario().)`
          : ''),
    )
  }

  if (kind === 'denied') {
    throw new Error(
      key in ENV_KIND
        ? `Refusing forbidden environment override ${key}=${value}: the ` +
            `GIT_CONFIG_* switches apply configuration no file ever held — ` +
            `GIT_CONFIG_COUNT activates GIT_CONFIG_KEY_<n>/GIT_CONFIG_VALUE_<n>, ` +
            `GIT_CONFIG_PARAMETERS carries the pairs inline — so this sets ` +
            `core.hooksPath or include.path past every containment check here. ` +
            `Set the config in the fixture's own repository, or point ` +
            `GIT_CONFIG_GLOBAL at a file inside the workspace.`
        : `Refusing UNDECLARED environment override ${key}=${value}: every ` +
            `GIT_* and AGENT_* variable a fixture may receive is declared in ` +
            `tests/harness/env.ts with the kind of value it holds, and an ` +
            `undeclared one has been through no check at all. Declare it with ` +
            `its kind (and why that kind is right), or use one already declared.`,
    )
  }

  if (kind !== 'path' && kind !== 'path-list' && kind !== 'scenario-path') {
    return
  }

  // `/dev/null` is the standard read-only way to suppress a developer's real
  // git config, and it is outside every workspace by definition.
  if (
    (key === 'GIT_CONFIG_GLOBAL' || key === 'GIT_CONFIG_SYSTEM') &&
    value === '/dev/null'
  ) {
    return
  }

  // A list is validated ELEMENT BY ELEMENT. Joined, it is not a path, so a
  // value with two perfectly contained entries would be refused.
  const paths = kind === 'path-list' ? value.split(':').filter(Boolean) : [value]
  for (const path of paths) {
    if (
      workspaceRoot !== undefined &&
      resolvesInsideWorkspace(path, workspaceRoot)
    ) {
      continue
    }
    throw new Error(
      `Refusing forbidden environment override ${key}=${value}: ` +
        `the path ${path} must be inside the scenario workspace ` +
        `${workspaceRoot ?? '(missing)'}` +
        (kind === 'scenario-path'
          ? `. Every scenario owns its ${key} (R3) precisely so a fixture ` +
            `cannot read the operator's real dotfiles or scatter temp files ` +
            `outside its workspace. Use s.home, or s.workspace.path(...).`
          : ''),
    )
  }
}

/**
 * Build the environment for a fixture child process.
 *
 * Starts from the real environment (PATH, LANG, SHELL and the rest are needed —
 * these suites run real tools), then removes every forbidden variable and
 * applies the caller's per-scenario overrides.
 *
 * `overrides` is applied AFTER the scrub deliberately: a scenario that must
 * exercise a forbidden variable — `git-isolation` exists precisely to prove
 * that a hostile GIT_DIR cannot reach the real repo — sets it explicitly and
 * visibly, rather than inheriting it by accident. Deliberate is fine; ambient
 * is the defect.
 *
 * Deliberate is not unconditional, though: an override is checked against the
 * KIND declared for it, and a GIT_* / AGENT_* name with no declaration — or one
 * declared 'denied' — is refused rather than passed on. "The spec author meant
 * it" is not a containment argument; it is how GIT_CONFIG_COUNT would have
 * carried `core.hooksPath` into a fixture with every check reporting green.
 *
 * `cwd` is where the child will RUN, and it is here because one rule cannot be
 * decided without it: with AGENT_FEED_LOG unset the feed a child writes to is
 * derived from its working directory (assertTokenMayBeDropped).
 */
export function fixtureEnv(
  overrides: Record<string, string | undefined> = {},
  workspaceRoot?: string,
  escapeToken?: string,
  cwd?: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

  // ONE scrub (TASK-025 H5): declared hazards plus every undeclared GIT_*/AGENT_*
  // name. The GIT_CONFIG_KEY_<n>/GIT_CONFIG_VALUE_<n> pairs have no fixed names;
  // they used to need their own prefix loop, and are now simply undeclared GIT_
  // names — so the next switch git invents is covered the same way.
  for (const key of Object.keys(env).filter(isForbiddenAmbient)) {
    delete env[key]
  }

  for (const [key, value] of Object.entries(overrides)) {
    assertOverrideAllowed(
      key,
      value,
      overrides,
      workspaceRoot,
      escapeToken,
      cwd,
    )
    if (value === undefined) delete env[key]
    else env[key] = value
  }

  return env
}

/**
 * Assert that this process itself is not carrying state that would corrupt a
 * fixture. Called once per scenario by the harness.
 *
 * This is belt-and-braces over fixtureEnv, and it is not redundant: it catches
 * the case where a spec bypasses the harness and calls node's child_process
 * directly. The conventions forbid that, but a forbidden practice that nothing
 * detects is how BUG-046 survived in four suites at once.
 */
export function assertProcessEnvClean(): void {
  // The same predicate fixtureEnv scrubs by (TASK-025 H5): a spec spawning
  // through child_process directly inherits an undeclared GIT_* name just as
  // well as a declared one.
  const carried = Object.keys(process.env).filter(isForbiddenAmbient)
  if (carried.length > 0) {
    throw new Error(
      `The test process is carrying variables that must never reach a fixture: ` +
        `${carried.join(', ')}. This is the BUG-046/BUG-047 class. The harness ` +
        `scrubs child environments, but a spec calling child_process directly ` +
        `would inherit these — which is why specs must spawn through the ` +
        `harness (docs/waiting-acceptance/TASK-018-CONVENTIONS.md). Unset them, ` +
        `run through scripts/run-ts-suites.sh (which does), or — only if one ` +
        `truly redirects nothing — declare it 'inert' in tests/harness/env.ts.`,
    )
  }
}
