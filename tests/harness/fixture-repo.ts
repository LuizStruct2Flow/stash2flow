/**
 * tests/harness/fixture-repo.ts — a git repository a scenario owns.
 *
 * WHY: Andreas, migrating drift-in-blueprint, reported that "the main missing
 * primitive is a repo fixture helper: drift-in-blueprint needs repeated
 * git init, identity config, add, commit, and fixture source setup, so each
 * migrated suite will otherwise grow its own mini git DSL."
 *
 * Thirty-odd suites each growing their own is how the shell tree ended up with
 * two different spellings of `git init` and a guard that could see only one of
 * them (BUG-047: git-isolation:118 grepped for the literal `git init`, missed
 * `git -C "$T6" init -q`, and matched COMMENT PROSE in suites that used a third
 * form). One primitive means one spelling, and nothing to grep for.
 *
 * IDENTITY IS SET PER-REPO, NEVER GLOBALLY. The harness scrubs GIT_CONFIG_*
 * from every child, so a fixture repo cannot read the developer's identity and
 * must carry its own. That is also what makes bootstrap-identity's scenarios
 * expressible: a repo with NO identity is a legitimate fixture state, so
 * `identity: null` is supported and distinct from the default.
 */

import { join } from 'node:path'
import type { RunResult, SpawnOptions } from './process.js'

export interface GitIdentity {
  name: string
  email: string
}

export const DEFAULT_IDENTITY: GitIdentity = {
  name: 'Fixture Operator',
  email: 'fixture@example.test',
}

export interface FixtureRepoOptions {
  /** Identity written into the repo's LOCAL config. `null` = leave it unset. */
  identity?: GitIdentity | null
  /** Initial branch name. Pinned so a host's init.defaultBranch cannot leak in. */
  branch?: string
  /** Create an initial empty commit, so HEAD resolves. */
  initialCommit?: boolean
}

export interface FixtureRepo {
  /** Absolute path to the working tree (inside the scenario workspace). */
  readonly dir: string
  /** Run a git command in this repo. Never inherits GIT_DIR — see env.ts. */
  git(args: string[], options?: Partial<SpawnOptions>): Promise<RunResult>
  /** Stage everything and commit. Returns the commit's short sha. */
  commitAll(message: string): Promise<string>
  /** The current HEAD sha, or '' when there are no commits. */
  head(): Promise<string>
  /** Read a local config value, or '' when unset. */
  config(key: string): Promise<string>
}

type Runner = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => Promise<RunResult>

/**
 * Build a git repository inside a directory the scenario already owns.
 *
 * `-c init.defaultBranch` and an explicit `--initial-branch` are both pinned:
 * a host configuring `master` and a host configuring `main` would otherwise
 * give two different fixtures, and a suite asserting on branch names would pass
 * for one developer and fail for another.
 */
export async function makeFixtureRepo(
  run: Runner,
  dir: string,
  options: FixtureRepoOptions = {},
): Promise<FixtureRepo> {
  const branch = options.branch ?? 'main'
  const identity =
    options.identity === undefined ? DEFAULT_IDENTITY : options.identity

  const git = (args: string[], opts: Partial<SpawnOptions> = {}) =>
    run('git', args, { cwd: dir, ...opts })

  const init = await git(['init', '-q', '--initial-branch', branch])
  if (init.code !== 0) {
    throw new Error(
      `git init failed in ${dir}\n${init.output}\n` +
        `If this says "not a git repository" the GIT_DIR scrub has regressed — ` +
        `that is BUG-047, where git init returned 0 while creating no .git at all.`,
    )
  }

  if (identity) {
    await git(['config', 'user.name', identity.name])
    await git(['config', 'user.email', identity.email])
  }
  // Commit signing off, always. A developer with commit.gpgsign=true globally
  // would otherwise have every fixture commit block on a passphrase prompt —
  // and the harness scrubs GIT_CONFIG_*, so the fixture cannot see that setting
  // to know it needs disabling. Set it locally and unconditionally.
  await git(['config', 'commit.gpgsign', 'false'])

  const repo: FixtureRepo = {
    dir,
    git,

    async commitAll(message: string): Promise<string> {
      const add = await git(['add', '-A'])
      if (add.code !== 0) throw new Error(`git add failed:\n${add.output}`)
      const commit = await git(['commit', '-q', '-m', message, '--allow-empty'])
      if (commit.code !== 0) throw new Error(`git commit failed:\n${commit.output}`)
      return repo.head()
    },

    async head(): Promise<string> {
      const r = await git(['rev-parse', '--short', 'HEAD'])
      return r.code === 0 ? r.stdout.trim() : ''
    },

    async config(key: string): Promise<string> {
      const r = await git(['config', '--local', '--get', key])
      return r.code === 0 ? r.stdout.trim() : ''
    },
  }

  if (options.initialCommit) {
    await repo.commitAll('fixture: initial')
  }

  return repo
}

/**
 * A directory of executable shims, plus the PATH that finds them first.
 *
 * WHY: Andreas called this "the awkwardest workaround" — fault-injection cases
 * (pull-exec-bit #6/#6b) need a stubbed tool ahead of the real one, and without
 * touching process.env the only route was hard-coding a minimal system PATH
 * after the shim directory. Hard-coding a system PATH in a test is a portability
 * bug waiting to happen, and it is the kind of thing every suite would spell
 * differently.
 */
export interface ShimDir {
  readonly dir: string
  /** Write an executable shim. `body` is a shell script WITHOUT the shebang. */
  add(name: string, body: string): Promise<string>
  /** PATH with this directory first, preserving the rest of the real one. */
  path(): string
}

export async function makeShimDir(
  dir: string,
  write: (rel: string, content: string, o?: { mode?: number }) => Promise<string>,
  relRoot: string,
): Promise<ShimDir> {
  return {
    dir,
    async add(name: string, body: string): Promise<string> {
      return write(join(relRoot, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    },
    path(): string {
      // Prepend, never replace. Replacing is how a fault-injection case ends up
      // also testing "what happens with no coreutils", which is a different
      // question and usually not the one being asked.
      return `${dir}:${process.env.PATH ?? ''}`
    },
  }
}
