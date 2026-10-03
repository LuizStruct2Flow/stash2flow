/**
 * tests/manifest/manifest.ts — the coverage control, as inspectable functions.
 *
 * BUG-005 / Codex F1 — make the coverage policy a CONTROL instead of a slogan.
 *
 * The 30 s pre-push ceiling was removed because it had become a coverage policy:
 * a suite that outgrew the budget got demoted to CI-only, and the gate carried
 * on printing "all checks passed" over less. The rule that replaced it — that
 * coverage is decided on risk, never on the clock — was claimed to be enforced
 * by `pipe_skip`, because a skip must carry a reason. That was false: a suite
 * simply OMITTED from `.githooks/pre-push-project` never reaches `pipe_skip` at
 * all, so deleting a `pipe_stage` block is a one-line silent coverage cut and
 * the pipeline still renders PASSED. `signal-dispatch` was the live proof.
 *
 * The questions a filesystem derivation cannot answer about itself, which is
 * everything this module checks:
 *
 *   - does every runner on disk actually get RUN, by the gate and by CI?
 *   - does the export boundary BEHAVE the way `.gitattributes` declares?
 *   - do bootstrap and pull deliver the same thing?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT ONLY A SPEC (TASK-018).
 *
 * `inspect()` takes the root it inspects and the runner it spawns with, so the
 * same code answers for three trees: this repo (manifest.spec.ts), a synthetic
 * perturbed tree (the fixture cases, which are what make each assertion
 * provably able to fail — R6), and a freshly BOOTSTRAPPED project
 * (tests/bootstrap-gate #6, which is the only case speaking for downstream).
 *
 * It used to be one shell file that all three drove as a subprocess. That
 * worked because a shell file is executable anywhere; a spec is not, and
 * bootstrap-gate would otherwise have had to `npm ci` inside a fixture on every
 * push. A module import costs nothing and the fixture cases come free with it.
 *
 * ---------------------------------------------------------------------------
 * BUG-051 — THE DEFECT THAT RETURNS THROUGH A DOOR THE CONTROL CANNOT SEE.
 *
 * Every assertion here used to be anchored on `*.sh`, so the whole control had
 * one shape of blind spot, and it was exactly the shape of the TypeScript
 * migration: move a suite to TS, delete its `.sh`, and nothing failed — no
 * discovery error, because no shell file remained to find.
 *
 * A RUNNER is therefore a `*.sh` OR a `*.spec.ts`, everywhere, including both
 * directions of the export boundary. Discovery lives in `scripts/lib/suites.sh`
 * and THIS FILE DOES NOT KEEP A COPY OF IT — it shells out to that library.
 * `scripts/run-ts-suites.sh` once grew a verbatim copy of the same parse, under
 * a comment claiming to be the thing that could not drift, and it had already
 * drifted. A control that discovers suites its own way is asserting something
 * about its own `find`, not about what runs.
 *
 * A TS suite is not invoked the way a shell suite is. One `vitest run` covers
 * the whole tree (PLAN-TASK-018 §7.3), so there is no per-suite command to grep
 * for. Nor does the hook run vitest itself: it sources `scripts/run-ts-suites.sh`
 * and calls into it. So the invocation proof is a CHAIN, and every link is
 * checked:
 *
 *     the spec exists   AND   the hook reaches the bridge it sources
 *                       AND   the bridge runs vitest with no path filter
 *                       AND   the vitest config's include actually covers it
 *
 * Break any link and #4 fails: delete the spec (1), delete the stage from the
 * hook or delete the bridge (2), give the bridge's run a positional path (3),
 * narrow the include glob (4). What is deliberately NOT accepted is "a spec
 * exists somewhere" — that would be a nothing-assertion in a new costume.
 *
 * ---------------------------------------------------------------------------
 * MIGRATION IS REPLACEMENT, NOT ACCUMULATION.
 *
 * There used to be a RETIRED-SHELL-RUNNERS table: a suite could keep a `*.sh`
 * the gate no longer invoked, provided a row named the mutant that proved its
 * spec equivalent. The table is gone with tests/SUITES.md. The rule is now the
 * simple one: **every runner on disk is invoked.** A suite migrating to
 * TypeScript deletes its shell runner in the same change that adds its spec,
 * having run the mutant first (R6).
 *
 * THAT MIGRATION IS FINISHED (TASK-047). There is one runner convention now —
 * `*.spec.ts`, or `*.spec.tsx` where the test contains JSX — so the rule reads
 * simply: every runner on disk is a spec, and every spec is invoked by the
 * blanket vitest run. What the last shell runner's retirement cost is recorded
 * in docs/config/findings.md F-003.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PORT LOST, STATED RATHER THAN QUIETLY DROPPED.
 *
 * The shell version's #9 asserted, BY EXECUTION, that this control invokes no
 * Node toolchain: it re-ran itself with node/npm/npx/tsc/vitest replaced by
 * shims that exit 127, and failed if any was touched or if the poisoned run
 * disagreed. It existed because tests/manifest governs its own migration — a
 * checkout part-way through TASK-018, or a host with no toolchain, still had to
 * get a truthful answer out of its own coverage control.
 *
 * That property cannot survive the port. A vitest spec IS a Node toolchain, and
 * no wording makes it survive. It is a REAL reduction and it is recorded here
 * rather than argued away.
 *
 * What stands in its place is fail-closed rather than fail-quiet, and it lives
 * in `scripts/run-ts-suites.sh`: with no `npx`, or with `tests/node_modules`
 * absent, the bridge calls `pipe_stage … false` and BLOCKS the push instead of
 * `pipe_skip`ping it. So a toolchain-less checkout gets no answer and cannot
 * push, rather than a wrong answer it believes. That is the safe direction to
 * be wrong in, and it is weaker than what #9 gave. `tests/ts-bridge` asserts
 * the blocking behaviour.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import ts from 'typescript'
import { notGithubActions } from '../helpers/project-config.js'

/** One check's verdict. `ok: false` carries the message the operator reads. */
export interface CheckResult {
  readonly id: string
  readonly ok: boolean
  readonly message: string
  /**
   * TASK-044 — set when the check did not judge this tree, with the reason.
   * Not a failure (`ok` stays true), and not a pass either: the caller must
   * print it, because an unanswered check that says nothing is BUG-005.
   */
  readonly skipped?: string
}

/** A process runner. `scenario.run` satisfies it; nothing else is accepted. */
export type Runner = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number },
) => Promise<{ code: number | null; stdout: string; output: string }>

/**
 * The toolchain files a `.spec.ts` needs in order to be executable at all.
 *
 * DECLARED ONCE, read by both #2b and #2c. It used to be two hand-written
 * lists and BUG-061 walked straight through the gap between them:
 * package-lock.json was in neither list nor the export-ignore block, so it
 * shipped ALONE to every derived project while both checks printed "phase 1 is
 * whole". An AND over a remembered subset cannot see a file it does not know
 * about — so the partial-ship tally in #2c, not this list, is what closes the
 * class.
 */
const TS_TOOLCHAIN = [
  'tests/package.json',
  'tests/package-lock.json',
  'tests/tsconfig.json',
  'tests/vitest.config.ts',
] as const

/** Regex-safe form of a suite name, which may legitimately contain `.` or `-`. */
const rx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function readOr(path: string, fallback = ''): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    // A fixture tree may lack the file on purpose. The fallback is the caller's, and its check judges it.
    return fallback
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    // Absence is the probed state.
    return false
  }
}

/**
 * BUG-115 — why a workflow's problems, not just its text.
 *
 * #5 reads a workflow as text, and text GitHub cannot parse still names every
 * suite. So it passed for three days while GitHub ran zero jobs on every push.
 * This parses the file the way GitHub does and checks the minimum Actions
 * shape. It returns one message per problem, or nothing when the file is sound.
 */
export function workflowProblems(text: string): string[] {
  const doc = parseDocument(text)
  if (doc.errors.length > 0) return doc.errors.map((e) => `does not parse: ${e.message}`)
  const isMap = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
  const w: unknown = doc.toJS()
  if (!isMap(w)) return ['is not a mapping']
  const p: string[] = []
  if (!('on' in w)) p.push('has no `on:` trigger')
  if (!isMap(w.jobs) || Object.keys(w.jobs).length === 0) return [...p, 'has no `jobs:`']
  for (const [id, job] of Object.entries(w.jobs)) {
    if (!isMap(job)) {
      p.push(`job ${id} is not a mapping`)
      continue
    }
    if ('uses' in job) continue // a reusable-workflow call has no steps of its own
    if (!('runs-on' in job)) p.push(`job ${id} has no runs-on`)
    if (!Array.isArray(job.steps) || job.steps.length === 0) {
      p.push(`job ${id} has no steps`)
      continue
    }
    job.steps.forEach((st: unknown, i: number) => {
      if (!isMap(st) || 'run' in st === 'uses' in st) {
        p.push(`job ${id} step ${i + 1} needs exactly one of run/uses`)
      }
    })
  }
  return p
}

/**
 * The files with COMMENT LINES REMOVED.
 *
 * Codex R2-F1b: membership was checked with an unanchored grep for the path, so
 * commenting out an invocation kept the control green while the suite stopped
 * running. Reproduced: `sed -i '/tests\/pipeline/s/^/#/' .githooks/pre-push*`
 * left the manifest passing "every suite is invoked by the gate". Strip
 * comments first, then require an anchored command rather than arbitrary text
 * containing the path.
 */
export function liveCmds(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/#.*/, ''))
    .join('\n')
}

/**
 * The same, for TypeScript — block comments then line comments.
 *
 * `//` also truncates a URL, which is harmless here: the only consumer is #1b,
 * where the effect is to IGNORE a reference rather than to invent one, and
 * nothing writes a helper path after a URL on one line.
 */
function stripTsComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
}

/** Shell function definitions in one file's live text. */
function definedFuncs(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const m = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*\([ \t]*\)[ \t]*\{/.exec(line)
    if (m?.[1]) out.push(m[1])
  }
  return out
}

/**
 * The bridges a set of files genuinely REACHES.
 *
 * The gate does not run vitest itself: `.githooks/pre-push-project` sources
 * `scripts/run-ts-suites.sh` and calls `ts_suites_stage`, and the actual
 * `npx vitest run` lives in there — because that file also declares the
 * expected suite list to the pipeline and injects one `pipe_stage_report` per
 * suite, so `bootstrap-gate` #3's >=25-stage guard and the slowest-stage SLO
 * keep meaning something (PLAN-TASK-018 §7.3).
 *
 * So "the gate's live commands" means the hook PLUS the files it sources — but
 * only the ones it genuinely reaches. A sourced file that merely DEFINES a
 * function is not running anything, and that is precisely the case where text
 * appears without executing. A bridge therefore counts only when all three
 * hold: the hook sources it by a literal relative path, the file EXISTS (an
 * absent bridge is `pipe_skip`ped at runtime, and a skip carries a reason but
 * is still not running), and the hook CALLS a function the file defines.
 *
 * Nothing here is specific to `run-ts-suites.sh`: the bridge is discovered, not
 * named. Only ONE hop is followed. A bridge that sources a second bridge fails
 * closed — no blanket run is found and #4 says so — which is the right
 * direction to be wrong in, and the fix is to extend this walk.
 */
export async function liveBridges(root: string, text: string): Promise<string[]> {
  // BUG-074 — THE SHELL VERSION COULD ONLY SEE AN INDENTED `source` LINE.
  //
  // It found candidates with a grep and then stripped the verb with
  // `s/.*[[:space:]](\.|source)[[:space:]]+//`, which requires whitespace
  // BEFORE the dot. A bridge sourced at column 0 — ordinary shell — came out of
  // that sed as the literal `. ./scripts/run-ts-suites.sh`, failed its `[ -f ]`
  // test and was never discovered. #4 then failed for the wrong reason (fail
  // closed) and #2c's ships-⟺-managed check silently skipped that bridge
  // entirely (fail OPEN, which is the half that matters). Every source line in
  // this repo's hooks happens to be indented, which is the only reason it
  // stayed latent. Anchoring on the match itself removes the class.
  const found = new Set<string>()
  //
  // BUG-066 — THE ROOT PREFIX IS A VARIABLE, AND IT IS NOT ALWAYS `$ROOT`.
  // This accepted exactly one spelling, `$ROOT/`, so when the gate started
  // resolving its code root and sourcing `. "$BP_CODE_ROOT/scripts/..."`, no
  // candidate matched, no bridge was discovered, and #4 reported EVERY
  // TypeScript suite as never invoked — a fail-closed red for a tree that was
  // in fact running all of them. A hardcoded variable name is the same kind of
  // second description this whole control exists to avoid.
  const src =
    /(^|[ \t])(\.|source)[ \t]+"?(\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\/)?\.?\/?([A-Za-z0-9_][A-Za-z0-9_./-]*)/gm
  const candidates = new Set<string>()
  for (const m of text.matchAll(src)) if (m[4]) candidates.add(m[4])

  for (const rel of [...candidates].sort()) {
    const abs = join(root, rel)
    if (!(await exists(abs))) continue
    const body = liveCmds(await readOr(abs))
    for (const fn of definedFuncs(body)) {
      if (new RegExp(`(^|[^A-Za-z0-9_./-])${rx(fn)}([ \t]|$)`, 'm').test(text)) {
        found.add(abs)
        break
      }
    }
  }
  return [...found].sort()
}

/** Those files' live commands, plus every bridge they reach. */
export async function deepCmds(root: string, files: string[]): Promise<string> {
  const own = liveCmds((await Promise.all(files.map((f) => readOr(f)))).join('\n'))
  const bridges = await liveBridges(root, own)
  const bodies = await Promise.all(bridges.map((b) => readOr(b)))
  return [own, ...bodies.map(liveCmds)].join('\n')
}

/**
 * One line per invocation of the vitest runner:
 *
 *   BLANKET vitest   a run over the whole tree: no positional path argument
 *   BLANKET npm      ditto, reached through `npm test` / `npm run test`
 *   ARGS <words>     a run NARROWED to those paths — proves nothing about a
 *                    suite it does not name
 *
 * The distinction is the whole assertion. `vitest run pipeline` in the gate
 * must not be readable as "every suite is invoked".
 */
export function classifyCmds(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const f = line.split(/[ \t]+/).filter((w) => w !== '')
    let verb = -1
    let kind = ''
    for (let i = 0; i < f.length; i++) {
      if (verb >= 0) break
      if (f[i] === 'vitest' && f[i + 1] === 'run') {
        verb = i + 1
        kind = 'vitest'
      } else if (f[i] === 'npm' && f[i + 1] === 'test') {
        verb = i + 1
        kind = 'npm'
      } else if (f[i] === 'npm' && f[i + 1] === 'run' && f[i + 2] === 'test') {
        verb = i + 2
        kind = 'npm'
      }
    }
    if (verb < 0) continue
    const args: string[] = []
    let release = false
    for (let i = verb + 1; i < f.length; i++) {
      const w = f[i] as string
      // TASK-054: an exclude is a narrowing like a path filter, UNLESS it names
      // exactly the release glob. That one run covers every non-release suite.
      let excluded: string | undefined
      if (w === '--exclude') excluded = f[++i] ?? ''
      else if (w.startsWith('--exclude=')) excluded = w.slice('--exclude='.length)
      if (excluded !== undefined) {
        if (excluded.replace(/^(['"])(.*)\1$/, '$2') === RELEASE_GLOB) release = true
        else args.push(`--exclude=${excluded}`)
        continue
      }
      if (w === '--' || w.startsWith('-')) continue
      args.push(w)
    }
    if (args.length > 0) out.push(`ARGS ${args.join(' ')}`)
    else out.push(`${release ? 'NONRELEASE' : 'BLANKET'} ${kind}`)
  }
  return out
}

/** The glob the gate excludes to leave the release tier to CI (TASK-054). */
export const RELEASE_GLOB = '**/*.release.spec.*'

/** What a text's vitest runs reach: every suite, every non-release suite, or neither. */
export type Reach = 'all' | 'nonrelease' | 'none'

/**
 * The `test` script out of tests/package.json, WITHOUT Node.
 *
 * Kept as a text parse rather than `JSON.parse` on purpose: the shell version
 * could not use a JSON parser and this must stay verdict-identical to it. If
 * this cannot be parsed the result is empty, which classifies as "not a blanket
 * run" — fail closed.
 */
export function npmTestScript(pkgText: string): string[] {
  const flat = pkgText.replace(/\n/g, '')
  const m = /"scripts"[^{]*\{/.exec(flat)
  if (!m) return []
  const body = flat.slice(m.index + m[0].length).replace(/\}.*/, '')
  const out: string[] = []
  for (const part of body.split(',')) {
    const t = /"test"[ \t]*:[ \t]*"([^"]*)"/.exec(part)
    if (t?.[1]) out.push(t[1])
  }
  return out
}

/** How far the whole-tree vitest runs in this text reach. */
export function reachOf(text: string, pkgText: string): Reach {
  // Shell metacharacters become line breaks first, so
  // `pipe_stage "x" npm test || { … }` is classified as the `npm test` it is,
  // and a stray `}` is not read as a path filter.
  const kinds = classifyCmds(text.replace(/[|&;(){}]/g, '\n'))
  const scripts = classifyCmds(npmTestScript(pkgText).join('\n'))
  const via = (tier: string) =>
    kinds.includes(`${tier} vitest`) || (kinds.includes(`${tier} npm`) && scripts.includes('BLANKET vitest'))
  if (via('BLANKET')) return 'all'
  if (via('NONRELEASE')) return 'nonrelease'
  return 'none'
}

/**
 * Link 4 of the chain: the configured include must actually reach the specs.
 *
 * Narrowing this glob is a coverage cut that would otherwise leave every other
 * link intact and every assertion green. The glob is `**\/*.spec.ts` and not
 * `tests/**\/*.spec.ts` because the config sits inside tests/, which is
 * therefore vitest's root (TASK-020).
 */
export function includeOk(cfgText: string): boolean {
  if (cfgText === '') return false
  const flat = cfgText.replace(/[ \n]/g, '')
  // BOTH SPELLINGS COUNT (TASK-047). A config may name `**/*.spec.ts`, or the
  // brace form `**/*.spec.{ts,tsx}` that also reaches a JSX component test.
  // Accepting only the first would turn #4 and #5 red the moment the config
  // widens — a control failing because the tree got MORE correct.
  return /include:\[[^\]]*["']\*\*\/\*\.spec\.(ts["']|\{ts,tsx\}["'])/.test(flat)
}

/** Lines containing a marker token — `grep -c`, which counts LINES. */
export function markerBalance(text: string, prefix: string): [number, number] {
  const lines = text.split('\n')
  return [
    lines.filter((l) => l.includes(`${prefix}:BEGIN`)).length,
    lines.filter((l) => l.includes(`${prefix}:END`)).length,
  ]
}

/**
 * TASK-068 / audit row N025 — a bare `ctx.skip(` can never land.
 *
 * DoD §3 rule 7: a skip must say why (a SKIP-NOTE via `skipVisibly` / `skipNote`),
 * so a suite never reads green while a behaviour goes unchecked in silence.
 * This walks the PARSED tree, not the text: a `ctx.skip(` mentioned in a comment
 * or a string is prose about the rule, not a call, and must not trip it
 * (Alexey's review). The match is any zero-argument `.skip(...)` member call —
 * `ctx.skip()`, with or without `await` — while every accepted form
 * (`ctx.skip(reason)`, `skipVisibly(ctx, reason)`) carries arguments and passes.
 * Returns `path:line` per hit, for the manifest case to render as the failure.
 */
export function bareSkips(source: string, file: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hits: string[] = []
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'skip' &&
      n.arguments.length === 0 &&
      !n.typeArguments
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf))
      hits.push(`${file}:${line + 1}`)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

interface Derivation {
  /** suite -> runner paths, relative to root. `''` is the no-suite bucket. */
  readonly runners: Array<{ suite: string; path: string }>
  /** suite -> tier (`blueprint` | `both`). */
  readonly rows: Array<{ suite: string; tier: string }>
  readonly names: string[]
  /** The release-tier suites (TASK-054): every spec is `*.release.spec.ts(x)`. */
  readonly release: ReadonlySet<string>
}

/**
 * THE SUITE DERIVATION LIVES IN scripts/lib/suites.sh, AND THIS FILE DOES NOT
 * KEEP A COPY OF IT.
 *
 * Sourced by absolute path and REQUIRED. A missing library must not degrade to
 * an empty derivation: every assertion below passes trivially over zero suites,
 * which is precisely the vacuity #7 exists to catch — but it would catch it one
 * step too late and blame the tree rather than the missing file.
 */
async function derive(root: string, run: Runner): Promise<Derivation | null> {
  const script = [
    'set -u',
    '. "$1/scripts/lib/suites.sh" || exit 1',
    'command -v bp_suite_runners >/dev/null 2>&1 || exit 1',
    'command -v bp_suite_rows >/dev/null 2>&1 || exit 1',
    'command -v bp_release_suites >/dev/null 2>&1 || exit 1',
    'echo "--RUNNERS--"',
    'bp_suite_runners "$1"',
    'echo "--ROWS--"',
    'bp_suite_rows "$1"',
    'echo "--RELEASE--"',
    'bp_release_suites "$1"',
  ].join('\n')
  const r = await run('sh', ['-c', script, 'sh', root], { cwd: root })
  if (r.code !== 0) return null

  const [, runnerBlock = '', rowBlock = '', releaseBlock = ''] = r.stdout.split(
    /^--(?:RUNNERS|ROWS|RELEASE)--$/m,
  )
  const runners = runnerBlock
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => {
      const [suite = '', path = ''] = l.split('\t')
      return { suite, path }
    })
  const rows = rowBlock
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => {
      const [suite = '', tier = ''] = l.split('\t')
      return { suite, tier }
    })
  const release = new Set(releaseBlock.split('\n').filter((l) => l !== ''))
  return { runners, rows, names: rows.map((r) => r.suite), release }
}

/** `git archive HEAD | tar -t`, i.e. what a derived project actually receives. */
async function archiveListing(root: string, run: Runner): Promise<string[]> {
  const r = await run(
    'sh',
    ['-c', 'git -C "$1" archive --format=tar HEAD 2>/dev/null | tar -t 2>/dev/null', 'sh', root],
    { cwd: root, timeoutMs: 120_000 },
  )
  return r.stdout.split('\n').filter((l) => l !== '')
}

const ok = (id: string, message: string): CheckResult => ({ id, ok: true, message })
const bad = (id: string, message: string): CheckResult => ({ id, ok: false, message })

/**
 * Run the whole control over one tree.
 *
 * `root` is the tree under inspection; `run` is the sandboxed process runner
 * that reaches it. Returns one verdict per check, in the order the shell
 * version printed them, so a verdict-by-verdict comparison is mechanical.
 */
export async function inspect(root: string, run: Runner): Promise<CheckResult[]> {
  const checks: CheckResult[] = []

  const d = await derive(root, run)
  if (!d) {
    return [
      bad(
        'suites-lib',
        'scripts/lib/suites.sh did not load — there is no suite derivation, so every ' +
          'assertion here would pass over zero suites. Run: blueprint pull scripts/lib/suites.sh',
      ),
    ]
  }

  const gatePath = join(root, '.githooks/pre-push-project')
  const hookPath = join(root, '.githooks/pre-push')
  const ciPath = join(root, '.github/workflows/security.yml')
  const pkgText = await readOr(join(root, 'tests/package.json'))
  const cfgText = await readOr(join(root, 'tests/vitest.config.ts'))

  // ONE RUNNER CONVENTION SINCE TASK-047: a runner is a `*.spec.ts`, or a
  // `*.spec.tsx` where the test contains JSX — the same convention, because
  // `.tsx` is TypeScript and a JSX component test cannot be written as `.ts`.
  //
  // `suitesWithSh`, and with it the per-suite `bash tests/<s>/<file>.sh` proof,
  // went with the last shell runner. The loss that retirement cost is recorded
  // in docs/config/findings.md F-003, not here.
  const isSpec = (p: string) => p.endsWith('.spec.ts') || p.endsWith('.spec.tsx')
  const suitesWithTs = new Set(
    d.runners.filter((r) => r.suite !== '' && isSpec(r.path)).map((r) => r.suite),
  )

  // =========================================================================
  // 1. EVERY RUNNER BELONGS TO A SUITE.
  //
  //    The derivation classifies by DIRECTORY. A runner sitting directly in
  //    `tests/` belongs to no suite at all — nothing invokes it, no export rule
  //    covers it, and it would execute nowhere while looking exactly like a
  //    test. `bp_suite_runners` emits it with an empty suite field rather than
  //    dropping it, which is the only reason this is checkable at all.
  //
  //    TASK-086 — ONLY IN THE BLUEPRINT. Outside it, DoD §2 counts a
  //    regression test only at the TOP LEVEL of tests/, because every
  //    subfolder is a managed suite a pull replaces, and tests/dod-gate #14
  //    skips its own "no runner at the tests/ root" guard downstream for the
  //    same reason. There the file is project-owned, and it does run: the
  //    blanket vitest run and its `**/*.spec.ts` include reach it, which #4
  //    and #5 hold for every suite. Refusing it here left a derived project's
  //    fix able to satisfy §2 or this check, never both. It passes with a
  //    message naming it, not in silence.
  // =========================================================================
  // `.blueprint-root` is the same positive marker `drift` uses.
  const inBlueprint = await exists(join(root, '.blueprint-root'))
  const toplevel = d.runners.filter((r) => r.suite === '' && r.path !== '').map((r) => r.path)
  if (toplevel.length === 0) {
    checks.push(ok('#1', '#1 every runner (*.sh or *.spec.ts) under tests/ belongs to a suite directory'))
  } else if (inBlueprint) {
    checks.push(
      bad(
        '#1',
        `#1 runners sit directly in tests/ and belong to no suite: ${toplevel.join(' ')}\n` +
          '        Move each into tests/<suite>/ — the gate, CI and the export\n' +
          '        boundary all address suites by directory, so a file here runs nowhere.',
      ),
    )
  } else {
    checks.push(
      ok(
        '#1',
        `#1 runners directly in tests/ are this project's own regression tests (DoD §2), run by the blanket vitest run: ${toplevel.join(' ')}`,
      ),
    )
  }

  // #1b — the compensating control for the helpers exemption in the derivation.
  // A helper is exempt from being a suite because it is sourced rather than
  // run, so the thing to assert is that it IS sourced: an unreferenced file
  // there is dead code that no gate stage and no CI job would ever have
  // complained about.
  const helperNames: string[] = []
  for (const dir of ['tests/helpers', 'tests/__helpers__']) {
    let entries: string[]
    try {
      entries = await readdir(join(root, dir))
    } catch {
      // No helpers directory in this tree, so nothing to orphan.
      continue
    }
    for (const e of entries.sort()) if (e.endsWith('.sh')) helperNames.push(e)
  }
  // A CONSUMER MAY BE TYPESCRIPT, and after TASK-018 it usually is. This walk
  // read only `*.sh`, so `tests/helpers/proc-cwd.sh` — sourced by
  // `tests/helpers/feed-fixture.ts` for BUG-089's fail-open guard, and driven
  // by `tests/proc-cwd/proc-cwd.spec.ts` — would be reported as dead the moment
  // its last shell consumer retired. A helper killed for being unreferenced by
  // a scan that cannot see its references is the worst shape this check has.
  //
  // THE HELPERS DIRECTORY STAYS EXCLUDED FOR `.sh` AND ONLY FOR `.sh`. That
  // exclusion exists so a helper's own header, which names itself, cannot
  // satisfy the check on its own behalf — and that argument is about the file
  // being judged, not about its neighbours. A `.ts` fixture in the same
  // directory is a consumer like any other.
  //
  // COMMENTS ARE STRIPPED, and that is not a refinement — without it this check
  // vouches for its OWN subject. The paragraph above names `proc-cwd.sh`, and
  // `manifest.ts` is a `.ts` file under `tests/`, so widening the walk made the
  // check's own prose the thing keeping the helper alive. MEASURED: with both
  // real consumers mutated away, #1b stayed green. That is precisely the
  // self-vouching the `helpers/*.sh` exclusion exists to prevent, reintroduced
  // one level up — the BUG-035 shape, membership decided by what comments SAY
  // rather than by what code DOES, which `tests/git-isolation` already learned.
  //
  // THE MATCH IS ON THE FILENAME, not on `helpers/<name>`. A real reference is
  // often assembled rather than spelled: `tests/helpers/feed-fixture.ts` sources
  // this very helper via `join(REPO_ROOT, 'tests', 'helpers', 'proc-cwd.sh')`,
  // which contains no `helpers/proc-cwd.sh` substring at all. Under the prefix
  // match that live consumer was invisible and only a comment made it look
  // otherwise. A `*.sh` basename is distinctive enough that a stripped-source
  // mention IS a reference, and over-inclusion is the safe direction here: the
  // cost of a false green is a dead helper left on disk, the cost of a false red
  // is a live one deleted.
  const sources: string[] = []
  // No swallow: a directory this walk is handed either reads or the check
  // cannot judge, and a check that quietly covers less is the F-002 shape.
  const walk = async (dir: string, inHelpers: boolean): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === 'node_modules') continue
        await walk(join(dir, e.name), e.name === 'helpers' || e.name === '__helpers__')
      } else if (e.name.endsWith('.ts')) {
        sources.push(stripTsComments(await readOr(join(dir, e.name))))
      } else if (!inHelpers && e.name.endsWith('.sh')) {
        sources.push(liveCmds(await readOr(join(dir, e.name))))
      }
    }
  }
  await walk(join(root, 'tests'), false)
  const allSources = sources.join('\n')
  const orphans = helperNames.filter((n) => !allSources.includes(n))
  checks.push(
    orphans.length > 0
      ? bad(
          '#1b',
          `#1b shared helpers that no suite sources: ${orphans.join(' ')} — exempt from being a suite, so nothing else would catch them`,
        )
      : ok('#1b', '#1b every shared helper is sourced by at least one suite'),
  )

  // A `blueprint`-tier suite drives machinery that exists ONLY here. It is
  // export-ignore'd, so in a DERIVED project it is legitimately absent — and,
  // since the suite set is derived from disk, absent means it never appears in
  // that project's derivation at all. `inBlueprint` is read at #1.
  if (inBlueprint) {
    checks.push(...(await exportBoundary(root, run, d)))
  }

  // =========================================================================
  // 4. EVERY SUITE IS ACTUALLY INVOKED BY THE GATE.
  //    A tree full of suites the gate never runs would be a more convincing
  //    version of the same silence.
  //
  //    Two runner kinds, two proofs, and a suite mid-migration owes BOTH — a
  //    spec that executes nowhere is dead code wearing the name of a suite,
  //    which is the state `drift-in-blueprint` was found in (running in neither
  //    the gate nor CI).
  //
  //    THE RELEASE TIER IS THE ONE EXCEPTION (TASK-054). A suite whose specs are
  //    all `*.release.spec.ts` is owed by CI, and #5 checks it there. Here it
  //    is left out, and the gate's run may exclude exactly RELEASE_GLOB.
  //
  //    NO OTHER TIER TEST HERE, and none is needed. A `blueprint`-tier suite is
  //    `both` plus "does not ship": it still blocks the push HERE. Downstream
  //    it is not on disk, so it is not in the derivation and there is nothing
  //    to skip.
  // =========================================================================
  const gateCmds = await deepCmds(root, [gatePath, hookPath])
  const hasCi = await exists(ciPath)
  const ciCmds = hasCi ? await deepCmds(root, [ciPath]) : ''

  const tsPresent = suitesWithTs.size > 0
  const gateReach: Reach = tsPresent ? reachOf(gateCmds, pkgText) : 'none'
  const ciReach: Reach = tsPresent && hasCi ? reachOf(ciCmds, pkgText) : 'none'
  const includeCovers = includeOk(cfgText)

  // BUG-066: a stage may name its path through the gate's resolved code root,
  // `"$BP_CODE_ROOT/tests/<suite>/…"`, rather than trusting cwd. The optional
  // variable prefix is what keeps this an assertion about INVOCATION rather
  // than about spelling.
  const rootVar = '"?(\\$\\{?[A-Za-z_][A-Za-z0-9_]*\\}?/)?'
  const tsNamed = (cmds: string, s: string) =>
    new RegExp(`vitest[^|]*${rootVar}tests/${rx(s)}/[a-zA-Z0-9._-]+\\.spec\\.tsx?`).test(cmds)
  /** A spec is covered when it is named outright, or reached by the chain. */
  const tsCovered = (cmds: string, s: string, reach: Reach, noRunner: string) => {
    if (tsNamed(cmds, s)) return ''
    if (reach === 'none') return noRunner
    // TASK-054: a run excluding the release glob covers every OTHER suite.
    if (reach === 'nonrelease' && d.release.has(s)) return `release tier, and this run excludes ${RELEASE_GLOB}`
    if (!includeCovers) return 'tests/vitest.config.ts include no longer covers **/*.spec.ts'
    return ''
  }

  // TASK-054: the gate owes every suite EXCEPT the release tier, which CI owes
  // (#5). The tier is the file name, so leaving it out here hides nothing.
  const notrun: string[] = []
  for (const s of d.names) {
    if (suitesWithTs.has(s) && !d.release.has(s)) {
      const why = tsCovered(gateCmds, s, gateReach, 'no vitest stage in .githooks/pre-push*')
      if (why) notrun.push(`${s}(${why})`)
    }
  }
  checks.push(
    notrun.length > 0
      ? bad(
          '#4',
          `#4 suites the gate never invokes: ${notrun.join(' ')}\n` +
            '        A spec is proven by a vitest run with NO path filter — in the hook, or in\n' +
            '        a bridge the hook sources AND calls into — plus an include glob that\n' +
            '        reaches it. A stage naming the spec outright also counts.\n' +
            '        A runner nothing invokes is not retired, it is dead: delete it, or wire it in.',
        )
      : ok('#4', '#4 every non-release suite is invoked by the gate'),
  )

  // =========================================================================
  // 5. EVERY SUITE IS ACTUALLY IN THE WORKFLOW.
  //
  //    TASK-044: #5 and #5b are about GitHub Actions. A project that declares
  //    another CI still receives the managed workflow, inert, and a pass over it
  //    would certify a pipeline that never runs. Both are answered as SKIPPED,
  //    naming the declared CI, and never dropped: a check that vanishes is the
  //    silence this file exists to refuse.
  // =========================================================================
  const notGithub = await notGithubActions(root)
  if (notGithub) {
    for (const id of ['#5', '#5b']) {
      checks.push({ id, ok: true, message: `${id} ${notGithub}`, skipped: notGithub })
    }
  } else if (hasCi) {
    const missing: string[] = []
    for (const s of d.names) {
      if (suitesWithTs.has(s)) {
        const why = tsCovered(ciCmds, s, ciReach, 'no vitest step in the workflow')
        if (why) missing.push(`${s}(${why})`)
      }
    }
    checks.push(
      missing.length > 0
        ? bad('#5', `#5 suites absent from the workflow: ${missing.join(' ')}`)
        : ok('#5', '#5 every suite runs in the workflow, runner kind by runner kind'),
    )
  }

  // =========================================================================
  // 5b. EVERY WORKFLOW IS ONE GITHUB CAN RUN (BUG-115).
  //     #5 proves the workflow NAMES every suite. That is worth nothing if
  //     GitHub rejects the file, because a rejected file runs zero jobs and
  //     the text still names every suite.
  // =========================================================================
  let workflows: string[] = []
  try {
    workflows = (await readdir(join(root, '.github/workflows'))).filter((f) => /\.ya?ml$/.test(f))
    workflows.sort((a, b) => a.localeCompare(b))
  } catch (err) {
    // No workflows directory means no CI to check, the same way #5 does not apply.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  if (!notGithub && workflows.length > 0) {
    const broken: string[] = []
    for (const f of workflows) {
      const rel = `.github/workflows/${f}`
      for (const msg of workflowProblems(await readOr(join(root, rel)))) broken.push(`${rel} ${msg}`)
    }
    checks.push(
      broken.length > 0
        ? bad(
            '#5b',
            `#5b GitHub would run NO jobs from these workflows:\n        ${broken.join('\n        ')}\n` +
              '        #5 reads the workflow as text and cannot see this. The pre-push gate\n' +
              '        cannot see CI either: it prints "watching CI" and exits 0.',
          )
        : ok('#5b', `#5b every workflow (${workflows.length}) parses into a runnable Actions shape`),
    )
  }

  // =========================================================================
  // 7. NON-VACUITY — the derivation must actually be finding suites. Every
  //    assertion above passes trivially over an empty tree, which is precisely
  //    the failure mode this file exists to prevent.
  // =========================================================================
  checks.push(
    d.names.length < 10
      ? bad(
          '#7',
          `#7 derived only ${d.names.length} suites from tests/ — the derivation is broken, so #1-#5 proved nothing`,
        )
      : ok('#7', `#7 derived ${d.names.length} suites from the runners on disk (assertions above are non-vacuous)`),
  )

  // =========================================================================
  // 7b. BUG-052 — THE MARKERS THAT MAKE A MANAGED FILE MERGEABLE ARE BALANCED.
  //
  //     `marker_aware_merge` (scripts/blueprint.mts) refuses to merge unless a
  //     file's BEGIN and END counts are equal, and `pull_file` then falls back
  //     to a WHOLE-FILE COPY — which is exactly the data loss the markers exist
  //     to prevent. It warns and leaves a `.bp-bak`, and nobody reads either.
  //
  //     It counts SUBSTRINGS, so a sentence explaining "put your rows after
  //     BLUEPRINT:END" counts as an END. Both managed marker files in this repo
  //     were in that state and had been for their whole lives, so neither had
  //     ever been marker-merged and every derived project's own gate guards
  //     were replaced on every pull.
  //
  //     `tests/marker-merge` does not catch this: it drives the MECHANISM
  //     against fixture files that satisfy the precondition, and never asks
  //     whether the real managed files do.
  // =========================================================================
  const markerBad: string[] = []
  for (const [rel, abs] of [
    ['.githooks/pre-push-project', gatePath],
    ['.githooks/pre-push', hookPath],
  ] as const) {
    if (!(await exists(abs))) continue
    const [b, e] = markerBalance(await readOr(abs), 'BLUEPRINT')
    if (b === 0 && e === 0) continue
    if (b === e) continue
    markerBad.push(`${rel}(${b} BEGIN/${e} END)`)
  }
  checks.push(
    markerBad.length > 0
      ? bad(
          '#7b',
          `#7b marker counts do not balance, so 'blueprint pull' will NOT merge these files — it falls back to a whole-file copy and destroys the project's own content outside the markers: ${markerBad.join(' ')}\n` +
            '        The counts are of SUBSTRINGS, so prose describing a marker counts as one.\n' +
            "        Say 'the managed region' in sentences and keep the literal token for markers.",
        )
      : ok('#7b', '#7b every marker vocabulary balances, so pull merges these files instead of clobbering them'),
  )

  return checks
}

/**
 * #2b and #2c — the export boundary, and the phase transition.
 *
 * Split out only for length; it is called exactly once, from `inspect`, and
 * only inside a blueprint.
 */
async function exportBoundary(
  root: string,
  run: Runner,
  d: Derivation,
): Promise<CheckResult[]> {
  const checks: CheckResult[] = []
  const listing = await archiveListing(root, run)

  if (listing.length === 0) {
    return [bad('#2b', '#2b could not archive HEAD — the export boundary is unverified, not verified')]
  }
  const shipped = new Set(listing)
  const ships = (p: string) => shipped.has(p)
  const shipsUnder = (prefix: string) => listing.some((l) => l.startsWith(prefix))

  // =========================================================================
  // 2b. THE EXPORT BOUNDARY, BOTH DIRECTIONS (BUG-028).
  //
  //     A tier is a claim about WHERE a suite runs, and "blueprint only" is
  //     such a claim — but it was enforced by nothing at all. `tests/bootstrap-*`,
  //     `tests/template-source`, `tests/drift-in-blueprint` and
  //     `tests/pull-exec-bit` all shipped to every derived project, wired into
  //     its gate, testing machinery that cannot exist there. Five of the six
  //     day-one failures. Nobody saw it because the failure happens on someone
  //     else's machine, after the blueprint's own gate has gone green over the
  //     same suites passing at home.
  //
  //     The tier is now DERIVED from `.gitattributes`, and this check is not
  //     thereby tautological: the tier comes from a directory-level line, and
  //     this compares that against a real `git archive`, which is the
  //     BEHAVIOUR. They come apart in both directions — a line that does not
  //     take effect declares a suite blueprint-only while it ships to everyone;
  //     a suite with no line whose files nevertheless do not arrive is a silent
  //     coverage cut for every project but this one.
  //
  //     `git check-attr` was tried first and is unusable here: it reports
  //     `unspecified` for a directory pattern like `templates/` even though
  //     `git archive` genuinely drops it.
  //
  //     The archive is taken of HEAD — the tree that is about to be pushed. It
  //     used to be the WORKING TREE, which guarded a case the gate cannot see
  //     and opened one it can. HEAD fails CLOSED, and the fix is to commit.
  //
  //     "SHIPPED" AND "RUNNABLE" ARE NOT THE SAME WORD. The invariant that
  //     holds in every phase is:
  //
  //         a shipping suite ships AT LEAST ONE runner the recipient can
  //         execute, AND ships NO runner the recipient cannot.
  //
  //     `tsShips` is derived from the archive rather than declared, so the rule
  //     re-reads itself at each phase with nothing to remember.
  // =========================================================================
  const tsShipping: string[] = []
  const tsAbsent: string[] = []
  let tsShips = true
  for (const f of TS_TOOLCHAIN) {
    if (ships(f)) tsShipping.push(f)
    else {
      tsShips = false
      tsAbsent.push(f)
    }
  }
  if (shipsUnder('tests/harness/')) tsShipping.push('tests/harness/')
  else {
    tsShips = false
    tsAbsent.push('tests/harness/')
  }

  // `.spec.tsx` counts as a shipped spec too (TASK-047): a project whose suites
  // are JSX component tests must not read as "no spec ships", which would send
  // #2c down its phase-1 branch over a tree that is fully migrated.
  const specsShip = listing.some((l) => /^tests\/.*\.spec\.tsx?$/.test(l))

  // Which harness files exist but do NOT arrive. Both sides are read off the
  // filesystem, so a file added to tests/harness/ tomorrow is covered without
  // anyone remembering to add it anywhere. `tsShips` above is satisfied by ONE
  // harness file; this is what makes "the harness ships" mean the harness
  // rather than a fragment.
  const harnessPartial: string[] = []
  let harnessFiles: string[] = []
  try {
    harnessFiles = (await readdir(join(root, 'tests/harness'))).filter((f) => f.endsWith('.ts'))
  } catch {
    // No harness directory in this tree. #2c judges that, not this walk.
    harnessFiles = []
  }
  for (const h of harnessFiles.sort()) {
    const rel = `tests/harness/${h}`
    if (!ships(rel)) harnessPartial.push(rel)
  }

  const shippedBp: string[] = []
  const withheld: string[] = []
  const hollow: string[] = []
  const unrunnable: string[] = []
  const tsonly: string[] = []

  for (const { suite: s, tier } of d.rows) {
    if (s === '') continue
    // ONE RUNNER KIND SINCE TASK-047, so the count is simply how many of this
    // suite's specs arrive. A directory that arrives without a runner is worse
    // than an absent one: the derived gate has nothing to run from it and the
    // push stays green over a suite that no longer exists.
    let tsTot = 0
    let tsGot = 0
    for (const r of d.runners.filter((r) => r.suite === s)) {
      tsTot++
      if (ships(r.path)) tsGot++
    }
    const any = shipsUnder(`tests/${s}/`)

    if (tier === 'blueprint') {
      // Nothing at all may ship — not the runners, not a stray fixture.
      if (any) shippedBp.push(s)
      continue
    }
    // (i) NEVER ship a runner the recipient cannot execute. Without the
    // toolchain a spec is not executable, so shipping one is shipping nothing
    // the recipient can use.
    if (!tsShips && tsGot > 0) {
      unrunnable.push(`${s}(${tsGot} spec)`)
      continue
    }
    // (ii) Every runner the suite has still has to arrive.
    if (tsShips && tsGot < tsTot) {
      hollow.push(`${s}(${tsGot}/${tsTot} spec)`)
      continue
    }
    // (iii) AT LEAST ONE executable runner must arrive.
    if (tsShips && tsGot > 0) continue

    if (tsTot > 0) tsonly.push(s)
    else if (!any) withheld.push(s)
    else hollow.push(`${s}(0/${tsTot} runners)`)
  }

  if (shippedBp.length > 0) {
    checks.push(
      bad(
        '#2b',
        `#2b suites declared blueprint-only by .gitattributes DO ship, so they run in every derived project's gate against machinery that cannot be there: ${shippedBp.join(' ')}`,
      ),
    )
  } else if (unrunnable.length > 0) {
    checks.push(
      bad(
        '#2b',
        `#2b suites ship a *.spec.ts while the TS toolchain does NOT ship, so a derived project receives a runner it cannot execute: ${unrunnable.join(' ')}\n` +
          '        Either export-ignore the spec, or make the phase-2 move whole (see #2c).',
      ),
    )
  } else if (hollow.length > 0) {
    checks.push(
      bad(
        '#2b',
        `#2b suites ship WITHOUT their runners, so the derived gate's 'if [ -f tests/<suite>/<runner> ]' guard skips them in silence: ${hollow.join(' ')}`,
      ),
    )
  } else if (tsonly.length > 0) {
    checks.push(
      bad(
        '#2b',
        `#2b suites are TypeScript-ONLY while the TS toolchain does not ship, so they reach a derived project with no runner it can execute: ${tsonly.join(' ')}\n` +
          '        Ship the TS toolchain (see #2c), or add \'tests/<suite>/ export-ignore\'\n' +
          '        to make the suite blueprint-only deliberately. There is no shell runner to\n' +
          '        fall back on any more (TASK-047) — a spec is the only kind there is.',
      ),
    )
  } else if (withheld.length > 0) {
    checks.push(
      bad(
        '#2b',
        `#2b suites that are not declared blueprint-only do not reach the archive, so every derived project silently loses them: ${withheld.join(' ')}`,
      ),
    )
  } else if (tsShips) {
    checks.push(
      ok(
        '#2b',
        '#2b the export boundary matches .gitattributes in both directions, runner by runner (HEAD; phase 2 — the TS toolchain ships, so specs count as runners)',
      ),
    )
  } else {
    checks.push(
      ok(
        '#2b',
        '#2b the export boundary matches .gitattributes in both directions, runner by runner (HEAD; the TS toolchain does not ship, so no shipping suite may carry a spec the recipient cannot execute)',
      ),
    )
  }

  // =====================================================================
  // 2c. THE PHASE TRANSITION IS ALL-OR-NOTHING.
  //
  //     #2b answers "is each suite coherent?". This answers "do the two
  //     propagation paths agree?", and nothing else in the repo does.
  //
  //       bootstrap  ships the WHOLE archive (new-project.sh: `git archive
  //                  HEAD`).
  //       pull       ships the managed set, which since TASK-021 IS that
  //                  archive minus the project-owned seeds.
  //
  //     So ships ⟺ managed holds by construction for every file, and the
  //     checks that compared a hand-kept MANAGED_FILES against the archive (a
  //     toolchain file outside tests/, a gate bridge that shipped unmanaged)
  //     went with the list. tests/bootstrap-contents #10 checks the
  //     construction itself. What is left here is that a toolchain ships whole
  //     or not at all.
  //
  //     NOT checked, deliberately: a toolchain that ships while no spec ships
  //     yet — that is the sane ordering of the phase-2 move, and forbidding it
  //     would force the riskier order. (The phase-2 mirror IS checked; see
  //     below.)
  // =====================================================================
  if (!tsShips && tsShipping.length > 0) {
    checks.push(
      bad(
        '#2c',
        `#2c BUG-073: the TS toolchain ships in PART — ${tsShipping.join(' ')} reach every derived project while ${tsAbsent.join(' ')} do not\n` +
          '        A partial toolchain is worse than none: the recipient gets machinery it\n' +
          "        cannot use, and .github/workflows/security.yml is MANAGED, so its ts-tests\n" +
          "        job runs 'npm ci' in a project holding half a toolchain and goes red on the\n" +
          '        first push, on a job that project never wrote (BUG-061).',
      ),
    )
  } else if (specsShip && !tsShips) {
    checks.push(
      bad(
        '#2c',
        '#2c BUG-073: *.spec.ts files ship to derived projects while the TS toolchain does not — every recipient gets specs with no runner\n' +
          '        Ship tests/package.json, tests/tsconfig.json, tests/vitest.config.ts and\n' +
          '        tests/harness/, or export-ignore the specs. Half of the move is worse than none.',
      ),
    )
  } else if (tsShips && !specsShip) {
    // THE PHASE-2 HALF OF THE SAME CLAIM (BUG-073). Every branch above tests
    // the invariant from the phase-1 side: machinery withheld, or machinery
    // arriving that the recipient cannot use. The mirror image is machinery
    // arriving that the recipient has NOTHING TO USE ON — vitest, a
    // package.json, an `npm ci` in a MANAGED CI job, and not one spec to run.
    //
    // It is deliberately NOT symmetric with the phase-1 pass below: phase 1
    // legitimately has a toolchain that does not ship AND no specs; phase 2 has
    // no legitimate state in which the toolchain ships alone, because the
    // invariant is an IFF — the toolchain ships BECAUSE a shipping suite is
    // TypeScript.
    checks.push(
      bad(
        '#2c',
        '#2c the TS toolchain ships but NO *.spec.ts does — every derived project installs a runner with nothing to run\n' +
          '        The invariant is an IFF: the toolchain ships BECAUSE a shipping suite is\n' +
          "        TypeScript. A toolchain alone means every project pays 'npm ci' in the\n" +
          '        MANAGED ts-tests job, on a green job that executed no test.',
      ),
    )
  } else if (tsShips && harnessPartial.length > 0) {
    // AND THE HARNESS HAS TO ARRIVE WHOLE. `tsShips` is satisfied by one file
    // under tests/harness/ — a one-file proxy for a whole directory, which is
    // exactly the shape BUG-061 walked through. `tests/harness/index.ts` is the
    // ONLY way a spec obtains a fixture, so a single export-ignore of it would
    // leave every shipped spec importing a module that is not there.
    checks.push(
      bad(
        '#2c',
        `#2c the harness ships in PART — every shipped spec imports it, and these files do not arrive: ${harnessPartial.join(' ')}\n` +
          '        tests/harness/index.ts is the only way a spec obtains a fixture. A partial\n' +
          '        harness is a project whose every TypeScript suite dies on an unresolved\n' +
          '        import, while the toolchain still reads as shipping because one file arrived.',
      ),
    )
  } else if (tsShips) {
    checks.push(
      ok(
        '#2c',
        '#2c BUG-073: phase 2 is whole — the TS toolchain, its specs and the whole harness ship, and what ships is what pull delivers',
      ),
    )
  } else {
    checks.push(
      ok(
        '#2c',
        "#2c phase 1 is whole — no spec ships, and the TS toolchain is export-ignore'd, so neither path delivers it",
      ),
    )
  }

  // THE OPERATOR HINT THE SHELL VERSION PRINTED. This reads HEAD, which is the
  // tree about to be pushed, so a boundary edited and not yet committed looks
  // exactly like a broken one. Only asked when something already failed.
  if (checks.some((c) => !c.ok)) {
    const dirty = await run(
      'git',
      ['-C', root, 'diff', '--quiet', 'HEAD', '--', '.gitattributes'],
      { cwd: root },
    )
    if (dirty.code !== 0) {
      const i = checks.findIndex((c) => !c.ok)
      const c = checks[i] as CheckResult
      checks[i] = bad(
        c.id,
        `${c.message}\n` +
          '        .gitattributes is modified but NOT COMMITTED. This reads HEAD, which\n' +
          '        is the tree about to be pushed — commit the boundary and re-run.',
      )
    }
  }

  return checks
}

/** The failing checks, formatted the way the shell runner printed them. */
export function failures(checks: CheckResult[]): string {
  return checks
    .filter((c) => !c.ok)
    .map((c) => `FAIL: ${c.message}`)
    .join('\n')
}
