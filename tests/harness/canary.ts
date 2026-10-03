/**
 * tests/harness/canary.ts — prove the real repository was not touched.
 *
 * THIS IS THE CHECK THAT CATCHES WHAT SELF-CONCURRENCY MISSES, and that is not
 * a theoretical claim. Both Codex reviewers independently proposed "run each
 * suite twice concurrently with itself" as THE isolation check. Vitali then ran
 * it and found the counter-example: `pipeline` PASSES self-concurrency while its
 * hazard survives, because both copies pin AGENT_FEED_LOG and therefore both
 * avoid the shared target. `template-source` likewise passes self-concurrency
 * while carrying the live-baton hole (BUG-046).
 *
 * Self-concurrency cannot see "concurrent with a DIFFERENT writer of a shared
 * target" — and every gate stage is such a writer, via pipeline.sh's
 * `feed_append "[GATE] ..."`. So the two checks are complementary and the plan
 * requires both. A harness offering only the first would believe it had
 * isolation it did not have, which is this repo's signature failure committed
 * by the control built to prevent it.
 *
 * Precedent in-tree: tests/pipeline:283-288 already does exactly this for the
 * real activity log, as an escape canary. This generalises it.
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Files that a correctly isolated scenario must leave byte-identical. */
export interface CanaryTarget {
  label: string
  path: string
}

interface Snapshot {
  target: CanaryTarget
  /** null = the file did not exist. That is a legitimate state to preserve. */
  content: string | null
  size: number | null
}

/**
 * The real state a fixture must never touch.
 *
 * The baton is the coordination primitive the whole team reads; BUG-030/046
 * saw a suite reset it to the bootstrap default mid-review, which reads as a
 * fresh checkout rather than as damage. The feed and its journal are the
 * durable record of what happened.
 */
export function realStateTargets(repoRoot: string): CanaryTarget[] {
  return [
    { label: 'live baton', path: join(repoRoot, 'logs/state/signal.md') },
    {
      label: 'baton journal',
      path: join(repoRoot, 'logs/state/signal-history.log'),
    },
    { label: 'activity feed', path: join(repoRoot, 'logs/agent-activity.log') },
    { label: 'git config', path: join(repoRoot, '.git/config') },
  ]
}

async function snapshotOne(target: CanaryTarget): Promise<Snapshot> {
  try {
    const s = await stat(target.path)
    return {
      target,
      content: await readFile(target.path, 'utf8'),
      size: s.size,
    }
  } catch {
    // A target that does not exist snapshots as null, and both snapshots compare alike.
    return { target, content: null, size: null }
  }
}

/** Lines in a file's content. Newline count, so an appended line reads as +1. */
function countLines(content: string): number {
  return (content.match(/\n/g) ?? []).length
}

/**
 * The verdict on one append-only target: the feed, or the baton's journal.
 *
 * A FUNCTION RATHER THAN A BRANCH IN THE LOOP, because the loop now carries
 * three discriminators (created/deleted, rotated, escaped) and reviewers have to
 * be able to read this one without holding the other two. It returns its
 * findings instead of mutating the caller's arrays, so the ordering of the
 * report stays the caller's business.
 *
 * BUG-129 — A ROTATION MOVES HISTORY, IT DOES NOT DESTROY IT, and the archive is
 * what tells the two apart. Same shape as the baton's journal witness: a
 * specific, checkable discriminator, never a blanket tolerance for "the feed is
 * noisy". scripts/lib/feed.sh renames to `<feed>.1` at its cap, so archive+live
 * still begins with whatever was captured — and if it does not, that is damage
 * and still fails.
 */
async function appendOnlyVerdict(
  before: Snapshot,
  after: Snapshot,
  escapeToken?: string,
): Promise<{ problems: string[]; notes: string[] }> {
  const problems: string[] = []
  const notes: string[] = []

  const archive = await snapshotOne({
    label: `${before.target.label} archive`,
    path: `${before.target.path}.1`,
  })
  const appended = after.content!.startsWith(before.content!)
  const rotated =
    !appended &&
    archive.content !== null &&
    (archive.content + after.content!).startsWith(before.content!)

  if (rotated) {
    notes.push(
      `${before.target.label} ROTATED during the run — its history moved to ` +
        `${archive.target.path}, where every captured byte is still present and ` +
        `in order. Not a fixture escape (${before.target.path})`,
    )
  } else if (!appended) {
    problems.push(
      `${before.target.label} was rewritten or truncated, not appended to ` +
        `(${before.target.path})`,
    )
  }

  // The archive is searched too: rotating must not become a way to carry a
  // leaked line out of the file the token check reads.
  const written = after.content! + (archive.content ?? '')
  if (escapeToken && written.includes(escapeToken)) {
    problems.push(
      `${before.target.label} contains this scenario's unique escape token ` +
        `(${before.target.path})`,
    )
  }

  return { problems, notes }
}

export class RealStateCanary {
  private constructor(private readonly before: Snapshot[]) {}

  static async capture(targets: CanaryTarget[]): Promise<RealStateCanary> {
    return new RealStateCanary(await Promise.all(targets.map(snapshotOne)))
  }

  /**
   * Throw if any watched file changed.
   *
   * THE ACTIVITY FEED IS THE ONE PARTIAL CHECK HERE, AND THIS IS ITS EXACT
   * SCOPE. The feed is append-only, and a live `agent-activity.sh --daemon` the
   * developer is running appends to it during a test run, so a byte comparison
   * would go red for an innocent reason. That leaves two checks and one hole:
   *
   *   CAUGHT      a rewrite or a truncation — what was captured is no longer a
   *               prefix of what is there now.
   *   CAUGHT      an append CARRYING this scenario's token, which is what
   *               AGENT_FEED_TAG and AGENT_PERSONA put on the lines of the two
   *               dominant writers (scenarioEnv in index.ts names them, and
   *               names the writers they do not reach).
   *   NOT CAUGHT  an append carrying no token. An append leaves the captured
   *               content intact as a prefix, so the prefix check passes by
   *               construction, and there is no token for the token check to
   *               find. Nothing here sees it.
   *   NOTED       a ROTATION (BUG-129). scripts/lib/feed.sh renames the feed to
   *               `<feed>.1` at its size cap, so the live file no longer starts
   *               with what was captured — but archive+live does, byte for
   *               byte. That is growth being capped, not damage, and failing on
   *               it turned suites red for changes that never touched the feed.
   *               The tolerance is exact rather than a shrug: a rotation that
   *               LOST or rewrote history still fails, and the escape token is
   *               searched in the archive too, so rotating is not a way to move
   *               a leaked line out of view.
   *
   * That third row read "caught only by the prefix check" until Codex pointed
   * out that the prefix check passes on EVERY append — a claim of coverage
   * inside the commit whose purpose was to retract a claim of coverage, which
   * is this repo's signature failure committed twice in the same place.
   *
   * It is stated rather than closed because closing it means ATTRIBUTING an
   * append, and the feed carries nothing to attribute by: a concurrent daemon's
   * line and a fixture's leaked line are the same bytes, written by the same
   * user, at the same moment. Forbidding new bytes outright would fail honest
   * runs, and a check that goes red for innocent reasons gets muted, which
   * leaves less coverage than admitting the gap. harness.spec.ts pins this
   * behaviour with a case, so the limit cannot quietly drift away from the
   * prose again in either direction.
   *
   * THE LIVE BATON IS WITNESSED RATHER THAN FROZEN (BUG-068), and the
   * discriminator is exact rather than a heuristic:
   *
   *   BUG-030's clobber writes signal.md DIRECTLY and appends NOTHING to
   *   logs/state/signal-history.log. A real agent's flip goes through
   *   scripts/signal-set.sh, which ALWAYS appends one line to that journal.
   *
   * So: baton unchanged → pass; baton changed AND the journal grew → REPORT,
   * do not fail; baton changed and the journal did not → fail, because that is
   * the defect this canary exists for. This makes the guard SHARPER, not
   * weaker — before it, the two were indistinguishable and the test was blamed
   * for both. No lock, no snapshot-and-restore, no loss of scope.
   *
   * RESIDUAL, stated because it is real and not zero: a test that itself called
   * signal-set.sh against the REAL baton would append to the real journal and
   * be waved through. Two things keep it small — AGENT_SIGNAL_FILE is on the
   * harness's forbidden list (env.ts, R3), so a scenario child cannot reach the
   * real baton by inheriting a variable; and a fixture would have to name the
   * real path explicitly, which is not something one does by accident. It is
   * NOT closed, because closing it means attributing an append, and the journal
   * carries nothing to attribute by — the same wall the feed hits three
   * paragraphs up. If someone later makes appends attributable, close it here.
   */
  async assertUnchanged(escapeToken?: string): Promise<void> {
    const problems: string[] = []
    const notes: string[] = []

    // BUG-068 — THE JOURNAL IS THE WITNESS.
    //
    // Read once, before the loop, because the baton's verdict depends on it and
    // the two are separate targets. `null` means there is no journal target, or
    // it could not be read: the baton then has no witness and any change to it
    // fails, which is the fail-closed direction. Omitting the journal must not
    // be a way to switch the guard off.
    const journalBefore = this.before.find(
      (s) => s.target.label === 'baton journal',
    )
    let journalGrew = false
    if (journalBefore?.content != null) {
      const now = await snapshotOne(journalBefore.target)
      journalGrew =
        now.content != null &&
        countLines(now.content) > countLines(journalBefore.content)
    }

    for (const before of this.before) {
      const after = await snapshotOne(before.target)

      if (before.content === null && after.content === null) continue

      if (before.content === null && after.content !== null) {
        problems.push(
          `${before.target.label} was CREATED by the fixture (${before.target.path})`,
        )
        continue
      }

      if (before.content !== null && after.content === null) {
        problems.push(
          `${before.target.label} was DELETED by the fixture (${before.target.path})`,
        )
        continue
      }

      // The journal joins the feed as append-only (BUG-068). signal-set.sh only
      // ever appends to it, so growth is normal and a rewrite or truncation is
      // damage — the same two-way test the feed already gets.
      const isAppendOnly =
        before.target.label === 'activity feed' ||
        before.target.label === 'baton journal'
      if (isAppendOnly) {
        const verdict = await appendOnlyVerdict(before, after, escapeToken)
        problems.push(...verdict.problems)
        notes.push(...verdict.notes)
        continue
      }

      if (after.content !== before.content) {
        if (before.target.label === 'live baton' && journalGrew) {
          notes.push(
            `live baton changed during the run AND ${journalBefore!.target.path} ` +
              `grew — a concurrent agent flipped the mic through signal-set.sh. ` +
              `Not a fixture escape (${before.target.path})`,
          )
          continue
        }
        problems.push(
          `${before.target.label} CHANGED (${before.target.path})`,
        )
      }
    }

    // REPORTED, NEVER SILENT. A canary that quietly waves something through is
    // indistinguishable from one that was switched off, which is this repo's
    // signature failure (BUG-004, A-22, BUG-066). The operator has to be able to
    // see that the canary looked, saw a change, and judged it legitimate.
    //
    // `CANARY-NOTE:` is a contract with scripts/run-ts-suites.sh, which greps
    // for it and surfaces these lines even on a PASSING gate run — where vitest
    // output is otherwise captured and discarded. Changing the marker in one
    // place makes the report invisible in the gate while every test here still
    // passes, so the two must move together.
    for (const note of notes) {
      console.warn(`CANARY-NOTE: ${note}`)
    }

    if (problems.length > 0) {
      throw new Error(
        `The scenario mutated real state outside its fixture:\n  - ` +
          problems.join('\n  - ') +
          `\n\nThis is the BUG-030 / BUG-046 / BUG-047 class. A fixture must ` +
          `own everything it writes.`,
      )
    }
  }

  /**
   * A unique token that must never appear in a real log.
   *
   * This is the half of the escape canary that survives a parallel gate: the
   * token is unique per scenario, so a sibling stage writing to the same file
   * cannot cause a false positive. The count-based half cannot make that claim.
   *
   * A TOKEN NOTHING EMITS DETECTS NOTHING. For a while this one was minted,
   * handed to every scenario and searched for, while no fixture had any way to
   * produce it — a check over a case that could not arise, which is this repo's
   * signature defect wearing the uniform of the control that exists to catch
   * it. What closes that is on the emitting side: scenarioEnv (index.ts) sets
   * AGENT_FEED_TAG and AGENT_PERSONA to the token, so the two dominant feed
   * writers — the gate pipeline and the activity supervisor — label every line
   * they emit with it. The comment there says what is and is not covered.
   *
   * Unique per RUN, never a literal, and BUG-050 is why: tests/pipeline once
   * searched for the fixed string `canary-must-not-escape`, an agent WROTE
   * ABOUT the check in the feed, and the canary went permanently red accusing
   * the suite of the pollution it was reading in its own prose.
   */
  static escapeToken(scenario: string): string {
    return `canary-must-not-escape-${scenario}-${process.pid}-${Date.now()}`
  }
}
