/**
 * tests/agent-activity-bound/agent-activity-bound.release.spec.ts — BUG-001.
 *
 * `agent-activity.sh` holds ONE instance with a BOUNDED process set. On a founder
 * host the old design reached ~17,400 script instances and ~8,700 `tail` processes,
 * exhausted `fs.inotify.max_user_instances` (128), and pegged ~24 of 32 threads for
 * 2.7 days at zero application load.
 *
 * These are BEHAVIOURAL assertions: the feed is actually started, actually written
 * to, and its log actually inspected. The source checks at the end are a cheap
 * backstop against the specific idioms that caused the defects — they are not the
 * coverage, and they cannot be.
 *
 * WHAT CHANGES IN THE PORT, AND WHY EACH CHANGE IS AN IMPROVEMENT RATHER THAN A
 * CONVENIENCE. All four are recorded because a silent change is still a change.
 *
 *   1. NO `--fast` SPLIT. The shell suite ran a subset in the pre-push gate and the
 *      race / fault-injection cases (#10, #18, #5f) only in CI. That split existed
 *      to fit a 30 s pre-push ceiling which was retired with BUG-005 — and CLAUDE.md
 *      §"Pre-push tolerance" now states plainly that a suite must never be demoted
 *      to fit a time budget. R7 makes a skip a build failure, so the split could not
 *      survive anyway.
 *
 *   2. ONE SCENARIO PER CASE, WHICH IS WHAT MAKES THIS SUITE PARALLEL-SAFE. The
 *      shell suite shared ONE fixture repo across all 34 assertions, and the
 *      supervisor lock is per REPO ROOT — not per state dir. That is why its
 *      teardown ordering was load-bearing (BUG-065: #7's teardown had to wait for
 *      its supervisor to be GONE before #2 started a feed, or `cmd_daemon` reported
 *      "started (daemon)" on the strength of a predecessor's lock and #2 then
 *      measured zero supervisors and blamed a leak). Here every case gets its own
 *      workspace and therefore its own repo root, so that interaction — and BUG-067,
 *      which is still open — is unreachable by construction rather than avoided by
 *      careful sequencing.
 *
 *   3. PROCESS COUNTS ARE SCOPED TO THIS SCENARIO. `#2` and `#15` counted
 *      `tail -n0 -F` MACHINE-WIDE, so a sibling test's processes changed their
 *      verdict. TASK-018-TARGET §1.2 names exactly that — "a machine-wide `ps`
 *      scan" — as the kind of thing that makes a test look like it needs serial
 *      execution when it is really reading something it does not own.
 *
 *   4. NO CASE WAITS A FIXED DURATION (R4). Where the shell slept to let ticks pass
 *      and then asserted an ABSENCE, this round-trips sentinels through the pumped
 *      JSONL transcript: each sentinel that comes back out of the feed is one tick PROVEN to
 *      have completed. That is strictly stronger than a sleep — it does not get
 *      weaker on a loaded box, and it does not get slower on an idle one. The one
 *      unavoidable bound is `withFeed`'s outer process ceiling, which is a safety
 *      net for a hung supervisor rather than a synchronisation point.
 *
 * THE HANDSHAKE IS NOT OPTIONAL (BUG-038). `expectSupervisors(1)` proves a
 * supervisor is RESIDENT. It does NOT prove the supervisor has seeded a baseline
 * offset for a given file, and those are not the same instant. Because the feed
 * deliberately does not replay pre-existing content (#16), a payload appended after
 * residency but before registration is folded into the baseline and is never
 * emitted — so the case reports "the reader lost it", which is indistinguishable
 * from the regression it exists to catch. THE LOSS IS PERMANENT: with `seed_offset`
 * delayed 5 s the payload never appeared in 184 s, and a bound raised to 45 s
 * against a measured 32.6 s first-record latency changed no outcome while adding
 * 2m41s to the run. Only re-writing the sentinel until one lands after the seed
 * closes it, which is what `readerReady` does.
 *
 * EQUIVALENCE RECORD (R6, and this migration's own evidence).
 *
 * Nineteen perturbed trees plus the healthy control and two negative controls were
 * built and BOTH implementations run over each: the retiring
 * `tests/agent-activity-bound/test.sh`, copied into the tree, and this spec with
 * `BP_SPEC_ROOT` pointed at it. Per-id verdict sets compared mechanically. Every
 * shipped mechanism and every review-found regression the old suite names has a
 * mutant: RC-1, RC-2, RC-6, R3, R4, I-2, I-3, #7, #8, #8b, #10, #12, #13, #14, #15f,
 * #16, #18.
 *
 * WHERE THEY AGREE: RC-6, I-3, R3, R4, I-2, #7, #8, #12, #14 and both negative
 * controls — identical red sets, to the id.
 *
 * WHERE THEY DIFFER, all five in the port's favour and none a regression:
 *
 *   - RC-1, RC-2, #16, #10, #13: the port reds a superset, because a leaked
 *     supervisor breaks every ownership assertion it owns, and because #11/#19 and
 *     #9 independently witness a mis-advanced offset.
 *   - THE SHELL SUITE RED `#15` AND `#2` ON SIX MUTANTS THAT TOUCH NO PROCESS CODE
 *     AT ALL — RC-6, I-3, R3, R4, #16, #12 — and those reds vanished on a clean
 *     re-run. Cause: both count `tail -n0 -F` MACHINE-WIDE, and the RC-2 tree had
 *     left 89 orphaned followers behind (a follower outlives the supervisor that
 *     forked it), so one tree's debris decided six later trees' verdicts. That is
 *     the reading-what-you-do-not-own defect R5 names, measured rather than
 *     supposed, and it is why `ownedProcesses()` scopes every count to the
 *     scenario's own workspace.
 *
 * FOUR ASSERTIONS NEITHER IMPLEMENTATION CAN FAIL, recorded because mutation cannot
 * close them — each needs a new assertion rather than a stricter one (BUG-094):
 *
 *   - `#8b` cannot witness the loss of the inode-reset branch. Its rotated-in file
 *     is SMALLER than the old offset, so the truncation branch (`size < off → 0`)
 *     resets it anyway and the case passes with the rotation branch deleted.
 *   - `#18` cannot witness the loss of the short-capture guard. Dropping one byte
 *     from a newline-terminated payload leaves a capture with no trailing newline,
 *     which the fragment path already withholds — so nothing is emitted either way.
 *     A witness needs a multi-record payload where the short capture still ends in a
 *     newline.
 *   - `#15f` cannot witness a `tee`. The mutant pipes each emit through one, so the
 *     child is transient and a `ps` snapshot almost never catches it.
 *   - `#13` passes when `--status` is made to trust the state file, because
 *     `resolve_supervisor` then rejects the dead pid and `--status` still exits
 *     non-zero — one fail-closed branch impersonating another (cf. BUG-081). The
 *     defect IS caught, by `#13b` and `#4`.
 *
 * One mutant is weaker than its name: `R3` perturbs only the FRAGMENT length path,
 * so `#17` correctly stays green and the static backstop is what fires. A faithful
 * R3 mutant would route the payload itself through `$()`.
 */

import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { REPO_ROOT, RealStateCanary, scenario, type Scenario } from '../harness/index.js'
import { feedFixture, type FeedFixture } from '../helpers/feed-fixture.js'

/**
 * The tree under test. `BP_SPEC_ROOT` repoints it at a perturbed copy, which is how
 * the equivalence driver runs this spec and the retiring shell suite over the same
 * bytes. It selects the SUBJECT, never the sandbox.
 */
const SUBJECT = process.env.BP_SPEC_ROOT ?? REPO_ROOT

const FEED = join(SUBJECT, 'scripts', 'agent-activity.sh')

/** One production-shaped Claude subagent record. */
function jsonlRecord(text: string): string {
  return `${JSON.stringify({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text }] } })}\n`
}

/** A script's source with comments stripped — this file's header names the idioms. */
async function code(path: string): Promise<string> {
  const raw = await readFile(path, 'utf8').catch(() => '')
  return raw.replace(/^[ \t]*#.*$/gm, '').replace(/[ \t]#.*$/gm, '')
}

/**
 * The instrumented fixture every behavioural case uses.
 *
 * The pumped source is a Claude subagent JSONL transcript: that is the production
 * `pump` path. Provider launchers label their own output because the supervisor
 * cannot recover a dispatch holder after the fact. These assertions are about the
 * shared byte-exact delta reader before its JSONL projection, so this real caller
 * exercises bounded reads, truncation, rotation and split records without retaining
 * a dead `raw` branch solely for tests.
 */
interface Bound {
  readonly f: FeedFixture
  /** Workspace-relative path of the pumped production JSONL source. */
  readonly runLogRel: string
  /** Append already-encoded bytes to the pumped JSONL source. */
  append(text: string): Promise<void>
  /** Wait until the JSONL reader has registered the pumped source. */
  ready(): Promise<void>
  /** Truncate the pumped run log. */
  truncate(): Promise<void>
  /**
   * Prove that `n` further ticks completed, by round-tripping a sentinel each time.
   *
   * This is what replaces every `sleep` that preceded an ABSENCE assertion. A sleep
   * asserts "enough time passed for the bug to show"; this asserts "the supervisor
   * completed n more cycles", which is the property actually wanted and which does
   * not degrade under load.
   *
   * THE SENTINEL GOES THROUGH A SEPARATE PUMPED FILE — a subagent transcript, not
   * the run log the cases write to. Writing it to the run log is wrong in a way that
   * is invisible until the split-record case: the sentinel's trailing newline
   * COMPLETES the deliberately-incomplete fragment #11/#19 is holding, so the feed
   * emitted `SPLIT-héllo-→TICK-PROOF-1` and the case failed while the code was
   * correct. A tick prover must not be able to alter what it is measuring.
   */
  proveTicks(n: number): Promise<void>
}

async function bound(s: Scenario, name = 'repo'): Promise<Bound> {
  const f = await feedFixture(s, name, {
    source: SUBJECT,
    holder: 'Fixture',
    state: 'ACTIVE',
  })
  const runLogRel = `home/.claude/projects/${f.repo.replace(/\//g, '-')}/sess/subagents/agent-pump-subject.jsonl`
  await s.fs.write(runLogRel, '')

  // A pumped file the cases never touch, so proving a tick cannot alter what the
  // tick is being counted for. A subagent transcript is the other thing the feed
  // pumps, and its records are self-delimiting JSON — so an appended sentinel can
  // never accidentally terminate a fragment the subject is holding.
  const tickRel = `home/.claude/projects/${f.repo.replace(/\//g, '-')}/sess/subagents/agent-tickproof.jsonl`
  await s.fs.write(tickRel, '')

  let tick = 0
  return {
    f,
    runLogRel,
    append: async (text) => void (await s.fs.write(runLogRel, text, { append: true })),
    ready: async () => void (await f.readerReady(runLogRel, { wrap: jsonlRecord })),
    truncate: async () => void (await s.fs.write(runLogRel, '')),
    proveTicks: async (n) => {
      if (n === 0) return
      // The tick file needs its own handshake once, for the same reason every other
      // watched file does: until it is seeded, a sentinel written to it is folded
      // into the baseline and never comes back (BUG-038).
      if (tick === 0) {
        await f.readerReady(tickRel, {
          wrap: (t) =>
            `${JSON.stringify({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: t }] } })}\n`,
        })
      }
      for (let i = 0; i < n; i += 1) {
        tick += 1
        const mark = `TICK-PROOF-${tick}`
        await s.fs.write(
          tickRel,
          `${JSON.stringify({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: mark }] } })}\n`,
          { append: true },
        )
        await f.expectLine(mark)
      }
    },
  }
}

/** A UTF-8 locale this host actually has, for the multibyte half of #11/#19. */
async function utf8Locale(s: Scenario): Promise<string> {
  const r = await s.run('sh', ['-c', 'locale -a 2>/dev/null'], { cwd: s.workspace.root })
  const found = r.stdout
    .split('\n')
    .find((l) => /^(en_US|C)\.(utf-?8)$/i.test(l.trim()))
  // R7: no skipping. The shell suite announced "#19 cannot prove the LC_ALL=C fix
  // on this host" and carried on green, which is BUG-005 in miniature — covering
  // less while reporting success. A host with no multibyte locale now FAILS, and
  // says what to install.
  expect(
    found,
    'no UTF-8 locale on this host, so the LC_ALL=C byte-counting fix cannot be ' +
      'proven. Install one (locale-gen en_US.UTF-8) rather than skipping the case.',
  ).toBeDefined()
  return (found ?? '').trim()
}

describe('BUG-001 / BUG-141 — one instance, a bounded process set, byte-correct reads', () => {
  // =========================================================================
  // RC-1 — the instance guard.
  // =========================================================================
  it('#1 50 concurrent starts → exactly 1 supervisor', async () => {
    await scenario('aab-1', async (s) => {
      // EXACTLY one, not "at most": zero would mean the daemon never started, and
      // the consensus plan requires one survivor.
      const b = await bound(s)
      try {
        await Promise.all(
          Array.from({ length: 50 }, () =>
            s.run('bash', ['scripts/agent-activity.sh', '--daemon'], {
              cwd: b.f.repo,
              env: b.f.env,
            }),
          ),
        )
        await b.f.expectSupervisors(1)
        expect((await b.f.ownedProcesses()).supervisors).toBe(1)
      } finally {
        await b.f.cli(['--stop'])
        await b.f.expectSupervisors(0)
      }
    })
  })

  it('#15 one resident process; no follow-by-name tails', async () => {
    await scenario('aab-15', async (s) => {
      const b = await bound(s)
      await b.f.withDaemon(async () => {
        // RC-2: the resident set is ONE supervisor doing its own reads. A `tail -F`
        // per watched file is the shape that reached ~8,700 processes.
        expect(await b.f.ownedProcesses()).toEqual({ supervisors: 1, tails: 0 })
      })
    })
  })

  it('#5 --status reports running', async () => {
    await scenario('aab-5', async (s) => {
      const b = await bound(s)
      await b.f.withDaemon(async () => {
        expect((await b.f.cli(['--status'])).code).toBe(0)
      })
    })
  })

  it('#5b --stop leaves zero residue', async () => {
    await scenario('aab-5b', async (s) => {
      const b = await bound(s)
      await b.f.withDaemon(async () => {})
      expect((await b.f.ownedProcesses()).supervisors).toBe(0)
    })
  })

  it('#5c --status reports not running after stop', async () => {
    await scenario('aab-5c', async (s) => {
      const b = await bound(s)
      await b.f.withDaemon(async () => {})
      expect((await b.f.cli(['--status'])).code).not.toBe(0)
    })
  })

  it('#6 concurrent stop/start converges to exactly one supervisor', async () => {
    await scenario('aab-6', async (s) => {
      const b = await bound(s)
      try {
        await b.f.cli(['--daemon'])
        await b.f.expectSupervisors(1)
        // Converge deliberately: a race may legitimately land on 0, but the
        // CONTRACT is "no wedged lock, no double start" — so a follow-up start must
        // reach exactly 1.
        await Promise.all([b.f.cli(['--stop']), b.f.cli(['--daemon'])])
        await b.f.cli(['--daemon'])

        await b.f.expectSupervisors(1)
      } finally {
        await b.f.cli(['--stop'])
        await b.f.expectSupervisors(0)
      }
    })
  })

  // =========================================================================
  // Byte-correct delta reads.
  // =========================================================================
  it('#16 pre-existing content not replayed', async () => {
    await scenario('aab-16', async (s) => {
      const b = await bound(s)
      // Written BEFORE the feed ever starts.
      await b.append(jsonlRecord('PRE-EXISTING-must-not-replay'))

      await b.f.withDaemon(async () => {
        // The absence is bounded by a PROVEN tick rather than by a sleep: once the
        // supervisor has completed a full cycle over this file, "not replayed" is a
        // fact instead of a guess about latency.
        await b.ready()
        await b.proveTicks(1)

        expect(await b.f.count('PRE-EXISTING-must-not-replay')).toBe(0)
      })
    })
  })

  it('#17 lone complete record emitted once, unaided by a successor or force-flush', async () => {
    await scenario('aab-17a', async (s) => {
      // THE ASSERTION THAT FAILS AGAINST THE `$()` FORMULATION, where command
      // substitution strips the trailing newline and k=0 leaves the record stuck
      // until the fragment bound. Not a latency assertion: several ticks are
      // allowed, because claiming "next tick" while polling many would say more
      // than it measures.
      const b = await bound(s)
      await b.f.withDaemon(async () => {
        await b.ready()
        await b.append(jsonlRecord('SOLO-RECORD'))
        await b.f.expectLine('SOLO-RECORD')
        await b.proveTicks(1)

        expect(await b.f.count('SOLO-RECORD')).toBe(1)
      })
    })
  })

  it('#17 offset advanced by the record (successor emitted, no re-emission)', async () => {
    await scenario('aab-17b', async (s) => {
      const b = await bound(s)
      await b.f.withDaemon(async () => {
        await b.ready()
        await b.append(jsonlRecord('SOLO-RECORD'))
        await b.f.expectLine('SOLO-RECORD')
        // A stalled offset would either re-emit the first record or swallow this one.
        await b.append(jsonlRecord('SOLO-NEXT'))
        await b.f.expectLine('SOLO-NEXT')

        expect(await b.f.count('SOLO-RECORD')).toBe(1)
      })
    })
  })

  it('#11/#19 incomplete multibyte record withheld', async () => {
    await scenario('aab-11a', async (s) => {
      // The split-record property (#11) holds in any locale. The MULTIBYTE part
      // (#19) only exercises the LC_ALL=C fix under a UTF-8 locale — in the C
      // locale awk already counts bytes, so it would pass vacuously against the
      // very implementation it exists to catch. So the locale is selected
      // explicitly, and its absence is a failure rather than a skip.
      const locale = await utf8Locale(s)
      const b = await bound(s)
      await b.f.withDaemon(
        async () => {
          await b.ready()
          const record = jsonlRecord('SPLIT-héllo-→-TAIL')
          await b.append(record.slice(0, record.indexOf('-TAIL')))

          await b.proveTicks(1)
          expect(
            await b.f.count('SPLIT-héllo-→'),
            'an incomplete record was emitted before its newline (byte/char mismatch)',
          ).toBe(0)
        },
        { LC_ALL: locale },
      )
    })
  })

  it('#11/#19 completed multibyte record emitted exactly once, intact', async () => {
    await scenario('aab-11b', async (s) => {
      const locale = await utf8Locale(s)
      const b = await bound(s)
      await b.f.withDaemon(
        async () => {
          await b.ready()
          const record = jsonlRecord('SPLIT-héllo-→-TAIL')
          const cut = record.indexOf('-TAIL')
          await b.append(record.slice(0, cut))
          await b.proveTicks(1)
          await b.append(record.slice(cut))

          await b.f.expectLine('SPLIT-héllo-→-TAIL')
          await b.proveTicks(1)
          expect(await b.f.count('SPLIT-héllo-→-TAIL')).toBe(1)
        },
        { LC_ALL: locale },
      )
    })
  })

  it('#3 quiet-then-active file still emits (never evicted)', async () => {
    await scenario('aab-3', async (s) => {
      // The rev-1 pool design would have evicted this file. Idleness is proven by
      // completed ticks rather than by sleeping: three cycles with nothing written
      // to this file is exactly what "went quiet" means, and it is checkable.
      const b = await bound(s)
      await b.f.withDaemon(async () => {
        await b.ready()
        const other = `${b.runLogRel.replace('agent-pump-subject.jsonl', 'agent-quiet-probe.jsonl')}`
        await s.fs.write(other, '')
        await b.proveTicks(3)

        await b.append(jsonlRecord('AFTER-IDLE'))
        await b.f.expectLine('AFTER-IDLE')
      })
    })
  })

  it('#12 oversized newline-less line force-flushed exactly once', async () => {
    await scenario('aab-12a', async (s) => {
      // A newline-less writer must not re-read forever. The force-flush bound is
      // turned right down, because proving the branch at the 1 MiB default would
      // mean writing a megabyte to reach a branch a hundred bytes reaches.
      const b = await bound(s)
      await b.f.withDaemon(
        async () => {
          await b.ready()
          await b.append('X'.repeat(200))

          await b.f.expectLine('force-flushed')
          await b.proveTicks(1)
          expect(
            await b.f.count('force-flushed'),
            'the offset did not advance past the fragment — a re-read loop',
          ).toBe(1)
        },
        { AGENT_FEED_MAX_FRAGMENT: '64' },
      )
    })
  })

  it('#12 stream continues after a force-flush', async () => {
    await scenario('aab-12b', async (s) => {
      const b = await bound(s)
      await b.f.withDaemon(
        async () => {
          await b.ready()
          await b.append('X'.repeat(200))
          await b.f.expectLine('force-flushed')

          await b.append(jsonlRecord('AFTER-FLUSH'))
          await b.f.expectLine('AFTER-FLUSH')
        },
        { AGENT_FEED_MAX_FRAGMENT: '64' },
      )
    })
  })

  // =========================================================================
  // RC-6 / I-3 — change detection on the baton.
  // =========================================================================
  it('#9 unchanged signal file emits nothing further (RC-6)', async () => {
    await scenario('aab-9', async (s) => {
      const b = await bound(s)
      await b.f.withDaemon(async () => {
        // THE SUBTLETY THAT MADE THIS THE MOST FREQUENT FAILURE IN THE SHELL SUITE
        // (5 of 8 runs): a new supervisor emits its banner ("feed started", or
        // "feed restarted" over an existing log since BUG-129 removed the wipe),
        // emits the baton line ONCE, and only then seeds the run log. Sampling the
        // baseline between the truncate and that baton line reads 0, the startup
        // line then lands inside the sampling window, and the case reports
        // "re-emitted every tick" about a supervisor that emitted exactly once. The
        // handshake proves the seed happened, which is strictly after the baton
        // line, so the baseline is sampled on a settled log.
        await b.ready()
        const base = await b.f.count('ACTIVE —')

        await b.proveTicks(3)

        expect(
          await b.f.count('ACTIVE —'),
          'the unchanged baton re-emitted every tick (a stat blob read as an mtime)',
        ).toBe(base)
      })
    })
  })

  it('#9b same-size in-place signal edit detected (I-3)', async () => {
    await scenario('aab-9b', async (s) => {
      // size+inode is a STREAM IDENTITY, not a change token. `signal_token` is a
      // `cksum` of the content for exactly this reason.
      const b = await bound(s)
      const baton = (task: string): string =>
        `# Agent Signal\n\n| Field | Value |\n|---|---|\n| Holder | Fixture |\n` +
        `| State | ACTIVE |\n| Task | ${task} |\n| Last update | 2026-09-11 |\n`

      await b.f.withDaemon(async () => {
        await b.ready()
        await s.fs.write('repo/state/signal.md', baton('AAAA'))
        await b.f.expectLine('AAAA')

        // Identical byte length, rewritten in place.
        await s.fs.write('repo/state/signal.md', baton('BBBB'))

        await b.f.expectLine('BBBB')
      })
    })
  })

  it('#20 BUG-129: a supervisor restart APPENDS to the feed, it does not truncate it', async () => {
    await scenario('aab-20', async (s) => {
      // THE HONEST REPRODUCER, staged rather than asserted about. It runs the real
      // script, a real second supervisor start, and the REAL canary — the same
      // class that turns `tests/subagent-feed` #9 red in the push gate when a wake
      // coincides with a suite run. Nothing real is touched: the canary watches
      // this fixture's own feed under the label the live one uses.
      //
      // The feed's contract is append-only — `tests/harness/canary.ts` is built on
      // it, and `emit` is the only other writer. `supervise_body` broke it once per
      // start with `: >"$out"`, so a restart looked exactly like a fixture escape.
      const f = await feedFixture(s, 'fx')

      await f.withFeed(async () => {
        await f.expectLine('[agent-activity] feed')
      })

      // THE FEED NEEDS HISTORY THE RESTART CANNOT REPRODUCE, and this is measured
      // rather than defensive: without it this case PASSED against the unfixed
      // script. The fixture is deterministic and fast, so both supervisors emit the
      // same banner and the same baton line inside the same second — the rewritten
      // content came out BYTE-IDENTICAL, the prefix check saw nothing, and the
      // truncation was invisible. Live, the two starts are minutes apart, which is
      // why the same wipe turns `tests/subagent-feed` #9 red on the founder's host
      // and turned nothing red here.
      const HISTORY = 'PRIOR-HISTORY-A-RESTART-CANNOT-REPRODUCE\n'
      await s.fs.write('fx/logs/agent-activity.log', HISTORY, { append: true })

      const before = await f.read()
      expect(before, 'the first supervisor wrote nothing, so this case would be vacuous').not.toBe('')
      expect(before, 'the history marker is what makes the truncation observable').toContain(HISTORY.trim())

      const canary = await RealStateCanary.capture([{ label: 'activity feed', path: f.log }])

      await f.withFeed(async () => {
        // The condition that holds in BOTH worlds, so the red lands on the canary
        // rather than on a wait for a line that cannot exist yet: the second
        // supervisor has touched the feed. Before the fix that is the truncation;
        // after it, the appended restart banner.
        await vi.waitFor(
          async () => {
            expect(await f.read(), 'the second supervisor never wrote to the feed').not.toBe(before)
          },
          { timeout: 8_000, interval: 100 },
        )
      })

      // Throws "activity feed was rewritten or truncated, not appended to" while
      // the wipe is there. A restart must be indistinguishable from any other
      // append, or every suite running under a live feed is a coin toss.
      await canary.assertUnchanged()
    })
  })

  it('#8 truncation handled; stream resumes', async () => {
    await scenario('aab-8', async (s) => {
      const b = await bound(s)
      await b.f.withDaemon(async () => {
        await b.ready()
        await b.truncate()
        await b.append(jsonlRecord('AFTER-TRUNCATE'))

        await b.f.expectLine('AFTER-TRUNCATE')
      })
    })
  })

  it('#8b rotation handled (inode change resets offset)', async () => {
    await scenario('aab-8b', async (s) => {
      const b = await bound(s)
      await b.f.withDaemon(async () => {
        await b.ready()
        // A NEW INODE at the same path, which is what a rotator produces.
        await s.run('mv', [join(s.workspace.root, b.runLogRel), join(s.workspace.root, `${b.runLogRel}.old`)], {
          cwd: s.workspace.root,
        })
        await s.fs.write(b.runLogRel, jsonlRecord('AFTER-ROTATE'))

        await b.f.expectLine('AFTER-ROTATE')
      })
    })
  })

  // =========================================================================
  // Identity and recovery — the state file must never be trusted on its own.
  // =========================================================================
  it('#13 stale state after SIGKILL reports not running', async () => {
    await scenario('aab-13', async (s) => {
      const b = await bound(s)
      await b.f.cli(['--daemon'])
      await b.f.expectSupervisors(1)
      const pid = await b.f.supervisorPid()
      expect(pid, 'the supervisor published no pid — the case cannot proceed').not.toBe('')

      await s.run('kill', ['-9', pid], { cwd: s.workspace.root })
      await b.f.expectSupervisors(0)

      // The LOCK is the oracle, not the state file. flock is released by the kernel
      // on SIGKILL, so "can I take it?" answers "is a supervisor alive?".
      expect((await b.f.cli(['--status'])).code, '--status trusted a stale state file').not.toBe(0)
    })
  })

  it('#13b stale --stop exits cleanly without signalling', async () => {
    await scenario('aab-13b', async (s) => {
      const b = await bound(s)
      await b.f.cli(['--daemon'])
      await b.f.expectSupervisors(1)
      const pid = await b.f.supervisorPid()
      await s.run('kill', ['-9', pid], { cwd: s.workspace.root })
      await b.f.expectSupervisors(0)

      expect((await b.f.cli(['--stop'])).code).toBe(0)
    })
  })

  it('#4 lock released by SIGKILL; restart yields exactly one supervisor', async () => {
    await scenario('aab-4', async (s) => {
      // A SURVIVING CHILD THAT INHERITED THE LOCK FD keeps the lock alive, so
      // recovery-by-SIGKILL would never converge.
      const b = await bound(s)
      try {
        await b.f.cli(['--daemon'])
        await b.f.expectSupervisors(1)
        const pid = await b.f.supervisorPid()
        await s.run('kill', ['-9', pid], { cwd: s.workspace.root })
        await b.f.expectSupervisors(0)

        const restart = await b.f.cli(['--daemon'])
        await b.f.expectSupervisors(1)
        expect((await b.f.ownedProcesses()).supervisors, restart.output).toBe(1)
      } finally {
        await b.f.cli(['--stop'])
        await b.f.expectSupervisors(0)
      }
    })
  })

  it('BUG-135 --daemon restarts a running supervisor whose code changed', async () => {
    await scenario('aab-135', async (s) => {
      // A running daemon sourced scripts/lib/roster.sh (and its own script) at
      // start. Editing a sourced lib underneath it — what a fix, or a
      // `blueprint pull` in a derived project, does — must make the NEXT
      // `--daemon` replace it, instead of leaving it running the old bytes
      // forever ("already running — leaving it").
      const b = await bound(s)
      try {
        await b.f.cli(['--daemon'])
        await b.f.expectSupervisors(1)
        const before = await b.f.supervisorPid()
        expect(before).not.toBe('')

        // Change a file the daemon sources, but not agent-activity.sh itself —
        // proving the identity check covers the LIBS, not just the entry point.
        await s.fs.write('repo/scripts/lib/roster.sh', '\n# BUG-135 test perturbation\n', {
          append: true,
        })

        const restart = await b.f.cli(['--daemon'])
        expect(restart.stdout, restart.output).toMatch(/code has changed.*restart/i)

        await b.f.expectSupervisors(1)
        const after = await b.f.supervisorPid()
        expect(after, 'still the pre-change pid — the daemon was not restarted').not.toBe(before)

        // An immediate second --daemon, with nothing further changed, is a no-op.
        const again = await b.f.cli(['--daemon'])
        expect(again.stdout, again.output).toMatch(/already running/)
        await b.f.expectSupervisors(1)
        expect(await b.f.supervisorPid()).toBe(after)
      } finally {
        await b.f.cli(['--stop'])
        await b.f.expectSupervisors(0)
      }
    })
  })

  it('#14 mismatched start-token → refused to signal an unrelated process', async () => {
    await scenario('aab-14', async (s) => {
      // PRECONDITION: a feed MUST be running, or `--stop` short-circuits on
      // "nothing to stop" and never reaches identity validation — the case would
      // pass against an implementation with no validation at all.
      const b = await bound(s)
      const stateFile = 'repo/logs/.agent-activity.state'
      try {
        await b.f.cli(['--daemon'])
        await b.f.expectSupervisors(1)
        const real = await s.fs.read(stateFile)

        // A victim this scenario owns, standing in for a reused pid.
        const victimPid = `${s.workspace.root}/victim.pid`
        const victim = s
          .run('sh', ['-c', `echo $$ > "${victimPid}"; exec sleep 300`], {
            cwd: s.workspace.root,
            timeoutMs: 120_000,
          })
          .catch(() => undefined)
        await vi.waitFor(async () => expect(await s.fs.exists('victim.pid')).toBe(true), {
          timeout: 20_000,
          interval: 50,
        })
        const vpid = (await s.fs.read('victim.pid')).trim()

        await s.fs.write(stateFile, `pid=${vpid}\nnonce=bogus\ntoken=NOT-THE-REAL-TOKEN\n`)
        const stop = await b.f.cli(['--stop'])

        expect(stop.code, '--stop signalled a process whose identity did not match').not.toBe(0)
        expect(
          (await s.run('kill', ['-0', vpid], { cwd: s.workspace.root })).code,
          'the unrelated process was killed',
        ).toBe(0)

        await s.fs.write(stateFile, real)
        await s.run('kill', ['-9', vpid], { cwd: s.workspace.root })
        await victim
      } finally {
        await b.f.cli(['--stop'])
        await b.f.expectSupervisors(0)
      }
    })
  })

  it('#14b missing nonce alone fails closed (I-2)', async () => {
    await scenario('aab-14b', async (s) => {
      // ONLY the nonce is omitted — real pid, real token. Anything else and the
      // baseline rejects on the token instead, so the case would pass against the
      // very implementation it is meant to catch.
      //
      // The nonce is not decoration: `start_token` on Linux is the start time in
      // clock ticks since BOOT, so after a reboot a fresh process can legitimately
      // carry the same pid AND the same token as the dead supervisor.
      const b = await bound(s)
      const stateFile = 'repo/logs/.agent-activity.state'
      try {
        await b.f.cli(['--daemon'])
        await b.f.expectSupervisors(1)
        const real = await s.fs.read(stateFile)
        const pid = /^pid=(\d+)$/m.exec(real)?.[1] ?? ''
        const token = /^token=(.*)$/m.exec(real)?.[1] ?? ''
        expect(pid, 'no pid in the state file').not.toBe('')
        expect(token, 'no token in the state file').not.toBe('')

        await s.fs.write(stateFile, `pid=${pid}\ntoken=${token}\n`)

        expect(
          (await b.f.cli(['--stop'])).code,
          'a state file with a valid pid+token but NO nonce was accepted',
        ).not.toBe(0)
        await s.fs.write(stateFile, real)
      } finally {
        await b.f.cli(['--stop'])
        await b.f.expectSupervisors(0)
      }
    })
  })

  // =========================================================================
  // Quoting, scale, and the two fault-injection seams.
  // =========================================================================
  it('#7 state dir containing spaces handled', async () => {
    await scenario('aab-7', async (s) => {
      const b = await bound(s)
      const spacey = await s.fs.mkdirp('repo/state dir with spaces')
      const spaceySubject = `home/.claude/projects/${b.f.repo.replace(/\//g, '-')}/sess/subagents/agent-spacey.jsonl`
      await s.fs.write(spaceySubject, '')
      await s.fs.write(
        'repo/state dir with spaces/signal.md',
        '| Field | Value |\n|---|---|\n| Holder | Fixture |\n| State | ACTIVE |\n| Task | t |\n',
      )
      const spaceyEnv = {
        AGENT_STATE_HOME: spacey,
        AGENT_SIGNAL_FILE: join(spacey, 'signal.md'),
      }

      await s.run('bash', ['scripts/agent-activity.sh', '--daemon'], {
        cwd: b.f.repo,
        env: { ...b.f.env, ...spaceyEnv },
      })
      try {
        await b.f.expectSupervisors(1)
        await b.f.expectLine('ACTIVE — t')
        // The supervisor is using the spacey state directory for its signal and
        // own state; this production JSONL subject then proves that it remained
        // alive and pumping rather than merely starting successfully.
        await b.f.readerReady(spaceySubject, { wrap: jsonlRecord })
        await s.fs.write(spaceySubject, jsonlRecord('SPACED-PATH-OK'), {
          append: true,
        })

        await b.f.expectLine('SPACED-PATH-OK')
      } finally {
        await s.run('bash', ['scripts/agent-activity.sh', '--stop'], {
          cwd: b.f.repo,
          env: { ...b.f.env, ...spaceyEnv },
        })
        await b.f.expectSupervisors(0)
      }
    })
  })

  it('#2 process count independent of transcript count (40→80 files: 1 supervisor, 0 tails)', async () => {
    await scenario('aab-2', async (s) => {
      // RC-2. Resident count staying independent of watched-file count IS the bug:
      // the old design held a follower per file and reached ~8,700 of them.
      const b = await bound(s)
      const proj = `home/.claude/projects/${b.f.repo.replace(/\//g, '-')}/sess/subagents`
      const makeTranscripts = async (from: number, to: number): Promise<void> => {
        for (let i = from; i < to; i += 1) {
          await s.fs.write(
            `${proj}/agent-${i}.jsonl`,
            `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `a${i}` }] } })}\n`,
          )
        }
      }
      await makeTranscripts(0, 40)

      await b.f.withDaemon(async () => {
        await b.ready()
        await b.proveTicks(1)
        const at40 = await b.f.ownedProcesses()

        await makeTranscripts(40, 80)
        // A completed tick AFTER the new files exist is what makes the second
        // reading meaningful: it proves the supervisor has seen all 80.
        await b.proveTicks(1)
        const at80 = await b.f.ownedProcesses()

        expect({ at40, at80 }).toEqual({
          at40: { supervisors: 1, tails: 0 },
          at80: { supervisors: 1, tails: 0 },
        })
      })
    })
  })

  it('#10 append during a slowed read: every record emitted exactly once', async () => {
    await scenario('aab-10', async (s) => {
      // R-1. The read window is widened by a TEST SEAM so the race is deterministic
      // rather than timing-luck: advancing the offset short duplicates records,
      // advancing it long skips them, and only exactly-once is correct.
      // THE SEAM IS A CLOCK THIS TEST SETS, and the appends are placed as fractions
      // OF IT. R4 permits controlling the clock and forbids guessing at one, and
      // that distinction is the whole of this case: `AGENT_FEED_TEST_SLOW_READ`
      // makes `pump` sleep a KNOWN number of seconds between stat'ing the file and
      // reading it, so a write landing a third of the way into that window is inside
      // the read by construction — it is not a bet on how fast the machine is.
      //
      // The first version of this port removed the shell's delays as R4 violations
      // and thereby removed the RACE: all three records landed before any read
      // window opened, and the case then passed against a mutant that advances the
      // offset to a RE-STAT — which silently drops anything appended during a read,
      // the exact defect #10 exists to catch. Measured, not assumed: that mutant is
      // caught by #9 and #11/#19 and was NOT caught here.
      const seamSeconds = 3
      const intoSeam = (fraction: number): Promise<void> =>
        new Promise((r) => setTimeout(r, seamSeconds * 1000 * fraction))

      const b = await bound(s)
      await b.f.withDaemon(
        async () => {
          await b.ready()
          await b.append(jsonlRecord('RACE-A')) // present when the snapshot is taken
          await intoSeam(1 / 3)
          await b.append(jsonlRecord('RACE-B')) // lands DURING the slowed read
          await intoSeam(1 / 3)
          await b.append(jsonlRecord('RACE-C'))

          // The shell gave this one call 30 s against its own default of 8
          // (`wait_for RACE-C 30`, test.sh:578), because the case DELIBERATELY
          // slows the read by `seamSeconds`: measured here at 4.60/4.61/4.62 s
          // over three runs — deterministic, and the only caller in these suites
          // that does not fit the 8 s default. Same number, same reason.
          await b.f.expectLine('RACE-C', 30_000)
          await b.proveTicks(1)
          // Advancing the offset short DUPLICATES, advancing it long SKIPS. Only
          // exactly-once is correct, which is why all three counts are asserted.
          expect({
            a: await b.f.count('RACE-A'),
            b: await b.f.count('RACE-B'),
            c: await b.f.count('RACE-C'),
          }).toEqual({ a: 1, b: 1, c: 1 })
        },
        { AGENT_FEED_TEST_SLOW_READ: String(seamSeconds) },
      )
    })
  })

  it('#18 short sink emits nothing and consumes nothing', async () => {
    await scenario('aab-18a', async (s) => {
      // R-1. If the bounded capture comes up short the tick must emit NOTHING and
      // advance NOTHING. The sink is armed MID-RUN, on the same supervisor, because
      // a restart would legitimately re-seed at EOF and mask the property.
      const b = await bound(s)
      const sentinel = join(s.workspace.root, 'short-sink-active')
      await b.f.withDaemon(
        async () => {
          // The handshake must complete while the sink is HEALTHY — the seam's whole
          // purpose is to suppress emission, so arming it first would make the
          // handshake unsatisfiable.
          await b.ready()
          await s.fs.write('short-sink-active', '')
          await b.append(jsonlRecord('SHORTSINK-PAYLOAD'))

          await b.proveTicks(0)
          // Nothing can be round-tripped while the sink is short, so the absence is
          // bounded by the RECOVERY below instead: the payload arriving intact and
          // exactly once after the sink is healthy proves the suppressed ticks
          // consumed nothing. That ordering is the assertion.
          expect(
            await b.f.count('SHORTSINK-PAYLOAD'),
            'a short capture was emitted — partial bytes escaped the bounded read',
          ).toBe(0)
        },
        { AGENT_FEED_TEST_SHORT_SINK: sentinel },
      )
    })
  })

  it('#18 deferred range delivered intact, exactly once, by the same supervisor', async () => {
    await scenario('aab-18b', async (s) => {
      const b = await bound(s)
      const sentinel = join(s.workspace.root, 'short-sink-active')
      await b.f.withDaemon(
        async () => {
          await b.ready()
          await s.fs.write('short-sink-active', '')
          await b.append(jsonlRecord('SHORTSINK-PAYLOAD'))
          await s.fs.rm('short-sink-active') // sink healthy again

          await b.f.expectLine('SHORTSINK-PAYLOAD')
          await b.proveTicks(1)
          expect(await b.f.count('SHORTSINK-PAYLOAD')).toBe(1)
        },
        { AGENT_FEED_TEST_SHORT_SINK: sentinel },
      )
    })
  })

  // =========================================================================
  // R-3 — foreground mode.
  // =========================================================================
  it('#5f foreground blocks (does not return like --daemon)', async () => {
    await scenario('aab-5f-block', async (s) => {
      const b = await bound(s)
      await b.f.withFeed(async () => {
        // It blocks if it is still resident once it has demonstrably started
        // pumping — which is a condition, where "it did not return yet" measured
        // against a sleep is a guess.
        await b.ready()
        expect((await b.f.ownedProcesses()).supervisors).toBe(1)
      })
    })
  })

  it("#15f foreground spawns no 'tee' (supervisor writes both sinks)", async () => {
    await scenario('aab-15f', async (s) => {
      const b = await bound(s)
      await b.f.withFeed(async () => {
        await b.ready()
        // THE PARENT PID HAS TO BE THE SUPERVISOR'S OWN. The first version passed
        // the supervisor COUNT to awk as if it were a pid, so the filter matched
        // nothing and the case passed without looking at anything — a green earned
        // by asking the wrong question.
        const pid = await b.f.supervisorPid()
        expect(pid, 'the foreground supervisor published no pid — nothing to inspect').not.toBe('')
        const tees = await s.run(
          'sh',
          [
            '-c',
            `ps -eo ppid,args 2>/dev/null | awk -v P="$1" '$1==P' | grep -c '[t]ee' || true`,
            'x',
            pid,
          ],
          { cwd: s.workspace.root },
        )
        // The one-resident-process contract: the supervisor writes stdout AND the
        // log itself rather than forking `tee` to do it.
        expect(Number(tees.stdout.trim() || '0')).toBe(0)
      })
    })
  })

  it('#5f foreground writes to stdout and the log itself', async () => {
    await scenario('aab-5f-sinks', async (s) => {
      // Both sinks in one case, deliberately: they are one property — "the
      // supervisor writes both" — and asserting them from two separate foreground
      // runs would double the cost to say the same thing.
      const b = await bound(s)
      const out = `${s.workspace.root}/fg.out`
      const running = s
        .run('sh', ['-c', `bash scripts/agent-activity.sh > "${out}" 2>&1`], {
          cwd: b.f.repo,
          env: b.f.env,
          timeoutMs: 60_000,
        })
        .catch(() => undefined)
      try {
        await b.ready()
        await b.append(jsonlRecord('FOREGROUND-LINE'))
        await b.f.expectLine('FOREGROUND-LINE')

        await vi.waitFor(
          async () => expect(await readFile(out, 'utf8')).toContain('FOREGROUND-LINE'),
          { timeout: 30_000, interval: 100 },
        )
        expect(await b.f.read()).toContain('FOREGROUND-LINE')
      } finally {
        await b.f.cli(['--stop'])
        await running
        await b.f.expectSupervisors(0)
      }
    })
  })

  // =========================================================================
  // Source backstops — cheap guards against the exact idioms that caused the
  // defects. A supplement to the behavioural cases, never the coverage.
  // =========================================================================
  it('static: no tail -F follower is reintroduced (RC-2)', async () => {
    expect(await code(FEED)).not.toMatch(/tail[ \t]+(-n0[ \t]+)?-F/)
  })

  it('static: the flock instance guard is still there (RC-1)', async () => {
    expect(await code(FEED)).toMatch(/flock/)
  })

  it('static: the broken stat fallback is not reintroduced (RC-6)', async () => {
    // `stat -f %m || stat -c %Y` returns the whole BSD stat blob on GNU, which is
    // never equal to itself twice — read as an mtime it makes every file look
    // changed on every tick.
    expect(await code(FEED)).not.toMatch(
      /\$\((stat -f %m[^)]*\|\| *stat -c %Y|stat -c %Y[^)]*\|\| *stat -f %m)/,
    )
  })

  it('static: fragment length is byte-based, not character-based (R4)', async () => {
    const body = await code(FEED)
    // awk's `length` counts CHARACTERS under a multibyte locale, so a fragment
    // holding one multibyte character measures short and is held back forever.
    if (/awk 'END\{print length/.test(body)) {
      expect(body).toMatch(/LC_ALL=C awk 'END\{print length/)
    }
  })

  it('static: the delta is not captured through command substitution (R3)', async () => {
    // `$()` strips trailing newlines, so a complete record arrives looking
    // incomplete and waits for the force-flush bound instead of being emitted.
    expect(await code(FEED)).not.toMatch(/^[ \t]*(local[ \t]+)?delta=\$\(/m)
  })
})
