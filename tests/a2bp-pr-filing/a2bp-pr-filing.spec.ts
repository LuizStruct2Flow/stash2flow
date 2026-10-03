/**
 * tests/a2bp-pr-filing/a2bp-pr-filing.spec.ts — BUG-011, in TypeScript
 * (TASK-018).
 *
 * `a2bp` reported a request as FILED when no PR was ever opened.
 *
 * `bp_file_existing_pr` asks gh for a PR on the request branch:
 *
 *   gh pr list … --json state,url --jq '.[0] | "\(.state)\t\(.url)"'
 *
 * On an EMPTY list `.[0]` is null, and jq interpolates null as the literal
 * string "null" — so the function printed `null<TAB>null` instead of nothing.
 * The caller guarded with `[ -n "$existing" ] && [ "$existing" != "<TAB>" ]`: it
 * anticipated empty fields but not the literal. A non-existent PR therefore
 * passed as an existing one, fell to the `*)` branch, printed
 * `✓ request already open: null`, and returned BP_RC_PENDING (3).
 *
 * That exit code is the severe part. 3 means "filed, awaiting a decision", and
 * CLAUDE.md is explicit that no script may read "PR opened" as "the blueprint
 * has this". Here the code ASSERTED filed while nothing was filed — worse than a
 * silent failure, because a caller cannot detect it.
 *
 * NOTHING HERE REACHES GITHUB. `gh` is a shim inside the scenario workspace,
 * found first on PATH; `jq` must be REAL, because the defect IS jq's rendering
 * of null and shimming it would test nothing.
 *
 * THE SOURCE-INSPECTION CASES CALL `sed`, they do not reimplement it. #4, #4b,
 * #4c and #5 assert on a RANGE of `scripts/blueprint`, and the shell suite
 * selected those ranges with `sed -n '/a/,/b/p'`. A TypeScript reimplementation
 * of sed's range semantics — including that a range re-triggers after it closes
 * — would be a second implementation to keep faithful for no gain, so the same
 * sed runs inside the sandbox and the verdicts cannot diverge.
 *
 * EQUIVALENCE RECORD (R6): `BP_SUBJECT_ROOT` points both implementations at one
 * perturbed copy of the blueprint. The catalogue is docs/waiting-acceptance/TASK-018-EQUIVALENCE-a2bp/ — 7 of 7
 * assertions here have a mutant that was RUN and OBSERVED to turn them red.
 *
 * #2 AND #3 NOW WITNESS THE DEFECT THEY NAME (BUG-104, closed). They did not.
 * The shim reproduced gh's `--jq` handling and ignored every other flag, so
 * deleting `--json state,url` (#2's subject) or narrowing `--state all` to
 * `--state open` (#3's subject) reached nothing and both stayed green — each was
 * red only under a mutation of the jq FILTER, i.e. proven by a defect other than
 * its own. The fix is in the FIXTURE, not in the assertions: `ghShim` now
 * implements `--state` filtering and `--json` field selection the way gh does,
 * so the query flags are under test instead of being ignored. Observed: `F2`
 * (`--json state,url` → `--json url`) reds #2, `F3` (`--state all` →
 * `--state open`) reds #3, and both stay green on the real tree.
 */

import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type RunResult, type Scenario } from '../harness/index.js'

const SUBJECT_ROOT = process.env.BP_SUBJECT_ROOT ?? REPO_ROOT
const LIB = join(SUBJECT_ROOT, 'scripts/lib/request-file.sh')
const CLI_REL = 'scripts/blueprint.mts'

/**
 * A `gh` whose `pr list` returns `json`.
 *
 * IT HONOURS `--state` AND `--json`, NOT ONLY `--jq` (BUG-104). The first
 * version consumed the filter and ignored every other flag, which made #2 and #3
 * unfalsifiable by the defect they name: deleting `--json state,url` or
 * narrowing `--state all` to `--state open` reached nothing the shim looked at,
 * so both stayed green whether or not a2bp asked gh for the right thing. A
 * fixture that ignores the argument under test is asserting on its own
 * behaviour.
 *
 * All three flags are reproduced the way gh implements them, so the assertions
 * stay behavioural rather than becoming argv inspections:
 *
 *   --state  filters (`all` means no filter, and gh compares case-insensitively);
 *   --json   SELECTS which fields come back — a field not asked for is absent,
 *            and jq then renders `\(.state)` of an absent key as `null`;
 *   --jq     pipes the result through jq, which is where BUG-011's literal
 *            `null` is produced and is why `jq` must stay REAL here.
 */
async function ghShim(s: Scenario, json: string): Promise<string> {
  const shims = await s.shimDir('bin')
  await shims.add(
    'gh',
    [
      `if [ "$1" = "pr" ] && [ "$2" = "list" ]; then`,
      `  json='${json}'`,
      `  filter=""`,
      `  fields=""`,
      `  state="open"`,
      `  while [ $# -gt 0 ]; do`,
      `    case "$1" in`,
      `      --jq)    shift; filter="$1" ;;`,
      `      --json)  shift; fields="$1" ;;`,
      `      --state) shift; state="$1" ;;`,
      `    esac`,
      `    shift`,
      `  done`,
      `  printf '%s' "$json" \\`,
      `    | jq -c --arg s "$state" --arg f "$fields" '`,
      `        [ .[]`,
      `          | select($s == "all" or (.state | ascii_downcase) == ($s | ascii_downcase))`,
      `          | if $f == "" then .`,
      `            else with_entries(select(.key as $k | ($f | split(",")) | index($k))) end`,
      `        ]' \\`,
      `    | jq -r "$filter"`,
      `  exit 0`,
      `fi`,
      `exit 1`,
    ].join('\n'),
  )
  return shims.path()
}

/** Probe for an existing PR through the shimmed gh. */
function existingPr(s: Scenario, path: string): Promise<RunResult> {
  return s.run('bash', ['-c', `. "${LIB}"; bp_file_existing_pr owner/repo some-ref`, '_'], {
    cwd: s.workspace.root,
    env: { PATH: path },
  })
}

/** The file the source-inspection cases below read: the `.mts` CLI. */
async function resolvedCli(): Promise<{ path: string; kind: 'shell' | 'ts' }> {
  const path = join(SUBJECT_ROOT, CLI_REL)
  expect(existsSync(path),`${CLI_REL} is missing from this checkout`).toBe(true)
  return { path, kind: 'ts' }
}

/** `sed -n '/start/,/end/p'` over the CLI — the shell suite's own selector. */
async function block(s: Scenario, path: string, range: string): Promise<string> {
  const r = await s.run('sed', ['-n', range, path], { cwd: s.workspace.root })
  expect(r.code, r.output).toBe(0)
  return r.stdout
}

/** The TS-side block selector: no shell block syntax (`esac`, `^  }`) exists
 * for sed's range to key on in the ported `.mts`, so this scans lines
 * instead — the first line matching `start`, through the first line AT OR
 * AFTER it matching `end` (inclusive). */
async function tsBlock(path: string, start: RegExp, end: RegExp): Promise<string> {
  const source = await readFile(path, 'utf8')
  const lines = source.split('\n')
  const s0 = lines.findIndex((l) => start.test(l))
  if (s0 < 0) return ''
  const e0 = lines.findIndex((l, i) => i >= s0 && end.test(l))
  if (e0 < 0) return ''
  return lines.slice(s0, e0 + 1).join('\n')
}

/**
 * ONE multi-line shell condition, bounded by the continuation backslashes that
 * actually define it.
 *
 * WHY THIS IS NOT A `sed` RANGE. `sed -n '/if \[ -n "$existing" \]/,/; then/p'`
 * is what the shell suite uses, and it is FAIL-OPEN: the end pattern is a line
 * the condition itself carries, so deleting the clause under test also deletes
 * the range's terminator, and the range runs on until the next unrelated
 * `; then` — 90 lines later, through comment prose that contains the word
 * `null`. Verified by mutation: with the whole null-rejecting continuation
 * deleted, the shell suite's #5 stays GREEN.
 *
 * A condition ends where its line stops ending in a backslash. That boundary is
 * the syntax rather than a guess about neighbouring text, so deleting the clause
 * shrinks the selection instead of exploding it.
 */
async function condition(s: Scenario, path: string, startPattern: RegExp): Promise<string> {
  const source = await s.run('cat', [path], { cwd: s.workspace.root })
  expect(source.code, source.output).toBe(0)
  const lines = source.stdout.split('\n')
  const start = lines.findIndex((l) => startPattern.test(l))
  if (start < 0) return ''
  const picked: string[] = []
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? ''
    picked.push(line)
    if (!line.endsWith('\\')) break
  }
  return picked.join('\n')
}

describe('BUG-011 — a2bp reports filed only when a PR actually exists', () => {
  it("#1 no PR on the branch produces empty output, not 'null'", async () => {
    await scenario('a2bp-pr-filing-1', async (s) => {
      // THE REPRODUCER. An empty list must report NOTHING — not the string
      // "null", which the caller cannot distinguish from a URL.
      const r = await existingPr(s, await ghShim(s, '[]'))

      expect(r.stdout, 'a non-existent PR reads as an existing one').not.toContain('null')
      expect(r.stdout.replace(/\s/g, ''), 'an empty PR list produced output at all').toBe('')
    })
  })

  it('#2 an existing PR is still reported with its state and url', async () => {
    await scenario('a2bp-pr-filing-2', async (s) => {
      // The fix must not blind the probe, which would re-file a request the
      // owner already closed.
      //
      // BOTH FIELDS ARE ASSERTED, because both are what `--json state,url` asks
      // for and the shim now honours that selection. Dropping `state` from the
      // query leaves the key absent, jq renders it as the literal `null`, and
      // this case sees it — which is the defect its title names.
      const path = await ghShim(s, '[{"state":"OPEN","url":"https://example.com/pr/7"}]')
      const r = await existingPr(s, path)
      expect(r.stdout.trim(), 'the probe did not report the PR with its state AND url').toBe(
        'OPEN\thttps://example.com/pr/7',
      )
    })
  })

  it('#3 a closed PR is still reported, so it is not silently re-filed', async () => {
    await scenario('a2bp-pr-filing-3', async (s) => {
      // Re-filing a request the owner declined re-spends the reviewer attention
      // this whole design exists to protect.
      //
      // The shim filters on `--state` the way gh does, so narrowing the query to
      // open PRs makes this list EMPTY and the probe silent — the exact
      // behaviour a narrowed query produces in production, and the reason this
      // case names `--state all`.
      const path = await ghShim(s, '[{"state":"CLOSED","url":"https://example.com/pr/8"}]')
      const r = await existingPr(s, path)
      expect(r.stdout.trim(), 'a CLOSED PR was not reported — it would be silently re-filed').toBe(
        'CLOSED\thttps://example.com/pr/8',
      )
    })
  })

  it('#4 branch-pushed-but-no-PR returns BP_RC_FAILED (5), not "filed"', async () => {
    await scenario('a2bp-pr-filing-4', async (s) => {
      // 3 is a PROMISE that a reviewer now has something to look at. Returning
      // it when nothing was filed is the defect that makes this bug worse than a
      // crash: the caller has no way to tell the difference.
      const lib = await s.run('grep', ['-q', 'BP_RC_FAILED=5', LIB], { cwd: s.workspace.root })
      expect(lib.code, 'BP_RC_FAILED is not 5 — the contract this asserts has moved').toBe(0)

      const { path, kind } = await resolvedCli()
      // scripts/blueprint.mts has no shell block syntax (`^  }`) for
      // sed's range to key on, so the ported file is read with tsBlock
      // instead, and BP_RC_FAILED/BP_RC_PENDING are its runtime-read
      // codes.failed/codes.pending (§3 P5: never a hardcoded TS constant).
      const failBranch =
        kind === 'ts'
          ? await tsBlock(path, /opening the PR failed/, /return codes\.failed/)
          : await block(s, path, '/opening the PR failed/,/^  }/p')
      expect(
        failBranch,
        'could not locate the pr-create failure branch — the assertion would be vacuous',
      ).not.toBe('')
      if (kind === 'ts') {
        expect(
          failBranch,
          "the branch is pushed and the PR failed, yet it returns codes.pending — 'filed' asserted while nothing was filed",
        ).not.toContain('codes.pending')
        expect(
          failBranch,
          'the pr-create failure branch returns neither codes.failed nor codes.pending — unclear contract',
        ).toContain('codes.failed')
      } else {
        expect(
          failBranch,
          "the branch is pushed and the PR failed, yet it returns BP_RC_PENDING (3) — 'filed' asserted while nothing was filed",
        ).not.toContain('BP_RC_PENDING')
        expect(
          failBranch,
          'the pr-create failure branch returns neither FAILED nor PENDING — unclear contract',
        ).toContain('BP_RC_FAILED')
      }
    })
  })

  it('#4b the missing-gh path returns BP_RC_FAILED (5), like the pr-create failure', async () => {
    await scenario('a2bp-pr-filing-4b', async (s) => {
      // THE OTHER no-PR PATH (Codex F1). Case #4 only inspects the block after
      // "opening the PR failed", so it was blind to the EARLIER `command -v gh`
      // branch, which still returned BP_RC_PENDING (3). That is the COMMON path:
      // most environments without gh never reach the pr-create call. The first
      // fix corrected the rarer branch and left the bug where it bites most.
      const { path, kind } = await resolvedCli()
      const noGh =
        kind === 'ts'
          ? await tsBlock(path, /commandExists\('gh'\)/, /return codes\.failed/)
          : await block(s, path, '/if ! command -v gh/,/^  fi/p')
      expect(noGh, 'could not locate the missing-gh branch').not.toBe('')
      if (kind === 'ts') {
        expect(
          noGh,
          "gh is not installed, no PR can exist, yet it returns codes.pending — 'filed' asserted with no PR",
        ).not.toContain('codes.pending')
        expect(noGh, 'the missing-gh branch returns neither codes.failed nor codes.pending').toContain('codes.failed')
      } else {
        expect(
          noGh,
          "gh is not installed, no PR can exist, yet it returns BP_RC_PENDING (3) — 'filed' asserted with no PR",
        ).not.toContain('BP_RC_PENDING')
        expect(noGh, 'the missing-gh branch returns neither FAILED nor PENDING').toContain(
          'BP_RC_FAILED',
        )
      }
    })
  })

  it('#4c a zero-exit gh pr create with no usable URL returns FAILED, not "filed"', async () => {
    await scenario('a2bp-pr-filing-4c', async (s) => {
      // THE THIRD no-PR PATH (Codex R2-F1). `gh pr create` can exit ZERO and
      // print nothing, `null`, or a warning; the code then announced "request
      // filed" and returned 3 on the strength of an exit status alone. Same
      // boundary already defended for bp_file_existing_pr: when the OUTPUT is
      // the evidence, a success status is not a substitute for it.
      const { path, kind } = await resolvedCli()
      const blk =
        kind === 'ts'
          ? await tsBlock(path, /gh reported success but returned no usable PR URL/, /return codes\.failed/)
          : await block(s, path, '/gh reported success but returned no usable PR URL/,/esac/p')
      expect(
        blk,
        "no guard on gh pr create's output — a zero exit with an empty or 'null' URL still reports filed",
      ).not.toBe('')
      expect(blk, 'the no-usable-URL path does not return the FAILED code').toContain(
        kind === 'ts' ? 'codes.failed' : 'BP_RC_FAILED',
      )
    })
  })

  it("#5 BUG-082: the caller explicitly rejects a literal 'null' as an existing PR, read from a BOUNDED condition", async () => {
    await scenario('a2bp-pr-filing-5', async (s) => {
      // Defence in depth: #1 fixes the source, this fixes the consumer, and the
      // bug needed BOTH to be wrong to reach the user.
      //
      // Read the WHOLE condition, not its first line: it is a multi-line `if`
      // with a trailing backslash, and grepping one line found the part without
      // the check and reported a fixed guard as broken.
      //
      // BOUNDED BY THE CONTINUATION, NOT BY A `; then` PATTERN — see
      // `condition()`. This is the one place this port is deliberately STRICTER
      // than the suite it replaces, and the defect it catches is concrete:
      // deleting the entire null-rejecting continuation leaves the shell suite's
      // #5 green, because it also deletes the terminator of that suite's own sed
      // range. Same shape as BUG-074 — a range that fails OPEN when the thing it
      // measures goes missing.
      //
      // TASK-081: the ported guard is one plain JS `if`, no continuation
      // backslash at all — `condition()`'s "stop at the first line that
      // doesn't end in \\" already returns just that one line unchanged, so
      // only the START pattern needs a second, kind-aware spelling.
      const { path, kind } = await resolvedCli()
      const startPattern = kind === 'ts' ? /if \(existing/ : /if \[ -n "\$existing" \]/
      const guard = await condition(s, path, startPattern)
      expect(guard, "could not find the caller's guard on $existing").not.toBe('')
      expect(guard, "the caller's guard does not reject a literal 'null'").toContain('null')
    })
  })
})
