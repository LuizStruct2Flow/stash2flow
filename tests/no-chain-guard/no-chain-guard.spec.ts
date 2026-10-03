/**
 * tests/no-chain-guard/no-chain-guard.spec.ts — the PreToolUse guard that
 * enforces AGENTS.md §"Running commands — one per call".
 *
 * Parallelism hazard: none. Every case writes into its own scenario workspace
 * and spawns a short-lived `bash`; nothing global is read or written.
 *
 * WHAT THE SUBJECT IS, AND WHERE THE §3.3 LINE FALLS. `scripts/no-chain-guard.sh`
 * is a Claude Code PreToolUse hook: the harness invokes it by path, hands it a
 * JSON payload on stdin, and reads an exit code. It is not the pre-push entry
 * point TASK-018-TARGET §3.3 exempts, and it is not being ported to TypeScript
 * here — only the SUITE is. The script stays shell because the thing that
 * executes it is an external harness with a shell-command contract, and the
 * cases below drive the real bytes of the real hook rather than a reimplementation.
 *
 * The guard is an ENFORCEMENT control, so the properties that matter are the
 * refusals, not the happy path:
 *
 *   - a chained command is blocked (&&, ||, ;)
 *   - a pipe is NOT blocked — a pipeline is one operation whose filter cannot
 *     run without its producer, which is the dependency test the rule states
 *   - a non-Bash tool passes, but only after its identity was parsed
 *   - anything it cannot parse FAILS CLOSED, including missing jq
 *
 * That last one is the whole reason this suite exists. Codex F4 found it failing
 * OPEN on malformed input and on a missing `jq`, contradicting its own stated
 * contract. A guard that evaporates when something is already wrong is worse
 * than no guard, because it is trusted.
 *
 * EQUIVALENCE RECORD (R6, and the migration's own evidence). The retiring
 * `tests/no-chain-guard/test.sh` and this spec were run over a population of
 * eight trees: the healthy repo plus seven mutants of `scripts/no-chain-guard.sh`,
 * each injecting the defect one assertion exists to catch. Verdict sets were
 * diffed mechanically. Full table in the migration report.
 *
 * They agreed on seven of the eight, and the eighth is BUG-078 — a mutant BOTH
 * implementations passed on the first run, which is the class a mutant-per-
 * assertion sweep exists to find and a review cannot. It is fixed here and
 * therefore now a deliberate, recorded DIVERGENCE: the shell suite is green on
 * that tree and this spec is red.
 *
 * MUTATION RECIPE (R6) — each applied to `scripts/no-chain-guard.sh`, both
 * runners run, red sets compared:
 *
 *   M1  `*'&&'*|*'||'*|*';'*) ;;` -> `*'&&'*) ;;`  (stop blocking `;` and `||`)
 *       Red: #1, #6.
 *   M2  `case "$cmd" in *'|'*) die_closed ...` added (block pipes too)
 *       Red: #2, #3.
 *   M3  `[ -n "$payload" ] || die_closed` -> `:`  (empty payload allowed)
 *       Red: #4-empty — BUT ONLY HERE. This mutant SURVIVED the shell suite, and
 *       that is BUG-078: `jq` on empty input exits 0 with no output, so the guard
 *       still blocks two branches later at "payload has no string .tool_name",
 *       with the same exit code. The shell case asserted only the code. Each
 *       fail-closed branch here asserts its own MESSAGE, which is the rule the
 *       shell suite's header states and applied to the missing-jq case alone.
 *   M4  drop the `command -v jq` guard entirely
 *       Red: #4-nojq. This is the mutant that survived in the SHELL suite's
 *       first version — `PATH=/nonexistent` removed `cat` too, so the empty-
 *       payload branch fired and impersonated the missing-jq branch. The port
 *       keeps the shell's fix: a PATH that HAS the utilities and lacks only jq,
 *       and an assertion on the stated CAUSE.
 *   M5  `if (.tool_name|type) == "string"` -> `.tool_name`  (accept a number)
 *       Red: #4-typed-toolname.
 *   M6  `if (.tool_input.command|type) == "string"` -> `.tool_input.command`
 *       Red: #4-typed-command.
 *   M7  `[ "$tool" = "Bash" ] || exit 0` -> `exit 0`  (never inspect anything)
 *       Red: #1, #6.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'

const GUARD = join(REPO_ROOT, 'scripts/no-chain-guard.sh')

/** Exit code the guard uses to refuse a tool call. Its whole contract. */
const BLOCKED = 2

/**
 * Feed the guard a payload on stdin and return its exit code and stderr.
 *
 * The harness spawns with stdin closed — deliberately, since a fixture that can
 * read the operator's terminal is not isolated — so the payload travels through
 * a file the scenario owns and a one-line driver that redirects it. That is the
 * whole reason this helper exists rather than a bare `s.run`.
 */
async function runGuard(
  s: Scenario,
  payload: string,
  options: { path?: string } = {},
): Promise<{ code: number | null; stderr: string }> {
  const payloadFile = await s.fs.write('payload.json', payload)
  const driver = await s.fs.write(
    'run-guard.sh',
    `exec bash ${JSON.stringify(GUARD)} < ${JSON.stringify(payloadFile)}\n`,
  )
  const r = await s.run('sh', [driver], {
    cwd: s.workspace.root,
    env: options.path === undefined ? {} : { PATH: options.path },
    timeoutMs: 30_000,
  })
  return { code: r.code, stderr: r.stderr }
}

/** A well-formed Bash tool payload carrying `command`. */
const bashPayload = (command: string): string =>
  JSON.stringify({ tool_name: 'Bash', tool_input: { command } })

describe('the no-chain guard blocks chains, permits pipes, and fails closed', () => {
  it('#1 &&, || and ; are all blocked', async () => {
    await scenario('nochain-1', async (s) => {
      // Every operator in its own right, plus the two real shapes the rule was
      // written for — a `cd` carrying a destructive command, and a stage carrying
      // a commit. Both are reviewed as the harmless first verb by an allowlist
      // that matches one pattern at a time, which IS the reason for the guard.
      const chained = [
        'echo a && echo b',
        'echo a || echo b',
        'echo a; echo b',
        'cd /tmp && rm -rf x',
        'git add . && git commit -m x',
      ]

      for (const command of chained) {
        const r = await runGuard(s, bashPayload(command))
        expect(r.code, `not blocked: ${command}\n${r.stderr}`).toBe(BLOCKED)
      }
    })
  })

  it('#2 pipes pass unblocked', async () => {
    await scenario('nochain-2', async (s) => {
      // Blocking a pipeline would make ordinary work inexpressible, which is how
      // a guard gets removed rather than obeyed. A filter cannot run without its
      // producer, so a pipeline passes the dependency test by construction.
      for (const command of [
        'grep -n foo file | head -5',
        'git log --oneline | wc -l',
        'cat x | jq -r .a | sort',
      ]) {
        const r = await runGuard(s, bashPayload(command))
        expect(r.code, `a pipe was blocked: ${command}\n${r.stderr}`).toBe(0)
      }
    })
  })

  it('#3 a single plain command passes', async () => {
    await scenario('nochain-3', async (s) => {
      const r = await runGuard(s, bashPayload('git -C /somewhere status --short'))
      expect(r.code, r.stderr).toBe(0)
    })
  })

  it('#4 malformed JSON fails closed', async () => {
    await scenario('nochain-4-badjson', async (s) => {
      // Returned 0 before the fix: the guard evaporated exactly when something
      // was already wrong, which is the worst moment to lose a control.
      const r = await runGuard(s, '{bad json')
      expect(r.code, r.stderr).toBe(BLOCKED)
      expect(r.stderr, 'it blocked, but not as a parse failure').toContain('not valid JSON')
    })
  })

  it('#4 an empty payload fails closed', async () => {
    await scenario('nochain-4-empty', async (s) => {
      const r = await runGuard(s, '')
      expect(r.code, r.stderr).toBe(BLOCKED)
      // THE CAUSE, AND THIS ONE IS NOT DECORATION — MEASURED (BUG-078).
      //
      // `jq` on empty input exits 0 with no output, so with the dedicated
      // empty-payload branch DELETED the guard still blocks, two branches later,
      // at "payload has no string .tool_name". Exit code 2 either way. The
      // retiring shell suite asserted only the code here, so that mutant SURVIVED
      // it — and the suite's own header states the rule it was breaking: "assert
      // the CAUSE, because otherwise one fail-closed branch impersonates
      // another". It followed that rule for the missing-jq case alone.
      expect(
        r.stderr,
        'it blocked, but via a later fail-closed branch — the empty-payload branch could be deleted and this case would stay green',
      ).toContain('empty tool payload')
    })
  })

  it('#4 a payload with no tool_name fails closed', async () => {
    await scenario('nochain-4-notool', async (s) => {
      // "I cannot tell what tool this is" is not "this is not Bash" — see #5.
      const r = await runGuard(s, JSON.stringify({ tool_input: { command: 'a && b' } }))
      expect(r.code, r.stderr).toBe(BLOCKED)
      expect(r.stderr, 'it blocked, but not for the missing tool_name').toContain(
        'no string .tool_name',
      )
    })
  })

  it('#4 a Bash payload with no command fails closed', async () => {
    await scenario('nochain-4-nocmd', async (s) => {
      const r = await runGuard(s, JSON.stringify({ tool_name: 'Bash', tool_input: {} }))
      expect(r.code, r.stderr).toBe(BLOCKED)
      expect(r.stderr, 'it blocked, but not for the missing command').toContain(
        'no string .tool_input.command',
      )
    })
  })

  it('#4 missing jq fails closed, and for the stated reason', async () => {
    await scenario('nochain-4-nojq', async (s) => {
      // `PATH=/nonexistent` was WRONG (Codex R2-F4): it removes `cat` too, so
      // the guard's own `cat` failed, the payload came back empty, and it
      // blocked at the EMPTY-PAYLOAD check — never reaching the missing-jq
      // branch at all. Deleting that branch entirely left the case green.
      //
      // Two lessons, both kept here: build a PATH that HAS the utilities and
      // lacks only jq, and assert the CAUSE, because otherwise one fail-closed
      // branch impersonates another.
      const nojq = await s.workspace.dir('nojq')
      const link = await s.fs.write(
        'link-utils.sh',
        // Everything the guard itself reaches for, minus jq. Resolved from the
        // host rather than hard-coded, because coreutils layout differs.
        `for u in sh bash cat printf sed grep; do\n` +
          `  src="$(command -v "$u" 2>/dev/null)"\n` +
          `  [ -n "$src" ] && ln -sf "$src" ${JSON.stringify(nojq)}/"$u"\n` +
          `done\n` +
          `exit 0\n`,
      )
      await s.run('sh', [link], { cwd: s.workspace.root })

      // NON-VACUITY: prove jq really is unreachable under this PATH, and that
      // the shell still is. Without both, the case tests nothing it claims to.
      const probe = await s.fs.write(
        'probe.sh',
        `command -v jq >/dev/null 2>&1 && echo JQ_PRESENT\n` +
          `command -v cat >/dev/null 2>&1 && echo CAT_PRESENT\n` +
          `exit 0\n`,
      )
      const p = await s.run('sh', [probe], {
        cwd: s.workspace.root,
        env: { PATH: nojq },
      })
      expect(p.output, 'built a PATH that still finds jq — the case would be vacuous').not.toContain(
        'JQ_PRESENT',
      )
      expect(p.output, 'built a PATH with no `cat` — the empty-payload branch would fire instead').toContain(
        'CAT_PRESENT',
      )

      const r = await runGuard(s, bashPayload('echo ok && rm -rf target'), { path: nojq })

      expect(r.code, `a chained command sailed through with jq absent\n${r.stderr}`).toBe(BLOCKED)
      // The CAUSE, not merely the verdict. Asserting only the exit code lets the
      // empty-payload branch stand in for this one, which is how the missing-jq
      // branch was deleted while its test stayed green.
      expect(r.stderr, 'it blocked, but via the WRONG branch — another fail-closed path is impersonating this one').toContain(
        'jq is not on PATH',
      )
    })
  })

  it('#4 a non-string tool_name fails closed', async () => {
    await scenario('nochain-4-typed-tool', async (s) => {
      // Codex R2-F3: `jq -r` renders a number as text, so this produced the
      // plausible string "7" and reached exit 0 — a schema-invalid payload
      // crossing an enforcement boundary. Syntactically valid JSON is not a
      // valid payload.
      const r = await runGuard(s, '{"tool_name":7,"tool_input":{"command":"a && b"}}')
      expect(r.code, r.stderr).toBe(BLOCKED)
    })
  })

  it('#4 a non-string command fails closed', async () => {
    await scenario('nochain-4-typed-cmd', async (s) => {
      const r = await runGuard(s, '{"tool_name":"Bash","tool_input":{"command":7}}')
      expect(r.code, r.stderr).toBe(BLOCKED)
    })
  })

  it('#5 a non-Bash tool passes even with operators in its arguments', async () => {
    await scenario('nochain-5', async (s) => {
      // Passing here is correct BECAUSE the identity parsed. That is why #4
      // blocks an absent tool_name rather than treating it as non-Bash.
      const r = await runGuard(
        s,
        JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/x; y && z' } }),
      )
      expect(r.code, `a Read call was blocked — the guard is out of its scope\n${r.stderr}`).toBe(0)
    })
  })

  it('#6 quoted prose containing ; is blocked (documented; workaround is .scratch/ + git commit -F)', async () => {
    await scenario('nochain-6', async (s) => {
      // The documented FALSE POSITIVE, pinned rather than wished away. If this
      // ever stops matching, CLAUDE.md documents a limitation that no longer
      // exists — and its workaround becomes cargo cult.
      const r = await runGuard(s, bashPayload('git commit -m "fix: a; b"'))
      expect(r.code, r.stderr).toBe(BLOCKED)
    })
  })

  it('#7 the guard is wired as a PreToolUse hook in settings.json', async () => {
    // Every assertion above tests a script that nothing may be invoking — the
    // A-15 defect this repo has had once. Parsed as JSON rather than grepped,
    // so a reference inside a comment or an unrelated key cannot satisfy it.
    const raw = await readFile(join(REPO_ROOT, '.claude/settings.json'), 'utf8')
    const settings = JSON.parse(raw) as {
      hooks?: { PreToolUse?: Array<{ hooks?: Array<{ command?: string }> }> }
    }

    const commands = (settings.hooks?.PreToolUse ?? []).flatMap((entry) =>
      (entry.hooks ?? []).map((h) => h.command ?? ''),
    )

    expect(
      commands.some((c) => c.includes('no-chain-guard')),
      `the guard is referenced by no PreToolUse hook — it runs nowhere. Saw: ${JSON.stringify(commands)}`,
    ).toBe(true)
  })
})
