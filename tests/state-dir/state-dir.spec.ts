/**
 * tests/state-dir/state-dir.spec.ts — A-09.
 *
 * The activity feed and the dispatchers must rendezvous on ONE per-project state
 * dir: the dispatchers APPEND run logs there, the feed READS them and streams
 * `[CODEX]` / `[GEMINI]` lines. For that to be a rendezvous and not a collision,
 * both sides must compute the SAME directory from the SAME rule. They did not —
 * see `state-dir.ts` for the defect and the fix.
 *
 * THE NAMED SEAM IS LOAD-BEARING AND SURVIVES THE PORT. #1, #2 and #5 pass
 * EXPLICIT roots to `agent_state_dir_for`, because A-09's property is that two
 * DIFFERENT projects derive two DIFFERENT directories — and that cannot be
 * expressed at all with an API that only ever answers about the current tree.
 * TASK-021 removed the positional argument from `agent_state_dir` and added
 * `agent_state_dir_for` precisely so these three cases stay possible while
 * production call sites are forbidden from passing a root (`tests/state-root` #G
 * is the sweep that forbids them). A port that quietly dropped the explicit roots
 * would delete the tests that prove the property while leaving the suite green.
 *
 * WHAT HAS ALREADY MOVED OUT, so nothing here duplicates it:
 *   #6   → `tests/state-root` #B (a hostile exported GIT_DIR cannot move the root)
 *   #6c  → `tests/forbidden-idiom` #H (no consumer anchors with `git rev-parse`)
 * `#6b` stays, because it proves the decoy environment is genuinely hostile — so
 * a green #8 below cannot be green by accident.
 *
 * EQUIVALENCE RECORD (TASK-018-RULES R6).
 *
 * TWELVE trees — eleven perturbed and the real repository — were built once and
 * BOTH implementations run over each: the retiring `tests/state-dir/test.sh`,
 * copied into the fixture and run with the fixture as its ROOT, and
 * `scanStateDir()`. The static verdicts (#3, #4, #5b, #7, #10, #10e) were compared
 * mechanically. **They agreed on all twelve inputs**, and `rootBlockCount` matched
 * the shell's own count on every one.
 *
 * The behavioural cases (#1, #2, #5, #5c, #6b, #8, #9, #9b, #10b, #10c, #10d)
 * drive the SAME shipped scripts in both implementations, so they were compared on
 * the real repository only — a fixture stub is not the launcher, and agreeing
 * about a stub proves nothing. All eleven green in both.
 *
 * ONE DISAGREEMENT WAS FOUND AND FIXED, which is the reason this method is worth
 * its cost: on the tree with a DELETED DISPATCHER the shell failed #3 ("dispatcher
 * X not found — cannot assert on it") while the port passed #3 and reported the
 * absence under a different name. The property was never lost — the spec asserted
 * it — but the VERDICT differed, and a verdict difference is how a port quietly
 * stops being one. `missingDispatchers` exists because of that row.
 *
 * Three further differences are recorded rather than smoothed over:
 *
 *   - THE OVERRIDE VALUE CHANGED, THE PROPERTY DID NOT. #2 and #5 asserted
 *     `AGENT_STATE_HOME=/explicit/dir`, an absolute path outside any workspace.
 *     The harness refuses that by design — `AGENT_STATE_HOME` is declared a
 *     'path' and an override must resolve inside the scenario, which is the R3
 *     guarantee that stopped BUG-046. The ported cases use a workspace path.
 *     "The override wins" is what is asserted in both; only the literal differs.
 *   - #10d SHADOWS `readlink` ON PATH to reach the hop-exhaustion branch, and the
 *     trick is Codex's rather than mine. A real >40 chain hits the kernel's ELOOP
 *     first, so #10c only ever observed rc=126 (bash refusing the cyclic file) and
 *     the branch went unexercised. Shadowing `readlink` with a stub that always
 *     answers with a path that is still a symlink makes the walk unable to
 *     converge, so the bound is what stops it and the branch runs like any other
 *     line. Ported through `s.shimDir()`, which is the harness's primitive for
 *     exactly this and keeps the stub inside the workspace.
 *   - #9's FIXTURE CARRIES `.blueprint-source`, and that is not cosmetic. It is a
 *     project-shaped tree that never runs `git init`, so under TASK-021's
 *     three-terminator walk it would resolve NOTHING and the dispatch would fail
 *     for a reason unrelated to A-09. `tests/state-root` #F was the spec that
 *     enumerated every such fixture constructor and failed when one produced no
 *     terminator; this is one of the three it found. #F DISSOLVED on 2026-09-11
 *     (BUG-109) — its whole population was `tests/<suite>/test.sh` fixtures,
 *     which the TASK-018 retirement deletes, and its own non-vacuity anchors
 *     were four of them. The terminator on this fixture is still load-bearing
 *     for the reason above; what is gone is the repo-wide census, because there
 *     is nothing left to census.
 *
 * R6 NEGATIVE PROOF — per CASE, not per case GROUP.
 *
 * The record above compares VERDICT SETS between the shell suite and this
 * port. Three Codex reviews of neighbouring groups refused certification on
 * the same point: agreeing on `#3` does not say which of the cases NAMED `#3`
 * can be made red. So every `it()` here was put to the narrower question —
 * is there a perturbation OBSERVED to turn it red — and the answer is
 * recorded in docs/waiting-acceptance/TASK-018-R6-isolation/outputs/gap.txt, which names
 * the mutant(s) per case. The denominator comes from the runner rather than
 * from a grep, so the `it.each` tables are expanded rather than counted once.
 *
 * Eighteen cases, eighteen with an observed red, each EXCLUSIVELY — this is
 * the only suite in the group where every case has a mutant of its own.
 * Two of them are FIXTURE perturbations rather than code defects, the shape
 * suite-sync #1c already uses: `#10c` asserts that bash refuses a cyclic
 * script file and `#6b` that `git rev-parse` under a foreign GIT_DIR answers
 * about the caller — properties of the kernel and of git, which no mutation
 * of this repository can falsify. Their fixtures are perturbed instead, and
 * each case notices.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import {
  CONSUMERS,
  DISPATCHERS,
  physicalRootBlock,
  scanStateDir,
  structuralViolations,
  type StateDirScan,
  resolveConsumerFile,
} from './state-dir.js'


const HELPER = join(REPO_ROOT, 'scripts/lib/state-dir.sh')

/**
 * A synthetic consumer's body. A consumer named by its `.mts` is judged as
 * TypeScript (state-dir.ts resolveConsumerFile), so a synthetic fixture gives
 * it the TS physical-root block instead of the shell template the others get.
 */
const TS_CONSUMER = [
  '// --- physical script root (A-09 / BUG-020, ported) ---',
  "const _bpRoot = 'dirname(dirname(realpathSync(fileURLToPath(import.meta.url))))'",
  '// --- end physical script root ---',
  "// reaches scripts/lib/state-dir.sh across a process boundary",
  "const LOG_FILE = 'signal.log'",
].join('\n')
const bodyFor = (rel: string, shell: string): string => (rel.endsWith('.mts') ? TS_CONSUMER : shell)

/**
 * #10b/#10d extract the shared shell walk and re-run it in a synthetic
 * fixture to prove IT follows a relative chain and refuses a cycle. That walk
 * is duplicated across every consumer that still carries it (#7's own
 * reasoning), so any one of them is as good a source as another — this reads
 * from whichever CONSUMER is still 'shell' today, rather than hardcoding
 * WATCHER (BUG-144 commit 0). A migrated consumer's `.mts` target has no such
 * block to extract (tsPhysicalRootBlock's docblock in state-dir.ts explains
 * why one is not needed there), so pinning these two cases to a name that
 * survives the NEXT port, not just this one, is what keeps them meaningful
 * instead of vacuous.
 */
function firstShellBlockSource(): string {
  for (const rel of CONSUMERS) {
    const resolved = resolveConsumerFile(REPO_ROOT, rel)
    if (resolved?.kind === 'shell') return join(REPO_ROOT, rel)
  }
  throw new Error(
    'no CONSUMER is still shell — #10b/#10d have nothing left to extract the walk from; ' +
      'if every consumer has migrated, the shell symlink walk itself is gone and these ' +
      'two cases should be retired rather than left vacuous',
  )
}

/**
 * Ask the SHIPPED helper, through the named seam, with an explicit root.
 *
 * `AGENT_STATE_HOME` is UNSET for the child unless the caller overrides it: the
 * harness sets it for every scenario, and `agent_state_dir_for` honours it, so
 * leaving it in place would collapse every distinctness assertion below to the
 * same answer. Unsetting a declared 'path' variable is explicitly permitted and
 * is how a fixture says "derive it".
 */
async function stateDirFor(
  s: Scenario,
  root: string,
  env: Record<string, string | undefined> = {},
): Promise<{ out: string; code: number | null }> {
  const r = await s.run(
    'sh',
    ['-c', '. "$1"; agent_state_dir_for "$2"', 'sh', HELPER, root],
    { cwd: s.workspace.root, env: { AGENT_STATE_HOME: undefined, HOME: s.home, ...env } },
  )
  return { out: r.stdout.trim(), code: r.code }
}

describe('A-09 — the feed and the dispatchers rendezvous on ONE per-project state dir', () => {
  it('#1 THE REPRODUCER — two projects derive two DISTINCT state dirs', async () => {
    await scenario('sd-1', async (s) => {
      // Under the literal placeholder both collapsed to one shared directory,
      // which IS the contamination. Two synthetic roots inside the workspace,
      // through the named seam, is the only way to state that property.
      const projA = await s.workspace.dir('x', 'proj-A')
      const projB = await s.workspace.dir('x', 'proj-B')

      const a = await stateDirFor(s, projA)
      const b = await stateDirFor(s, projB)

      expect(a.code).toBe(0)
      expect(b.code).toBe(0)
      // BUG-020's location, asserted on the derivation. This used to assert a
      // literal `/h/.proj-A`, which pinned the implementation rather than the
      // guarantee — and so failed when BUG-020 moved the dir INSIDE the project
      // even though the anti-collision property was untouched.
      expect(a.out).toBe(join(projA, 'logs/state'))
      expect(b.out).toBe(join(projB, 'logs/state'))
      expect(
        a.out,
        'two projects collapsed to the SAME state dir — the A-09 contamination',
      ).not.toBe(b.out)
      // And nothing reaches $HOME to find it: deleting the project must delete
      // its state, which it did not before — a project bootstrapped at the same
      // path later inherited the old records.
      expect(a.out.startsWith(s.home)).toBe(false)
    })
  })

  it('#2+#5 AGENT_STATE_HOME overrides the derived dir — the deliberate shared-dir case', async () => {
    await scenario('sd-2', async (s) => {
      // An operator pointing several checkouts at one dir is a choice A-09
      // supports and the move inside the project must not remove. The path is a
      // workspace path rather than the shell suite's `/explicit/dir`, because the
      // harness refuses an override outside the scenario — same property,
      // contained value.
      const explicit = await s.workspace.dir('explicit')
      const proj = await s.workspace.dir('x', 'proj-A')

      const derived = await stateDirFor(s, proj)
      const overridden = await stateDirFor(s, proj, { AGENT_STATE_HOME: explicit })

      expect(derived.out).toBe(join(proj, 'logs/state'))
      expect(overridden.out, 'AGENT_STATE_HOME no longer overrides').toBe(explicit)
    })
  })

  it('#5 the state dir resolves INSIDE the project, never outside it', async () => {
    await scenario('sd-5', async (s) => {
      const proj = await s.workspace.dir('x', 'proj-C')
      const d = await stateDirFor(s, proj)

      expect(d.out.startsWith(`${proj}/`), `the state dir resolved OUTSIDE the project: ${d.out}`).toBe(
        true,
      )
    })
  })

  it('#1 the seam REFUSES an empty or missing root rather than deriving from nothing', async () => {
    await scenario('sd-1-refuses', async (s) => {
      // Not in the shell suite. Added because the seam is the one sanctioned way
      // to pass a root, so its failure modes are now part of the contract: an
      // empty root would otherwise derive `/logs/state` at the filesystem root,
      // which is the concrete harm `tests/state-root` #E asserts is unreachable.
      const empty = await stateDirFor(s, '')
      expect(empty.code).not.toBe(0)

      const none = await s.run('sh', ['-c', '. "$1"; agent_state_dir_for', 'sh', HELPER], {
        cwd: s.workspace.root,
        env: { AGENT_STATE_HOME: undefined },
      })
      expect(none.code).not.toBe(0)
    })
  })

  it('#3+#4+#5b+#7+#10+#10e THE REAL REPO — one mechanism, every consumer wired to it', async () => {
    const scan = await scanStateDir(REPO_ROOT)

    expect(scan.missing, `consumer(s) not found: ${scan.missing.join(' ')}`).toEqual([])

    // #3 — no dispatcher builds a state/log path from the literal placeholder,
    // plus the non-vacuity half: prove the grep target exists at all, so a
    // renamed file cannot make "zero literal hits" pass by finding nothing.
    expect(
      scan.sawAnyLogPath,
      'found no run/signal/last-message path in any dispatcher — grep target vanished (vacuous)',
    ).toBe(true)
    expect(
      scan.missingDispatchers,
      `dispatcher(s) not found, so #3 cannot assert on them: ${scan.missingDispatchers.join(' ')}`,
    ).toEqual([])
    expect(scan.literalPlaceholder, scan.literalPlaceholder.join(' ')).toEqual([])

    // #4 — the guarantee is ONE mechanism, so every side must be wired to it.
    expect(
      scan.notSourcingHelper,
      `${scan.notSourcingHelper.join(' ')} do not source scripts/lib/state-dir.sh — ` +
        `each has its own copy of the rule`,
    ).toEqual([])

    // #5b — a cheap first line, not a proof. See #8/#9 for the real boundary.
    expect(
      scan.structural,
      `a consumer builds a state path outside the shared helper: ${scan.structural.join(' ')}`,
    ).toEqual([])

    // #7 — the physical-root block is byte-identical in every consumer, and there
    // are at least four of them (the floor is what makes a collapsed population
    // visible rather than vacuously green).
    expect(scan.rootBlockMissing, `${scan.rootBlockMissing.join(' ')} anchor some other way`).toEqual(
      [],
    )
    expect(scan.rootBlockDrifted, `${scan.rootBlockDrifted.join(' ')} has drifted`).toEqual([])
    expect(scan.rootBlockCount).toBe(CONSUMERS.length)
    expect(scan.rootBlockCount).toBeGreaterThanOrEqual(4)

    // #10 — `readlink -f` is a GNU extension. On BSD and older macOS `readlink`
    // EXISTS but rejects it, so the previous form left the path unresolved and the
    // launcher went looking for /tmp/scripts. It failed SILENTLY, which is worse
    // than the bug it replaced — and `command -v readlink` succeeded, so the
    // guard meant to detect absence saw nothing wrong.
    expect(scan.gnuReadlink, `${scan.gnuReadlink.join(' ')} depend on GNU readlink -f`).toEqual([])

    // #10e — every copy carries the hop-exhaustion guard, since #10d exercises
    // only the one it extracts.
    expect(scan.noHopGuard, `${scan.noHopGuard.join(' ')} lack the hop guard`).toEqual([])
  })

  it('#6b the decoy environment is genuinely hostile — so #8 cannot pass by accident', async () => {
    await scenario('sd-6b', async (s) => {
      // Git exports GIT_DIR to every hook and the gate runs the suites, so
      // anything launched from that context inherits it. A root resolved with
      // `git rev-parse --show-toplevel` then answers about the CALLER's
      // environment rather than the script's own tree — Codex reproduced the feed
      // landing on <repo>/logs/state while the launcher landed on
      // <repo>/scripts/logs/state. Different dirs is A-09 reopened.
      const decoy = await s.gitRepo('decoy')
      await s.fs.write(join('decoy', 'f.txt'), 'x\n')
      await decoy.commitAll('decoy base')

      const preFix = await s.run(
        'sh',
        ['-c', 'git rev-parse --show-toplevel 2>/dev/null || pwd'],
        { cwd: join(REPO_ROOT, 'scripts'), env: { GIT_DIR: join(decoy.dir, '.git') } },
      )

      expect(
        preFix.stdout.trim(),
        'the pre-fix anchor also resolved correctly — the decoy is not hostile, ' +
          'so #8 could pass by accident',
      ).not.toBe(REPO_ROOT)
    })
  })

  it('#8+#9+#9b BEHAVIOURAL — the real launcher, through an out-of-tree symlink, under a hostile GIT_DIR', async () => {
    await scenario('sd-8', async (s) => {
      // Codex broke the previous fix (`dirname "$0"`) with exactly this: an
      // out-of-tree symlink made the watcher try to source
      // /tmp/scripts/lib/state-dir.sh. He also observed, correctly, that #5b is
      // heuristic and a behavioural launcher test is the stronger boundary. This
      // is that test — it does not care how the path is spelled, only where the
      // bytes end up. Both hostilities at once, because that is how they arrive:
      // reached through an out-of-tree symlink AND git's repo pointer naming a
      // different repository.
      await s.fs.mkdirp(join('work', 'scripts/lib'))

      // TASK-021 — a project-shaped fixture root marker. The launcher also
      // resolves the Git common directory now (TASK-066), so this is a real Git
      // work tree as well as a project-shaped root. The marker keeps this case
      // focused on state-dir derivation rather than Git discovery.
      await s.fs.write(join('work', '.blueprint-source'), '')

      for (const rel of [
        'scripts/start-codex-signal-watch.mts',
        'scripts/signal-watch.mts',
        'scripts/codex-feed-filter.sh',
      ]) {
        await s.fs.copyIn(join(REPO_ROOT, rel), join('work', rel))
        await s.fs.chmod(join('work', rel), 0o755)
      }
      await s.fs.copyIn(HELPER, join('work', 'scripts/lib/state-dir.sh'))
      // BUG-144 round 3 — recoverStrandedMic (scripts/signal-watch.mts) now
      // actually reaches scripts/lib/roster.sh after every dispatch (it used
      // to fail resolving the roster and never get this far). This minimal
      // out-of-tree fixture never carried that file, so `bash -c '. "$1"; …'`
      // failed with "No such file or directory" — a genuinely new failure mode
      // this test's own assertion (line ~423) exists to catch, not the state
      // dir this suite is about. Copying the real lib in is what production
      // already requires: BP_CODE_ROOT-relative paths only resolve when the
      // code root actually carries the tree it claims to.
      await s.fs.copyIn(join(REPO_ROOT, 'scripts/lib/roster.sh'), join('work', 'scripts/lib/roster.sh'))
      // TASK-065 (round 3) — signal-watch.mts also imports a sibling .mts lib
      // directly (scripts/lib/spawn-bounded.mts), not sourced through a shell
      // function like the two libs above, so the same "carry what the copied
      // watcher actually needs" rule applies here too.
      await s.fs.copyIn(join(REPO_ROOT, 'scripts/lib/spawn-bounded.mts'), join('work', 'scripts/lib/spawn-bounded.mts'))
      // TASK-083 — the ported start-codex-signal-watch.mts imports
      // scripts/lib/find-bin.mts and scripts/lib/scratch-tmpdir.mts directly;
      // same "carry what the copied watcher actually needs" rule as the two
      // imports above.
      await s.fs.copyIn(join(REPO_ROOT, 'scripts/lib/find-bin.mts'), join('work', 'scripts/lib/find-bin.mts'))
      await s.fs.copyIn(join(REPO_ROOT, 'scripts/lib/scratch-tmpdir.mts'), join('work', 'scripts/lib/scratch-tmpdir.mts'))
      await s.gitRepo('work')

      // BUG-019 — the watcher reads the LIVE baton (untracked, under the state
      // dir), not the tracked AGENT_SIGNAL.md, which is the protocol document.
      // Written directly rather than via signal-set.sh so this case keeps testing
      // the state-dir derivation without depending on the publisher.
      await s.fs.write(
        join('work', 'logs/state/signal.md'),
        [
          '| Field | Value |',
          '|---|---|',
          '| Holder | Jesko |',
          '| State | OVER_TO_CODEX |',
          '| Task | behavioural fixture |',
          '',
        ].join('\n'),
      )

      // A stub codex that proves it ran by touching a file at an absolute path.
      // It used to echo a marker and #9b looked for it in the run log — which
      // failed, because the launcher pipes codex's stdout through
      // codex-feed-filter.sh, whose job is to keep only JSON events. The marker
      // was correctly discarded. A side effect the transport cannot swallow is
      // the honest signal.
      const marker = s.workspace.path('work', 'stub-ran')
      await s.fs.write(join('work', 'stub-codex'), `#!/usr/bin/env bash\n: > "$STUB_MARKER"\n`, {
        mode: 0o755,
      })

      // A TWO-HOP chain whose second hop is RELATIVE. One absolute hop is the
      // easy case and `readlink -f` handled it; the portable walk has to
      // re-anchor a relative target against the LINK's own directory, and a chain
      // has to be followed rather than resolved in one call.
      const links = await s.workspace.dir('links', 'nested')
      await s.run('ln', ['-s', s.workspace.path('work', 'scripts/start-codex-signal-watch.mts'), join(links, 'hop2.mts')], {
        cwd: s.workspace.root,
      })
      await s.run('ln', ['-s', 'nested/hop2.mts', s.workspace.path('links', 'launch-via-symlink.mts')], {
        cwd: s.workspace.root,
      })
      // TASK-088: the launcher is the `.mts` itself, run with node, which
      // resolves its own physical location through the whole chain
      // (realpathSync), so no sibling has to be linked beside the symlink.

      const decoy = await s.gitRepo('decoy')
      await s.fs.write(join('decoy', 'f.txt'), 'x\n')
      await decoy.commitAll('decoy base')

      const r = await s.run(
        'node',
        [s.workspace.path('links', 'launch-via-symlink.mts'), '--poll', '1', '--once'],
        {
          cwd: s.workspace.root,
          timeoutMs: 60_000,
          env: {
            CODEX_BIN: s.workspace.path('work', 'stub-codex'),
            STUB_MARKER: marker,
            GIT_DIR: join(decoy.dir, '.git'),
            AGENT_SIGNAL_SETTLE: '0',
            // UNSET, not pointed elsewhere. The whole subject is where the
            // launcher DERIVES its state from, and a scenario baton handed to it
            // would answer the question for it.
            AGENT_SIGNAL_FILE: undefined,
            AGENT_STATE_HOME: undefined,
          },
        },
      )

      const output = `${r.stdout}${r.stderr}`

      // #8 — the symptom Codex reported, asserted by name: a wrong root shows up
      // as the launcher reaching outside the tree for the helper it must source.
      expect(
        output,
        `the launcher resolved its root from the SYMLINK's directory: ${output}`,
      ).not.toContain(s.workspace.path('links', 'scripts'))
      expect(output).not.toContain('No such file or directory')

      // #9 — state landed under the FIXTURE repo, so the derivation ran at
      // dispatch rather than at launch.
      expect(
        await s.fs.exists(join('work', 'logs/state/codex-runs.log')),
        `no run log under the fixture's logs/state — dispatch-time derivation did ` +
          `not happen. Output: ${output}`,
      ).toBe(true)

      // #9b — non-vacuity: if the stub never ran, #9 asserts nothing about a real
      // dispatch.
      expect(
        await s.fs.exists(join('work', 'stub-ran')),
        `the stub never ran, so #9 proves nothing. Output: ${output}`,
      ).toBe(true)
    })
  })

  it('#10b the shipped resolver follows a two-hop RELATIVE chain to the real tree', async () => {
    await scenario('sd-10b', async (s) => {
      // #10 forbids the GNU dependency; this proves the portable walk that
      // replaced it actually follows a chain. Stated explicitly because the two
      // are easy to confuse: on a GNU host the old `readlink -f` form ALSO passes
      // this case. The bug was only ever visible on BSD/older macOS, so #10b
      // would NOT have caught it and only #10's check for the flag would.
      await s.fs.mkdirp(join('probe', 'real/scripts'))
      await s.fs.mkdirp(join('probe', 'links/nested'))

      const block = physicalRootBlock(await readFile(firstShellBlockSource(), 'utf8'))
      expect(block, 'the physical-root block has moved — #10b is extracting nothing').not.toBeNull()
      await s.fs.write(
        join('probe', 'real/scripts/probe.sh'),
        `${block}\nprintf '%s\\n' "$_bp_root"\n`,
      )

      await s.run('ln', ['-s', s.workspace.path('probe', 'real/scripts/probe.sh'), s.workspace.path('probe', 'links/nested/hop2.sh')], { cwd: s.workspace.root })
      await s.run('ln', ['-s', 'nested/hop2.sh', s.workspace.path('probe', 'links/probe-entry.sh')], {
        cwd: s.workspace.root,
      })

      const r = await s.run('bash', [s.workspace.path('probe', 'links/probe-entry.sh')], {
        cwd: s.workspace.root,
      })

      // BUG-036 — the resolver correctly returns a fully-resolved PHYSICAL path.
      // Comparing its correct answer against an unresolved literal failed this
      // case with "chain not followed", an accusation against the resolver for
      // doing its job. `s.workspace` hands out physical paths for that reason.
      expect(r.stdout.trim()).toBe(s.workspace.path('probe', 'real'))
    })
  })

  it('#10c a symlink CYCLE fails non-zero rather than resolving to something plausible', async () => {
    await scenario('sd-10c', async (s) => {
      // The hop bound stops a hang. On its own it would then return whatever
      // `dirname` of a still-unresolved link yields, which is a silent wrong
      // answer — precisely the failure mode Codex flagged where `readlink -f`
      // degrading quietly was worse than the missing-file error it replaced.
      // Trading a hang for a lie is not a fix.
      const cyc = await s.workspace.dir('cyc')
      await s.run('ln', ['-s', join(cyc, 'b.sh'), join(cyc, 'a.sh')], { cwd: s.workspace.root })
      await s.run('ln', ['-s', join(cyc, 'a.sh'), join(cyc, 'b.sh')], { cwd: s.workspace.root })

      const r = await s.run('bash', [join(cyc, 'a.sh')], { cwd: s.workspace.root })

      expect(r.code, `a symlink cycle produced rc=0 and output '${r.stdout}' — silently wrong`).not.toBe(
        0,
      )
    })
  })

  it('#10d the hop-exhaustion branch RUNS, reached by shadowing readlink on PATH', async () => {
    await scenario('sd-10d', async (s) => {
      // I wrote that this branch was uncoverable: a real >40 chain hits the
      // kernel's ELOOP first, so #10c only ever observed rc=126 (bash refusing
      // the cyclic file) and the code just written went unexercised. I said so
      // rather than claiming coverage I did not have.
      //
      // Codex then built it in one pass, and the trick is worth keeping: shadow
      // `readlink` on PATH so it always answers with a path that is STILL a
      // symlink. The walk can then never converge, the bound is what stops it,
      // and the branch runs on this kernel like any other line. The lesson is
      // that "the OS gets there first" was a fact about the DEFAULT environment,
      // not about the code — and a test controls its environment.
      await s.fs.mkdirp(join('hop', 'real/scripts'))

      const block = physicalRootBlock(await readFile(firstShellBlockSource(), 'utf8'))
      await s.fs.write(
        join('hop', 'real/scripts/probe.sh'),
        `${block}\nprintf '%s\\n' "$_bp_root"\n`,
      )
      const entry = s.workspace.path('hop', 'real/scripts/entry.sh')
      await s.run('ln', ['-s', s.workspace.path('hop', 'real/scripts/probe.sh'), entry], {
        cwd: s.workspace.root,
      })

      const shims = await s.shimDir('hop-bin')
      await shims.add('readlink', `printf '%s\\n' "${entry}"`)

      const r = await s.run('bash', [entry], { cwd: s.workspace.root, env: { PATH: shims.path() } })

      expect(r.code, 'the exhaustion branch was not reached').not.toBe(0)
      expect(`${r.stdout}${r.stderr}`).toContain('exceeds 40 hops')
    })
  })
})

/**
 * TASK-018-RULES R6 — #5b, #7 and #10 shown red on a tree carrying the defect.
 *
 * #5c in the shell suite did this for #5b alone, and it is the most important of
 * the three: a structural guard can still be vacuous, so it is run against the
 * shapes that MUST fail — the two historical spellings, and BOTH of Codex's
 * bypasses, which is the point of writing the guard structurally in the first
 * place. The benign lines must stay clean.
 */
describe('A-09 R6 — the static guards are provably able to fail', () => {
  it('#5c the guard catches all four defect shapes, including both Codex bypasses', () => {
    const caught = (line: string): boolean =>
      structuralViolations('f.sh', `#!/bin/sh\n${line}\n`).length > 0

    expect(caught('RUN_LOG="$HOME/.{{PROJECT_NAME}}/codex-runs.log"'), 'the original literal-placeholder path').toBe(true)
    expect(
      caught('state_dir="${AGENT_STATE_HOME:-$HOME/.$(basename "$repo_root")}"'),
      'the original derived-basename path',
    ).toBe(true)
    // Codex bypass 1: braces. Bypass 2: printf, naming no artefact. Both
    // reintroduce the bug and match no $HOME pattern, which is why the guard is
    // structural rather than a blocklist.
    expect(caught('RUN_LOG="${HOME}/.$(basename "$repo_root")/codex-runs.log"'), 'braced $HOME').toBe(
      true,
    )
    expect(
      caught('STATE_DIR="$(printf "%s/.%s" "$HOME" "$(basename "$repo_root")")"'),
      'printf, no artefact name',
    ).toBe(true)

    // And the benign lines stay clean, or the guard fires on legitimate uses and
    // gets deleted rather than obeyed.
    expect(caught('  proj="$HOME/.claude/projects/$(printf "%s" "$repo_root")"'), 'transcript reading').toBe(
      false,
    )
    expect(caught('RUN_LOG="$STATE_DIR/codex-runs.log"'), 'a correct derived assignment').toBe(false)
    expect(caught('LOG_FILE="$2"'), 'an operator passing an explicit path').toBe(false)
  })

  it('#5b the KNOWN LIMIT is stated as a case, not left as a surprise', () => {
    // Codex defeated the guard a second time by putting the bad directory in an
    // unlisted variable and building the artefact name from parts — no complete
    // artefact name, no listed assignment. The variable-name list is the weak
    // point and cannot be closed by adding names.
    //
    // Asserted so the limit is a fact in the suite rather than a paragraph in a
    // comment: #8/#9 above are the real boundary, and if someone ever tightens
    // this they will find the case that says what tightening has to beat.
    const bypass = 'BAD_DIR="$HOME/.x"\n  printf "%s/%s%s" "$BAD_DIR" "codex-runs" ".log"'
    expect(structuralViolations('f.sh', `#!/bin/sh\n${bypass}\n`)).toEqual([])
  })

  it('#7 a drifted physical-root block is named', async () => {
    await scenario('sd-r6-7', async (s) => {
      const real = await readFile(firstShellBlockSource(), 'utf8')
      const block = physicalRootBlock(real)
      expect(block).not.toBeNull()

      const files: Record<string, string> = {}
      for (const rel of CONSUMERS) files[rel] = bodyFor(rel, real)
      // One consumer's copy drifts by a single character. Four copies exist
      // because the block cannot live in scripts/lib/ — it is the code that FINDS
      // scripts/lib/ — so pinning them byte-for-byte is the only defence.
      // The launchers are TypeScript now (TASK-088), so the copy that drifts is
      // a 'ts' one: the second ts consumer, judged against the first.
      files[CONSUMERS[2]] = mutateAll(TS_CONSUMER, 'dirname(dirname(realpathSync', 'dirname(realpathSync')

      const scan = await writeAndScan(s, 'bp', files)

      expect(scan.rootBlockDrifted).toEqual([CONSUMERS[2]])
      expect(scan.rootBlockCount).toBe(CONSUMERS.length)
    })
  })

  it('#7 a consumer with NO physical-root block anchors some other way', async () => {
    await scenario('sd-r6-7-missing', async (s) => {
      const real = await readFile(firstShellBlockSource(), 'utf8')
      const files: Record<string, string> = {}
      for (const rel of CONSUMERS) files[rel] = bodyFor(rel, real)
      files[CONSUMERS[2]] = '#!/bin/sh\n. lib/state-dir.sh\nexceeds 40 hops\n'

      const scan = await writeAndScan(s, 'bp', files)

      expect(scan.rootBlockMissing).toEqual([CONSUMERS[2]])
      expect(scan.rootBlockCount).toBe(CONSUMERS.length - 1)
    })
  })

  // agent-activity.sh is the one SHELL consumer left (the launchers are
  // TypeScript, TASK-088), so each shell defect gets its own scenario on it.
  const SHELL_DEFECTS: ReadonlyArray<readonly [string, keyof StateDirScan, string, string]> = [
    // #4 — a consumer with its own copy of the rule instead of the helper.
    ['#4', 'notSourcingHelper', 'lib/state-dir.sh', 'lib/its-own-idea.sh'],
    // #10 — the GNU dependency, which fails SILENTLY on BSD.
    ['#10', 'gnuReadlink', '_bp_self="$(readlink "$_bp_self")"', '_bp_self="$(readlink -f "$_bp_self")"'],
    // #10e — a copy without the hop guard, so a cycle resolves to a wrong root.
    ['#10e', 'noHopGuard', 'exceeds 40 hops', 'is fine actually'],
  ]
  for (const [id, field, find, to] of SHELL_DEFECTS) {
    it(`${id} goes red on the defect it names`, async () => {
      await scenario(`sd-r6-${id}`, async (s) => {
        const real = await readFile(firstShellBlockSource(), 'utf8')
        const files: Record<string, string> = {}
        for (const rel of CONSUMERS) files[rel] = bodyFor(rel, real)
        files[CONSUMERS[0]] = mutateAll(real, find, to)

        const scan = await writeAndScan(s, 'bp', files)

        expect(scan[field]).toEqual([CONSUMERS[0]])
      })
    })
  }

  it('#3 a dispatcher building a log path from the literal placeholder is caught', async () => {
    await scenario('sd-r6-3', async (s) => {
      const real = await readFile(firstShellBlockSource(), 'utf8')
      const files: Record<string, string> = {}
      for (const rel of CONSUMERS) files[rel] = bodyFor(rel, real)
      // THE ORIGINAL DEFECT, verbatim in shape: this repo is the template AND a
      // working copy, so the placeholder stayed literal and every derived
      // checkout's dispatcher wrote into one shared directory.
      files[DISPATCHERS[0]] =
        `${TS_CONSUMER}\nRUN_LOG="$HOME/.{{PROJECT_NAME}}/codex-runs.log"\n` // a2bp-allow: a planted fixture this case proves the state-dir scan refuses
      // #5b catches the same line from the other direction (shell consumers
      // only — it is a shell-syntax rule), which is the belt-and-braces the two
      // rules are for.
      files[CONSUMERS[0]] = `${real}\nRUN_LOG="$HOME/.{{PROJECT_NAME}}/codex-runs.log"\n` // a2bp-allow: a planted fixture this case proves the state-dir scan refuses

      const scan = await writeAndScan(s, 'bp', files)

      expect(scan.literalPlaceholder).toEqual([DISPATCHERS[0]])
      expect(scan.sawAnyLogPath).toBe(true)
      expect(scan.structural).toContain(`${CONSUMERS[0]}(A)`)
    })
  })

  it('#3 the non-vacuity half — a dispatcher naming NO artefact makes the scan refuse to judge', async () => {
    await scenario('sd-r6-3-vacuous', async (s) => {
      // A renamed artefact would otherwise make "zero literal hits" pass by
      // finding nothing to scan, which is the BUG-005 shape this guard's own
      // guard exists for.
      const files: Record<string, string> = {}
      for (const rel of CONSUMERS) files[rel] = '#!/bin/sh\n. lib/state-dir.sh\nexceeds 40 hops\n'

      const scan = await writeAndScan(s, 'bp', files)

      expect(scan.sawAnyLogPath).toBe(false)
    })
  })

  it('a MISSING consumer is reported rather than silently skipped', async () => {
    await scenario('sd-r6-missing', async (s) => {
      const real = await readFile(firstShellBlockSource(), 'utf8')
      const files: Record<string, string> = {}
      for (const rel of CONSUMERS) files[rel] = bodyFor(rel, real)
      delete files[CONSUMERS[3]]

      const scan = await writeAndScan(s, 'bp', files)

      expect(scan.missing).toEqual([CONSUMERS[3]])
      // And #3's own half of it. The shell control failed #3 on a deleted
      // DISPATCHER — "cannot assert on it" — and the first version of this port
      // folded that into `missing` alone, which made the two disagree on exactly
      // this tree. Found by the verdict comparison, not by reading.
      expect(scan.missingDispatchers).toEqual([CONSUMERS[3]])
    })
  })
})

/**
 * Rewrite exactly the occurrences asked for, and fail loudly when the anchor has
 * moved.
 *
 * Written after three R6 cases passed vacuously: `String.replace` takes only the
 * FIRST match, and `lib/state-dir.sh` appears four times in a consumer (once as
 * the `source` line, three times in prose), so the mutation landed in a comment
 * and the guard correctly saw nothing wrong. A mutant that silently applies to
 * nothing is a green R6 case proving the opposite of what it claims — which is
 * the `a2bp-contamination` failure exactly.
 */
function mutateAll(src: string, find: string, to: string): string {
  const count = src.split(find).length - 1
  if (count === 0) throw new Error(`Mutation anchor not found in the shipped file: ${find}`)
  return src.split(find).join(to)
}

/** Write a set of consumer files into the workspace and scan that root. */
async function writeAndScan(
  s: Scenario,
  name: string,
  files: Record<string, string>,
): Promise<StateDirScan> {
  const root = await s.workspace.dir(name)
  for (const [rel, content] of Object.entries(files)) {
    await s.fs.write(join(name, rel), content)
  }
  return scanStateDir(root)
}
