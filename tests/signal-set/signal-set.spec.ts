/**
 * tests/signal-set/signal-set.spec.ts — the baton publishes atomically, and
 * survives pipes, backslashes and newlines.
 *
 * `scripts/signal-set.sh` publishes the whole baton in ONE atomic write, so a
 * poller can never sample the new `State` beside the previous round's `Task`.
 *
 * Everything here was found by the tool failing on its own first real use. The
 * very first dispatch written with it was REFUSED for containing a pipe — in a
 * question about whether refusing pipes was correct. The refusal became
 * escaping; `awk -v` then silently undid the escaping and truncated the
 * instruction at exactly the point it was explaining pipes. A guard whose two
 * input paths disagree, or whose escaping is undone downstream, is worse than no
 * guard: it reports success.
 *
 * PORTED FROM tests/signal-set/test.sh (TASK-018). Equivalence was measured,
 * not reviewed — see docs/waiting-acceptance/TASK-018-EQUIVALENCE-mic/ for the mutant
 * population, the per-case agreement table and the two divergences, both of
 * which are recorded below at the case they affect.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { scenario, type Scenario } from '../harness/index.js'

/** A baton with prose on both sides of the table, so "only the rows change" is checkable. */
const SEED =
  '# Agent Signal\n\nPreamble stays untouched.\n\n| Field | Value |\n|---|---|\n' +
  '| Holder | OLD |\n| State | OLD |\n| Task | old task |\n| Last update | 1970-01-01 |\n\n' +
  'Trailer stays untouched.\n'

/**
 * A fresh baton in its own directory, and the publisher pointed at it.
 *
 * The directory is per-call rather than per-scenario because the JOURNAL is
 * derived from the baton's location: two batons sharing a directory would share
 * a journal, and #6 needs a journal it can break without breaking anything
 * else. The shell suite reused one path and re-seeded it, which works only
 * because it runs serially — R5 says there is no such category, so the
 * isolation is structural here.
 */
async function publisher(s: Scenario, name: string) {
  const dir = `${name}/`
  const baton = await s.fs.write(`${dir}AGENT_SIGNAL.md`, SEED)

  // BUG-140: signal-set.sh now validates --holder against a roster, read via
  // AGENT_ROSTER_FILE when set (same shape as AGENT_SIGNAL_FILE/--file for the
  // baton). Pointed at a path that does not exist, the check degrades to a
  // no-op — the same way it does on a checkout with no live AGENT_ROSTER.md —
  // so the plain "H"/"NEW"/"OLD" holders every other case in this file uses
  // are unaffected. tests/signal-set/roster below overrides this per case to
  // exercise the check itself.
  const rosterFile = join(s.workspace.root, dir, 'AGENT_ROSTER.md')

  const publish = (args: string[], env: Record<string, string> = {}) =>
    s.runScript('scripts/signal-set.sh', ['--file', baton, ...args], {
      cwd: s.workspace.root,
      env: { AGENT_ROSTER_FILE: rosterFile, ...env },
    })

  /** How a reader recovers the cell: strip the row prefix and the trailing delimiter. */
  const taskCell = async () => {
    const rows = (await s.fs.read(`${dir}AGENT_SIGNAL.md`))
      .split('\n')
      .filter((l) => l.startsWith('| Task |'))
    expect(rows.length, 'the Task row is not exactly one row — the table is broken').toBe(1)
    return (rows[0] ?? '').replace(/^\| Task \| /, '').replace(/ \|$/, '')
  }

  const taskRowCount = async () =>
    (await s.fs.read(`${dir}AGENT_SIGNAL.md`))
      .split('\n')
      .filter((l) => l.startsWith('| Task |')).length

  const content = () => s.fs.read(`${dir}AGENT_SIGNAL.md`)

  return { baton, dir, publish, taskCell, taskRowCount, content }
}

/** Publish a Task and hand back the recovered cell. The common shape of a case below. */
async function cellFor(s: Scenario, name: string, task: string): Promise<string> {
  const p = await publisher(s, name)
  const r = await p.publish(['--holder', 'H', '--state', 'S', '--task', task])
  expect(r.code, `publishing failed: ${r.output}`).toBe(0)
  return p.taskCell()
}

describe('signal-set.sh publishes the whole baton in one atomic write', () => {
  it('#1 a literal pipe is escaped, not refused, and the text survives intact', async () => {
    await scenario('signal-set-1', async (s) => {
      const p = await publisher(s, 'one')

      // REFUSING IS NOT AN OPTION, and that is the finding rather than a
      // preference: `\|` renders as a pipe inside a markdown cell, and refusing
      // means a prompt can never discuss shell pipelines, alternation, or this
      // very rule. Found by dogfooding — the first dispatch ever published with
      // this tool was rejected for asking whether refusing was correct.
      const r = await p.publish(['--holder', 'H', '--state', 'S', '--task', 'discuss a | pipe'])
      expect(r.code, `a Task containing a pipe was refused outright: ${r.output}`).toBe(0)

      expect(await p.taskRowCount(), 'the pipe broke the table into extra Task rows').toBe(1)
      const cell = await p.taskCell()
      expect(cell, 'the pipe was not escaped in the cell').toContain('discuss a \\| pipe')
      expect(cell, 'the cell was truncated at the pipe').toMatch(/pipe$/)
    })
  })

  it('#2 backslashes, regex metacharacters and & pass through as data', async () => {
    await scenario('signal-set-2', async (s) => {
      // THIS IS THE `awk -v` BUG. `-v` runs escape processing over the value, so
      // the `\|` applied a moment earlier became a raw pipe again and truncated
      // the instruction. ENVIRON does not. `&` is here for the other half: it is
      // sed's "the whole match" replacement metacharacter.
      const cell = await cellFor(
        s,
        'two',
        'path C:\\tmp\\new and regex .*+?[]^$ and & ampersand',
      )

      expect(cell, 'backslash sequences were mangled').toContain('C:\\tmp\\new')
      expect(cell, 'regex-special characters were mangled').toContain('.*+?[]^$')
      expect(cell, "'&' was mangled (sed replacement semantics)").toContain('& ampersand')
    })
  })

  it('#3 multiline --task is normalised to a single cell', async () => {
    await scenario('signal-set-3', async (s) => {
      // BOTH input paths must normalise newlines. `--task-file` did and `--task`
      // did not, so a multiline `--task` produced a broken multi-line table row:
      // one path validated, the other not, which is how a guard grows a hole.
      const p = await publisher(s, 'three')
      await p.publish(['--holder', 'H', '--state', 'S', '--task', 'line one\nline two'])

      expect(await p.taskRowCount(), 'multiline --task broke the table').toBe(1)
      expect(await p.taskCell()).toContain('line one line two')
    })
  })

  it('#3b multiline --task-file is normalised the same way', async () => {
    await scenario('signal-set-3b', async (s) => {
      const p = await publisher(s, 'threeb')
      const taskFile = await s.fs.write('threeb/t.md', 'from\na file\n')
      await p.publish(['--holder', 'H', '--state', 'S', '--task-file', taskFile])

      expect(await p.taskRowCount(), 'multiline --task-file broke the table').toBe(1)
      expect(await p.taskCell()).toContain('from a file')
    })
  })

  it('#3c repeated interior spaces are preserved; only line breaks are normalised', async () => {
    await scenario('signal-set-3c', async (s) => {
      // An earlier version ran `sed 's/  */ /g'` and silently rewrote
      // indentation, aligned snippets, and quoted arguments whose repeated
      // spaces are deliberate. None of that threatens the table, so none of it
      // is the normaliser's business.
      expect(await cellFor(s, 'threec', 'run:  cmd --flag   "a  b"  end')).toBe(
        'run:  cmd --flag   "a  b"  end',
      )
    })
  })

  it('#3d interior tabs are preserved as tabs (documented policy)', async () => {
    await scenario('signal-set-3d', async (s) => {
      expect(await cellFor(s, 'threed', 'has\ta tab')).toBe('has\ta tab')
    })
  })

  it('#3e boundary whitespace IS trimmed — the documented policy, not an accident', async () => {
    await scenario('signal-set-3e', async (s) => {
      // A REAL EDIT, asserted rather than glossed. The code's own comment once
      // claimed everything horizontal was preserved while the same `sed`
      // stripped the edges, and no case exercised a boundary — so nothing caught
      // the contradiction (Codex R5-F1).
      expect(await cellFor(s, 'threee', '   leading and trailing   ')).toBe(
        'leading and trailing',
      )
    })
  })

  it('#3f boundary tabs are trimmed like boundary spaces — one policy, not two', async () => {
    await scenario('signal-set-3f', async (s) => {
      expect(await cellFor(s, 'threef', '\tboundary tabs\t')).toBe('boundary tabs')
    })
  })

  it('#3g boundary vertical-tab and form-feed are trimmed too, so the policy is POSIX [[:space:]] as documented', async () => {
    await scenario('signal-set-3g', async (s) => {
      // The trim is POSIX `[[:space:]]` under a pinned `LC_ALL=C` (BUG-043),
      // which is wider than "space and tab": VT and FF go as well. Asserted so
      // the documented policy is byte-accurate rather than approximately true
      // (Codex R6-F2).
      expect(await cellFor(s, 'threeg', '\v\fvt and ff\v\f')).toBe('vt and ff')
    })
  })

  it('#3h a Unicode NBSP survives at the boundary — documented as unsupported, not silently assumed', async () => {
    await scenario('signal-set-3h', async (s) => {
      // PINNED SO THE LIMITATION IS A RECORDED DECISION. If someone later adds
      // Unicode handling, this case tells them a documented contract is
      // changing. It is also the case BUG-043 broke: under a UTF-8 locale on BSD
      // `[[:space:]]` matched U+00A0, so the same command trimmed differently
      // depending on the publisher's LANG — which is why the script pins
      // LC_ALL=C rather than inheriting it.
      expect(await cellFor(s, 'threeh', '\u00A0nbsp edges\u00A0')).not.toBe('nbsp edges')
    })
  })

  it('#4 only the baton rows change; the surrounding prose is byte-identical', async () => {
    await scenario('signal-set-4', async (s) => {
      const p = await publisher(s, 'four')
      await p.publish(['--holder', 'NEW', '--state', 'NEWSTATE', '--task', 'x'])

      // LINE-ANCHORED, not "contains a newline then the row". The first version
      // required a PRECEDING newline, which is a claim about the row's neighbour
      // rather than about the row — so a mutant that ate the surrounding prose
      // made this case AND #6 go red, where the shell suite reddened only this
      // one. Caught by the equivalence run, and it was the port being stricter on
      // an axis nobody had decided to be strict about.
      const after = await p.content()
      expect(after, 'surrounding prose was modified').toMatch(/^Preamble stays untouched\.$/m)
      expect(after, 'surrounding prose was modified').toMatch(/^Trailer stays untouched\.$/m)
      expect(after, 'the Holder row was not rewritten').toMatch(/^\| Holder \| NEW \|$/m)
      expect(after, 'the State row was not rewritten').toMatch(/^\| State \| NEWSTATE \|$/m)
    })
  })

  it('#5 a refused publish leaves the previous baton byte-identical', async () => {
    await scenario('signal-set-5', async (s) => {
      const p = await publisher(s, 'five')
      const before = await p.content()

      const r = await p.publish(['--holder', 'H', '--state', 'S'])
      expect(r.code, 'publishing with no Task succeeded').not.toBe(0)
      expect(await p.content(), 'a refused publish modified the signal').toBe(before)
    })
  })

  it('#6 BUG-023: a failed journal append exits 8 and says the baton IS published, so no caller retries into a double publish', async () => {
    await scenario('signal-set-6', async (s) => {
      // THE JOURNAL WAS A BACKSTOP: append-only, written only here, read by
      // nothing that makes a decision. Under that contract `|| true` was right —
      // a logging failure had no business failing a mic flip.
      //
      // FEATURE-003 made the journal the REPLAY'S SOURCE and did not update this
      // writer. So a flip could publish successfully, lose its event, and the
      // next session's resume would report a short replay with no warning and
      // exit 0. Durable is not complete: a file nothing truncates still has
      // holes if its writer treats them as acceptable.
      //
      // The baton IS still published — publication is atomic and already done by
      // this point, and refusing after the fact is not available. So the
      // contract is "published, but not journalled", and it needs its own exit
      // status: a caller that retried on a plain failure would double-publish.
      //
      // DIVERGENCE FROM THE SHELL SUITE, DELIBERATE. That version made the
      // journal read-only with `chmod 444` and therefore SKIPPED ITSELF as root,
      // where a read-only file is still writable. R7 forbids a skip, so the
      // append is broken a way no uid can defeat: a DIRECTORY at the journal's
      // path makes `printf >> "$JOURNAL"` fail for root exactly as it does for
      // anyone else. Same failing line, same exit path, one fewer platform where
      // this case quietly covers nothing.
      const baton = await s.fs.write(
        'six/signal.md',
        '| Field | Value |\n|---|---|\n| Holder | OLD |\n| State | OLD |\n' +
          '| Task | old |\n| Last update | 1970-01-01 |\n',
      )
      await s.fs.mkdirp('six/signal-history.log')

      // BUG-140: this case builds its own baton rather than going through
      // publisher(), so it needs the same AGENT_ROSTER_FILE-points-nowhere
      // degrade by hand — unset, --holder NEW would be refused against the
      // real checkout's roster before ever reaching the journal-append logic
      // this case exists to exercise.
      const r = await s.runScript(
        'scripts/signal-set.sh',
        ['--file', baton, '--holder', 'NEW', '--state', 'NEWSTATE', '--task', 'flip'],
        { cwd: s.workspace.root, env: { AGENT_ROSTER_FILE: join(s.workspace.root, 'six/AGENT_ROSTER.md') } },
      )

      expect(
        r.code,
        'a lost journal event exited 0 — the next resume reports a short replay and cannot know',
      ).toBe(8)
      expect(
        await s.fs.read('six/signal.md'),
        'the baton was NOT published, so the failure was reported at the wrong layer',
      ).toMatch(/^\| Holder \| NEW \|$/m)
      expect(r.output.toLowerCase(), 'the failure does not name the journal').toContain('journal')
      expect(
        r.output.toLowerCase(),
        'the message does not say the baton IS published — a caller may retry and double-publish',
      ).toContain('published')
    })
  })

  describe('BUG-140 — Holder must be a persona the roster names', () => {
    const ROSTER =
      '# Agent Roster\n\n## Members\n\n| Role | Name | Backing agent |\n|---|---|---|\n' +
      '| Orchestrator | Alisa | Claude Code |\n'

    it('#140a an unrostered Holder is refused, and the previous baton is untouched', async () => {
      await scenario('signal-set-140a', async (s) => {
        const p = await publisher(s, '140a')
        await s.fs.write('140a/AGENT_ROSTER.md', ROSTER)
        const before = await p.content()

        const r = await p.publish(['--holder', 'NoSuchPersona', '--state', 'S', '--task', 't'])
        expect(r.code, 'signal-set.sh --holder NoSuchPersona PUBLISHED').not.toBe(0)
        expect(r.output, 'the refusal does not name the roster file').toContain('AGENT_ROSTER.md')
        expect(await p.content(), 'a refused publish modified the signal').toBe(before)
      })
    })

    it('#140b a rostered Holder still publishes', async () => {
      await scenario('signal-set-140b', async (s) => {
        const p = await publisher(s, '140b')
        await s.fs.write('140b/AGENT_ROSTER.md', ROSTER)

        const r = await p.publish(['--holder', 'Alisa', '--state', 'S', '--task', 't'])
        expect(r.code, `a rostered Holder was refused:\n${r.output}`).toBe(0)
        expect(await p.content(), 'the Holder row was not rewritten').toMatch(/^\| Holder \| Alisa \|$/m)
      })
    })

    it('#140c no roster on disk yet: any Holder still publishes (fresh-clone degrade), and the skip is announced', async () => {
      await scenario('signal-set-140c', async (s) => {
        // No AGENT_ROSTER.md is written for this case — the fixture's default,
        // set up by publisher() itself. A checkout before
        // `cp AGENT_ROSTER.example.md AGENT_ROSTER.md` must still be able to
        // publish, or bootstrap itself is blocked. The degrade must SAY it
        // skipped the check, though — a silent skip is the exact failure mode
        // this whole batch (BUG-139/BUG-140) is about.
        const p = await publisher(s, '140c')

        const r = await p.publish(['--holder', 'AnyoneAtAll', '--state', 'S', '--task', 't'])
        expect(r.code, `publishing with no roster on disk was refused:\n${r.output}`).toBe(0)
        expect(r.output, 'the roster skip was not announced').toContain('skipped the roster check')
      })
    })

    it('#140d Holder = Nobody is accepted as the sentinel for "the mic is free"', async () => {
      await scenario('signal-set-140d', async (s) => {
        const p = await publisher(s, '140d')
        await s.fs.write('140d/AGENT_ROSTER.md', ROSTER)

        const r = await p.publish(['--holder', 'Nobody', '--state', 'IDLE', '--task', 't'])
        expect(r.code, `Holder=Nobody was refused against a real roster:\n${r.output}`).toBe(0)
        expect(await p.content(), 'the Holder row was not rewritten').toMatch(/^\| Holder \| Nobody \|$/m)
      })
    })
  })
})
