/**
 * tests/harness/files.ts — filesystem writes that cannot leave the workspace.
 *
 * WHY THIS EXISTS, and it is a correction rather than an addition.
 *
 * Andreas (Back-End-2, Codex) migrated two suites against the first version of
 * this harness and reported the gap precisely:
 *
 *   "File setup is also half in and half out of the harness. I used
 *    s.workspace for paths, but had to use Node fs directly for writeFile,
 *    chmod, copyFile, cp, rm, and mode checks. That is acceptable, but it means
 *    'all fixture mutations stay under the workspace' is still a CONVENTION for
 *    filesystem writes, not enforced the same way process execution is."
 *
 * That is exactly right, and it undercut the harness's central claim. The whole
 * argument for a typed fixture is that isolation stops being something an
 * author must remember (BUG-046 and BUG-047 were each one forgotten line). A
 * harness that enforces it for processes and merely asks nicely for files has
 * two standards, and the weaker one governs the easier mistake — `writeFile` is
 * one import away, while spawning a process is not.
 *
 * The canary still catches such a write AFTER the fact, so the guarantee was
 * never absent. But detection and prevention are different promises, and the
 * plan claimed the stronger one. These helpers make it true: every path is
 * resolved and checked to be inside the scenario's workspace before anything
 * touches the disk.
 *
 * This is a case where getting the API reviewed by a model that did not design
 * it was worth more than the migration it was asked to do.
 */

import { mkdir, writeFile, readFile, chmod, stat, rm, copyFile, realpath } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

export class OutsideWorkspaceError extends Error {
  constructor(target: string, root: string) {
    super(
      `Refusing to write outside the scenario workspace.\n` +
        `  target: ${target}\n` +
        `  root:   ${root}\n` +
        `A fixture must own everything it writes. If a scenario genuinely needs ` +
        `to observe real state, read it through the canary rather than writing ` +
        `to it — that is the BUG-030 / BUG-046 class.`,
    )
    this.name = 'OutsideWorkspaceError'
  }
}

/**
 * Filesystem operations bound to one workspace root.
 *
 * Every method resolves its argument and refuses anything that escapes the
 * root — including via `..`, and including a symlink whose resolved parent
 * lands outside. The root is already a physical path (BUG-036), so the
 * comparison is like-for-like.
 */
export class ScopedFs {
  constructor(private readonly root: string) {}

  /** Resolve a path and prove it stays inside. Public so specs can assert on it. */
  private assertLexicalContainment(target: string): void {
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new OutsideWorkspaceError(target, this.root)
    }
  }

  /** Resolve the nearest existing ancestor so a symlink cannot redirect a write. */
  async resolve(relOrAbs: string): Promise<string> {
    const target = resolve(this.root, relOrAbs)
    // `startsWith(root + sep)` and not `startsWith(root)`: the latter would
    // accept a sibling directory whose name merely begins with the root's.
    this.assertLexicalContainment(target)

    let ancestor = target
    for (;;) {
      try {
        const physicalAncestor = await realpath(ancestor)
        const suffix = target.slice(ancestor.length).replace(/^[/\\]+/, '')
        const physicalTarget = resolve(physicalAncestor, suffix)
        this.assertLexicalContainment(physicalTarget)
        return physicalTarget
      } catch (error) {
        if (error instanceof OutsideWorkspaceError) throw error
        const parent = dirname(ancestor)
        if (parent === ancestor) throw error
        ancestor = parent
      }
    }
  }

  /**
   * `append` is not a convenience. The feed suites drive a live supervisor that
   * tracks each watched file by its SIZE, so rewriting a log to add a line looks
   * like a truncate-and-replace and resets the offset — the very event
   * agent-activity-bound #8 asserts about. An append is the only write that means
   * "one more record arrived", which is what every sentinel round-trip needs.
   */
  async write(
    relPath: string,
    content: string,
    options: { mode?: number; append?: boolean } = {},
  ): Promise<string> {
    const target = await this.resolve(relPath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, { encoding: 'utf8', flag: options.append ? 'a' : 'w' })
    if (options.mode !== undefined) await chmod(target, options.mode)
    return target
  }

  async read(relPath: string): Promise<string> {
    return readFile(await this.resolve(relPath), 'utf8')
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await stat(await this.resolve(relPath))
      return true
    } catch {
      // Absence is the probed state.
      return false
    }
  }

  async chmod(relPath: string, mode: number): Promise<void> {
    await chmod(await this.resolve(relPath), mode)
  }

  /** The permission bits, as the octal string the shell suites compare on. */
  async mode(relPath: string): Promise<string> {
    const s = await stat(await this.resolve(relPath))
    return (s.mode & 0o7777).toString(8)
  }

  async mkdirp(relPath: string): Promise<string> {
    const target = await this.resolve(relPath)
    await mkdir(target, { recursive: true })
    return target
  }

  async rm(relPath: string): Promise<void> {
    await rm(await this.resolve(relPath), { recursive: true, force: true })
  }

  /**
   * Copy a file INTO the workspace from anywhere.
   *
   * Deliberately asymmetric: the source may be outside (a suite legitimately
   * copies scripts/blueprint.mts out of the repo under test), the destination may
   * not. Reading real files is fine; writing them is the defect.
   */
  async copyIn(absSource: string, relDest: string): Promise<string> {
    const target = await this.resolve(relDest)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(absSource, target)
    return target
  }
}
