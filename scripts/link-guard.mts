// scripts/link-guard.mts — TASK-080: a Claude Code Stop hook that requires
// every item id in the Orchestrator's reply text to be a link to the row it
// names.
//
// WHY A STOP HOOK. The founder reads replies in the VS Code extension, where
// `[TASK-077](docs/waiting-acceptance/BACKLOG.md)` is clickable and a bare
// `TASK-077` is a manual lookup. He asked for links twice (2026-09-22,
// 2026-09-23) and the prose reminder failed both times: every other gate in
// this repo reads the REPOSITORY, and this rule governs reply TEXT, which no
// hook but `Stop` ever sees. Scope was settled by the founder 2026-09-24:
// "this is only relevant for the orchestrator" — so binding Claude Code only
// is the whole surface, not a ceiling.
//
// WHAT IS CHECKED, AND WHAT IS DELIBERATELY NOT. For every
// TASK-/BUG-/FEATURE-/SPIKE-NNN id in the last assistant message, the FIRST
// mention must be a markdown link whose target is the lifecycle file that
// ACTUALLY holds that row today — docs/backlog/, docs/doing/,
// docs/waiting-acceptance/ or docs/done/, resolved by reading the row tables,
// never assumed. "Some link exists" is the docs/config/findings.md F-002
// proxy shape this epic exists not to repeat: a row that moved folder must
// make a stale link FAIL, because that is the case worth catching. Fenced
// code blocks and inline code spans are quoted material (tool output, commit
// subjects, grep results), not prose, and demand nothing. Later mentions of
// an id already linked demand nothing. An id with NO row anywhere demands
// nothing — the guard reports what it found, never invents a target. An id
// whose row sits in TWO folders at once — the spec'd REOPEN transition of
// docs/DoD.md §1 (a rejected acceptance, a regression or a rework request
// moves the row back to doing/ while the done/ row is still there) — accepts
// a link to ANY folder that really holds the row, and a bare mention names
// every candidate: the guard never picks a winner by ordering.
//
// A CONTRACT WORTH ITS COST: tool output pasted inline WITHOUT a fence or
// backticks IS prose, and every item id in it demands a link. That is
// deliberate (quoted material is fenced code blocks and inline spans only)
// but surprises the next reader exactly once: if the guard refuses a reply
// whose only ids came from a pasted command result, the fix is to fence the
// output, not to widen what counts as quoted.
//
// WHERE THIS RUNS. Wired as a Stop hook in .claude/settings.json beside the
// existing PreToolUse entries. Claude Code hands the hook a JSON payload on
// stdin carrying the transcript path and the session's cwd; exit 2 refuses
// the stop and feeds the message back so the fix is mechanical (each
// violation names the id AND the exact path it should have linked to). Exit
// 0 in every other case. The lifecycle docs are read from the payload's cwd
// — the session's project root, which for a derived project is the derived
// tree, not this script's checkout — falling back to the tree beside this
// script when the payload carries no usable cwd.
//
// THE GUARD MUST NEVER LOOP OR WEDGE THE SESSION. `stop_hook_active` in the
// payload means this stop was itself triggered by a stop hook — honouring it
// is what prevents the guard from re-firing on its own refusal forever. And
// any failure of the guard's OWN machinery (unreadable transcript, malformed
// payload, unparseable lines) exits 0: a guard that blocks the session on
// its own bug is worse than the miss it was built for. Every such swallow
// says why, per AGENTS.md §"Observability is a main concern" — a bindingless
// catch with no words fails tests/forbidden-idiom.
//
// Usage:
//   node scripts/link-guard.mts --hook            Stop hook contract: payload
//                                                 on stdin, exit 2 on a
//                                                 violation, 0 otherwise.
//   node scripts/link-guard.mts --hook --verbose  same, plus a one-line
//                                                 summary on stderr (the
//                                                 settings.json wiring runs
//                                                 WITHOUT --verbose so a
//                                                 passing reply stays silent;
//                                                 the suite uses it as the
//                                                 non-vacuity floor).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/**
 * The lifecycle folders a row can live in, most advanced first. A row should
 * exist in exactly one — but docs/DoD.md §1's REOPEN transition (a rejected
 * acceptance, a regression, a rework request) legitimately leaves the id in
 * two folders at once until the done/ row is removed. That state is named,
 * normal traffic, not a violation, and the guard does not adjudicate it by
 * ordering: every folder that really holds the row is an acceptable link
 * target, and a bare mention names them all (see findRowFiles).
 */
const LIFECYCLE_FOLDERS = ['done', 'waiting-acceptance', 'doing', 'backlog'] as const

/** The row tables each lifecycle folder can hold. */
const LIFECYCLE_FILES = ['BACKLOG.md', 'BUGS.md'] as const

/** Every id shape the guard knows: TASK-080, BUG-035, FEATURE-007, SPIKE-NNN. */
const ID_PATTERN = /\b(?:TASK|BUG|FEATURE|SPIKE)-\d+\b/g

/** An inline or reference-less markdown link: [text](target "title"). */
const LINK_PATTERN = /\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?[^)\n]*\)/g

interface CheckResult {
  /** Prose id mentions seen (all of them, not only firsts). The floor. */
  readonly mentions: number
  /** Distinct ids that resolved to a lifecycle row. */
  readonly withRows: number
  /** Distinct ids seen. */
  readonly distinct: number
  /** One line per violation, each naming the id and the exact target path. */
  readonly violations: readonly string[]
}

/**
 * The message text minus quoted material: fenced blocks toggle on ``` lines,
 * inline code spans are dropped. Fences first, spans after, per line — the
 * tests/doc-links convention, kept identical so "not prose" means the same
 * thing to both guards.
 */
function proseOf(message: string): string {
  const out: string[] = []
  let inFence = false
  for (const line of message.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    out.push(line.replace(/`[^`]*`/g, ''))
  }
  return out.join('\n')
}

/** Does this lifecycle file hold the row for `id`? A row anchor is a table
 *  row (`| **TASK-080** |`) or a heading (`## TASK-080 — …`), never a prose
 *  mention — a row's own text talks about other ids constantly. */
function fileHoldsRow(content: string, id: string): boolean {
  const tableRow = new RegExp(`^\\|\\s*\\*\\*${id}\\*\\*\\s*\\|`, 'm')
  const heading = new RegExp(`^#{1,6}\\s+\\*{0,2}${id}\\*{0,2}(?=[\\s—]|$)`, 'm')
  return tableRow.test(content) || heading.test(content)
}

/**
 * EVERY lifecycle file that holds `id`'s row today — all of them, not a
 * winner chosen by folder ordering. Usually one path; two when a REOPEN has
 * moved the row back to doing/ while the done/ row is still there (docs/
 * DoD.md §1). Empty when no row exists anywhere — in which case the id
 * demands nothing. Reads the real tree on every call: a row that moved
 * folder since the session started must make a stale link fail, so
 * yesterday's answer is not good enough.
 */
function findRowFiles(id: string, docsRoot: string): string[] {
  const found: string[] = []
  for (const folder of LIFECYCLE_FOLDERS) {
    for (const file of LIFECYCLE_FILES) {
      const rel = join('docs', folder, file)
      let content: string
      try {
        content = readFileSync(join(docsRoot, rel), 'utf8')
      } catch {
        // Swallowed deliberately: a lifecycle file this checkout does not have
        // (derived projects ship a subset) is a file that cannot hold the row,
        // not a reason to block the reply.
        continue
      }
      if (fileHoldsRow(content, id)) found.push(rel)
    }
  }
  return found
}

/** Normalise a link target for comparison: drop <>, title, ./, anchor, /. */
function normalizeTarget(raw: string): string {
  let t = raw.trim()
  if (t.startsWith('<') && t.endsWith('>')) t = t.slice(1, -1)
  t = t.split(/\s/)[0] ?? t
  t = t.replace(/^\.\//, '')
  const hash = t.indexOf('#')
  if (hash !== -1) t = t.slice(0, hash)
  if (t.endsWith('/')) t = t.slice(0, -1)
  return t
}

/** Run the rule over one reply message. Pure apart from the row lookups.
 *  `docsRoot` is where the lifecycle docs live; the hook passes the
 *  payload's cwd (falling back to the tree beside this script). */
export function checkMessage(message: string, docsRoot: string = ROOT): CheckResult {
  const prose = proseOf(message)

  const ids = new Map<string, number>() // id -> first mention index
  let mentions = 0
  for (const m of prose.matchAll(ID_PATTERN)) {
    mentions++
    if (!ids.has(m[0])) ids.set(m[0], m.index)
  }

  const links: Array<{ start: number; end: number; target: string }> = []
  for (const m of prose.matchAll(LINK_PATTERN)) {
    links.push({ start: m.index, end: m.index + m[0].length, target: m[2] ?? '' })
  }

  const violations: string[] = []
  let withRows = 0
  for (const [id, firstAt] of ids) {
    const rowFiles = findRowFiles(id, docsRoot)
    if (rowFiles.length === 0) continue // no row anywhere: demands nothing
    withRows++

    // Where the row lives, for the refusal message. A dual-folder row (the
    // spec'd REOPEN state) names EVERY candidate — the guard reports what it
    // found and never picks one by ordering.
    const where = rowFiles.join(' or ')
    const link = links.find((l) => firstAt >= l.start && firstAt < l.end)
    if (link === undefined) {
      const options = rowFiles.map((f) => `[${id}](${f})`).join(' or ')
      violations.push(`${id}: first mention is not a link — write ${options}.`)
      continue
    }
    const target = normalizeTarget(link.target)
    const acceptable = rowFiles.some((f) => target === f || target.endsWith(`/${f}`))
    if (!acceptable) {
      violations.push(
        `${id}: first mention links to ${link.target}, but the row lives at ` +
          `${where} — retarget to one of those.`,
      )
    }
  }

  return { mentions, withRows, distinct: ids.size, violations }
}

/**
 * The prose of the last text-bearing assistant message in the transcript, or
 * null when there is none. Lines that do not parse are skipped: a transcript
 * is append-only and a torn final line is normal while the session is live —
 * that is not a reason to block the reply.
 */
function lastAssistantText(transcript: string): string | null {
  let text: string | null = null
  for (const line of transcript.split('\n')) {
    if (line.trim() === '') continue
    let entry: { type?: unknown; message?: unknown }
    try {
      entry = JSON.parse(line) as { type?: unknown; message?: unknown }
    } catch {
      // Swallowed deliberately: one unparseable line is skipped, per above.
      continue
    }
    if (entry.type !== 'assistant') continue
    const msg = entry.message as { role?: unknown; content?: unknown } | undefined
    if (msg?.role !== 'assistant' || !Array.isArray(msg.content)) continue
    const parts: string[] = []
    for (const block of msg.content) {
      const b = block as { type?: unknown; text?: unknown }
      if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    }
    if (parts.length > 0) text = parts.join('\n')
  }
  return text
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    // Swallowed deliberately: a hook with no readable stdin has nothing to
    // judge, and a guard that blocked on its own read failure would be worse
    // than the miss it exists to catch.
    return ''
  }
}

function hookMain(verbose: boolean): number {
  const payload = readStdin()
  if (payload === '') return 0

  let parsed: { transcript_path?: unknown; stop_hook_active?: unknown; cwd?: unknown }
  try {
    parsed = JSON.parse(payload) as {
      transcript_path?: unknown
      stop_hook_active?: unknown
      cwd?: unknown
    }
  } catch {
    // Swallowed deliberately: a payload this hook cannot parse is not its call
    // to adjudicate — exit 0 and let the session proceed.
    return 0
  }

  // THE LOOP GUARD. This stop was itself triggered by a stop hook; running
  // again would fire on our own refusal forever. Claude Code sets this flag
  // exactly so a hook can stand down, and standing down is the whole contract.
  if (parsed.stop_hook_active === true) return 0

  if (typeof parsed.transcript_path !== 'string') return 0

  let transcript: string
  try {
    transcript = readFileSync(parsed.transcript_path, 'utf8')
  } catch {
    // Swallowed deliberately: an unreadable transcript means the guard cannot
    // see the reply, and "I cannot tell" must never read as "it is fine" by
    // BLOCKING — the failure direction here is toward the session continuing.
    return 0
  }

  const message = lastAssistantText(transcript)
  if (message === null) {
    if (verbose) console.error('link-guard: no assistant prose in the transcript; nothing to check')
    return 0
  }

  // The lifecycle docs are the SESSION's project tree (the payload's cwd),
  // not necessarily this script's checkout — a derived project's hook runs
  // this script but the rows live in the derived docs. A missing or unusable
  // cwd falls back to the tree beside the script; the row lookups fail open
  // either way, so a bogus cwd degrades to "no rows found", never a block.
  const docsRoot = typeof parsed.cwd === 'string' && parsed.cwd !== '' ? parsed.cwd : ROOT

  const result = checkMessage(message, docsRoot)

  if (verbose) {
    console.error(
      `link-guard: examined ${result.mentions} prose id mention(s); ` +
        `rows found: ${result.withRows} of ${result.distinct} distinct id(s)`,
    )
  }

  if (result.violations.length > 0) {
    console.error(
      'link-guard (TASK-080): an item id in the reply must be a link to the row it names:',
    )
    for (const v of result.violations) console.error(`  ${v}`)
    return 2
  }
  return 0
}

const args = process.argv.slice(2)
if (args.includes('--hook')) {
  process.exit(hookMain(args.includes('--verbose')))
}
console.error('usage: node scripts/link-guard.mts --hook [--verbose]')
process.exit(0)
