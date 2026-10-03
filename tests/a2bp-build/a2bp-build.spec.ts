/**
 * tests/a2bp-build/a2bp-build.spec.ts — building an a2bp request commit against
 * a fetched blueprint base, in TypeScript (TASK-018).
 *
 * The case that matters most is #2: an unrelated base entry must SURVIVE into the
 * request tree. The build populates an isolated index with
 * `update-index --cacheinfo`, and if that index is not first seeded with
 * `read-tree <base>` the resulting tree contains only the target paths — so the
 * request would propose DELETING the entire blueprint except the files it
 * changes. That defect survived ten plan reviews because "build the new tree from
 * the base tree with the target entries replaced" reads as though it describes
 * itself.
 *
 * NO NETWORK. Every fetch is from a local repository inside the scenario
 * workspace.
 *
 * R4 AND CASE #3b. The shell suite slept 1.1 s there, and its comment is right
 * that the delay is the whole case: `bp_request_hermetic` unsets
 * GIT_AUTHOR_DATE/GIT_COMMITTER_DATE, so dates set on its command line were
 * stripped and `commit-tree` fell back to the WALL CLOCK. Two builds inside one
 * second agreed, and the flow broke under the pre-push gate where the runs
 * straddled a second. R4 forbids the fixed wait, not the coverage: the condition
 * is "the wall-clock second has advanced", so this polls for that instead. It is
 * also faster — half a second on average rather than 1.1 s always.
 *
 * EQUIVALENCE RECORD (R6): `BP_SUBJECT_ROOT` points both implementations at one
 * perturbed copy of the blueprint. The catalogue is docs/waiting-acceptance/TASK-018-EQUIVALENCE-a2bp/ — 17 of 17
 * assertions here have a mutant that was RUN and OBSERVED to turn them red.
 *
 * ONE THING THAT PASSES AND SHOULD NOT BE READ AS COVERAGE. `B4` removes the
 * hermetic scrub from around `commit-tree` and nothing goes red, correctly: the
 * command already pins autocrlf, signing, encoding, identity and dates on its
 * own line, so at THAT call site the scrub is redundant.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type RunResult, type Scenario } from '../harness/index.js'

const SUBJECT_ROOT = process.env.BP_SUBJECT_ROOT ?? REPO_ROOT
const LIBS = ['request.sh', 'request-build.sh', 'request-inputs.sh'].map((l) =>
  join(SUBJECT_ROOT, 'scripts/lib', l),
)
const PREAMBLE = LIBS.map((l) => `. "${l}"`).join('\n')

/**
 * Source the request libs and run `script`.
 *
 * `envPrefix` is prepended INSIDE the child — hostile ambient git config is the
 * subject of #4, and tests/harness/env.ts denies a GIT_CONFIG_COUNT override for
 * good reason (GIT_CONFIG_KEY_<n> can set core.hooksPath past its containment
 * checks, which is the A-22 shape). Setting it one process further in keeps the
 * assertion — the claim is that `bp_request_hermetic` strips it — without asking
 * the harness to hand a fixture a variable it refuses to hand out.
 */
function sh(
  s: Scenario,
  script: string,
  args: string[] = [],
): Promise<RunResult> {
  return s.run('bash', ['-c', `${PREAMBLE}\n${script}`, '_', ...args], {
    cwd: s.workspace.root,
  })
}

/** Call a shell FUNCTION with every argument passed positionally. */
function call(s: Scenario, fn: string, args: string[]): Promise<RunResult> {
  const refs = args.map((_, i) => `"\$${i + 1}"`).join(' ')
  return sh(s, `${fn} ${refs}`, args)
}

const captured = (r: RunResult): string => r.stdout.replace(/\n+$/, '')

/** Run a script that references its own `$1`, `$2`, … and return its stdout. */
async function out(s: Scenario, script: string, args: string[]): Promise<string> {
  const r = await sh(s, script, args)
  expect(r.code, `${script}\n${r.output}`).toBe(0)
  return captured(r)
}

/** Call a shell function positionally and return its stdout. */
async function outFn(s: Scenario, fn: string, args: string[]): Promise<string> {
  const r = await call(s, fn, args)
  expect(r.code, `${fn}\n${r.output}`).toBe(0)
  return captured(r)
}

/** A `<path>:<mode>:<content-file>` spec, with the file inside the workspace. */
async function spec(
  s: Scenario,
  path: string,
  mode: string,
  content: string,
): Promise<string> {
  const name = Buffer.from(`${path}|${mode}|${content}`).toString('hex')
  const file = await s.fs.write(`specs/${name}`, content)
  return `${path}:${mode}:${file}`
}

/** The stand-in blueprint: several files, only one of which a request targets. */
async function upstream(s: Scenario): Promise<{ dir: string; base: string }> {
  const up = await s.gitRepo('upstream')
  await s.fs.write('upstream/docs/DoD.md', 'the DoD\n')
  await s.fs.write('upstream/docs/SECURITY.md', 'security recipe\n')
  await s.fs.write('upstream/scripts/lib/state-dir.sh', 'unrelated helper\n')
  await s.fs.write('upstream/README.md', '# readme\n')
  await up.commitAll('base')
  const full = await up.git(['rev-parse', 'HEAD'])
  return { dir: up.dir, base: full.stdout.trim() }
}

/** A scratch bare clone of `from`, as the CLI builds one. */
let bareSeq = 0
async function bareClone(s: Scenario, from: string): Promise<string> {
  const dir = s.workspace.path(`bare${bareSeq++}`)
  const init = await sh(s, 'bp_request_hermetic git init -q --bare --object-format=sha1 "$1"', [dir])
  expect(init.code, init.output).toBe(0)
  const fetch = await sh(s, 'bp_request_transport_env git -C "$1" fetch -q --depth 1 "$2" main', [
    dir,
    from,
  ])
  expect(fetch.code, fetch.output).toBe(0)
  return dir
}

/** Wait until the wall-clock second advances. R4: a condition, not a duration. */
async function nextWallSecond(): Promise<void> {
  const start = Math.floor(Date.now() / 1000)
  while (Math.floor(Date.now() / 1000) === start) {
    await new Promise((r) => setImmediate(r))
  }
}

describe('a2bp request commits are deterministic, minimal, and assert their own diff', () => {
  it('#1 a request commit is built on the fetched base', async () => {
    await scenario('a2bp-build-1', async (s) => {
      const { dir, base } = await upstream(s)
      const bare = await bareClone(s, dir)
      const c1 = await outFn(s, 'bp_build_request', [
        bare,
        base,
        'a2bp/acme/test1',
        'acme',
        await spec(s, 'docs/DoD.md', '100644', 'the DoD, improved'),
      ])
      expect(c1, 'build produced no commit').not.toBe('')
      const parent = await out(s, 'bp_request_hermetic git -C "$1" rev-parse "$2"', [bare, `${c1}^`])
      expect(parent, "the commit's parent is not the captured base").toBe(base)
    })
  })

  it('#2 unrelated base entries survive; the diff touches exactly 1 path', async () => {
    await scenario('a2bp-build-2', async (s) => {
      // THE ONE THAT MATTERS. Without `read-tree <base>` seeding the index, the
      // tree would hold only docs/DoD.md and the request would propose deleting
      // everything else.
      const { dir, base } = await upstream(s)
      const bare = await bareClone(s, dir)
      const c1 = await outFn(s, 'bp_build_request', [
        bare,
        base,
        'a2bp/acme/test1',
        'acme',
        await spec(s, 'docs/DoD.md', '100644', 'the DoD, improved'),
      ])
      // NOT a skip. If the build refused, the property this case exists to prove
      // is untested, and an untested property must read as a failure.
      expect(c1, 'NOT EXERCISED — no commit was built').not.toBe('')

      const absent: string[] = []
      for (const f of ['docs/SECURITY.md', 'scripts/lib/state-dir.sh', 'README.md']) {
        const r = await sh(s, 'bp_request_hermetic git -C "$1" cat-file -e "$2"', [
          bare,
          `${c1}:${f}`,
        ])
        if (r.code !== 0) absent.push(f)
      }
      expect(
        absent,
        'the index was not seeded from the base, so this request would DELETE these',
      ).toEqual([])

      const changed = await out(s, 'bp_request_hermetic git -C "$1" diff --name-only "$2" "$3"', [
        bare,
        base,
        c1,
      ])
      expect(changed.split('\n').filter(Boolean)).toEqual(['docs/DoD.md'])
    })
  })

  it('#3 an identical request rebuilds to an identical SHA, in a fresh clone', async () => {
    await scenario('a2bp-build-3', async (s) => {
      // This is what makes exact-tip retry adoption possible; without it the
      // retry always refuses.
      const { dir, base } = await upstream(s)
      const build = async (): Promise<string> =>
        outFn(s, 'bp_build_request', [
          await bareClone(s, dir),
          base,
          'a2bp/acme/test1',
          'acme',
          await spec(s, 'docs/DoD.md', '100644', 'the DoD, improved'),
        ])
      const c1 = await build()
      const c1b = await build()

      // Emptiness is checked FIRST and separately: two failed builds both yield
      // "", and "" === "" would report determinism as proven by two absences.
      expect(c1, 'NOT EXERCISED — a build produced no commit').not.toBe('')
      expect(c1b, 'NOT EXERCISED — a build produced no commit').not.toBe('')
      expect(c1b, 'retry adoption would never match').toBe(c1)
    })
  })

  it('#3b builds a second apart are identical; the date comes from the base, not the clock', async () => {
    await scenario('a2bp-build-3b', async (s) => {
      // THE REGRESSION. Cases #3 and #4 rebuild back-to-back, so both commits
      // land in the same second — and that made them blind to the actual defect:
      // bp_request_hermetic unsets GIT_AUTHOR_DATE/GIT_COMMITTER_DATE, so dates
      // set on its command line were stripped and commit-tree fell back to the
      // WALL CLOCK. Crossing a second boundary is the only witness.
      const { dir, base } = await upstream(s)
      // Each build gets its OWN fresh clone, as the CLI does — and the handle is
      // kept, because the commit exists only in the clone that built it.
      const build = async (): Promise<{ sha: string; bare: string }> => {
        const bare = await bareClone(s, dir)
        const sha = await outFn(s, 'bp_build_request', [
          bare,
          base,
          'a2bp/acme/tsec',
          'acme',
          await spec(s, 'docs/DoD.md', '100644', 'the DoD, improved'),
        ])
        return { sha, bare }
      }

      const first = await build()
      await nextWallSecond()
      const second = await build()

      expect(first.sha, 'NOT EXERCISED — a build produced no commit').not.toBe('')
      expect(second.sha, 'NOT EXERCISED — a build produced no commit').not.toBe('')
      expect(
        second.sha,
        'the commit date is coming from the wall clock, so retry adoption refuses its own request',
      ).toBe(first.sha)

      const bare = first.bare
      const commitDate = await out(s, 'bp_request_hermetic git -C "$1" show -s --format=%ct "$2"', [
        bare,
        first.sha,
      ])
      const baseDate = await out(s, 'bp_request_hermetic git -C "$1" show -s --format=%ct "$2"', [
        bare,
        base,
      ])
      expect(commitDate, 'the date is not being taken from the base').toBe(baseDate)
    })
  })

  it('#4 hostile autocrlf, signing, author identity, dates and locale do not change the SHA', async () => {
    await scenario('a2bp-build-4', async (s) => {
      // Every one of these would leak into the commit if construction used a
      // working tree or an unscrubbed env.
      const { dir, base } = await upstream(s)
      const specArg = await spec(s, 'docs/DoD.md', '100644', 'the DoD, improved')

      const clean = await outFn(s, 'bp_build_request', [
        await bareClone(s, dir),
        base,
        'a2bp/acme/test1',
        'acme',
        specArg,
      ])

      const hostileBare = await bareClone(s, dir)
      const hostile = await sh(
        s,
        'GIT_CONFIG_COUNT=2 ' +
          'GIT_CONFIG_KEY_0=core.autocrlf GIT_CONFIG_VALUE_0=true ' +
          'GIT_CONFIG_KEY_1=commit.gpgsign GIT_CONFIG_VALUE_1=true ' +
          'GIT_AUTHOR_NAME="Somebody Else" GIT_AUTHOR_EMAIL="else@example.com" ' +
          'GIT_AUTHOR_DATE="2020-01-01T00:00:00Z" GIT_COMMITTER_DATE="2020-01-01T00:00:00Z" ' +
          'LC_ALL=en_US.UTF-8 ' +
          'bp_build_request "$1" "$2" "$3" "$4" "$5"',
        [hostileBare, base, 'a2bp/acme/test1', 'acme', specArg],
      )
      const hostileSha = captured(hostile)

      expect(clean, 'NOT EXERCISED — a build produced no commit').not.toBe('')
      expect(hostileSha, 'NOT EXERCISED — no commit was built under hostile config').not.toBe('')
      expect(hostileSha, 'the scrub is not holding').toBe(clean)
    })
  })

  it('#5 a multi-file request changes exactly its paths and carries modes', async () => {
    await scenario('a2bp-build-5', async (s) => {
      const { dir, base } = await upstream(s)
      const bare = await bareClone(s, dir)
      const c2 = await outFn(s, 'bp_build_request', [
        bare,
        base,
        'a2bp/acme/test2',
        'acme',
        await spec(s, 'docs/DoD.md', '100644', 'one'),
        await spec(s, 'scripts/lib/state-dir.sh', '100755', 'two'),
      ])
      expect(c2, 'multi-file build failed').not.toBe('')

      const changed = await out(s, 'bp_request_hermetic git -C "$1" diff --name-only "$2" "$3"', [
        bare,
        base,
        c2,
      ])
      expect(changed.split('\n').filter(Boolean)).toHaveLength(2)

      const entry = await out(
        s,
        'bp_request_hermetic git -C "$1" ls-tree "$2" -- scripts/lib/state-dir.sh | awk \'{print $1}\'',
        [bare, c2],
      )
      expect(entry, 'the 100755 mode was not carried into the tree').toBe('100755')
    })
  })

  it('#6 a file absent from the base is created without disturbing the rest', async () => {
    await scenario('a2bp-build-6', async (s) => {
      const { dir, base } = await upstream(s)
      const bare = await bareClone(s, dir)
      const c3 = await outFn(s, 'bp_build_request', [
        bare,
        base,
        'a2bp/acme/test3',
        'acme',
        await spec(s, 'docs/NEWFILE.md', '100644', 'brand-new'),
      ])
      expect(c3, 'could not create a file absent from the base').not.toBe('')

      const content = await out(s, 'bp_request_hermetic git -C "$1" show "$2"', [
        bare,
        `${c3}:docs/NEWFILE.md`,
      ])
      expect(content, 'the created file has wrong content').toBe('brand-new')

      const kept = await sh(s, 'bp_request_hermetic git -C "$1" cat-file -e "$2"', [
        bare,
        `${c3}:README.md`,
      ])
      expect(kept.code, 'creating a file lost unrelated entries').toBe(0)
    })
  })

  it('#7 a directory at the target path is refused, naming the reason', async () => {
    await scenario('a2bp-build-7', async (s) => {
      const { dir, base } = await upstream(s)
      const bare = await bareClone(s, dir)
      const r = await call(s, 'bp_build_validate_base', [bare, base, 'docs'])
      expect(r.code, 'a DIRECTORY at the target path was accepted').not.toBe(0)
      expect(r.output.toUpperCase(), 'did not say a directory was in the way').toContain('DIRECTORY')
    })
  })

  it('#7b an existing regular file and a creatable path both pass', async () => {
    await scenario('a2bp-build-7b', async (s) => {
      const { dir, base } = await upstream(s)
      const bare = await bareClone(s, dir)
      const r = await call(s, 'bp_build_validate_base', [
        bare,
        base,
        'docs/DoD.md',
        'docs/NEWFILE.md',
      ])
      expect(r.code, r.output).toBe(0)
    })
  })

  it('#7c a path blocked by a non-directory parent is refused', async () => {
    await scenario('a2bp-build-7c', async (s) => {
      const { dir, base } = await upstream(s)
      const bare = await bareClone(s, dir)
      const r = await call(s, 'bp_build_validate_base', [bare, base, 'README.md/nested.md'])
      expect(r.code, 'a path whose parent is a FILE was accepted').not.toBe(0)
    })
  })

  it('#7d TASK-037: a new path differing from the base only by case is refused, parents included', async () => {
    await scenario('a2bp-build-7d', async (s) => {
      // A git tree holds `Readme.md` and `README.md` side by side; a macOS
      // checkout cannot. Exact collisions are refused above; these were not.
      const up = await s.gitRepo('upstream-case')
      await s.fs.write('upstream-case/Readme.md', '# readme\n')
      await s.fs.write('upstream-case/Docs/guide.md', 'guide\n')
      await up.commitAll('base')
      const base = (await up.git(['rev-parse', 'HEAD'])).stdout.trim()
      const bare = await bareClone(s, up.dir)

      const problems: string[] = []
      for (const bad of ['README.md', 'docs/NEW.md']) {
        const r = await call(s, 'bp_build_validate_base', [bare, base, bad])
        if (r.code === 0) problems.push(`${bad} was accepted`)
        else if (!r.output.includes('only by case')) problems.push(`${bad} refused, but not for case: ${r.output}`)
      }
      // Non-vacuity: the exact parent and an unrelated path still pass.
      const ok = await call(s, 'bp_build_validate_base', [bare, base, 'Docs/NEW.md', 'other/NEW.md'])
      if (ok.code !== 0) problems.push(`exact-case paths were refused: ${ok.output}`)
      expect(problems).toEqual([])
    })
  })

  it('#8 the assertion catches an unseeded index — the defect that survived ten plan reviews', async () => {
    await scenario('a2bp-build-8', async (s) => {
      // Built by hand from an EMPTY index — exactly what the missing read-tree
      // would have produced.
      const { dir, base } = await upstream(s)
      const bare = await bareClone(s, dir)
      const cf = await s.fs.write('mis', 'mis-seeded\n')

      const blob = await out(
        s,
        'bp_request_hermetic git -C "$1" hash-object -w --no-filters --stdin < "$2"',
        [bare, cf],
      )
      // `bp_request_hermetic env GIT_INDEX_FILE=…`, NOT
      // `GIT_INDEX_FILE=… bp_request_hermetic …`. BUG-048 names this exact
      // fixture (`a2bp-build:258-259`) as passing FOR THE WRONG REASON: the
      // wrapper does `env -u GIT_INDEX_FILE`, so a prefix assignment is stripped
      // and both commands operated on the bare repo's own index. That index is
      // empty in a fresh clone, so the fixture accidentally produced the tree it
      // meant to — the verdict was right and the mechanism was not. `request.sh`
      // documents the same trap for GIT_AUTHOR_DATE and names this idiom as the
      // fix: set the variable INSIDE the scrub.
      const badIndex = s.workspace.path('bad-index')
      const add = await sh(
        s,
        'bp_request_hermetic env GIT_INDEX_FILE="$1" git -C "$2" update-index --add --cacheinfo "100644,$3,docs/DoD.md"',
        [badIndex, bare, blob],
      )
      expect(add.code, add.output).toBe(0)
      // Non-vacuity of the fixture: the named index file must now actually
      // exist, which is what proves the assignment reached git rather than being
      // scrubbed. Without this the case can silently go back to using the bare
      // repo's own index and still look correct.
      expect(
        await s.fs.exists('bad-index'),
        'GIT_INDEX_FILE did not reach git — the hand-built index is the repo\'s own, so this case would pass for the wrong reason (BUG-048)',
      ).toBe(true)
      const badTree = await out(
        s,
        'bp_request_hermetic env GIT_INDEX_FILE="$1" git -C "$2" write-tree',
        [badIndex, bare],
      )
      // The identity must be supplied explicitly: the hermetic env scrubs global
      // config, so commit-tree has no user.email to fall back on. That the
      // fixture needs this is itself evidence the scrub is working.
      const badCommit = await out(
        s,
        "printf 'mis-seeded\\n' | GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@local " +
          'GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@local ' +
          'bp_request_hermetic git -C "$1" commit-tree "$2" -p "$3"',
        [bare, badTree, base],
      )

      const r = await call(s, 'bp_build_assert', [
        bare,
        base,
        badCommit,
        `docs/DoD.md:100644:${cf}`,
      ])
      expect(
        r.code,
        'the assertion PASSED a tree built from an unseeded index — it would not have caught the deletion defect',
      ).not.toBe(0)
      expect(r.output.toLowerCase(), 'refused, but not for the changed-path-set reason').toContain(
        'different set of paths',
      )
    })
  })
})
