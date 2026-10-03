/**
 * tests/session-resume/session-resume.spec.ts — FEATURE-003: a woken session
 * must be able to DERIVE where it is, and an INCOMPLETE replay must be LOUD.
 *
 * Every case that can be wrong asserts BOTH halves: the text a human reads, and
 * a non-zero exit a script can branch on. A warning printed beside exit 0 is the
 * BUG-018 shape — a refusal that returned 0, so a caller read "sync succeeded"
 * while nothing had been pulled — and is not accepted here.
 *
 * WHAT "INCOMPLETE" CAN MEAN, which is less than it sounds. Events are replayed
 * from `logs/state/signal-history.log`, which is append-only and which nothing
 * truncates. So a replay cannot be silently short, and "incomplete" reduces to
 * two states: NO MARKER, or the prose and the journal DISAGREE.
 *
 * Ordering is POSITIONAL, never by timestamp. This host's clock jumped BACKWARDS
 * during 2026-08-03 — entries stamped 19:47 sit earlier in the file than entries
 * stamped 14:39.
 *
 * PORTED FROM tests/session-resume/test.sh (TASK-018). Equivalence measured over
 * a mutant population rather than reviewed — see
 * docs/waiting-acceptance/TASK-018-EQUIVALENCE-mic/.
 */

import { describe, it, expect } from 'vitest'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { scenario, type RunResult, type Scenario } from '../harness/index.js'
import type { FixtureRepo } from '../harness/fixture-repo.js'
import { startWatcher, until } from '../harness/watcher.js'

/**
 * The environment `session-resume.sh` must be handed.
 *
 * BOTH baton pointers are UNSET rather than pointed at the fixture, and that is
 * the faithful choice: the subject resolves the baton and the journal from
 * `--root` through `agent_signal_file_for`, and that derivation is what case #9
 * is about. Overriding `AGENT_SIGNAL_FILE` to the very path the derivation would
 * produce gives identical bytes while testing nothing — the shape this repo
 * calls a guard watching the wrong thing.
 *
 * Unsetting them is what the shell suite did too, for a harder reason:
 * `signal-watch.mts` exports `AGENT_SIGNAL_FILE` into every dispatched
 * wake, so a suite run from inside a dispatch inherited a pointer to the REAL
 * baton and wrote live state whatever its cwd said (BUG-046).
 */
const NO_INHERITED_BATON = {
  AGENT_SIGNAL_FILE: undefined,
  AGENT_STATE_HOME: undefined,
} as const

interface Fixture {
  readonly root: string
  /** The fixture's own git repository — one handle, never re-initialised. */
  readonly repo: FixtureRepo
  /** Run session-resume against this fixture. */
  resume(args?: string[]): Promise<RunResult>
  /** Append ordinary baton flips to the durable journal. */
  journal(...events: string[]): Promise<void>
  read(rel: string): Promise<string>
  write(rel: string, content: string, options?: { mode?: number; append?: boolean }): Promise<string>
  /** Replace `session-marker: <id>` in HANDOVER.md — the prose half of #2/#11. */
  restamp(id: string): Promise<void>
  /** The id of the last open marker in the journal. */
  lastOpenId(): Promise<string>
}

/**
 * A throwaway project tree with a git history, the four lifecycle folders, a
 * baton, a journal and a feed.
 *
 * `name` scopes it inside the scenario workspace, so several fixtures can exist
 * at once without the serial re-seeding the shell suite relied on (R5).
 */
async function fixture(s: Scenario, name: string): Promise<Fixture> {
  const repo = await s.gitRepo(name)
  const root = repo.dir
  const rel = (p: string) => join(name, p)

  await s.fs.write(rel('docs/backlog/BACKLOG.md'),
    '| # | Item |\n|---|---|\n| **TASK-100** | parked |\n| **BUG-101** | parked |\n')
  await s.fs.write(rel('docs/doing/BACKLOG.md'),
    '| # | Item |\n|---|---|\n| **FEATURE-003** | building |\n')
  await s.fs.write(rel('docs/waiting-acceptance/BACKLOG.md'),
    '| # | Item |\n|---|---|\n| **TASK-008** | landed |\n')
  await s.fs.write(rel('docs/done/BUGS.md'),
    '| # | Bug |\n|---|---|\n| **BUG-001** | accepted |\n')
  await s.fs.write(rel('docs/doing/HANDOVER.md'), '# HANDOVER\n\nWIP prose.\n')
  await s.fs.write(rel('logs/state/signal.md'),
    '| Field | Value |\n|---|---|\n| Holder | Eto |\n| State | ACTIVE |\n' +
      '| Task | fixture task |\n| Last update | 2026-08-06 |\n')
  await s.fs.write(rel('logs/state/signal-history.log'), '')
  await s.fs.write(rel('logs/agent-activity.log'), '')

  await repo.commitAll('TASK#0: fixture base')

  const f: Fixture = {
    root,
    repo,

    resume: (args = []) =>
      s.runScript('scripts/session-resume.sh', ['--root', root, ...args], {
        cwd: s.workspace.root,
        env: NO_INHERITED_BATON,
      }),

    async journal(...events) {
      // APPENDED, never read-modify-written. The journal is append-only and that
      // is the property the whole replay design rests on — rewriting it to add a
      // line is a truncate-and-replace, which is the one thing the canary treats
      // as damage rather than as growth (BUG-068).
      await s.fs.write(
        rel('logs/state/signal-history.log'),
        events.map((e) => `[2026-08-06T10:00:00Z] ${e}\n`).join(''),
        { append: true },
      )
    },

    read: (p) => s.fs.read(rel(p)),
    write: (p, content, options) => s.fs.write(rel(p), content, options),

    async restamp(id) {
      const handover = await s.fs.read(rel('docs/doing/HANDOVER.md'))
      await s.fs.write(
        rel('docs/doing/HANDOVER.md'),
        handover.replace(/session-marker: [0-9a-f]*/, `session-marker: ${id}`),
      )
    },

    async lastOpenId() {
      const ids = [...(await s.fs.read(rel('logs/state/signal-history.log')))
        .matchAll(/^\[[^\]]*\] <([0-9a-f]+)> /gm)].map((m) => m[1])
      expect(ids.length, 'the journal holds no open marker').toBeGreaterThan(0)
      return ids[ids.length - 1] ?? ''
    },
  }

  return f
}

/** A content hash of every file in a tree, `.git` excluded. The #10 oracle. */
async function treeDigest(root: string): Promise<string> {
  const hash = createHash('sha256')
  const walk = async (dir: string): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      if (entry.name === '.git') continue
      if (entry.isDirectory()) {
        await walk(abs)
      } else if (entry.isFile()) {
        hash.update(relative(root, abs))
        hash.update(await readFile(abs))
        // The MODE too. A read that silently re-permissioned a file it reported
        // on would round-trip the bytes and still have written.
        hash.update(String((await stat(abs)).mode))
      }
    }
  }
  await walk(root)
  return hash.digest('hex')
}

describe('FEATURE-003 — a woken session derives where it is, and an incomplete replay is loud', () => {
  it('#1 a truncated activity feed is a NON-EVENT: silent, exit 0, journal replayed', async () => {
    await scenario('resume-1', async (s) => {
      // THIS CASE ASSERTS THE INVERSE OF WHAT IT ONCE DID. The first design wrote
      // a probe into the feed and warned when it was gone, reasoning that the
      // feed's loss meant the window's detail was lost. Two things were wrong,
      // and no hardening would have fixed either: the replay is read from the
      // JOURNAL, which nothing truncates, so the feed was never the data source;
      // and the feed is truncated on EVERY `agent-activity.sh --daemon` start,
      // i.e. on every wake, so the warning fired on the ordinary path. A warning
      // that always fires is noise, noise gets muted, and a muted tool detects
      // nothing.
      const f = await fixture(s, 'p1')
      await f.resume(['--mark'])
      await f.journal('Holder=Jesko State=OVER_TO_CODEX Task=review the plan')
      await f.write('logs/agent-activity.log', '') // the daemon restarted, as it always does

      const r = await f.resume()
      expect(r.output, 'a healthy resume warned after an ordinary daemon restart — the tool cries wolf').not.toContain('⚠')
      expect(r.code, 'a healthy, complete replay did not exit 0').toBe(0)
      expect(r.output, 'the journal events were not replayed').toContain('review the plan')
    })
  })

  it('#2 a header/journal disagreement is named, adjudicated, and exits non-zero', async () => {
    await scenario('resume-2', async (s) => {
      // HANDOVER.md says <Y>, the journal's open marker is <X> — the two were
      // written independently, so one of them is a claim nobody backed. This is
      // the case that went undetected twice on 2026-08-05, when HANDOVER.md was
      // rewritten to be true and went stale again inside the same session.
      const f = await fixture(s, 'p2')
      await f.resume(['--mark'])
      await f.restamp('deadbeef')

      const r = await f.resume()
      expect(r.output, 'the disagreement did not name the id HANDOVER.md claims').toContain('deadbeef')
      expect(r.output, 'the two markers disagree and nothing said so').toMatch(
        /independently|disagree|does not match/i,
      )
      expect(r.output, 'the warning does not say which source to trust').toMatch(/trust/i)
      expect(r.code, 'an untrusted snapshot exited 0').not.toBe(0)
    })
  })

  it('#3 replay starts at the LATER open marker, not the first one', async () => {
    await scenario('resume-3', async (s) => {
      // A reader that greps for "the marker" and takes the first hit replays the
      // whole day and buries the live window.
      const f = await fixture(s, 'p3')
      await f.resume(['--mark'])
      await f.journal('Holder=A State=ACTIVE Task=BEFORE-THE-SECOND-SNAPSHOT')
      await f.resume(['--mark'])
      await f.journal('Holder=B State=ACTIVE Task=AFTER-THE-SECOND-SNAPSHOT')

      const r = await f.resume()
      expect(r.output, 'replay reached back past the later marker').not.toContain('BEFORE-THE-SECOND-SNAPSHOT')
      expect(r.output, 'replay did not include the events in the live window').toContain('AFTER-THE-SECOND-SNAPSHOT')
    })
  })

  it('#4 replay is POSITIONAL, so a clock that moved backwards does not lose events', async () => {
    await scenario('resume-4', async (s) => {
      // A marker is a POSITION in an append-only file, so an event stamped
      // EARLIER than the marker must still be replayed. Any implementation that
      // filters on "timestamp > marker time" silently drops them, and this host
      // has actually done it.
      const f = await fixture(s, 'p4')
      await f.resume(['--mark'])
      // Positionally AFTER the marker and chronologically long before it, which
      // is the exact shape this host produced for real on 2026-08-03.
      await f.write(
        'logs/state/signal-history.log',
        '[1999-01-01T00:00:00Z] Holder=C State=ACTIVE Task=CLOCK-WENT-BACKWARDS\n',
        { append: true },
      )

      const r = await f.resume()
      expect(
        r.output,
        'an event stamped before the marker was dropped — ordering is by clock, not position',
      ).toContain('CLOCK-WENT-BACKWARDS')
    })
  })

  it('#5 a journal with no marker says so outright and exits non-zero', async () => {
    await scenario('resume-5', async (s) => {
      // A fresh clone, or a journal that was lost. Printing an empty replay here
      // is the exact "silence looks like success" failure, and it is the most
      // likely one: a fresh checkout has no journal, so this is what every first
      // run looks like.
      const f = await fixture(s, 'p5')
      await f.journal('Holder=D State=ACTIVE Task=orphan event')

      const r = await f.resume()
      expect(r.output, 'a journal with no marker printed no explanation').toMatch(
        /no snapshot marker|no marker/i,
      )
      expect(r.code, 'nothing is being replayed and resume still exited 0').not.toBe(0)
    })
  })

  it('#6 --rollback STASHES rather than discards, and the content round-trips', async () => {
    await scenario('resume-6', async (s) => {
      // When the snapshot cannot be trusted the instinct is to roll back, and the
      // safe form of that is `git stash push`, never `checkout --`. Both clear
      // the tree; only one is reversible when the judgement was wrong — and an
      // untrusted snapshot is LOW CONFIDENCE about the work, which is exactly
      // when destroying it is least defensible.
      //
      // Asserted BEHAVIOURALLY — the content round-trips — and not by grepping
      // the source for forbidden commands, so a future "simplification" to
      // `checkout --` fails here rather than passing a string check.
      const f = await fixture(s, 'p6')
      const repo = f.repo
      await f.resume(['--mark'])
      await f.write('docs/doing/PLAN-WIP.md', 'PRECIOUS UNCOMMITTED WORK\n')
      await f.write('docs/doing/HANDOVER.md', (await f.read('docs/doing/HANDOVER.md')) + 'edited\n')

      await f.resume(['--rollback'])

      const stashes = await repo.git(['stash', 'list'])
      expect(
        stashes.stdout.trim(),
        '--rollback left no stash — the uncommitted work is unrecoverable',
      ).not.toBe('')

      const pop = await repo.git(['stash', 'pop'])
      expect(pop.code, `git stash pop failed: ${pop.output}`).toBe(0)
      expect(
        await f.read('docs/doing/PLAN-WIP.md'),
        'stashed content did not round-trip byte-for-byte',
      ).toContain('PRECIOUS UNCOMMITTED WORK')
      expect(
        await f.read('docs/doing/HANDOVER.md'),
        'the tracked modification did not round-trip',
      ).toContain('edited')
    })
  })

  it('#7 the report DERIVES git state, lifecycle contents and the live baton', async () => {
    await scenario('resume-7', async (s) => {
      // NON-VACUITY OF THE REPORT ITSELF. Every assertion above is about warnings
      // and replay windows, and all of them pass against a tool that prints
      // nothing else. The report must actually derive the four things it exists
      // to show, at run time, from the thing that owns each one — which is the
      // whole reason the authored snapshot was not built.
      const f = await fixture(s, 'p7')
      await f.resume(['--mark'])

      const r = await f.resume()
      expect(r.output, 'the report does not derive the doing/ items').toContain('FEATURE-003')
      expect(r.output, 'the report does not derive git state').toMatch(/branch|HEAD/i)
      expect(r.output, 'the report does not derive the baton Holder').toContain('Eto')
      expect(r.output, 'the report does not derive the baton State').toContain('ACTIVE')
    })
  })

  it('#8 the reader HOLDS NOTHING, so the next run already agrees with the world', async () => {
    await scenario('resume-8', async (s) => {
      // Change the world without telling the tool. This is the property that made
      // the reader the deliverable and left the authored snapshot parked: a
      // second bookkeeping surface goes stale by construction, and atomic
      // publication only guarantees a COHERENT stale snapshot.
      const f = await fixture(s, 'p8')
      await f.resume(['--mark'])

      const before = await f.resume()
      await f.write(
        'docs/doing/BACKLOG.md',
        (await f.read('docs/doing/BACKLOG.md')) + '| **BUG-999** | promoted mid-session |\n',
      )
      const after = await f.resume()

      expect(before.output, 'the report claimed an item that did not exist when it ran').not.toContain('BUG-999')
      expect(after.output, 'an item promoted between runs is invisible — the reader is caching state').toContain('BUG-999')
    })
  })

  it('#9 markers are paired and DURABLE: the open marker goes in the journal, and a second --mark closes the first', async () => {
    await scenario('resume-9', async (s) => {
      // The feed is truncated on every daemon start, so a marker kept only there
      // is lost exactly when it is needed. `signal-set.sh` only ever appends to
      // the journal and nothing truncates it — that is the one durable stream
      // available.
      const f = await fixture(s, 'p9')
      await f.resume(['--mark'])

      expect(
        await f.read('logs/state/signal-history.log'),
        '--mark wrote no open marker into logs/state/signal-history.log',
      ).toMatch(/^\[[^\]]+\] <[0-9a-f]+>/m)
      expect(
        await f.read('docs/doing/HANDOVER.md'),
        '--mark did not record the id in HANDOVER.md, so nothing can disagree with the journal',
      ).toContain('session-marker')

      await f.resume(['--mark'])
      expect(
        await f.read('logs/state/signal-history.log'),
        'a second --mark did not CLOSE the previous marker — the window has no end',
      ).toMatch(/^\[[^\]]+\] <\/[0-9a-f]+>/m)
    })
  })

  it('#10 reporting is READ-ONLY — nothing in the tree it reports on changes', async () => {
    await scenario('resume-10', async (s) => {
      // A read that mutates is a read nobody can run twice, and this one runs on
      // every wake. BUG-014 is the precedent: the suite that proved the gate arms
      // is what disarmed it.
      const f = await fixture(s, 'p10')
      await f.resume(['--mark'])

      const before = await treeDigest(f.root)
      await f.resume()
      expect(
        await treeDigest(f.root),
        'a plain resume modified the tree it was reporting on',
      ).toBe(before)
    })
  })

  it('#11 an OLDER snapshot id and an id from no known mark get different, accurate advice', async () => {
    await scenario('resume-11', async (s) => {
      // NOISE CONTROL. A branch switch routinely brings in a HANDOVER committed
      // under an EARLIER marker. That must be distinguishable from prose written
      // by something that never marked at all — same severity, very different
      // advice, and the tool gets muted if it cannot tell them apart.
      const f = await fixture(s, 'p11')
      await f.resume(['--mark'])
      const older = await f.lastOpenId()
      await f.resume(['--mark'])

      await f.restamp(older)
      const known = await f.resume()
      expect(known.output, 'a known PAST id was reported as an unbacked claim').toMatch(/older snapshot id/i)
      expect(known.output, 'the warning does not name the one-command fix').toContain('--mark')

      await f.restamp('cafebabe')
      const unbacked = await f.resume()
      expect(
        unbacked.output,
        'an id from no known mark was not distinguished from an older one',
      ).toMatch(/appears NOWHERE/i)
    })
  })

  it('#12 Codex R6-1: --mark with an unwritable journal REFUSES and leaves HANDOVER.md untouched', async () => {
    await scenario('resume-12', async (s) => {
      // `--mark` used to exit 0 and stamp a NEW id into HANDOVER.md for a window
      // the journal never recorded. The next read then reports prose disagreeing
      // with the journal — the exact staleness this tool exists to detect,
      // manufactured by the tool itself. It matters MORE since the journal became
      // the only thing written: an unverified write there is the whole failure
      // rather than one of two.
      //
      // DIVERGENCE FROM THE SHELL SUITE, DELIBERATE. That version made the
      // journal read-only with `chmod 444` and SKIPPED ITSELF as root, where a
      // read-only file is still writable — and R7 forbids a skip. Here the
      // journal's path is a DIRECTORY, which makes `printf >> "$JOURNAL"` fail
      // for root exactly as for anyone else, and makes the read-back `grep` fail
      // the same way. The prior `--mark` that the shell version used only to
      // populate HANDOVER's id is replaced by seeding that id directly, because
      // a prior --mark needs the journal to be writable.
      const f = await fixture(s, 'p12')
      await f.write('docs/doing/HANDOVER.md', '<!-- session-marker: aaaaaaaa -->\n\n# HANDOVER\n')
      await s.fs.rm('p12/logs/state/signal-history.log')
      await s.fs.mkdirp('p12/logs/state/signal-history.log')

      const handoverBefore = await f.read('docs/doing/HANDOVER.md')
      const r = await f.resume(['--mark'])

      expect(r.code, '--mark with an unwritable journal exited 0').not.toBe(0)
      expect(
        await f.read('docs/doing/HANDOVER.md'),
        'HANDOVER.md was stamped with an id the journal never recorded',
      ).toBe(handoverBefore)
      expect(
        await readdir(join(f.root, 'logs/state/signal-history.log')),
        'the journal changed despite being unwritable',
      ).toEqual([])
      expect(r.output, 'the unwritable journal was not named').toMatch(/could not be read back/i)
    })
  })

  it('#13 Codex R8 / BUG-079: the window roll is ONE write(), so a concurrent flip cannot land between two windows', async () => {
    await scenario('resume-13', async (s) => {
      // `--mark` makes session-resume a SECOND WRITER to a file `signal-set.sh`
      // also appends to — the A-09 shape one level up. With `</old>` and `<new>`
      // written as two separate appends there is a gap between them, and a mic
      // flip landing in that gap belongs to NO replay window: after the close of
      // the old one, before the open of the new one, so no resume will ever show
      // it. Silent, and it drops exactly the events this feature preserves.
      //
      // The fix is ONE write() rather than a lock: a single indivisible append
      // cannot be landed inside. BUG-079 is that `printf '%s\n' "$roll"` is not
      // one — bash's printf flushes at every newline — so the script needs
      // `cat <<EOF`, whose body is fully written to a temp file before `cat` runs.
      //
      // ═════════════════════════════════════════════════════════════════════════
      // THE COMPETING APPENDER IS A TIGHT LOOP, NOT `signal-set.sh`, AND THAT IS
      // THE WHOLE REASON THIS CASE CAN FAIL AT ALL.
      //
      // The shell suite drove the race with a full `bash signal-set.sh` per flip
      // — about 33 Hz against a gap of a few microseconds, so the chance of
      // landing inside it over 30 marks was well under one percent. TASK-018's
      // equivalence run injected the two-append defect and BOTH implementations
      // stayed GREEN: a case asserting a race it cannot provoke, which is
      // BUG-005's shape and the reason R6 exists.
      //
      // What the appender contributes to the journal is exactly one
      // `printf >>`, so issuing that directly is faithful to the hazard and drops
      // the process spawn. Measured on this host: ~170 kHz, and at that rate the
      // pre-BUG-079 script leaked 36 orphans over 60 marks while the fixed one
      // leaks none. Recorded here because "this test can fail" is the claim, and
      // the rate is what makes it true.
      const f = await fixture(s, 'p13')
      await f.resume(['--mark'])

      const journal = join(f.root, 'logs/state/signal-history.log')
      const stop = s.workspace.path('p13-flip.stop')
      const flipper = await s.fs.write(
        'p13-flipper.sh',
        '#!/usr/bin/env bash\n' +
          'i=0\n' +
          `while [ ! -f "${stop}" ]; do\n` +
          "  printf '[2026-08-06T10:00:00Z] Holder=Flipper State=ACTIVE Task=concurrent flip %s\\n'" +
          ` "$i" >> "${journal}"\n` +
          '  i=$((i + 1))\n' +
          'done\n',
        { mode: 0o755 },
      )

      const flips = startWatcher(s, 'bash', [flipper], { env: NO_INHERITED_BATON })

      try {
        // WAIT FOR THE RACE TO BE REAL before racing against it. A run where the
        // appender had not started yet is a run with no concurrency in it, which
        // would pass while testing nothing — the same "inconclusive reads as
        // green" shape tests/baton-durability #1 detects rather than tolerates.
        await until('the concurrent appender has landed at least one event', async () =>
          (await f.read('logs/state/signal-history.log')).includes('concurrent flip'),
        )

        for (let i = 0; i < 60; i++) await f.resume(['--mark'])
      } finally {
        await s.fs.write('p13-flip.stop', '')
        await flips.awaitExit('the appender loop did not stop when told to')
      }

      // Any ordinary event sitting between a close and the next open fell in the gap.
      const orphans: string[] = []
      let inGap = false
      for (const line of (await f.read('logs/state/signal-history.log')).split('\n')) {
        if (/^\[[^\]]*\] <\/[0-9a-f]+>/.test(line)) { inGap = true; continue }
        if (/^\[[^\]]*\] <[0-9a-f]+> /.test(line)) { inGap = false; continue }
        if (inGap && line !== '') orphans.push(line)
      }

      expect(
        orphans,
        'event(s) landed between a window close and the next open — they belong to no replay window',
      ).toEqual([])
    })
  })
})
