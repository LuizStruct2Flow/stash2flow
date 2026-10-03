/**
 * tests/pre-push-secrets/pre-push-secrets.spec.ts — A-03: the secret gate must
 * scan WHAT IS BEING PUSHED, not the index.
 *
 * Parallelism hazard: `serial-timing` for #9 and #10 only, and the timing is the
 * SUBJECT's, not the test's — see the R4 note below. Everything else is fully
 * contained: each case owns its fixture repo, its shim directory and its
 * workspace. The A-03 cases use a shim; the BUG-156 cases below deliberately
 * invoke the real scanner against the repository's shipped config.
 *
 * THE DEFECT. The hook ran `gitleaks protect --staged`. `--staged` scans the git
 * INDEX, and at pre-push time the index is empty — the commit has already been
 * made. Measured against a real gitleaks with a real detectable secret committed
 * and about to be pushed:
 *
 *   gitleaks protect --staged        → 0 commits scanned, ~0 bytes, rc=0
 *   gitleaks detect --log-opts=range → 1 commit scanned, leaks found: 1
 *
 * So the gate AGENTS.md §Security describes as "gitleaks blocks the push" was a
 * no-op in the normal commit-then-push flow. It could only ever have fired for
 * someone who staged a secret and ran `git push` without committing it.
 *
 * WHERE THE §3.3 LINE FALLS. `.githooks/pre-push` is the entry point
 * TASK-018-TARGET §3.3 keeps in shell permanently, and it is NOT being ported. It
 * is the subject here, run byte-for-byte under `/bin/sh` in a fixture repo. What
 * is ported is the suite. The same line is drawn in `tests/pre-push-scanners`,
 * with the reasoning stated in full there.
 *
 * THE SHIM ASSERTS ON ARGV, which is the whole defect: the hook was calling the
 * wrong subcommand against the wrong target. No real secret is ever written to
 * disk, and every path is deterministic rather than dependent on a real
 * scanner's behaviour.
 *
 * R4 — NO FIXED WAITS, AND #9/#10 COMPLY. `GITLEAKS_TIMEOUT_SECONDS` is a cap
 * this test hands to the SUBJECT; the shim then hangs. The test waits for the
 * hook to EXIT — a condition — and the elapsed bound in #10 is computed from the
 * cap it passed rather than guessed. There is no `sleep` in this file. What is
 * asserted is that the subject's own budget bounds the whole push, which cannot
 * be expressed without a scanner that takes longer than the budget.
 *
 * `--fast` IS GONE. The shell version omitted #9 and #10 under a flag, to fit a
 * 30 s pre-push ceiling that no longer exists (founder decision closing BUG-005:
 * "never demote a suite to fit a time budget"). Both cases now always run, which
 * is also what R7 requires — a conditionally-absent case is a skipped one.
 *
 * EQUIVALENCE RECORD (R6). The retiring `tests/pre-push-secrets/test.sh` and this
 * spec were run over the healthy repo plus one mutant of `.githooks/pre-push` per
 * assertion, and the per-case verdict sets diffed mechanically. Table in the
 * migration report.
 *
 * MUTATION RECIPE (R6), each applied to `.githooks/pre-push`:
 *
 *   M1  restore `gitleaks protect --staged`
 *       Red: #1, #2, #3, #6, #7, #7b, #8. This is A-03 itself.
 *   M2  pass the raw all-zero remote sha into the range
 *       Red: #3.
 *   M3  scan on a deletion too (drop the all-zero LOCAL sha check)
 *       Red: #4.
 *   M4  classify gitleaks rc >= 2 as a finding
 *       Red: #5.
 *   M5  skip the scan entirely when stdin carries no ref lines
 *       Red: #6.
 *   M6  add `--not --remotes` back to the new-ref range
 *       Red: #7.
 *   M7  add `--remotes=<destination>` to the new-ref range
 *       Red: #7, #7b.
 *   M8  treat a timed-out scan as clean
 *       Red: #9.
 *   M9  move the `timeout` inside the per-ref loop (cap becomes per-ref)
 *       Red: #10.
 *   M10 fall back to an unbounded scan when no timeout provider exists
 *       Red: #11.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'

const HOOK = join(REPO_ROOT, '.githooks/pre-push')
const GITLEAKS_CONFIG = join(REPO_ROOT, '.gitleaks.toml')
const ZERO = '0000000000000000000000000000000000000000'

describe('A-03 — the secret gate scans the pushed commits, not the empty index', () => {
  it('#1 a secret in the pushed commits blocks the push', async () => {
    await scenario('secrets-1', async (s) => {
      // THE REPRODUCER. Nothing is staged, which is the normal state when
      // pre-push fires.
      const f = await fixture(s)
      await f.gitleaks(1)

      const r = await f.runHook(`refs/heads/main ${f.head} refs/heads/main ${f.base}\n`)

      expect(
        r.code,
        `the push was ALLOWED with a secret in the pushed range — the gate scanned the index (empty at pre-push time), not the commits\n${r.output}`,
      ).not.toBe(0)
      expect(r.output, 'it blocked, but not by the secret scan').toContain('SIMULATED-LEAK')
    })
  })

  it('#2 the scan is scoped to the range actually being pushed', async () => {
    await scenario('secrets-2', async (s) => {
      // `remote..local` is what "what am I about to publish" means; anything else
      // either misses commits or re-scans history that is already upstream.
      const f = await fixture(s)
      await f.gitleaks(1)
      await f.runHook(`refs/heads/main ${f.head} refs/heads/main ${f.base}\n`)

      const argv = await f.argv()

      expect(argv, `gitleaks was never invoked with 'detect'. argv: ${argv}`).toContain('detect')
      expect(argv, `the scan range does not name remote..local. argv: ${argv}`).toContain(f.base)
      expect(argv, `the scan range does not name remote..local. argv: ${argv}`).toContain(f.head)
    })
  })

  it('#3 a new branch scans its own commits without an unresolvable range', async () => {
    await scenario('secrets-3', async (s) => {
      // A brand-new branch has remote_sha = 000…0, which is not a resolvable
      // revision. Passing `000..local` to git makes the scan ERROR, and a scan
      // that cannot run must never read as a clean pass (BUG-003's rule).
      const f = await fixture(s)
      await f.gitleaks(1)

      const r = await f.runHook(`refs/heads/feat ${f.head} refs/heads/feat ${ZERO}\n`)
      const argv = await f.argv()

      expect(
        r.code,
        `a new branch pushed its secrets unscanned — the all-zero remote sha was not handled\n${r.output}`,
      ).not.toBe(0)
      expect(argv, `an unresolvable 000…0 range was handed to git. argv: ${argv}`).not.toMatch(
        new RegExp(`${ZERO}\\.\\.|\\.\\.${ZERO}`),
      )
    })
  })

  it('#4 a branch deletion is not scanned and does not block', async () => {
    await scenario('secrets-4', async (s) => {
      // Deleting a remote branch pushes nothing. There is no content to scan, so
      // it must not block — and must not invent a range from an all-zero local
      // sha.
      const f = await fixture(s)
      await f.gitleaks(1)

      const r = await f.runHook(`(delete) ${ZERO} refs/heads/gone ${f.head}\n`)
      const argv = await f.argv()

      expect(
        r.code,
        `a branch DELETION was blocked by the secret scan — nothing is being published\n${r.output}`,
      ).toBe(0)
      expect(argv, `a deletion triggered a content scan. argv: ${argv}`).not.toContain('detect')
    })
  })

  it('#5 a scanner failure still blocks AS a tool failure, not as a finding', async () => {
    await scenario('secrets-5', async (s) => {
      // BUG-003 discipline must survive here: gitleaks exits 1 for a FINDING and
      // >= 2 when it could not run.
      const f = await fixture(s)
      await f.gitleaks(2)

      const r = await f.runHook(`refs/heads/main ${f.head} refs/heads/main ${f.base}\n`)

      expect(
        r.code,
        `a gitleaks TOOL FAILURE passed as a clean scan — fail-open on the secret gate\n${r.output}`,
      ).not.toBe(0)
      expect(
        r.output.toLowerCase(),
        'a tool failure was reported as a secret finding — the BUG-003 conflation is back',
      ).not.toContain('found a secret')
      expect(r.output, 'it blocked, but never says the scan could not run').toMatch(
        /could not complete|did NOT run/i,
      )
    })
  })

  it('#6 no ref info on stdin degrades safely rather than skipping or crashing', async () => {
    await scenario('secrets-6', async (s) => {
      // The hook is also run directly — by the DoD gate rehearsal, by CI, and by
      // this repo's own fixtures — with no ref lines on stdin. It must still scan
      // something rather than crash or silently skip.
      const f = await fixture(s)
      await f.gitleaks(1)

      const r = await f.runHook('')
      const argv = await f.argv()

      expect(
        r.code === 0 && !argv.includes('detect'),
        `with no ref info the secret scan was silently skipped — a hook run by hand must not be a hole\n${r.output}`,
      ).toBe(false)
      expect(r.output, `the hook errored with no stdin\n${r.output}`).not.toMatch(
        /unbound|syntax error|bad substitution/i,
      )
    })
  })

  it('#7 a new ref is scanned in full — no remote’s refs are subtracted', async () => {
    await scenario('secrets-7', async (s) => {
      // Codex F1 — "already published" means already on THE DESTINATION, not on
      // any remote you happen to have configured. `--not --remotes` subtracts
      // every remote's tracking refs, so a commit sitting on a private mirror is
      // skipped even though pushing it to the public remote IS a first
      // disclosure. Case #3 only proved the all-zero sha never reaches git; it
      // said nothing about which remote is subtracted.
      const f = await fixture(s)
      await f.repo.git(['remote', 'add', 'origin', 'https://example.invalid/pub.git'])
      await f.repo.git(['remote', 'add', 'private', 'https://example.invalid/priv.git'])
      // The commit exists ONLY on the private mirror's tracking ref.
      await f.repo.git(['update-ref', 'refs/remotes/private/main', f.head])
      await f.gitleaks(1)

      const r = await f.runHook(`refs/heads/main ${f.head} refs/heads/main ${ZERO}\n`)
      const argv = await f.argv()

      expect(
        r.code,
        `a commit already on a PRIVATE remote was skipped when first pushed to origin\n${r.output}`,
      ).not.toBe(0)
      expect(
        argv,
        `a new ref subtracted SOMETHING; nothing local is trustworthy enough to subtract. argv: ${argv}`,
      ).not.toContain('--not')
    })
  })

  it('#7b a phantom destination tracking ref does not shrink the scan', async () => {
    await scenario('secrets-7b', async (s) => {
      // Codex R2-F1 — `--remotes=<destination>` was the second attempt and is
      // still only a NAMESPACE SELECTOR: it never asks the destination what it
      // has, so a stale-ahead, hand-created or refspec-repurposed ref under
      // refs/remotes/<destination>/ subtracts commits the destination need not
      // contain. That is an UNDER-scan, the one direction that ships secrets.
      const f = await fixture(s)
      await f.repo.git(['remote', 'add', 'origin', 'https://example.invalid/pub.git'])
      await f.repo.git(['update-ref', 'refs/remotes/origin/phantom', f.head])
      await f.gitleaks(1)

      const r = await f.runHook(`refs/heads/main ${f.head} refs/heads/main ${ZERO}\n`)

      expect(
        r.code,
        `a phantom refs/remotes/origin/* ref caused the outgoing commit to be subtracted — the local tracking namespace was trusted as authoritative\n${r.output}`,
      ).not.toBe(0)
    })
  })

  it('#8 a bare-URL destination scans all reachable history', async () => {
    await scenario('secrets-8', async (s) => {
      // Codex F1, other half — when the destination is a bare URL rather than a
      // named remote, there are no tracking refs worth trusting.
      const f = await fixture(s)
      await f.gitleaks(1)

      const r = await f.runHook(`refs/heads/main ${f.head} refs/heads/main ${ZERO}\n`, {
        args: ['https://example.invalid/direct.git', 'https://example.invalid/direct.git'],
      })
      const argv = await f.argv()

      expect(r.code, `pushing to a bare URL skipped the scan entirely\n${r.output}`).not.toBe(0)
      expect(argv, `a bare-URL destination consulted tracking refs. argv: ${argv}`).not.toContain(
        '--remotes',
      )
    })
  })

  it('#9 a scan that exceeds its budget blocks AS incomplete, distinctly', async () => {
    await scenario('secrets-9', async (s) => {
      // Codex R3-F2 — a new ref is scanned over its whole history, which is
      // unbounded, while the gate is not. Those cannot both hold silently, so the
      // local scan is capped and an unfinished scan BLOCKS: it is not a clean
      // scan, and it is not the same thing as a crashed scanner either.
      const f = await fixture(s)
      await f.hangingGitleaks()

      const r = await f.runHook(`refs/heads/main ${f.head} refs/heads/main ${f.base}\n`, {
        timeoutSeconds: 2,
      })

      expect(r.code, `an unfinished scan passed as clean — the budget cap fails open\n${r.output}`).not.toBe(0)
      expect(
        r.output,
        `it blocked, but does not say the scan was incomplete — indistinguishable from a real finding\n${r.output}`,
      ).toMatch(/INCOMPLETE|did not finish/i)
      expect(r.output.toLowerCase(), 'a timeout was reported as a secret finding').not.toContain(
        'found a secret',
      )
    })
  })

  it('#10 the budget bounds the whole push, not each ref', async () => {
    await scenario('secrets-10', async (s) => {
      // Codex R4-F1 — the cap used to be handed to a fresh `timeout` inside the
      // loop, so three slow refs could spend 3× the advertised cap before the
      // rest of the gate even started. #9 supplies one ref line and therefore
      // cannot see it.
      //
      // The bound is DERIVED from the cap this case passes, not guessed (R4).
      const cap = 3
      const refs = ['a', 'b', 'c']
      const f = await fixture(s)
      await f.hangingGitleaks()

      const started = Date.now()
      const r = await f.runHook(
        refs.map((n) => `refs/heads/${n} ${f.head} refs/heads/${n} ${f.base}\n`).join(''),
        { timeoutSeconds: cap },
      )
      const elapsedSeconds = (Date.now() - started) / 1000

      expect(r.code, `three hanging refs passed the gate\n${r.output}`).not.toBe(0)
      expect(
        elapsedSeconds,
        `${refs.length} refs took ${elapsedSeconds.toFixed(1)}s against a ${cap}s budget — the cap is per-ref, so a multi-ref push multiplies it`,
      ).toBeLessThan(cap * refs.length)
      expect(r.output, 'bounded, but does not report the scan as incomplete').toMatch(
        /INCOMPLETE|did not finish/i,
      )
    })
  })

  it('#11 no timeout provider fails closed with an actionable message', async () => {
    await scenario('secrets-11', async (s) => {
      // Codex R4-F2 — with no timeout provider the cap does not exist, so the
      // hook must REFUSE rather than run an unbounded scan. The old fallback ran
      // gitleaks unbounded, which is precisely what the then-documented macOS
      // install path produced: "the scan is capped" was true of Linux boxes and
      // nowhere else.
      const f = await fixture(s)
      await f.gitleaks(0)

      // A PATH carrying the fixture's shims and the host's utilities, with no
      // `timeout` or `gtimeout` anywhere. `jq` is deliberately PRESENT: the SCA
      // stage needs it and fails CLOSED without it, so omitting it would leave
      // this case passing for the wrong reason — a gate failing closed on a
      // missing jq looks identical from the exit code.
      const notimeout = await s.workspace.dir('notimeout')
      const setup = await s.fs.write(
        'link-notimeout.sh',
        `for t in jq git sh sed grep cat mktemp tail rm date printf find awk cut sort tr wc head; do\n` +
          `  src="$(command -v "$t" 2>/dev/null)"\n` +
          `  [ -n "$src" ] && ln -sf "$src" ${JSON.stringify(notimeout)}/"$t"\n` +
          `done\n` +
          `for t in gitleaks semgrep osv-scanner trivy; do\n` +
          `  ln -sf ${JSON.stringify(f.shims.dir)}/"$t" ${JSON.stringify(notimeout)}/"$t"\n` +
          `done\n` +
          `exit 0\n`,
      )
      await s.run('sh', [setup], { cwd: s.workspace.root })

      // NON-VACUITY, both directions.
      const probe = await s.run(
        'sh',
        [
          await s.fs.write(
            'probe-notimeout.sh',
            `command -v timeout >/dev/null 2>&1 && echo TIMEOUT_PRESENT\n` +
              `command -v gtimeout >/dev/null 2>&1 && echo GTIMEOUT_PRESENT\n` +
              `command -v jq >/dev/null 2>&1 && echo JQ_PRESENT\n` +
              `exit 0\n`,
          ),
        ],
        { cwd: s.workspace.root, env: { PATH: notimeout } },
      )
      expect(probe.output, 'built a PATH that still finds a timeout provider').not.toMatch(
        /TIMEOUT_PRESENT|GTIMEOUT_PRESENT/,
      )
      expect(probe.output, 'built a PATH with no jq — the gate would fail closed for the wrong reason').toContain(
        'JQ_PRESENT',
      )

      const r = await f.runHook(`refs/heads/main ${f.head} refs/heads/main ${f.base}\n`, {
        path: notimeout,
      })

      expect(
        r.code,
        `with no timeout available the hook ran the scan unbounded and passed — the cap silently vanished\n${r.output}`,
      ).not.toBe(0)
      expect(
        r.output,
        `it blocked, but never explains that no timeout provider was found\n${r.output}`,
      ).toMatch(/timeout|coreutils/i)
    })
  })
})

describe('BUG-156 — the shipped gitleaks config keeps the gate effective', () => {
  it('#12 the gate command finds a synthetic token with the repository config', async () => {
    await scenario('secrets-12', async (s) => {
      await expectShippedConfigFinds(s, 'credentials.txt')
    })
  })

  it('#13 the gate command finds a synthetic token in tracked .env.example', async () => {
    await scenario('secrets-13', async (s) => {
      await expectShippedConfigFinds(s, '.env.example')
    })
  })

  // #14/#15 — the four-eyes defeat (e421a7b). The two false-positive exceptions
  // are RULE-LEVEL allowlists with condition = "AND". As GLOBAL [[allowlists]]
  // the same entries skipped the whole file on path match alone IN DIRECTORY
  // MODE (`gitleaks dir` / `--no-git`: 8.30.1 scanned ~0 bytes of both), while
  // git-mode `detect` — the gate's and CI's command — honored the AND. Measured
  // in the round-2 review: the same planted tree, 11105c7's config, `detect`
  // found 4, `dir .` found 0. So each case runs BOTH modes: git mode pins the
  // exception to one line shape (dropping the regexes or widening the paths
  // fails it), dir mode pins that no mode skips the whole file (the global
  // form fails it). Each plants a line that trips the SAME rule the exception
  // is scoped to, next to the real safe shape: the planted line must be found
  // and the safe line must not.
  it('#14 a generic-api-key line in scripts/shell-inventory.json is still found', async () => {
    await scenario('secrets-14', async (s) => {
      const hex = '0123456789abcdef'
      const blobId = Array.from({ length: 40 }, (_, i) => hex[(i * 7) % hex.length]).join('')
      for (const mode of MODES) {
        // The PAT prefix is stripped: with it, github-pat claims the line and
        // generic-api-key — the rule the exception is scoped to — is never tested.
        const findings = await expectShippedConfigFinds(
          s,
          'scripts/shell-inventory.json',
          (token) =>
            `{\n  "scripts/sonar-api.sh": "${blobId}",\n  "api_secret_key": "${token.slice('ghp_'.length)}"\n}\n`,
          mode,
        )
        expect(
          findings.map((f) => f.RuleID),
          `${mode} mode: the planted key was not found by generic-api-key`,
        ).toContain('generic-api-key')
        expect(
          findings.map((f) => f.StartLine),
          `${mode} mode: the safe blob-id line is reported — the allowlist is gone`,
        ).not.toContain(2)
      }
    })
  })

  it('#15 a real-credential curl in scripts/sonar-api.sh is still found', async () => {
    await scenario('secrets-15', async (s) => {
      // Built by concatenation, like the token: written as a literal, this
      // source line trips curl-auth-user in the repo's OWN history scan (the
      // round-3 review caught 0fa623c doing exactly that — the push-range
      // scan found it and the gate would have blocked the push). The bytes
      // written to the fixture are unchanged.
      const curl = 'curl -sS ' + '-u "'
      for (const mode of MODES) {
        const findings = await expectShippedConfigFinds(
          s,
          'scripts/sonar-api.sh',
          (token) =>
            `${curl}${'$'}{SONAR_TOKEN}:" "${'$'}{SONAR_HOST_URL}$1"\n` +
            `${curl}admin:${token}" "https://sonar.example.invalid/api/x"\n`,
          mode,
        )
        expect(
          findings.map((f) => f.RuleID),
          `${mode} mode: the planted credential was not found by curl-auth-user`,
        ).toContain('curl-auth-user')
        expect(
          findings.map((f) => f.StartLine),
          `${mode} mode: the safe env-var line is reported — the allowlist is gone`,
        ).not.toContain(1)
      }
    })
  })
})

/** `git`: the gate's `detect --log-opts=range`. `dir`: a working-tree audit, `gitleaks dir .`. */
const MODES = ['git', 'dir'] as const
type Mode = (typeof MODES)[number]

interface Finding {
  RuleID: string
  StartLine: number
}

async function expectShippedConfigFinds(
  s: Scenario,
  plantedPath: string,
  body: (token: string) => string = (token) => `token=${token}\n`,
  mode: Mode = 'git',
): Promise<Finding[]> {
  const name = `repo-${mode}`
  const repo = await s.gitRepo(name)
  await s.fs.copyIn(GITLEAKS_CONFIG, `${name}/.gitleaks.toml`)
  await s.fs.write(`${name}/README.md`, 'base\n')
  await repo.commitAll('base')

  // Constructed at runtime so this source file never contains a token literal
  // that the very scanner under test would flag in the blueprint's history.
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const suffix = Array.from({ length: 36 }, (_, i) => alphabet[(i * 17) % alphabet.length]).join('')
  const syntheticToken = ['ghp', '_', suffix].join('')
  await s.fs.write(`${name}/${plantedPath}`, body(syntheticToken))
  await repo.commitAll(`plant synthetic token in ${plantedPath}`)

  const base = await repo.git(['rev-parse', 'HEAD~1'])
  const head = await repo.git(['rev-parse', 'HEAD'])
  expect(base.code, `git rev-parse HEAD~1 failed\n${base.output}`).toBe(0)
  expect(head.code, `git rev-parse HEAD failed\n${head.output}`).toBe(0)

  // Git mode is byte-for-byte the command used by `_st_gitleaks`; dir mode is
  // the working-tree audit the config's own header invites. Both add a JSON
  // report so a case can say WHICH line was found, and both run from the
  // fixture root so gitleaks auto-discovers the copied repository config just
  // as the real pre-push gate and CI do.
  const report = s.workspace.path(`gitleaks-report-${mode}.json`)
  const target =
    mode === 'git'
      ? ['detect', `--log-opts=${base.stdout.trim()}..${head.stdout.trim()}`]
      : ['dir', '.']
  const result = await s.run(
    'gitleaks',
    [...target, '--redact', '--no-banner', '--report-format=json', `--report-path=${report}`],
    { cwd: repo.dir },
  )

  expect(
    result.code,
    `${mode} mode: the shipped config let a synthetic token in ${plantedPath} pass the gate command\n${result.output}`,
  ).toBe(1)
  return JSON.parse(await readFile(report, 'utf8')) as Finding[]
}

// ---------------------------------------------------------------------------
// The fixture: a repo with two commits, the real hook, and shims for every
// scanner the hook can discover.
// ---------------------------------------------------------------------------

type FixtureRepoLike = Awaited<ReturnType<Scenario['gitRepo']>>
type ShimDirLike = Awaited<ReturnType<Scenario['shimDir']>>

interface SecretsFixture {
  readonly repo: FixtureRepoLike
  readonly shims: ShimDirLike
  /** Full sha of the tip, and of its parent — the "remote" side of the range. */
  readonly head: string
  readonly base: string
  /** A gitleaks shim: `protect` always reports clean, `detect` exits `code`. */
  gitleaks(code: number): Promise<void>
  /** A gitleaks shim whose `detect` never returns. */
  hangingGitleaks(): Promise<void>
  /** Everything the gitleaks shim was invoked with, newline-joined. */
  argv(): Promise<string>
  runHook(
    stdin: string,
    options?: { args?: string[]; path?: string; timeoutSeconds?: number },
  ): Promise<{ code: number | null; output: string }>
}

async function fixture(s: Scenario): Promise<SecretsFixture> {
  const repo = await s.gitRepo('repo')
  const shims = await s.shimDir('bin')
  const argvFile = s.workspace.path('gitleaks-argv')

  await s.fs.copyIn(HOOK, 'repo/.githooks/pre-push')
  await s.fs.chmod('repo/.githooks/pre-push', 0o755)
  // FEATURE-002: the hook sources the pipeline renderer and fails closed without
  // it, by design. Without it every case here reports "the hook could not start"
  // rather than testing the secret scan at all.
  await s.fs.copyIn(join(REPO_ROOT, 'scripts/lib/pipeline.sh'), 'repo/scripts/lib/pipeline.sh')
  // BUG-126: the SAST stage sources the verdict policy and fails closed without
  // it, the same way it does without the renderer above.
  await s.fs.copyIn(join(REPO_ROOT, 'scripts/semgrep-verdict.sh'), 'repo/scripts/semgrep-verdict.sh')
  await s.fs.write('repo/.claude/settings.json', '{\n  "permissions": {\n    "allow": []\n  }\n}\n')

  await s.fs.write('repo/README.md', 'base\n')
  await repo.commitAll('base')
  await s.fs.write('repo/README.md', 'base\nsecond\n')
  await repo.commitAll('second')

  const rev = async (spec: string): Promise<string> => {
    const r = await repo.git(['rev-parse', spec])
    expect(r.code, `git rev-parse ${spec} failed\n${r.output}`).toBe(0)
    return r.stdout.trim()
  }

  // Neutral shims so no ambient binary decides these results (the R11 lesson from
  // tests/pre-push-scanners: every executable the hook can discover must be under
  // fixture control, not just the ones a case asserts on).
  //
  // semgrep is NOT a bare `exit 0`: since BUG-003 the hook classifies from
  // semgrep's --json output, so a silent exit 0 reads as "did not complete" and
  // blocks every case for the wrong reason.
  await shims.add('semgrep', `printf '{"version":"1","results":[],"errors":[]}\\n'\nexit 0`)
  // osv-scanner's stage READS ITS JSON now (BUG-045), so a clean scan has to look
  // like one. Both shims were bare `exit 0` once, and that hid here rather than
  // failing loudly: #4 is the only case asserting the gate exits ZERO, so it was
  // the only one a broken SCA stage could break.
  await shims.add('osv-scanner', `echo '{"results":[]}'\nexit 0`)
  await shims.add('trivy', 'exit 0')

  const f: SecretsFixture = {
    repo,
    shims,
    head: await rev('HEAD'),
    base: await rev('HEAD~1'),

    async gitleaks(code: number): Promise<void> {
      // Records its full argv, then decides by SUBCOMMAND:
      //   protect → always "no leaks" (the real behaviour at pre-push time: the
      //             index is empty, so it scans nothing and passes)
      //   detect  → the secret IS in the pushed commits
      // A hook that still calls `protect` therefore PASSES; one that calls
      // `detect` blocks. That difference is the regression.
      await shims.add(
        'gitleaks',
        `echo "$@" >>${JSON.stringify(argvFile)}\n` +
          `case "$1" in\n` +
          `  protect) echo "0 commits scanned."; echo "no leaks found"; exit 0 ;;\n` +
          `  detect)  echo "SIMULATED-LEAK in pushed range"; exit ${code} ;;\n` +
          `esac\n` +
          `exit 0`,
      )
      await s.fs.write('gitleaks-argv', '')
    },

    async hangingGitleaks(): Promise<void> {
      await shims.add(
        'gitleaks',
        `echo "$@" >>${JSON.stringify(argvFile)}\n` +
          `case "$1" in\n` +
          `  detect) sleep 30 ;;\n` +
          `esac\n` +
          `exit 0`,
      )
      await s.fs.write('gitleaks-argv', '')
    },

    async argv(): Promise<string> {
      try {
        return await readFile(argvFile, 'utf8')
      } catch {
        // No argv file means the stub was never invoked, which '' says.
        return ''
      }
    },

    async runHook(stdin, options = {}) {
      const refs = await s.fs.write('refs.txt', stdin)
      const args = options.args ?? ['origin', 'git@example.com:x/y.git']
      // The harness spawns with stdin closed — a fixture that can read the
      // operator's terminal is not isolated — so the ref lines travel through a
      // file the scenario owns and a one-line driver that redirects it. The ref
      // lines ARE the input under test, so this is not incidental plumbing.
      const driver = await s.fs.write(
        'run-hook.sh',
        `exec sh .githooks/pre-push ${args.map((a) => JSON.stringify(a)).join(' ')} < ${JSON.stringify(refs)}\n`,
      )
      const env: Record<string, string> = { PATH: options.path ?? shims.path() }
      if (options.timeoutSeconds !== undefined) {
        env.GITLEAKS_TIMEOUT_SECONDS = String(options.timeoutSeconds)
      }
      const r = await s.run('sh', [driver], {
        cwd: repo.dir,
        env,
        timeoutMs: 180_000,
      })
      return { code: r.code, output: r.output }
    },
  }

  return f
}
