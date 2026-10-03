/**
 * tests/pipeline/pipeline.spec.ts — FEATURE-002, the pre-push gate renders as a
 * pipeline.
 *
 * Parallelism hazard: `serial-global` for #19 only, and only as an OBSERVATION.
 * #19 reads the operator's real activity feed to prove nothing here writes to
 * it. It never writes there, so a concurrent scenario cannot corrupt it — but a
 * concurrent AGENT can append to that feed between the two readings, which is
 * why the check is on `[GATE]` lines and this scenario's own token rather than
 * on the file being byte-identical. Every other case is fully contained.
 *
 * Most of this file is about ONE property, and it is not the rendering:
 *
 *   **FAIL CLOSED.** `scripts/lib/pipeline.sh` decides whether a push is
 *   allowed. If a stage fails and the renderer lets it through, every gate in
 *   this repo silently stops guarding anything — and it would look exactly like
 *   a passing gate, which is the failure mode that made BUG-004 expensive. So
 *   the failure paths get more assertions than the happy path: non-zero exit,
 *   death by signal, a missing binary, and a failure in the LAST stage (an
 *   off-by-one in the summary is the obvious way to lose one).
 *
 * The rendering assertions exist mainly to protect the second reason the feature
 * exists: a gate that did not run prints nothing, which is indistinguishable
 * from a gate that passed. The banner is what makes absence visible, so "the
 * banner is present and says PASSED/FAILED" is load-bearing.
 *
 * WHERE THE §3.3 LINE FALLS. `scripts/lib/pipeline.sh` is not the pre-push entry
 * point TASK-018-TARGET §3.3 exempts — it is a library the entry point sources,
 * and §6 of TARGET records that whether it becomes TypeScript is still open for
 * the founder. Either way the subject here is the SHELL renderer as it exists
 * today: every case drives the real bytes of `scripts/lib/pipeline.sh` under
 * `/bin/sh`, never bash, because the hook is `#!/bin/sh` and a bashism that
 * passes in a test breaks in the gate.
 *
 * TWO KNOBS ARE SET INSIDE THE DRIVER SCRIPT, NOT THROUGH THE SCENARIO ENV.
 * `AGENT_GATE_SLO_TOTAL_MS` and `AGENT_FEED_MAX_LINES` are undeclared in
 * `tests/harness/env.ts`, so the harness — correctly — refuses them as
 * overrides: an undeclared AGENT_* name has been through no containment check.
 * They are durations and line counts, they name nothing on disk, and they belong
 * to the fixture rather than to the scenario, so they are assigned in the shell
 * driver the case writes. Declaring them in the harness would work too; this
 * keeps the knob next to the one case that turns it.
 *
 * EQUIVALENCE RECORD (R6). The retiring `tests/pipeline/test.sh` and this spec
 * were run over a population of perturbed trees — the healthy repo plus one
 * mutant of `scripts/lib/pipeline.sh` (or `feed.sh`) per assertion group — and
 * the per-case verdict sets diffed mechanically. Table in the migration report.
 *
 * THE RUN FOUND THREE THINGS A REVIEW HAD NOT, and all three are recorded here
 * rather than smoothed over. Two are cases that COULD NOT FAIL on the defect they
 * name — the class a passing test hides by construction — and the third is a
 * product defect:
 *
 *   * #3 "a failed stage halts the pipeline" was blind. Its evidence was a line
 *     of stdout from a stage that, once the halt was removed, RAN AND PASSED —
 *     so the buffer #8 asserts swallowed exactly the evidence #3 looked for.
 *     Green in both implementations with the halt deleted. Now asserted on a
 *     filesystem side effect, which the buffer cannot hide.
 *   * #9/#17 "no ANSI escapes" could not fail via the colour path while BUG-083
 *     was open, because there was no escape byte in the renderer at all.
 *   * BUG-083 itself (fixed): the colour literals lost their ESC bytes, so the
 *     gate printed `[2m`, `[32m` and `[K` as literal text on every push from a
 *     terminal. #9b now asserts the real escape on a pty.
 *
 * #12 also disagreed, and the shell side is the wrong one: its machine-wide
 * `/tmp/tmp.*` count went red under a mutant that changes nothing about temp
 * dirs, because an unrelated process created one during the five runs. That is
 * the global read R5 forbids, and the note on #12 below is what replaces it.
 *
 * MUTATION RECIPE (R6), each applied to `scripts/lib/pipeline.sh`:
 *
 *   M1  `pipe_stage`'s `exit 1` becomes `exit 0` (a failing stage exits clean)
 *       Red: #2, #4, #5, #6, #14-fail-closed, #20-not-masked. THE GATE IS OPEN.
 *       Note that mutating `pipe_finish`'s `return 1` instead changes nothing:
 *       `pipe_stage` exits 1 on its own, so that is an EQUIVALENT mutant, not a
 *       defect. Worth stating because it looks like the obvious one to try.
 *   M2  `pipe_stage`'s `pipe_finish; exit 1` becomes `return 1` (no halt)
 *       Red: #3 — but only since #3 stopped looking for its evidence in a
 *       buffered stream. See the equivalence record above.
 *   M3  the buffered failure replay is dropped
 *       Red: #7.
 *   M4  a passing stage's buffer is echoed
 *       Red: #8.
 *   M5  `[ -t 1 ]` forced true (colour always)
 *       Red: #9, #9b. (Before BUG-083's fix: NOTHING.)
 *   M6  `pipe_skip` calls `_pipe_record bad`
 *       Red: #11.
 *   M7  `_pipe_cleanup` becomes a no-op
 *       Red: #12.
 *   M8  counters read from the scratch dir instead of shell variables
 *       Red: #15 (and #14 under the no-mktemp PATH).
 *   M9  `_pipe_feed` uses the colourised `_pipe_line` text
 *       Red: #17.
 *   M10 feed rotation trims in place (`tail`→`cat >`) instead of renaming
 *       Red: #18 (no archive — the history is deleted), #18b (a concurrent
 *       append inside the rewrite window is lost). This mutant is the code as
 *       it stood before BUG-129's second half; the inverse mutant this line
 *       used to describe rested on the false inode premise #18 now records.
 *   M11 the SLO branch `return 1`s
 *       Red: #20-never-blocks.
 *   M12 SLO defaults lowered to 1 ms
 *       Red: #20-silent-baseline.
 */

import { describe, it, expect } from 'vitest'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type RunResult, type Scenario } from '../harness/index.js'

const LIB = join(REPO_ROOT, 'scripts/lib/pipeline.sh')
const FEED_LIB = join(REPO_ROOT, 'scripts/lib/feed.sh')

const STATE_LIB = join(REPO_ROOT, 'scripts/lib/state-dir.sh')

/** The suffix `scripts/lib/feed.sh` appends to the project root it derives. */
const FEED_SUFFIX = 'logs/agent-activity.log'

/**
 * What a production caller does before it asks feed.sh anything (BUG-077).
 *
 * feed.sh used to answer with `git rev-parse --show-toplevel`, which reports
 * whatever repository the CALLER's git environment points at — and git exports
 * GIT_DIR into every hook, while this gate runs its suites from one. It now
 * reads `$BP_STATE_ROOT`, resolved once through the same upward filesystem walk
 * every other consumer uses.
 *
 * So the drivers below resolve it the way `scripts/agent-activity.sh` and
 * `scripts/log-activity.sh` do. The case's claim is unchanged — the enclosing
 * project root plus FEED_SUFFIX — but it is now asked of the shared derivation
 * rather than of git.
 */
const RESOLVE_STATE_ROOT =
  `. ${JSON.stringify(STATE_LIB)}\n` +
  `BP_CODE_ROOT="$(pwd)"\n` +
  `BP_STATE_ROOT="$(bp_state_root)" || exit 9\n`

/**
 * ESC, as the thing to search for. A CI log full of these is soup.
 *
 * Written as an escape SEQUENCE rather than as the literal byte: a raw control
 * character in a source file is one editor or one reformat away from becoming an
 * empty string, and `not.toContain('')` is a different assertion entirely.
 */
const ESC = '\u001b'

/**
 * Run a shell snippet against the real renderer, in a real `sh`.
 *
 * `sh` and never `bash`: the hook is `#!/bin/sh` (dash on Ubuntu), and a bashism
 * that passes here would break in the gate — which is the one place it cannot be
 * observed failing safely.
 *
 * The snippet is written to a file rather than passed with `-c` so that a case's
 * fixture is readable on disk when something goes wrong, and so a driver can set
 * its own environment (see the knobs note in the docblock).
 */
async function runPipe(
  s: Scenario,
  name: string,
  snippet: string,
  options: { env?: Record<string, string | undefined>; cwd?: string } = {},
): Promise<RunResult> {
  const driver = await s.fs.write(`drivers/${name}.sh`, snippet)
  return s.run('sh', [driver], {
    cwd: options.cwd ?? s.workspace.root,
    env: options.env ?? {},
    timeoutMs: 60_000,
  })
}

/** A snippet that sources only the renderer. */
const withLib = (body: string): string => `. ${JSON.stringify(LIB)}\n${body}\n`

/** A snippet that sources the feed appender too — pipeline.sh no-ops without it. */
const withFeed = (body: string): string =>
  `. ${JSON.stringify(FEED_LIB)}\n. ${JSON.stringify(LIB)}\n${body}\n`

/**
 * A PATH whose `mktemp` always fails, with the real PATH behind it.
 *
 * Prepended, never replaced: replacing would also test "what happens with no
 * coreutils", which is a different question from the one #14 and #15 ask.
 */
async function noMktempPath(s: Scenario): Promise<string> {
  const shims = await s.shimDir('nomktemp')
  await shims.add('mktemp', 'exit 1')
  return shims.path()
}

describe('FEATURE-002 — the gate renders as a pipeline and fails closed', () => {
  it('#0 the renderer exists where every case below expects it', async () => {
    // Not ceremony: every case sources this path, and a `.` of a missing file in
    // dash is a non-zero exit that could be mistaken for a fail-closed verdict.
    // Failing here names the real cause once instead of twenty times.
    await expect(stat(LIB)).resolves.toBeTruthy()
  })

  it('#1 all-green pipeline exits 0 and renders PASSED', async () => {
    await scenario('pipeline-1', async (s) => {
      const r = await runPipe(
        s,
        'p1',
        withLib(`pipe_init 'gate' 'test'
pipe_stage 'a' true
pipe_stage 'b' true
pipe_finish`),
      )

      expect(r.code, r.output).toBe(0)
      expect(r.output).toContain('PASSED')
    })
  })

  it('#2 a failing stage exits non-zero (fail closed)', async () => {
    await scenario('pipeline-2', async (s) => {
      const r = await runPipe(
        s,
        'p2',
        withLib(`pipe_init 'gate'
pipe_stage 'a' true
pipe_stage 'boom' false
pipe_stage 'c' true
pipe_finish`),
      )

      expect(r.code, `a failing stage exited 0 — THE GATE IS OPEN\n${r.output}`).not.toBe(0)
    })
  })

  it('#3 a failed stage halts the pipeline', async () => {
    await scenario('pipeline-3', async (s) => {
      // If later stages still execute, a gate that reported failure could still
      // have run destructive work after it.
      //
      // THE EVIDENCE IS A FILE, NOT A LINE OF OUTPUT, AND THAT IS BUG-078's
      // SIBLING FINDING. The shell version ran `pipe_stage 'after' echo
      // REACHED_AFTER_FAILURE` and grepped stdout — but a stage that RUNS AND
      // PASSES has its output buffered and deliberately not replayed (that is
      // #8). So when the halt was removed, the `after` stage executed, its echo
      // went into the buffer, and the grep found nothing: the case stayed GREEN
      // while the property it names was gone. Measured, with the halt deleted, on
      // both implementations.
      //
      // A side effect on the filesystem survives the buffer. The whole point of
      // #3 is that a halted pipeline runs no further WORK, and work leaves traces
      // that are not stdout.
      const marker = s.workspace.path('after-stage-ran')
      const r = await runPipe(
        s,
        'p3',
        withLib(`pipe_init 'gate'
pipe_stage 'boom' false
pipe_stage 'after' sh -c 'echo ran > ${marker}'
pipe_finish`),
      )

      expect(
        await s.fs.exists('after-stage-ran'),
        `execution continued past a failed stage — the 'after' stage did real work\n${r.output}`,
      ).toBe(false)
    })
  })

  it('#4 a failure in the final stage still exits non-zero', async () => {
    await scenario('pipeline-4', async (s) => {
      // The off-by-one a summary loop invites.
      const r = await runPipe(
        s,
        'p4',
        withLib(`pipe_init 'gate'
pipe_stage 'a' true
pipe_stage 'last' false
pipe_finish`),
      )

      expect(r.code, `a final-stage failure exited 0 — off-by-one in the summary\n${r.output}`).not.toBe(0)
    })
  })

  it('#5 a stage killed by a signal fails the gate', async () => {
    await scenario('pipeline-5', async (s) => {
      // The OOM killer and a `timeout` both arrive this way. A signal death must
      // not read as success.
      const r = await runPipe(
        s,
        'p5',
        withLib(`pipe_init 'gate'
pipe_stage 'killed' sh -c 'kill -9 $$'
pipe_finish`),
      )

      expect(r.code, `a signal-killed stage exited 0 — the gate is open\n${r.output}`).not.toBe(0)
    })
  })

  it('#6 a missing binary fails the gate', async () => {
    await scenario('pipeline-6', async (s) => {
      // The "tool not installed" case, which is how a scanner silently stops
      // scanning.
      const r = await runPipe(
        s,
        'p6',
        withLib(`pipe_init 'gate'
pipe_stage 'nope' definitely-not-a-real-binary-xyz
pipe_finish`),
      )

      expect(r.code, `a missing binary exited 0 — the gate is open\n${r.output}`).not.toBe(0)
    })
  })

  it('#7 a failing stage’s output is shown', async () => {
    await scenario('pipeline-7', async (s) => {
      // Buffering must not swallow the diagnosis — otherwise the pipeline is
      // prettier and strictly less useful.
      const r = await runPipe(
        s,
        'p7',
        withLib(`pipe_init 'gate'
pipe_stage 'noisy' sh -c 'echo UNIQUE_DIAGNOSTIC_STRING; exit 3'
pipe_finish`),
      )

      expect(r.output, 'the failing stage’s output was swallowed by the buffer').toContain(
        'UNIQUE_DIAGNOSTIC_STRING',
      )
    })
  })

  it('#8 a passing stage’s output stays buffered', async () => {
    await scenario('pipeline-8', async (s) => {
      // That is what makes it a summary.
      const r = await runPipe(
        s,
        'p8',
        withLib(`pipe_init 'gate'
pipe_stage 'quiet' sh -c 'echo CHATTY_TOOL_NOISE'
pipe_finish`),
      )

      expect(r.output, 'a passing stage’s output leaked into the summary').not.toContain(
        'CHATTY_TOOL_NOISE',
      )
    })
  })

  it('#9 non-TTY output is free of ANSI escape sequences', async () => {
    await scenario('pipeline-9', async (s) => {
      // The harness captures stdout through a pipe, so this IS the non-TTY path.
      const r = await runPipe(
        s,
        'p9',
        withLib(`pipe_init 'gate'
pipe_stage 'a' true
pipe_finish`),
      )

      expect(r.output, 'ANSI escapes present in non-TTY output — CI logs would be soup').not.toContain(
        ESC,
      )
      // POSITIVE CONTROL ON THE DETECTOR. `not.toContain` over a haystack that
      // could never hold the needle is the shape of a check that has never been
      // seen doing anything, and this one was in exactly that position while
      // BUG-083 was open. Proving the search itself works separates "the renderer
      // is clean" from "the search is broken".
      expect(`plain ${ESC}[31mred`, 'the ESC search cannot find an ESC').toContain(ESC)
    })
  })

  it('#9b BUG-083: on a terminal the colour codes carry their escape byte, and off one there are none', async () => {
    // BUG-083: the colour literals had lost their ESC byte, so on every push from
    // a terminal the gate printed `[2m`, `[32m`, `[K` as literal text. This drives
    // the renderer on a REAL pty (`script`), which is the only way to reach the
    // `[ -t 1 ]` branch — and it is what makes #9 and #17 live: they assert no
    // escape leaks off a terminal, which means nothing until one exists on it.
    await scenario('pipeline-9b', async (s) => {
      const driver = await s.fs.write(
        'drivers/p9b.sh',
        withLib(`pipe_init 'gate'
pipe_stage 'a' true
pipe_finish`),
      )
      // util-linux `script` takes -c; BSD `script` takes the command positionally.
      const probe = await s.run('script', ['-qec', 'true', '/dev/null'], { cwd: s.workspace.root })
      const args =
        probe.code === 0
          ? ['-qec', `sh '${driver}'`, '/dev/null']
          : ['-q', '/dev/null', 'sh', driver]
      const tty = await s.run('script', args, { cwd: s.workspace.root, env: {}, timeoutMs: 60_000 })
      expect(tty.code, tty.output).toBe(0)
      expect(tty.output, 'no gate output came through the pty').toContain('gate')

      expect(tty.output, 'the TTY branch emits no real ANSI colour code').toContain(`${ESC}[32m`)
      expect(
        tty.output.replaceAll(`${ESC}[`, ''),
        'a colour code was printed WITHOUT its escape byte — BUG-083',
      ).not.toMatch(/\[(?:[0-9]+m|K)/)

      // Off a terminal: no escape byte AND no bare literal either.
      const piped = await runPipe(
        s,
        'p9b-piped',
        withLib(`pipe_init 'gate'
pipe_stage 'a' true
pipe_finish`),
      )
      expect(piped.output, 'escape codes in non-TTY output').not.toContain(ESC)
      expect(piped.output, 'bare colour literals in non-TTY output').not.toMatch(/\[(?:[0-9]+m|K)/)
    })
  })

  it('#10 the banner renders on both the passing and failing paths', async () => {
    await scenario('pipeline-10', async (s) => {
      // The anti-BUG-004 property: no banner must mean "the gate did not run",
      // so the banner cannot be conditional on success.
      const ok = await runPipe(
        s,
        'p10-ok',
        withLib(`pipe_init 'pre-push gate'
pipe_stage 'a' true
pipe_finish`),
      )
      const bad = await runPipe(
        s,
        'p10-bad',
        withLib(`pipe_init 'pre-push gate'
pipe_stage 'a' false
pipe_finish`),
      )

      expect(ok.output, 'no banner on the passing path — absence would be ambiguous').toContain(
        'pre-push gate',
      )
      expect(bad.output, 'no banner on the failing path — absence would be ambiguous').toContain(
        'pre-push gate',
      )
    })
  })

  it('#11 a skip is visible in the render and does not fail the gate', async () => {
    await scenario('pipeline-11', async (s) => {
      // A skipped stage is normal (no backend/, no IaC) and must not block — but
      // must be VISIBLE. An invisible skip is how "94% coverage over 9% of the
      // code" happens.
      const r = await runPipe(
        s,
        'p11',
        withLib(`pipe_init 'gate'
pipe_skip 'IaC synth' 'no infrastructure/'
pipe_finish`),
      )

      expect(r.code, r.output).toBe(0)
      expect(r.output).toContain('IaC synth')
      expect(r.output).toContain('skipped')
    })
  })

  it('#12 no temp directories leak across 5 runs', async () => {
    await scenario('pipeline-12', async (s) => {
      // `pipe_init` mktemp's per run and the gate runs on every push, so a leak
      // here is unbounded growth in the operator's temp dir.
      //
      // DIVERGENCE FROM THE SHELL SUITE, and it is a strict improvement. That
      // version counted `/tmp/tmp.*` ACROSS THE WHOLE MACHINE, which is a global
      // read: any unrelated process creating a temp dir mid-case falsified it,
      // and R5 forbids exactly that. The harness pins TMPDIR per scenario, so
      // the count is over a directory this scenario owns — same property,
      // parallel-safe, and no longer answerable by anyone else's process.
      const tmp = s.workspace.path('tmp')
      const before = (await readdir(tmp)).length

      for (let i = 0; i < 5; i += 1) {
        const r = await runPipe(
          s,
          `p12-${i}`,
          withLib(`pipe_init 'gate'
pipe_stage 'a' true
pipe_finish`),
        )
        expect(r.code, r.output).toBe(0)
      }

      const after = (await readdir(tmp)).length
      expect(after, `temp dirs leaked: ${before} -> ${after}`).toBeLessThanOrEqual(before)
    })
  })

  it('#13 the gate hooks source the pipeline renderer', async () => {
    // Assertions #1–#12 could all pass while `.githooks/` ignored the library
    // entirely.
    //
    // KNOWN HOLE, measured rather than suspected (R6 second pass, recorded in
    // the migration report as FINDING 1). This cannot tell SOURCING the renderer
    // from MENTIONING it: deleting the `. scripts/lib/pipeline.sh` line while
    // leaving the five comments in `.githooks/pre-push` that name the same path
    // keeps this green. BUG-080's exact shape. The retiring shell #13 is a
    // `grep -q 'lib/pipeline.sh'` over the same file and has the identical hole,
    // so this is a faithful port and NOT the place to fix it — narrowing it here
    // would make the port unprovable against the runner it replaces.
    for (const rel of ['.githooks/pre-push', '.githooks/pre-push-project']) {
      const text = await readFile(join(REPO_ROOT, rel), 'utf8')
      expect(text, `${rel} does not source scripts/lib/pipeline.sh`).toContain('lib/pipeline.sh')
    }
  })

  it('#14 with no scratch dir the pipeline still runs, still fails closed, and still shows failure output', async () => {
    await scenario('pipeline-14', async (s) => {
      // /tmp full, mounted noexec, or coreutils off PATH must not stop the gate.
      // "Could not create a temp dir" is a terrible reason to block a push and a
      // far worse one to allow one.
      const env = { PATH: await noMktempPath(s) }

      const pass = await runPipe(
        s,
        'p14-pass',
        withLib(`pipe_init 'gate'
pipe_stage 'a' true
pipe_finish`),
        { env },
      )
      expect(pass.code, `no-scratch-dir pass path broke\n${pass.output}`).toBe(0)
      expect(pass.output).toContain('PASSED')
      // NON-VACUITY: prove the fixture actually removed buffering, or this case
      // is just #1 again under a longer PATH.
      expect(pass.output, 'mktemp did not fail — the unbuffered path was never exercised').toContain(
        'no scratch dir',
      )

      const fail = await runPipe(
        s,
        'p14-fail',
        withLib(`pipe_init 'gate'
pipe_stage 'boom' false
pipe_finish`),
        { env },
      )
      expect(fail.code, `THE GATE IS OPEN when no scratch dir is available\n${fail.output}`).not.toBe(0)

      // Unbuffered mode streams rather than replaying, but the diagnosis must
      // not vanish.
      const noisy = await runPipe(
        s,
        'p14-noisy',
        withLib(`pipe_init 'gate'
pipe_stage 'noisy' sh -c 'echo STREAMED_DIAGNOSTIC; exit 1'
pipe_finish`),
        { env },
      )
      expect(noisy.output, 'unbuffered failure output was lost entirely').toContain(
        'STREAMED_DIAGNOSTIC',
      )
    })
  })

  it('#15 the tally is correct with no scratch dir', async () => {
    await scenario('pipeline-15', async (s) => {
      // Counting via the filesystem is how a tally silently reads zero and a
      // failure disappears from the summary line.
      const r = await runPipe(
        s,
        'p15',
        withLib(`pipe_init 'gate'
pipe_stage 'a' true
pipe_skip 's' 'why'
pipe_stage 'b' false
pipe_finish`),
        { env: { PATH: await noMktempPath(s) } },
      )

      expect(r.output, `tally wrong with no scratch dir\n${r.output}`).toMatch(
        /1 passed · 1 failed · 1 skipped/,
      )
    })
  })

  it('#16 stage results, the verdict and PUSH BLOCKED all reach the activity feed', async () => {
    await scenario('pipeline-16', async (s) => {
      // The terminal render scrolls away and never existed at all for anyone who
      // was not watching that shell — including an agent asked later "did that
      // push actually get gated?". The feed is the durable answer, and it is the
      // same stream every other agent writes to.
      //
      // AGENT_FEED_LOG is pinned by the harness to this scenario's own feed, so
      // the isolation the shell suite had to remember per case is structural
      // here. #19 is what proves the pinning holds.
      const pass = await runPipe(
        s,
        'p16-pass',
        withFeed(`pipe_init 'pre-push gate' 'x'
pipe_stage 'alpha' true
pipe_skip 'beta' 'not here'
pipe_finish`),
      )
      expect(pass.code, pass.output).toBe(0)

      const feed = await readFile(s.feedLog, 'utf8')
      // KNOWN HOLE in THIS claim only, measured (R6 second pass, FINDING 2 in
      // the migration report). `pipe_finish` writes `slowest: alpha 0.0s` into
      // the VERDICT line, so the stage name reaches the feed even with the
      // per-stage `_pipe_feed` deleted — this pattern matches, both
      // implementations stay green, and the defect it names goes unnoticed. The
      // shell #16 has the identical hole; claims 2–4 below are each falsifiable.
      // Left as-is deliberately: see #13.
      expect(feed, `stage results missing from the feed:\n${feed}`).toMatch(/\[.*\].*alpha/)
      expect(feed, `skipped stage missing from the feed:\n${feed}`).toMatch(/\[.*\].*beta/)
      expect(feed, `no verdict line in the feed:\n${feed}`).toContain('PASSED')

      // A blocked push must be unmistakable in the log — this is the line
      // someone greps for after the fact.
      const blocked = await runPipe(
        s,
        'p16-blocked',
        withFeed(`pipe_init 'pre-push gate'
pipe_stage 'boom' false
pipe_finish`),
      )
      expect(blocked.code, blocked.output).not.toBe(0)

      const feed2 = await readFile(s.feedLog, 'utf8')
      expect(feed2, 'a blocked push is not identifiable in the feed').toContain('PUSH BLOCKED')
    })
  })

  it('#17 feed lines are plain text', async () => {
    await scenario('pipeline-17', async (s) => {
      // The feed is tailed and grepped, so escapes in it are the same defect as
      // escapes in a CI log — and they break grep patterns that look anchored but
      // are not.
      //
      // ITS OWN CASE, not an extra assertion inside #16. Sharing a case makes the
      // two verdicts inseparable: a #16 failure reported #17 red as well, which
      // showed up as a false divergence in the equivalence run against the shell
      // suite. One case, one claim.
      //
      // It also catches an escape arriving any way other than the colour path —
      // which a mutant injecting one into `_pipe_feed` confirms.
      const r = await runPipe(
        s,
        'p17',
        withFeed(`pipe_init 'pre-push gate'
pipe_stage 'alpha' true
pipe_finish`),
      )
      expect(r.code, r.output).toBe(0)

      const feed = await readFile(s.feedLog, 'utf8')
      expect(feed.trim(), 'the feed is empty — #17 would pass vacuously').not.toBe('')
      expect(feed, 'ANSI escapes leaked into the activity feed').not.toContain(ESC)
    })
  })

  it('#18 BUG-129: rotation MOVES the history, it does not delete it', async () => {
    await scenario('pipeline-18', async (s) => {
      // THE INODE CLAIM THAT USED TO BE ASSERTED HERE WAS FALSE, and it was
      // load-bearing: it is the reason `tail`→`cat >` looked mandatory. The
      // supervisor does NOT hold this file open. `emit` is
      // `printf '%s\n' "$1" >>"$out"` (scripts/agent-activity.sh:336), which
      // reopens per line, and the only `exec N>` in that script targets the lock
      // file. Nothing tracks the feed by descriptor, so replacing the inode
      // orphans no writer — and rotation by rename becomes available.
      //
      // What IS load-bearing is the contract tests/harness/canary.ts enforces:
      // the feed is append-only, so a rotation that DELETES the head reads as a
      // fixture escape and turns an innocent suite red (BUG-129; the mechanism
      // behind tests/subagent-feed #9). Rename keeps every byte — the history
      // moves to `<feed>.1`, and archive+live still begins with what the canary
      // captured.
      //
      // The threshold knob is set in the driver, not the scenario env: see the
      // docblock.
      const filler = Array.from({ length: 60 }, (_, i) => `filler line ${i}`).join('\n')
      await s.fs.write('logs/agent-activity.log', `${filler}\n`)

      const r = await runPipe(
        s,
        'p18',
        `AGENT_FEED_MAX_LINES=20\nexport AGENT_FEED_MAX_LINES\n` +
          `. ${JSON.stringify(FEED_LIB)}\nfeed_append 'trigger rotation'\n`,
      )
      expect(r.code, r.output).toBe(0)

      expect(
        await s.fs.exists('logs/agent-activity.log.1'),
        'rotation left no archive — the trimmed history is simply GONE, which is ' +
          'what the canary reads as a rewrite (BUG-129)',
      ).toBe(true)

      const live = await readFile(s.feedLog, 'utf8')
      const archive = await readFile(`${s.feedLog}.1`, 'utf8')

      expect(
        archive,
        'the pre-rotation history did not survive into the archive',
      ).toContain('filler line 0')
      expect(
        archive + live,
        'the line that TRIGGERED the rotation was lost by it',
      ).toContain('trigger rotation')
      expect(
        live,
        'the new feed does not say where its history went — a reader following ' +
          'the log sees it restart with no explanation',
      ).toMatch(/rotated/)
      expect(
        live.split('\n').filter(Boolean).length,
        'rotation did not cap the live feed',
      ).toBeLessThanOrEqual(20)
    })
  })

  it('#18b BUG-129: an append that RACES the rotation is not lost', async () => {
    await scenario('pipeline-18b', async (s) => {
      // CODEX'S PROBE, MADE DETERMINISTIC. `tail`→`cat >` has a window between
      // the snapshot and the rewrite, and a line appended inside it is
      // overwritten and gone — proved by hand against the real appender, and
      // held open here by a `cat` shim that sleeps. Every hook and gate stage
      // calls this appender on the same feed, so the racing writer is routine.
      //
      // A LOCK WAS NOT THE ANSWER. feed.sh is POSIX sh sourced by `#!/bin/sh`
      // hooks, and `flock` is absent on macOS — coordinating every writer would
      // mean a lock the platform may not have, on the one path that must never
      // fail a push. Rename CLOSES the window instead of guarding it: the
      // concurrent writer either appends before the rename (its bytes ride into
      // the archive) or after it (they land in the new file). Nothing is lost,
      // which is why this case does not care WHICH file the line ends up in.
      const shims = await s.shimDir('slowcat')
      await shims.add(
        'cat',
        'sleep 0.4\nfor p in /bin/cat /usr/bin/cat; do\n  [ -x "$p" ] && exec "$p" "$@"\ndone\nexit 127',
      )

      const filler = Array.from({ length: 60 }, (_, i) => `filler line ${i}`).join('\n')
      await s.fs.write('logs/agent-activity.log', `${filler}\n`)

      const r = await runPipe(
        s,
        'p18b',
        `AGENT_FEED_MAX_LINES=20\nexport AGENT_FEED_MAX_LINES\n` +
          `( sleep 0.2\n  printf '%s\\n' 'CONCURRENT-LINE' >>"$AGENT_FEED_LOG" ) &\n` +
          `. ${JSON.stringify(FEED_LIB)}\nfeed_append 'trigger rotation'\nwait\n`,
        { env: { PATH: shims.path() } },
      )
      expect(r.code, r.output).toBe(0)

      const live = await readFile(s.feedLog, 'utf8')
      let archive = ''
      if (await s.fs.exists('logs/agent-activity.log.1')) {
        archive = await readFile(`${s.feedLog}.1`, 'utf8')
      }

      expect(
        archive + live,
        'a line appended DURING the rotation was overwritten and lost — the feed ' +
          'drops writes from any producer unlucky enough to hit the window (BUG-129)',
      ).toContain('CONCURRENT-LINE')
    })
  })

  /**
   * #19 — THIS SUITE MUST NOT WRITE TO THE OPERATOR'S REAL FEED.
   *
   * The non-vacuity guard on all the isolation above. The shell version of this
   * case had a `[ -f "$feed" ]` disarm switch whose `else` branch printed
   * `pass "#19 no real feed present to pollute"`, and it had been passing over a
   * path that did not exist — a pollution guard reporting "nothing to pollute"
   * about the WRONG FILE. That switch was deleted on 2026-09-11. Deleting it is
   * necessary and not sufficient: without it the count comparison still reads
   * `0 -> 0` on a missing file and passes for the same reason, one branch later.
   *
   * So the precondition is ASSERTED rather than inherited, in two parts that are
   * separate cases because they fail for different reasons:
   *
   *   #19a  the path being guarded is the one `scripts/lib/feed.sh` itself
   *         derives. Proven by ASKING feed.sh on a fixture repo, not by
   *         reconstructing `<root>/logs/…` in TypeScript — reconstruction is
   *         precisely how the shell version came to watch a code-root path after
   *         the state root moved.
   *   #19b  the detector FIRES. Run over a planted file carrying both markers it
   *         looks for, it must report polluted. A checker that has only ever
   *         been seen reporting "clean" proves nothing, which is R6 applied to
   *         the check itself rather than to the subject.
   *
   * Only then #19c, the actual observation.
   */
  it('#19a the guarded path is the one scripts/lib/feed.sh derives, asked rather than reconstructed', async () => {
    await scenario('pipeline-19a', async (s) => {
      // Ask the real appender what it resolves, from inside a git repo the
      // scenario owns, with AGENT_FEED_LOG unset so the derivation actually
      // runs. That is legal here and only here: the harness permits unsetting it
      // because the cwd is contained, so what gets derived lands in the
      // workspace rather than in the operator's feed.
      const repo = await s.gitRepo('project', { initialCommit: true })
      const r = await runPipe(
        s,
        'p19a',
        `${RESOLVE_STATE_ROOT}. ${JSON.stringify(FEED_LIB)}\nfeed_log_path\necho\n`,
        { env: { AGENT_FEED_LOG: undefined }, cwd: repo.dir },
      )

      expect(r.code, r.output).toBe(0)
      // The RULE: the enclosing project root, plus this suffix. Nothing about
      // where feed.sh or the scripts live.
      expect(r.stdout.trim(), `feed.sh derived an unexpected path:\n${r.output}`).toBe(
        join(repo.dir, FEED_SUFFIX),
      )

      // Apply the same rule to the real checkout, with git naming the root
      // rather than this spec assuming it. This is the path #19c guards.
      const top = await s.run('git', ['-C', REPO_ROOT, 'rev-parse', '--show-toplevel'], {
        cwd: s.workspace.root,
      })
      expect(top.code, top.output).toBe(0)
      expect(top.stdout.trim(), 'the blueprint checkout is not a git work-tree root').not.toBe('')
    })
  })

  it('#19b the pollution detector fires on a planted feed', async () => {
    await scenario('pipeline-19b', async (s) => {
      // The positive control that replaces the deleted disarm switch. It asserts
      // the CHECKER, so #19c's "clean" verdict is a measurement rather than an
      // absence of measurement — including on a machine where the real feed does
      // not exist yet.
      const planted = await s.fs.write(
        'planted-feed.log',
        `12:00:00 [GATE] ✓ something  0.1s\n12:00:01 [GATE] ✓ ${s.escapeToken}  0.1s\n`,
      )
      const verdict = detect(await readFile(planted, 'utf8'), s.escapeToken)

      expect(verdict.gateLines, 'the [GATE] counter saw nothing in a file full of them').toBe(2)
      expect(verdict.carriesToken, 'the token search missed a token that is present').toBe(true)
    })
  })

  it('#19c the suite writes no [GATE] lines and no token into the real activity feed', async () => {
    await scenario('pipeline-19c', async (s) => {
      // Stronger than the shell version, which sourced no feed appender at all —
      // so `_pipe_feed` returned early and the case could not have observed a
      // write even if one were attempted. Here feed.sh IS sourced and
      // AGENT_FEED_LOG is UNSET, so the destination is derived exactly as it is
      // in production (#19a pins that derivation). The stage is named after this
      // scenario's escape token, so a line that escapes is attributable.
      // THE PATH IS ASKED OF feed.sh, FOR THE REAL ROOT — not reconstructed here.
      //
      // The first version of this case built it as `join(gitToplevel,
      // FEED_SUFFIX)`, and that was VACUOUS: pointed at a path that does not
      // exist, the before/after counts are both 0 and the token is absent, so the
      // case passes while observing nothing. Measured by perturbing the path and
      // watching the case stay green — which is the same defect, one level up,
      // that the deleted `[ -f ]` disarm switch had.
      //
      // So the authority is `feed_log_path` itself, invoked with AGENT_FEED_LOG
      // unset and cwd at the real checkout, which is the exact resolution a
      // production caller gets. That is the ONE child in this file that runs
      // outside the workspace, and it is safe for a narrow, stated reason:
      // `feed_log_path` only PRINTS a path — `feed_append` is what writes, and it
      // is not called. The escape token stays on this child's environment, so the
      // harness canary would still catch it if that ever stopped being true.
      const resolved = await runPipe(
        s,
        'p19c-resolve',
        `${RESOLVE_STATE_ROOT}. ${JSON.stringify(FEED_LIB)}\nfeed_log_path\necho\n`,
        { env: { AGENT_FEED_LOG: undefined }, cwd: REPO_ROOT },
      )
      expect(resolved.code, resolved.output).toBe(0)
      const realFeed = resolved.stdout.trim()

      // PRECONDITION, asserted rather than inherited. A guard watching an empty
      // string, a relative path, or anything that is not the feed is a guard
      // reporting "clean" about nothing.
      expect(realFeed, 'feed.sh resolved no path for the real checkout').not.toBe('')
      expect(realFeed, 'the resolved path is not absolute').toMatch(/^\//)
      expect(realFeed, 'the resolved path is not the activity feed').toMatch(
        new RegExp(`/${FEED_SUFFIX}$`),
      )

      const existedBefore = await readIfPresent(realFeed) !== '' || (await fileExists(realFeed))
      const before = detect(await readIfPresent(realFeed), s.escapeToken)

      // MAKE THE FIXTURE PROJECT-SHAPED (BUG-077). feed.sh no longer falls back
      // to `pwd` when it cannot identify a project — it drops the line rather
      // than guessing one — so a bare temp directory now resolves to nothing and
      // this case would pass vacuously for a NEW reason. `.blueprint-source` is
      // one of the three terminators `bp_state_root` walks for, and planting it
      // is what scripts/lib/state-dir.sh says a fixture that never `git init`s
      // owes: "the two markers are complete for real CHECKOUTS and NOT for
      // FIXTURES".
      await s.fs.write('.blueprint-source', 'config_version = 2\n')

      const r = await runPipe(
        s,
        'p19c',
        RESOLVE_STATE_ROOT +
          withFeed(`pipe_init 'gate'
pipe_stage '${s.escapeToken}' true
pipe_finish`),
        { env: { AGENT_FEED_LOG: undefined }, cwd: s.workspace.root },
      )
      expect(r.code, r.output).toBe(0)

      // The derived destination — inside the workspace — is where the lines went.
      // Asserting this is what makes the "real feed unchanged" half meaningful:
      // otherwise a renderer that wrote nowhere would also pass.
      const derived = await readFile(join(s.workspace.root, FEED_SUFFIX), 'utf8')
      expect(derived, 'the run wrote no feed lines anywhere — #19c would pass vacuously').toContain(
        s.escapeToken,
      )

      const after = detect(await readIfPresent(realFeed), s.escapeToken)

      expect(after.carriesToken, `this scenario's token reached ${realFeed}`).toBe(false)
      // Count, not byte-equality: a concurrent agent may legitimately append to
      // the operator's feed between the two readings. A [GATE] line is what only
      // a gate writes.
      expect(
        after.gateLines,
        `[GATE] lines appeared in ${realFeed}: ${before.gateLines} -> ${after.gateLines}`,
      ).toBe(before.gateLines)
      // And the run must not have CREATED it either. On a checkout where the feed
      // does not exist yet, the count comparison above is 0 -> 0 and carries no
      // information; this clause is what still has meaning there.
      expect(
        await fileExists(realFeed),
        `the run created the operator's feed at ${realFeed}`,
      ).toBe(existedBefore)
    })
  })

  it('#20 an exceeded SLO warns, never blocks, and points at optimising', async () => {
    await scenario('pipeline-20', async (s) => {
      // The whole design difference from the 30 s ceiling this replaced. The
      // ceiling BLOCKED, so the cheapest way to satisfy it was to move a suite
      // out of the gate — a performance limit that silently became a coverage
      // limit. If this SLO ever gains the power to fail a push, that pressure
      // returns, so the exit status is asserted explicitly.
      const tripped = await runPipe(
        s,
        'p20-tripped',
        `AGENT_GATE_SLO_TOTAL_MS=1\nexport AGENT_GATE_SLO_TOTAL_MS\n` +
          withLib(`pipe_init 'gate'
pipe_stage 'a' true
pipe_finish`),
      )

      expect(tripped.code, `an SLO breach failed the gate\n${tripped.output}`).toBe(0)
      expect(tripped.output, 'the SLO did not warn at all').toContain('SLO')
      expect(
        tripped.output,
        'the SLO warning does not steer away from demotion — which is how a perf limit becomes a coverage limit',
      ).toMatch(/do not (move|demote)|optimise/i)
    })
  })

  it('#20 a healthy gate is silent: default thresholds sit above the baseline', async () => {
    await scenario('pipeline-20-quiet', async (s) => {
      // Codex R2-F2: a threshold at or below the accepted baseline warns on
      // EVERY ordinary run, cannot distinguish a regression from normal
      // operation, and gets trained out within a week.
      const r = await runPipe(
        s,
        'p20-quiet',
        withLib(`pipe_init 'gate'
pipe_stage 'a' true
pipe_finish`),
      )

      expect(r.code, r.output).toBe(0)
      expect(
        r.output,
        'the DEFAULT thresholds warn on a trivial passing gate — the signal is noise from day one',
      ).not.toContain('SLO')
    })
  })

  it('#20 an SLO breach does not mask a real failure', async () => {
    await scenario('pipeline-20-mask', async (s) => {
      const r = await runPipe(
        s,
        'p20-mask',
        `AGENT_GATE_SLO_TOTAL_MS=1\nexport AGENT_GATE_SLO_TOTAL_MS\n` +
          withLib(`pipe_init 'gate'
pipe_stage 'boom' false
pipe_finish`),
      )

      expect(r.code, `THE GATE IS OPEN when the SLO trips alongside a failure\n${r.output}`).not.toBe(0)
    })
  })
})

/** The two markers #19 looks for, in one comparable shape. */
function detect(feedText: string, token: string): { gateLines: number; carriesToken: boolean } {
  return {
    gateLines: feedText.split('\n').filter((l) => l.includes('[GATE]')).length,
    carriesToken: feedText.includes(token),
  }
}

/** Read a file that may legitimately not exist yet. */
async function readIfPresent(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    // Not there yet, as the doc comment says. Empty is what callers compare against.
    return ''
  }
}

/** Does this path exist? Distinct from "is it empty", which #19c needs too. */
async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    // Absence is the probed state.
    return false
  }
}
