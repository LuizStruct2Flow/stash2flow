/**
 * tests/a2bp-request/a2bp-request.spec.ts — the identity half of the a2bp
 * feature-request flow, in TypeScript (TASK-018).
 *
 * WHAT THIS GUARDS. The length-framed request key, ref validation, and the
 * git-version floor. Every component of the key is attacker- or
 * accident-influenced: a remote URL, a branch name, a project directory name and
 * file content can all contain whatever character a delimiter scheme chose. A
 * byte count cannot be forged by content, and the cases below prove it.
 *
 * THE SUBJECT IS STILL SHELL. `scripts/lib/request.sh` has not been ported, so
 * these cases drive it through `bash -c`. TASK-018-TARGET §3.2 predicts the cost
 * (parity, not the two-orders-of-magnitude win a logic test gets) and that is
 * accepted here: the mission was a faithful port with the shell suite left
 * running beside it, not a rewrite of the request library.
 *
 * EQUIVALENCE RECORD (R6). `BP_SUBJECT_ROOT` exists so that both
 * implementations can be pointed at the SAME perturbed copy of the blueprint.
 * The equivalence run mutates `scripts/lib/request.sh` in a scratch copy, runs
 * `tests/a2bp-request/test.sh` from that copy and this spec with
 * `BP_SUBJECT_ROOT` set to it, and compares which case ids go red. It is NOT a
 * serial or skip hatch — it changes which tree is under test, never whether a
 * case runs. The catalogue is docs/waiting-acceptance/TASK-018-EQUIVALENCE-a2bp/ — 15 of 15 assertions
 * here have a mutant that was RUN and OBSERVED to turn them red.
 *
 * #3 AND #3b COULD NOT SEE THE FRAMING LEAVE, and now can (BUG-104, closed).
 * Their original fixtures shifted a byte into a field whose next neighbour is
 * constant, so the concatenations still differed: removing the byte count from
 * the content primitive (#3's subject) left #3 green, and making the headers
 * newline-delimited (#3b's subject) left #3b green. Each was red only under a
 * defect OTHER than the one in its title — content leaving the key for #3, the
 * project component leaving it for #3b.
 *
 * Each case now carries a second pair chosen so the shifted bytes become the
 * next record's header (#3) or forge a newline boundary (#3b). Observed: K3 reds
 * #3, K4 reds #3b, and both are green on the real library. #3c stays as the
 * witness for plain concatenation of BOTH primitives at once.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type RunResult, type Scenario } from '../harness/index.js'

/**
 * The blueprint checkout under test. `REPO_ROOT` unless an equivalence run
 * points it at a perturbed copy.
 */
const SUBJECT_ROOT = process.env.BP_SUBJECT_ROOT ?? REPO_ROOT
const LIB = join(SUBJECT_ROOT, 'scripts/lib/request.sh')

/** Source request.sh and run `script` with `args` as $1, $2, … */
function sh(s: Scenario, script: string, args: string[] = []): Promise<RunResult> {
  return s.run('bash', ['-c', `. "${LIB}"\n${script}`, '_', ...args], {
    cwd: s.workspace.root,
  })
}

/**
 * Run a shell expression and return its stdout, asserting it succeeded.
 *
 * Trailing newlines are stripped because the shell suite read every one of these
 * through `$( )`, which does exactly that. Comparing an unstripped value would
 * make this port differ from the suite it must match on every function that ends
 * its output with a newline — `bp_request_key` does, `bp_request_ref` does not.
 */
async function out(s: Scenario, script: string, args: string[] = []): Promise<string> {
  const r = await sh(s, script, args)
  expect(r.code, `${script}\n${r.output}`).toBe(0)
  return r.stdout.replace(/\n+$/, '')
}

/**
 * The shell suite's `spec` helper: write content to a file and emit the
 * `<path>:<mode>:<file>` triple `bp_request_key` consumes.
 *
 * The file name is derived from the triple's bytes so that two calls with the
 * same arguments reuse one file — which is what makes the determinism cases (#1,
 * #3) compare keys rather than compare two different temp paths.
 */
async function spec(
  s: Scenario,
  path: string,
  mode: string,
  content: string,
): Promise<string> {
  const key = Buffer.from(`${path}|${mode}|${content}`).toString('hex')
  const file = await s.fs.write(`specs/${key}`, content)
  return `${path}:${mode}:${file}`
}

const R = 'git@github.com:Owner/bp.git'
const B = 'main'
const S = '0123456789abcdef0123456789abcdef01234567'
const P = 'acme-flow'

/** bp_request_key with the four header components plus n file specs. */
function key(
  s: Scenario,
  header: [string, string, string, string],
  ...specs: string[]
): Promise<string> {
  const argv = [...header, ...specs]
  const refs = argv.map((_, i) => `"\$${i + 1}"`).join(' ')
  return out(s, `bp_request_key ${refs}`, argv)
}

describe('a2bp request identity — the key is framed, deterministic and ref-validated', () => {
  it('#1 identical inputs produce one 64-char key', async () => {
    await scenario('a2bp-request-1', async (s) => {
      const spec1 = await spec(s, 'docs/DoD.md', '100644', 'hello')
      const k1 = await key(s, [R, B, S, P], spec1)
      const k2 = await key(s, [R, B, S, P], spec1)

      expect(k1).not.toBe('')
      expect(k1).toBe(k2)
      expect(k1).toHaveLength(64)
      expect(k1).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  it('#2 remote, branch, base, project, path, mode and content all bind into the key', async () => {
    await scenario('a2bp-request-2', async (s) => {
      const base = await key(s, [R, B, S, P], await spec(s, 'docs/DoD.md', '100644', 'hello'))

      const variants: Record<string, string> = {
        remote: await key(
          s,
          ['git@github.com:Other/bp.git', B, S, P],
          await spec(s, 'docs/DoD.md', '100644', 'hello'),
        ),
        branch: await key(s, [R, 'release', S, P], await spec(s, 'docs/DoD.md', '100644', 'hello')),
        base_sha: await key(
          s,
          [R, B, 'f'.repeat(40), P],
          await spec(s, 'docs/DoD.md', '100644', 'hello'),
        ),
        project: await key(
          s,
          [R, B, S, 'other-project'],
          await spec(s, 'docs/DoD.md', '100644', 'hello'),
        ),
        path: await key(s, [R, B, S, P], await spec(s, 'docs/SECURITY.md', '100644', 'hello')),
        mode: await key(s, [R, B, S, P], await spec(s, 'docs/DoD.md', '100755', 'hello')),
        content: await key(s, [R, B, S, P], await spec(s, 'docs/DoD.md', '100644', 'goodbye')),
      }

      // Reported as a set rather than seven assertions: which components fail to
      // bind is the diagnosis, and one-at-a-time would report only the first.
      const inert = Object.entries(variants)
        .filter(([, k]) => k === base)
        .map(([name]) => name)
      expect(inert, 'these components are not in the key at all').toEqual([])
    })
  })

  it('#3 content boundaries are framed, so an adjacent-content collision is impossible', async () => {
    await scenario('a2bp-request-3', async (s) => {
      // Without length-prefixing, "ab"+"c" and "a"+"bc" hash the same. This is
      // the entire reason the key is framed rather than delimited.
      const kA = await key(
        s,
        [R, B, S, P],
        await spec(s, 'a', '100644', 'ab'),
        await spec(s, 'b', '100644', 'c'),
      )
      const kB = await key(
        s,
        [R, B, S, P],
        await spec(s, 'a', '100644', 'a'),
        await spec(s, 'b', '100644', 'bc'),
      )
      expect(kA).not.toBe(kB)

      // THE PAIR THAT WITNESSES CONTENT FRAMING LEAVING (BUG-104). The pair
      // above cannot: content's NEXT neighbour is the following spec's framed
      // path, which begins with a byte count, so a byte shifted out of content
      // lands in front of a digit and the concatenations still differ. Removing
      // the count from the content primitive alone therefore left this case
      // green, and its only red mutant deleted content from the key entirely —
      // a different defect from the one in its title.
      //
      // A collision needs the shifted bytes to BE the next frame's header. With
      // content unframed the tail reads `<content><len(path)> <path>`, so
      // (content "", path "1 x") and (content "3 ", path "x") both render
      // `3 1 x`. Framed, the content records are `0 ` and `2 3 ` and nothing
      // collides. Observed: K3 reds this, and it is green on the real library.
      const kA2 = await key(
        s,
        [R, B, S, P],
        await spec(s, 'a', '100644', ''),
        await spec(s, '1 x', '100644', 'z'),
      )
      const kB2 = await key(
        s,
        [R, B, S, P],
        await spec(s, 'a', '100644', '3 '),
        await spec(s, 'x', '100644', 'z'),
      )
      expect(kA2, 'content is concatenated without a byte count').not.toBe(kB2)
    })
  })

  it('#3b header components are framed too, not newline-delimited', async () => {
    await scenario('a2bp-request-3b', async (s) => {
      const kC = await key(s, [R, B, S, 'ab'], await spec(s, 'x', '100644', 'z'))
      const kD = await key(s, [R, B, S, 'a'], await spec(s, 'x', '100644', 'z'))
      expect(kC).not.toBe(kD)

      // THE PAIR THAT WITNESSES NEWLINE DELIMITING (BUG-104). The pair above
      // survives it: with `<len> <bytes>` replaced by `<bytes>\n` the project
      // components `ab` and `a` still produce different streams, so this case
      // stayed green under the very defect its title names and was red only when
      // the project component left the key altogether.
      //
      // Newline delimiting is falsified by a component that CONTAINS a newline,
      // because the boundary is then forgeable: project `a\nb` + path `x` and
      // project `a` + path `b\nx` both emit `a\nb\nx\n`. Framed, the records are
      // `3 a\nb1 x` and `1 a3 b\nx`. Observed: K4 reds this, green on the real
      // library.
      const kC2 = await key(s, [R, B, S, 'a\nb'], await spec(s, 'x', '100644', 'z'))
      const kD2 = await key(s, [R, B, S, 'a'], await spec(s, 'b\nx', '100644', 'z'))
      expect(kC2, 'header components are delimited by newlines, not framed').not.toBe(kD2)
    })
  })

  it('#3c BUG-082: a byte shifted ACROSS a component boundary changes the key — the only witness framing has', async () => {
    await scenario('a2bp-request-3c', async (s) => {
      // THIS CASE IS NEW, AND IT IS THE ONE THAT ACTUALLY CATCHES UNFRAMING.
      //
      // Found by mutation while porting: removing the byte count from BOTH
      // framing primitives — so the key becomes plain concatenation — turns
      // #1, #2, #3, #3b and #4 all GREEN. Every existing fixture shifts a byte
      // into a field whose next neighbour is CONSTANT, so the concatenations
      // still differ and the collision the framing exists to prevent never
      // materialises. #3's own header calls itself "the entire reason the key is
      // framed rather than delimited", and it could not see the framing leave.
      //
      // A witness needs the shifted byte to cross a boundary: project `ab` with
      // path `x` against project `a` with path `bx`. Unframed both render
      // `…abx…`; framed they cannot. Verified both ways — collides on the
      // mutant, distinct on the real library.
      const kE = await key(s, [R, B, S, 'ab'], await spec(s, 'x', '100644', 'z'))
      const kF = await key(s, [R, B, S, 'a'], await spec(s, 'bx', '100644', 'z'))
      expect(kE, 'the key is concatenating without a byte count').not.toBe(kF)
    })
  })

  it('#4 a newline inside a component cannot forge a record boundary', async () => {
    await scenario('a2bp-request-4', async (s) => {
      // This is what defeated the earlier newline-delimited header design.
      const kE = await key(s, [R, 'main\nevil', S, P], await spec(s, 'x', '100644', 'z'))
      const kF = await key(s, [R, 'main', S, P], await spec(s, 'x', '100644', 'z'))
      expect(kE).not.toBe('')
      expect(kE).not.toBe(kF)
    })
  })

  it('#5 an ordinary project name produces a valid ref', async () => {
    await scenario('a2bp-request-5', async (s) => {
      const r = await sh(s, 'bp_request_ref "$1" "$2"', ['acme-flow', 'f'.repeat(64)])
      expect(r.code, r.output).toBe(0)
    })
  })

  it('#5b leading dot, .., ~, ^, :, ?, *, [, .lock, @{, space, backslash and empty all refuse', async () => {
    await scenario('a2bp-request-5b', async (s) => {
      // git's rules, confirmed by asking git rather than recalling them. An
      // earlier version of this list included "trailing." — git ACCEPTS a
      // component-final dot, because its no-trailing-dot rule applies to the
      // whole ref rather than each component. The expectation was wrong, not
      // the code. See #5e.
      const bad = [
        '.leading',
        'has..dots',
        'has~tilde',
        'has^caret',
        'has:colon',
        'has?q',
        'has*star',
        'has[bracket',
        'ends.lock',
        'at@{brace',
        'has space',
        'back\\slash',
        '',
      ]
      const accepted: string[] = []
      for (const name of bad) {
        const r = await sh(s, 'bp_request_ref "$1" "$2"', [name, 'f'.repeat(64)])
        if (r.code === 0) accepted.push(JSON.stringify(name))
      }
      expect(accepted, 'check-ref-format is not being consulted for these').toEqual([])
    })
  })

  it("#5c a refused ref says why, naming the project", async () => {
    await scenario('a2bp-request-5c', async (s) => {
      const r = await sh(s, 'bp_request_ref "$1" "$2"', ['.leading', 'f'.repeat(64)])
      expect(r.code).not.toBe(0)
      expect(r.output.toLowerCase()).toContain('not a valid branch name')
    })
  })

  it("#5d a project name containing '/' is refused — check-ref-format alone would allow it", async () => {
    await scenario('a2bp-request-5d', async (s) => {
      // A slash is LEGAL in a ref, so check-ref-format cannot catch this — the
      // rule being violated is ours. `a/b` would give a2bp/a/b/<digest>: an
      // extra namespace level git accepts happily and `prs` cannot parse, since
      // it reads the project from a fixed position.
      const r = await sh(s, 'bp_request_ref "$1" "$2"', ['a/b', 'f'.repeat(64)])
      expect(r.code).not.toBe(0)
      expect(r.output, 'refused, but not for the slash reason').toContain('single ref component')
    })
  })

  it('#5e a component-final dot is accepted, matching git rather than a stricter invented rule', async () => {
    await scenario('a2bp-request-5e', async (s) => {
      const r = await sh(s, 'bp_request_ref "$1" "$2"', ['trailing.', 'f'.repeat(64)])
      expect(
        r.code,
        'git accepts a trailing dot mid-ref; we must not be stricter than check-ref-format without a stated reason',
      ).toBe(0)
    })
  })

  it('#6 the ref carries the full 64-char digest', async () => {
    await scenario('a2bp-request-6', async (s) => {
      // A truncated id is a birthday problem against a namespace that persists.
      const k = await key(s, [R, B, S, P], await spec(s, 'docs/DoD.md', '100644', 'hello'))
      const ref = await out(s, 'bp_request_ref "$1" "$2"', ['acme-flow', k])
      expect(ref).toBe(`a2bp/acme-flow/${k}`)
      expect(ref).toContain(k)
    })
  })

  it('#7 the git floor is 2.32 and this host satisfies it', async () => {
    await scenario('a2bp-request-7', async (s) => {
      const floor = await out(s, 'printf %s "$BP_REQUEST_MIN_GIT"')
      expect(floor, 'the documented floor has moved').toBe('2.32')

      const r = await sh(s, 'bp_request_check_git_version')
      const version = await sh(s, 'git --version')
      expect(r.code, `this host's git was rejected: ${version.stdout.trim()}`).toBe(0)
    })
  })

  it('#8 hermetic env unsets GIT_DIR/GIT_CONFIG_COUNT/GIT_INDEX_FILE and pins config+locale', async () => {
    await scenario('a2bp-request-8', async (s) => {
      // THE HOSTILE VALUES ARE SET INSIDE THE CHILD, not through the harness's
      // `env` parameter, and that is deliberate rather than a workaround.
      // tests/harness/env.ts DENIES a GIT_CONFIG_COUNT override, because
      // GIT_CONFIG_KEY_<n> can set core.hooksPath past every containment check
      // it performs — the BUG-047 / A-22 shape. Here the hostile config IS the
      // subject: the assertion is that `bp_request_hermetic` strips it. Setting
      // it one process further in keeps the assertion and keeps the harness's
      // guarantee intact, since the variable reaches only a `sh -c echo` whose
      // cwd is inside the workspace and which touches no repository.
      const r = await sh(
        s,
        'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.autocrlf GIT_CONFIG_VALUE_0=true ' +
          'GIT_DIR=/nonexistent GIT_INDEX_FILE=/nonexistent ' +
          'bp_request_hermetic sh -c ' +
          "'echo \"${GIT_DIR:-unset}/${GIT_CONFIG_COUNT:-unset}/${GIT_INDEX_FILE:-unset}/$GIT_CONFIG_GLOBAL/$LC_ALL\"'",
      )
      expect(r.code, r.output).toBe(0)
      expect(r.stdout.trim()).toBe('unset/unset/unset//dev/null/C')
    })
  })

  it('#8b transport keeps GIT_SSH_COMMAND and still refuses GIT_DIR / config injection', async () => {
    await scenario('a2bp-request-8b', async (s) => {
      // Transport keeps credentials — silently breaking authenticated remotes is
      // not acceptable — but still refuses redirection.
      const r = await sh(
        s,
        'GIT_SSH_COMMAND="ssh -i /key" GIT_DIR=/nonexistent GIT_CONFIG_COUNT=1 ' +
          'bp_request_transport_env sh -c ' +
          "'echo \"${GIT_SSH_COMMAND:-unset}|${GIT_DIR:-unset}|${GIT_CONFIG_COUNT:-unset}\"'",
      )
      expect(r.code, r.output).toBe(0)
      expect(r.stdout.trim()).toBe('ssh -i /key|unset|unset')
    })
  })
})
