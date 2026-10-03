// scripts/lib/find-bin.mts — shared binary discovery for the signal-watch
// launchers (TASK-067/TASK-083 port). Each shell launcher hand-rolled its own
// `command -v` + `find ... | sort -V | tail -1` fallback; porting three
// near-identical copies to TypeScript would just move the duplication, so it
// lives here once and every ported launcher calls it.

import { accessSync, constants as fsConstants, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** True if `path` exists and is executable by this process — mirrors `[ -x ... ]`. */
export function isExecutable(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK)
    return statSync(path).isFile()
  } catch {
    // Missing, unreadable or a directory are all "not a usable binary" here.
    return false
  }
}

/** `command -v NAME` — the first executable match on $PATH, or undefined. */
export function findOnPath(name: string): string | undefined {
  const path = process.env.PATH ?? ''
  for (const dir of path.split(':')) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (isExecutable(candidate)) return candidate
  }
  return undefined
}

// findLatestUnderTree — mirrors
// `find ROOT -type f -name NAME -path '<star>/PATH_SEGMENT/<star>'` then
// `sort -V | tail -1`: walk ROOT recursively, collect files named NAME whose
// path contains a `/PATH_SEGMENT/` component, and return the version-sorted
// last one (the shell launchers used this to pick the newest bundled binary
// under an extensions/version tree). A missing or unreadable ROOT yields no
// matches, same as `find`'s `2>/dev/null`.
export function findLatestUnderTree(root: string, name: string, pathSegment: string): string | undefined {
  const segment = `/${pathSegment}/`
  const matches: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      // Unreadable or vanished mid-walk (a permissions dir, a symlink race) is
      // the same "nothing found here" outcome `find`'s `2>/dev/null` gives —
      // skip this branch rather than aborting the whole search.
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      let info
      try {
        info = statSync(full)
      } catch {
        // A dangling symlink or a file removed between readdir and stat is
        // not a candidate binary — skip it, same as the directory case above.
        continue
      }
      if (info.isDirectory()) {
        stack.push(full)
      } else if (info.isFile() && entry === name && `${full}/`.includes(segment)) {
        matches.push(full)
      }
    }
  }
  if (matches.length === 0) return undefined
  // `sort -V`: natural/version comparison. Intl.Collator's numeric mode is the
  // portable Node equivalent — it orders "10" after "9" the way -V does.
  const collator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' })
  matches.sort(collator.compare)
  return matches.at(-1)
}
