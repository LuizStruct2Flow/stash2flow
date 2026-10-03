/**
 * tests/harness/dump.ts — process-tree evidence capture for a scenario wait
 * that times out (BUG-146).
 *
 * tests/sync-by-address #20d has hung ~320s in CI three times (BUG-120 row:
 * 61cfe01, 374a8d9, c7c47f6) and never once locally (162+ runs, including
 * under `taskset -c 0-3`). 320019-320024ms is not a wait budget anything in
 * the test chose — it is tests/vitest.config.ts's global `testTimeout`
 * (320_000ms) killing the test from outside while something it awaits never
 * settles. Nothing was captured at that moment, so each occurrence taught
 * nothing beyond "it happened again". This module is the capture: a scenario
 * races a wait against ITS OWN, much shorter timeout (`waitOrDump` in
 * index.ts) so it fails fast, WITH the process tree it was waiting on written
 * to a file first.
 *
 * Generic on purpose — this has nothing #20d-specific in it. Any scenario
 * wait, in any suite, can use `waitOrDump` and get the same capture.
 */

import { execFile } from 'node:child_process'
import { cp, mkdir, readdir, readFile, readlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

interface ProcRow {
  pid: number
  ppid: number
  /** Process group id — the group the killer group-signals. */
  pgid: number
  /** Session id — 1 when the kernel reparented this row to init/a subreaper,
   * which is exactly the shape an orphan holding a pipe takes (BUG-146). */
  sid: number
  stat: string
  wchan: string
  args: string
}

/**
 * The `ps` arguments for this platform, always the seven columns `parsePs`
 * reads. Darwin's `ps` refuses `sid` and `wchan:32` (TASK-087), so it gets its
 * own keywords; its `sess` prints 0 for every process, kept for the column
 * count, not the value. Every other platform keeps the Linux spelling. Only the
 * tree comes across: the per-process `/proc` reads below stay Linux-only and
 * report `<unreadable: …>` elsewhere.
 */
export function psArgs(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'darwin') return ['-eo', 'pid,ppid,pgid,sess,stat,wchan,args']
  return ['-eo', 'pid,ppid,pgid,sid,stat,wchan:32,args']
}

/** Parse the output of `ps` run with `psArgs()` into rows. */
function parsePs(output: string): ProcRow[] {
  const rows: ProcRow[] = []
  for (const line of output.trim().split('\n').slice(1)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line)
    if (!m) continue
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      pgid: Number(m[3]),
      sid: Number(m[4]),
      stat: m[5]!,
      wchan: m[6]!,
      args: m[7]!,
    })
  }
  return rows
}

/** Every pid in `roots` plus every descendant, walking `ppid` links. */
function withDescendants(all: ProcRow[], roots: number[]): ProcRow[] {
  const byPpid = new Map<number, ProcRow[]>()
  for (const row of all) {
    const list = byPpid.get(row.ppid) ?? []
    list.push(row)
    byPpid.set(row.ppid, list)
  }
  const wanted = new Set(roots)
  const queue = [...roots]
  while (queue.length > 0) {
    const pid = queue.shift() as number
    for (const child of byPpid.get(pid) ?? []) {
      if (wanted.has(child.pid)) continue
      wanted.add(child.pid)
      queue.push(child.pid)
    }
  }
  return all.filter((row) => wanted.has(row.pid))
}

/** A /proc/<pid>/<name> read that reports why it failed rather than throwing —
 * a dump that cannot read a stack is still evidence; one that crashes trying
 * to read it is worse than the hang it was meant to explain. */
async function readProcFile(pid: number, name: string): Promise<string> {
  try {
    const text = await readFile(`/proc/${pid}/${name}`, 'utf8')
    return text.trim() || '(empty)'
  } catch (err) {
    return `<unreadable: ${(err as Error).message}>`
  }
}

async function listFds(pid: number): Promise<string[]> {
  try {
    const entries = await readdir(`/proc/${pid}/fd`)
    const out: string[] = []
    for (const entry of entries) {
      const target = await readlink(`/proc/${pid}/fd/${entry}`).catch(
        (err: Error) => `<unreadable: ${err.message}>`,
      )
      out.push(`${entry} -> ${target}`)
    }
    return out
  } catch (err) {
    return [`<unreadable: ${(err as Error).message}>`]
  }
}

interface PipeHolder {
  pid: number
  fd: string
  pipeId: string
  row: ProcRow | undefined
}

/**
 * Every LIVE process (from `all`, a whole-machine `ps` snapshot) with an fd
 * open on one of `pipeIds`, regardless of parentage.
 *
 * THE BLIND SPOT THIS CLOSES (BUG-146, fifth and sixth CI occurrences). The
 * ppid-walk `withDescendants` above cannot see this: a process whose parent
 * was killed is reparented to init or a subreaper and falls out of any walk
 * rooted at the scenario's own tracked pids, even though it can still hold
 * the write end of a pipe the scenario's `child.on('close', ...)` is waiting
 * on to reach EOF. Searching every pid's fd table instead of walking parentage
 * finds it regardless of where the kernel reparented it to.
 *
 * Linux-only (`/proc`), and best-effort within that: `readdir`/`readlink` on
 * another process's fd table needs the OS to permit it (same-uid normally
 * does; a hardened sandbox may not) — a pid this cannot read is skipped, not
 * reported as clean. `pipeIds` is `process.ts`'s `trackedPipeIds()`, captured
 * from each child's OWN fd view at spawn time (not the parent's — a
 * socketpair's two ends carry two different ids, and only the child's is what
 * a forked descendant inherits).
 */
async function findPipeHolders(all: ProcRow[], pipeIds: string[]): Promise<PipeHolder[]> {
  if (pipeIds.length === 0) return []
  const targets = new Set(pipeIds)
  const hits: PipeHolder[] = []
  for (const row of all) {
    let entries: string[]
    try {
      entries = await readdir(`/proc/${row.pid}/fd`)
    } catch {
      // The pid exited mid-scan, or the OS refuses its fd table: skip it,
      // unreported — a dump must never throw on a best-effort net.
      continue
    }
    for (const fd of entries) {
      const target = await readlink(`/proc/${row.pid}/fd/${fd}`).catch(() => undefined)
      if (target !== undefined && targets.has(target)) {
        hits.push({ pid: row.pid, fd, pipeId: target, row })
      }
    }
  }
  return hits
}

/**
 * Every LIVE process whose `/proc/<pid>/environ` contains `marker` — the
 * SECOND net (BUG-146), for when the pipe scan above cannot read a holder's
 * fd table (permission) but can still read its environ, or simply as
 * independent corroboration. `marker` is a scenario's own `escapeToken`,
 * already carried in `AGENT_FEED_TAG`/`AGENT_PERSONA` on every fixture child
 * (index.ts's `scenarioEnv`) and, like any environment variable, normally
 * inherited across fork()/exec() by a reparented descendant too.
 *
 * `environ` is NUL-separated and may be binary; read as a `Buffer` and search
 * it directly rather than decoding, which is also what makes a partial or
 * invalid UTF-8 sequence in some other process's environment harmless here.
 */
async function findByEnvMarker(all: ProcRow[], marker: string): Promise<ProcRow[]> {
  if (!marker) return []
  const hits: ProcRow[] = []
  for (const row of all) {
    try {
      const buf = await readFile(`/proc/${row.pid}/environ`)
      if (buf.includes(marker)) hits.push(row)
    } catch {
      // Unreadable (exited between the ps snapshot and this read, or another
      // user's process) — skip, do not report as clean.
    }
  }
  return hits
}

/**
 * Render the process tree rooted at `rootPids` — a scenario's own tracked
 * process groups — as text: `ps`'s pid/ppid/state/wchan/args, plus
 * `/proc/<pid>/wchan` and `/proc/<pid>/stack` (Linux; `stack` needs root and
 * is usually "<unreadable>" outside it — reported, not hidden), plus each
 * process's open fds ("cheap" here because a scenario's own tree is a
 * handful of processes, not the whole machine's).
 *
 * Never throws. A capture that fails must not mask the timeout it exists to
 * explain — the caller's original error is what propagates either way.
 *
 * `pipeIds` and `envMarker` are the two BUG-146 nets that do NOT depend on
 * parentage, closing the blind spot `withDescendants` has by construction: a
 * process reparented to init/a subreaper falls out of any ppid walk, however
 * far it descends, while still holding the pipe this scenario's `close` wait
 * is blocked on. Both are optional and both degrade to a stated "this net did
 * not run" line rather than silence, so a dump that predates a caller passing
 * them (or that runs where /proc is unavailable) still reads as a dump, not a
 * clean bill of health.
 */
export async function dumpProcessTree(
  rootPids: number[],
  label: string,
  pipeIds: string[] = [],
  envMarker = '',
): Promise<string> {
  const lines: string[] = [
    `# process-tree dump: ${label}`,
    `# generated: ${new Date().toISOString()}`,
    `# roots (this scenario's tracked process groups): ${rootPids.join(', ') || '(none)'}`,
    '',
  ]
  let all: ProcRow[] = []
  try {
    const { stdout } = await execFileAsync('ps', psArgs())
    all = parsePs(stdout)
    const tree = rootPids.length > 0 ? withDescendants(all, rootPids) : []
    if (tree.length === 0) {
      lines.push('(nothing found under the tracked roots — every tracked process had already exited)')
    }
    for (const row of tree) {
      lines.push(
        `pid=${row.pid} ppid=${row.ppid} pgid=${row.pgid} sid=${row.sid} stat=${row.stat} wchan(ps)=${row.wchan} args=${row.args}`,
      )
      lines.push(`  /proc/${row.pid}/wchan: ${await readProcFile(row.pid, 'wchan')}`)
      lines.push(`  /proc/${row.pid}/stack: ${await readProcFile(row.pid, 'stack')}`)
      const fds = await listFds(row.pid)
      lines.push(`  fds: ${fds.length}`)
      for (const fd of fds) lines.push(`    ${fd}`)
      lines.push('')
    }
  } catch (err) {
    lines.push(`ps failed: ${(err as Error).message}`)
  }

  // BUG-146, fifth/sixth occurrence: both real dumps found "nothing under the
  // tracked roots" while the wait they were captured for never resolved —
  // which needs a pipe held open by something the ppid walk above cannot see.
  // These two nets search the WHOLE machine's live processes instead of
  // walking parentage, so an orphan turns up regardless of who reparented it.
  lines.push('')
  lines.push(
    `# pipe holders (BUG-146, parentage-independent): every live process with an fd on one of this scenario's own stdio pipes`,
  )
  if (pipeIds.length === 0) {
    lines.push(
      '(no pipe ids were supplied to this dump — either the caller predates this net, or /proc pipe-id capture at spawn time found nothing to capture)',
    )
  } else {
    lines.push(`# searched pipe ids: ${pipeIds.join(', ')}`)
    const holders = await findPipeHolders(all, pipeIds)
    if (holders.length === 0) {
      lines.push('(no live process holds an fd on any of them)')
    } else {
      for (const h of holders) {
        const row = h.row
        lines.push(
          `pid=${h.pid} fd=${h.fd} -> ${h.pipeId}` +
            (row
              ? ` ppid=${row.ppid} pgid=${row.pgid} sid=${row.sid} stat=${row.stat} args=${row.args}`
              : ' (not in the ps snapshot — exited between snapshot and scan)'),
        )
      }
    }
  }

  lines.push('')
  lines.push(
    `# env-marker holders (BUG-146, second net): every live process whose /proc/<pid>/environ contains this scenario's escape token`,
  )
  if (!envMarker) {
    lines.push('(no scenario env marker was supplied to this dump)')
  } else {
    const markerHits = await findByEnvMarker(all, envMarker)
    if (markerHits.length === 0) {
      lines.push('(no live process carries it)')
    } else {
      for (const row of markerHits) {
        lines.push(`pid=${row.pid} ppid=${row.ppid} pgid=${row.pgid} sid=${row.sid} stat=${row.stat} args=${row.args}`)
      }
    }
  }

  return lines.join('\n')
}

/**
 * Where a dump lands. NEVER inside a scenario's own workspace — `dispose()`
 * (workspace.ts) removes it, and asserts the removal, regardless of whether
 * the scenario body failed. `BP_HARNESS_DUMP_DIR` overrides the default for
 * an IN-PROCESS caller only (see tests/harness/harness.spec.ts "BUG-146"
 * cases, which set it directly on `process.env`).
 *
 * It does NOT reach a NESTED harness (a bootstrapped project's own vitest,
 * as tests/bootstrap-gate runs) — every `BP_*` name is stripped from that
 * child's environment by `scripts/run-ts-suites.sh`'s `ts_scrubbed` before
 * its vitest starts (BUG-146 round 2: passing `BP_HARNESS_DUMP_DIR` on the
 * nested process's env looked like it worked, but the scrub that exists for
 * BUG-046/047/066 unsets it on the way in, so the nested run always fell
 * back to a directory inside the derived workspace that teardown deletes —
 * nothing was ever captured for a nested hang). A nested run's dump is
 * instead read off disk, from the derived project's OWN
 * `tests/.timeout-dumps`, and copied into the outer repo's by `collectDumps`
 * below, while the derived workspace still exists.
 */
export function dumpDir(repoRoot: string): string {
  return process.env.BP_HARNESS_DUMP_DIR || join(repoRoot, 'tests', '.timeout-dumps')
}

/**
 * Copy every file a NESTED harness run left in `fromDir` (a derived
 * project's `tests/.timeout-dumps`, still inside the outer scenario's
 * workspace) into `toDir` (the outer repo's own `tests/.timeout-dumps`,
 * which survives teardown and is what CI uploads — BUG-146 round 2).
 *
 * Best-effort and silent about a `fromDir` that never existed — most gate
 * runs never time out, so "nothing to collect" is the common case, not a
 * failure. Any other read error propagates: a dump directory that exists
 * but cannot be read is worth failing loudly over, not swallowing.
 */
export async function collectDumps(fromDir: string, toDir: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(fromDir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  if (entries.length === 0) return []
  await mkdir(toDir, { recursive: true })
  const copied: string[] = []
  for (const entry of entries) {
    const dest = join(toDir, entry)
    await cp(join(fromDir, entry), dest, { recursive: true })
    copied.push(dest)
  }
  return copied
}

/** Write a dump to `dir`, one file per timeout, and return its path. */
export async function writeDump(dir: string, label: string, text: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const safe = label.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80)
  const file = join(dir, `${safe}-${process.pid}-${Date.now()}.txt`)
  await writeFile(file, text, 'utf8')
  return file
}
