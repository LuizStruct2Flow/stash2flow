// scripts/log-activity.mts — TASK-067 port of the shell hook log-activity.sh,
// which TASK-088 deleted: .claude/settings.json runs this file with node.
//
// Hook → activity-feed appender. Wired in .claude/settings.json on the
// SubagentStart / SubagentStop events so Claude Code SUBAGENTS show up in the
// unified feed (logs/agent-activity.log) the same way Codex does. Reads the
// hook payload JSON on stdin. Emits ONE line:
//   HH:MM:SS [<Persona> - <model> - <effort>] <event>: <summary>
//
// The libs this hook depends on (scripts/lib/state-dir.sh, feed.sh,
// watcher-lock.sh, staleness.sh, roster.sh) stay shell — they are shared with
// still-shell consumers (scripts/agent-activity.sh among them) — so this file
// reaches them ACROSS A PROCESS BOUNDARY (`sh -c '. "$1"; fn "$2" …'`) rather
// than hand-copying their derivations into TypeScript, the same pattern
// scripts/signal-watch.mts uses for the same reason: two copies of one rule is
// how A-09 broke the feed.
//
// Defensive by design: a hook must NEVER fail the tool call. Every branch
// falls back to a best-effort line and exits 0.

import { spawn, spawnSync } from 'node:child_process'
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// --- physical script root (A-09 / BUG-020 pattern) --------------------------
const SELF_PATH = fileURLToPath(import.meta.url)
const BP_CODE_ROOT = dirname(dirname(realpathSync(SELF_PATH)))

const STATE_DIR_LIB = join(BP_CODE_ROOT, 'scripts/lib/state-dir.sh')
const FEED_LIB = join(BP_CODE_ROOT, 'scripts/lib/feed.sh')
const WATCHER_LOCK_LIB = join(BP_CODE_ROOT, 'scripts/lib/watcher-lock.sh')
const STALENESS_LIB = join(BP_CODE_ROOT, 'scripts/lib/staleness.sh')
const ROSTER_LIB = join(BP_CODE_ROOT, 'scripts/lib/roster.sh')

function readable(path: string): boolean {
  try {
    accessSync(path, fsConstants.R_OK)
    return true
  } catch {
    // Missing or unreadable are the same "cannot use it" outcome here.
    return false
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// A notice written and then followed by process.exit() in the same turn can
// be dropped: stderr is a synchronous pipe on this host, but is not
// guaranteed to be one everywhere, and Node does not flush a pending async
// write on exit (BUG-153 round 3, cases #15/#18 went red in a sandbox where
// it wasn't). The old shell hook used `printf >&2`, itself synchronous —
// `fs.writeSync` on fd 2 is the same guarantee: the write completes before
// this call returns, so there is nothing left pending for exit to drop.
function stderrNotice(text: string): void {
  try {
    writeSync(2, text)
  } catch {
    // stderr itself is closed or invalid — the notice is lost, but a hook
    // must never fail the tool call over its own diagnostic output.
  }
}

// bp_clamp_int, ported: the wait/cap knobs are digit STRINGS, not integers —
// '08' is bad octal to shell arithmetic and a 26-digit value overflows a naive
// numeric compare, and both killed the deferred child before it ever emitted
// anything (Alexey's review, 2026-09-16, finding 3). Length-before-value is
// what keeps the compare itself from overflowing.
function clampInt(raw: string | undefined, def: number, max: number): number {
  if (raw === undefined || raw === '' || /[^0-9]/.test(raw)) return def
  let v = raw
  while (v.length > 1 && v.startsWith('0')) v = v.slice(1)
  const maxStr = String(max)
  if (v.length > maxStr.length) return max
  const n = Number(v)
  return n > max ? max : n
}

// --- read the hook payload ---------------------------------------------------
// No jq needed here: this process already has a real JSON parser, and the
// jq-based `extract()` this replaces only ever ran over ITS OWN stdin. jq is
// still reached, across the process boundary, for the roster lookup below —
// that one runs against a transcript file this process does not otherwise
// read.
let payload: Record<string, unknown> = {}
try {
  const raw = readFileSync(0, 'utf8')
  payload = JSON.parse(raw) as Record<string, unknown>
} catch {
  // Missing stdin, empty stdin, or invalid JSON — every field below degrades
  // to empty, exactly like `jq -r '.x // empty'` failing on bad input.
  payload = {}
}

// jq's `//`: the first key present with a value that is neither `null` nor
// `false`. A key absent from a JSON object reads as `undefined` via plain
// property access, which this treats the same as an explicit `null`.
function jqOr(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (v !== undefined && v !== null && v !== false) {
      return typeof v === 'string' ? v : JSON.stringify(v)
    }
  }
  return ''
}

let event = jqOr(payload, ['hook_event_name'])
if (!event) event = 'Subagent'

let summary = jqOr(payload, ['agent_description', 'description', 'prompt', 'last_message', 'reason'])
summary = summary.replace(/\n/g, '').slice(0, 110)

const aid = jqOr(payload, ['agent_id'])
let atype = jqOr(payload, ['agent_type', 'subagent_type'])

let meta = jqOr(payload, ['agent_transcript_path'])
if (meta) {
  meta = meta.replace(/\.jsonl$/, '.meta.json')
} else {
  const tp = jqOr(payload, ['transcript_path'])
  meta = tp && aid ? `${tp.replace(/\.jsonl$/, '')}/subagents/agent-${aid}.meta.json` : ''
}

// THE DEFERRED CHILD IS THIS SAME FILE, re-invoked directly under node (see
// deferSpawn below), never through the shell shim. It carries no payload on
// stdin, so what it needs arrives in the environment, applied here, above
// every use of event/meta/summary/atype below (BUG-124's own regression:
// resolved only when applied before the roster lookup that follows).
if (process.env.BP_SUBAGENT_DEFER_CHILD === '1') {
  event = process.env.BP_DEFER_EVENT ?? event
  meta = process.env.BP_DEFER_META ?? ''
  summary = process.env.BP_DEFER_SUMMARY ?? ''
  atype = process.env.BP_DEFER_ATYPE ?? ''
}

// --- BP_STATE_ROOT, resolved once (bp_state_root's own contract) -----------
const stateRootResult = spawnSync('sh', ['-c', '. "$1"; bp_state_root', 'sh', STATE_DIR_LIB], {
  env: { ...process.env, BP_CODE_ROOT },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
if (stateRootResult.status !== 0) process.exit(0)
const BP_STATE_ROOT = (stateRootResult.stdout ?? '').trim()

function feedAppend(line: string): void {
  // feed_append is best-effort and never fails by its own contract — nothing
  // here needs to inspect its result.
  spawnSync('sh', ['-c', '. "$1"; feed_append "$2"', 'sh', FEED_LIB, line], {
    env: { ...process.env, BP_STATE_ROOT },
    stdio: 'ignore',
  })
}

function resolveFlockCmd(): string {
  const r = spawnSync('sh', ['-c', '. "$1"; bp_flock_cmd', 'sh', WATCHER_LOCK_LIB], {
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (r.status !== 0) return ''
  return (r.stdout ?? '').trim()
}

// --- the timeout provider, and so whether the roster lookup runs at all ----
// NO PROVIDER → NO LOOKUP, same trade the shell version makes: an unbounded
// lookup can stall a dispatch indefinitely, and a wrong label is survivable
// where a hung tool call is not.
const BP_ROSTER_LOOKUP_TIMEOUT = process.env.BP_ROSTER_LOOKUP_TIMEOUT || '2'
let tcmd = ''
if (readable(ROSTER_LIB) && meta) {
  const r = spawnSync(
    'sh',
    ['-c', '. "$1" >/dev/null 2>&1 || exit 0; bp_staleness_timeout_cmd 2>/dev/null || exit 0', 'sh', STALENESS_LIB],
    { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  )
  tcmd = (r.stdout ?? '').trim()
  if (!tcmd) {
    stderrNotice('[log-activity] no timeout(1)/gtimeout(1) available — skipping the roster lookup; labelling by agent type\n')
  }
}

const marker = event === 'SubagentStart' ? '→ dispatched' : event === 'SubagentStop' ? '← finished' : event

// emit_bookend — labelled through the ONE shared roster lookup
// (bp_roster_subagent_label), the same function scripts/agent-activity.sh
// labels streamed lines with (BUG-124: two derivations disagreed).
function emitBookend(): void {
  let label = ''
  if (tcmd) {
    const inner = '. "$1" 2>/dev/null || exit 0; bp_roster_subagent_label "$2" "$3" 2>/dev/null || exit 0'
    const r = spawnSync(
      tcmd,
      [BP_ROSTER_LOOKUP_TIMEOUT, 'bash', '-c', inner, 'bp-roster-lookup', ROSTER_LIB, BP_STATE_ROOT, meta],
      { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    label = (r.stdout ?? '').trim()
  }
  const bracket = label || `${atype || process.env.AGENT_FEED_LABEL || 'subagent'} - Claude Code`
  feedAppend(`[${bracket}] ${marker}${summary ? `: ${summary}` : ''}`)
}

const BP_SUBAGENT_META_WAIT = clampInt(process.env.BP_SUBAGENT_META_WAIT, 5, 15)
// AT MOST THIS MANY children may wait at once, and the knob cannot raise it.
const BP_SUBAGENT_DEFER_MAX = clampInt(process.env.BP_SUBAGENT_DEFER_MAX, 8, 8)

const deferDir = join(BP_STATE_ROOT, 'subagent-defer')

// CLOSE EVERYTHING ABOVE 2 IN THE CHILD, ported. `{ stdio: 'ignore' }` on
// `child_process.spawn` only accounts for Node's OWN internal fd churn on
// startup — measured directly: a driver's `exec 9>lock` did not survive into
// a spawned grandchild (Node's own libuv happened to reuse that low number
// for its own eventfd), but `exec 19>lock` sailed straight through
// unmodified, because nothing internal ever claims a number that high. A
// caller-held lock (or any other stray descriptor) can therefore outlive the
// hook that returned it unless this closes it explicitly — so, like the
// shell version, a tiny shell step runs BEFORE node starts (nothing internal
// to Node exists yet to confuse this closing loop) and only then execs the
// real child. THIS RUNS UNDER BASH: `exec 19>&-` is a syntax error
// under dash (a two-digit descriptor there is parsed as a command name), the
// same reason the shell version's own close_inherited() required it.
const CLOSE_INHERITED_THEN_EXEC =
  'fdd=/proc/self/fd; [ -d "$fdd" ] || fdd=/dev/fd; ' +
  'if [ -d "$fdd" ]; then for fd in "$fdd"/*; do f=${fd##*/}; ' +
  'case "$f" in 0|1|2|*[!0-9]*) continue ;; esac; eval "exec ${f}>&-" 2>/dev/null || true; done; fi; ' +
  'exec "$1" "$2"'

// --- the deferred child's own wait loop -------------------------------------
// THE START BOOKEND IS WRITTEN AFTER THIS HOOK RETURNS: the meta file lands
// only once Claude Code's own hook call has exited (measured absent across a
// 2s poll from inside the hook, present ~100ms after it returned). So a
// detached child waits for it instead, bounded by BP_SUBAGENT_META_WAIT, and
// labels by agent type if it never comes.
//
async function runDeferredChild(): Promise<never> {
  const slot = process.env.BP_DEFER_SLOT ?? ''
  const cleanup = (): void => {
    if (!slot) return
    try {
      rmSync(slot, { recursive: true, force: true })
    } catch {
      // Best-effort: a slot left behind is reclaimed by the next caller's
      // liveness check, not a correctness problem on its own.
    }
  }
  process.on('exit', cleanup)
  // A shell RESUMES after a trap that does not exit; an explicit exit here is
  // what makes releasing the slot and ending its owner one act (BUG-133).
  for (const sig of ['SIGHUP', 'SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => process.exit(143))
  }

  const waitSeconds = clampInt(process.env.BP_DEFER_WAIT, 5, 15)
  const deadline = Date.now() + waitSeconds * 1000
  while (!existsSync(meta) && Date.now() < deadline) {
    await sleep(100)
  }
  emitBookend()
  process.exit(0)
}

function readSlotPid(slot: string): { pid: string; unknown: boolean } {
  let raw: string
  try {
    raw = readFileSync(join(slot, 'pid'), 'utf8').trim()
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { pid: '', unknown: false }
    // BUG-153: a read failure on a slot that EXISTS must not read as "no
    // owner" — the shell version's `cat` could fail transiently (fork/exec
    // EAGAIN under load) and still fold into `_ds_pid=""`, so a live
    // reservation was reclaimed out from under its real owner. Reading
    // in-process removes the fork/exec hazard entirely for the ordinary case
    // (ENOENT), and fails CLOSED — owner unknown, so treated as live — for
    // every other one.
    return { pid: '', unknown: true }
  }
  // BUG-153 round 2: the pid file EXISTS and the read succeeded, but the
  // content is empty or not a pid — a caller can observe the file between
  // its creation and the write of its content. That is still "owner
  // unknown", not "no owner": only ENOENT (the file never existed) may
  // report no owner. Anything else present-but-unparseable fails closed the
  // same as a read error.
  if (raw === '' || !Number.isInteger(Number(raw))) return { pid: raw, unknown: true }
  return { pid: raw, unknown: false }
}

// defer_spawn — reserve a slot and hand it a detached child, atomically:
// reclaiming a dead slot and creating a fresh one happen under the SAME
// flock, so a sweep that reclaims a slot can never race a fresh reservation
// into the same name (Codex's S2, tests/subagent-feed #16).
function resolveBashCmd(): string {
  const r = spawnSync('sh', ['-c', 'command -v bash'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  if (r.status !== 0) return ''
  return (r.stdout ?? '').trim()
}

async function deferSpawn(): Promise<boolean> {
  // The deferred child's own fd-closing step needs bash (CLOSE_INHERITED_THEN_EXEC's
  // own comment says why) — no bash, no deferral, same trade the shell
  // version made for the same reason.
  const bashBin = resolveBashCmd()
  if (!bashBin) return false

  const flockBin = resolveFlockCmd()
  if (!flockBin) return false

  try {
    mkdirSync(deferDir, { recursive: true })
  } catch {
    // Cannot make the defer dir — no deferral this dispatch, hook still emits.
    return false
  }
  const lockPath = join(deferDir, '.lock')
  try {
    writeFileSync(lockPath, '', { flag: 'a' })
  } catch {
    // Cannot touch the lock file — same fallback as above.
    return false
  }

  // Bounded wait, never a bare blocking flock: a hook must never stall the
  // tool call it only observes, so a mutex this can't take in time means "do
  // not defer".
  const lockChild = spawn(flockBin, ['-w', '5', lockPath, '-c', 'echo LOCKED; exec cat'], {
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  const handshake = await new Promise<'locked' | 'refused'>((resolve) => {
    let settled = false
    lockChild.stdout?.once('data', (chunk: Buffer) => {
      if (settled) return
      if (chunk.toString('utf8').startsWith('LOCKED')) {
        settled = true
        resolve('locked')
      }
    })
    lockChild.once('exit', () => {
      if (settled) return
      settled = true
      resolve('refused')
    })
  })
  if (handshake === 'refused') return false

  let claimed = false
  try {
    let n = 0
    while (n < BP_SUBAGENT_DEFER_MAX) {
      const slot = join(deferDir, `slot-${n}`)
      if (existsSync(slot)) {
        const { pid, unknown } = readSlotPid(slot)
        let alive = unknown
        if (!alive && pid) {
          const pidNum = Number(pid)
          if (Number.isInteger(pidNum)) {
            try {
              process.kill(pidNum, 0)
              alive = true
            } catch {
              // ESRCH: no process with this pid — the owner is gone, reclaim it.
              alive = false
            }
          }
        }
        if (alive) {
          n += 1
          continue
        }
        // SAFE ONLY UNDER THE LOCK: no other caller can create or delete a
        // slot while we hold it, so this cannot remove a replacement
        // generation. An external `rm`, not `fs.rmSync` — a caller-observable
        // step (tests/subagent-feed #16 races this exact removal via a PATH
        // shim on `rm`).
        spawnSync('rm', ['-rf', slot], { env: process.env })
      }
      try {
        mkdirSync(slot)
      } catch {
        // EEXIST: another caller won this name first — try the next slot.
        n += 1
        continue
      }
      const child = spawn(bashBin, ['-c', CLOSE_INHERITED_THEN_EXEC, 'bash', process.execPath, SELF_PATH], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          BP_SUBAGENT_DEFER_CHILD: '1',
          BP_DEFER_SLOT: slot,
          BP_DEFER_META: meta,
          BP_DEFER_EVENT: event,
          BP_DEFER_SUMMARY: summary,
          BP_DEFER_ATYPE: atype,
          BP_DEFER_WAIT: String(BP_SUBAGENT_META_WAIT),
        },
      })
      child.unref()
      // THE OWNER, recorded before the lock is dropped. A slot whose pid is
      // not yet written reads as reclaimable to the next caller — and BUG-153
      // round 3 is exactly that read: a write that fails (ENOSPC, an I/O
      // error) used to be swallowed here, leaving the slot claimed on disk
      // with a live, unrecorded child. The next caller's read then hits
      // ENOENT, which readSlotPid correctly reports as "no owner" (it IS
      // absent — round 1/2's fail-closed branches are for a read failure or
      // unparsable content, not this), and reclaims a slot whose owner is
      // still running: BUG-153's exact failure through another door. A slot
      // must never stay claimed with no pid file while its child lives, so a
      // failed write kills the child and releases the slot instead of
      // limping on with an unrecorded owner.
      try {
        writeFileSync(join(slot, 'pid'), `${child.pid}\n`)
        claimed = true
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          // Already gone — nothing left to kill.
        }
        try {
          rmSync(slot, { recursive: true, force: true })
        } catch {
          // Best-effort: the hazard that mattered (a live, unrecorded owner)
          // is already closed by the kill above, even if the empty slot
          // directory itself lingers.
        }
      }
      break
    }
  } finally {
    // Release: close the handshake child's stdin so its `cat` sees EOF and
    // exits, dropping the flock.
    lockChild.stdin?.end()
  }
  return claimed
}

// SAY WHICH MECHANISM IS MISSING (BUG-041/042's misdirection class): the cap
// message names the wrong culprit if flock itself is what's actually absent.
function deferNotice(): void {
  const flockCheck = spawnSync('sh', ['-c', '. "$1"; bp_flock_cmd >/dev/null 2>&1', 'sh', WATCHER_LOCK_LIB], {
    env: process.env,
    stdio: 'ignore',
  })
  if (flockCheck.status === 0) {
    stderrNotice(
      `[log-activity] no deferred slot free (cap ${BP_SUBAGENT_DEFER_MAX}) — labelling this dispatch by agent type\n`,
    )
    return
  }

  stderrNotice(
    '[log-activity] no flock(1) — subagent bookends are labelled by agent type, not by persona. ' +
      'Install it: bash scripts/install-toolchain.sh\n',
  )

  // ONCE, IN THE FEED — stderr is discarded outside --debug, and the feed is
  // where the founder is actually looking when a persona's name is missing.
  try {
    mkdirSync(deferDir, { recursive: true })
  } catch {
    // Cannot make the defer dir — skip the one-time feed marker, stderr already said it.
    return
  }
  const marker = join(deferDir, '.no-flock-notice')
  if (existsSync(marker)) return
  try {
    writeFileSync(marker, '')
  } catch {
    // Cannot write the marker — same fallback, stderr already said it.
    return
  }
  feedAppend(
    '[log-activity - Claude Code] subagent bookends are labelled by agent type, not by persona: no flock(1) ' +
      'on this machine, so the persona lookup cannot be deferred. Install it with scripts/install-toolchain.sh',
  )
}

async function main(): Promise<void> {
  if (process.env.BP_SUBAGENT_DEFER_CHILD === '1') {
    await runDeferredChild()
    return
  }

  let deferred = false
  if (event === 'SubagentStart' && tcmd && !existsSync(meta)) {
    deferred = await deferSpawn()
    if (!deferred) deferNotice()
  }
  if (!deferred) emitBookend()
  process.exit(0)
}

main().catch(() => process.exit(0))
