/**
 * tests/install-toolchain/install-toolchain.spec.ts — scripts/install-toolchain.sh.
 *
 * Parallelism class: mockable. Every case owns a scenario workspace and HOME;
 * `node` is a shim reporting a chosen version; nothing is installed and nothing
 * reaches the network.
 *
 * TASK-027 (a2bp request PR #67 from linkedin-watcher-agent, upstream U3).
 * `check` REPORTED NODE OK ON A NODE THAT CANNOT RUN THE HARNESS. The installer
 * restated the requirement as `NODE_MIN_MAJOR="18"` while tests/package.json
 * declares `"node": "^20.19.0 || >=22.12.0"`, a floor that is a security
 * requirement (vitest 4.1.11 is the first release clear of GHSA-82fw-gwwq-j7x9).
 * Reproduced on main by Jesko (QA-2, Codex): a Node 20.0.0 shim passed `check`.
 * A restated requirement is a copy that drifts; the installer reads
 * `engines.node` from the manifest npm itself enforces.
 *
 * A MAJOR-ONLY COMPARISON IS NOT A FIX. Raising the constant to 20 still passes
 * 20.0.0 and 22.0.0, which the range rejects. #1 pins those versions, and 21.x,
 * which sits between the two alternatives.
 *
 * #5 IS THIS REPO'S ADDITION TO THE REQUEST. The request's evaluator treated
 * every caret as "same major", which is npm's rule only above major 0: `^0.10.0`
 * means `>=0.10.0 <0.11.0`, and `^0.0.3` means `=0.0.3`. Jesko's review asked
 * for exact zero-major semantics or a fail-closed refusal; the evaluator
 * implements npm's rule, and #5 is red for both the pre-fix script and the
 * request as filed.
 *
 * HOW THE VERSION IS FAKED. The shim answers `node --version` itself and runs
 * every other invocation through the real node with a preload that overrides
 * `process.version` and `process.versions.node`, so the script's own Node code
 * runs for real and sees the chosen version, however it asks.
 *
 * MUTATION RECORD (R6) — OBSERVED, each mutant applied alone to
 * scripts/install-toolchain.sh on a copy of the tree outside any git tree, this
 * suite run, the file restored. (The request's own header admitted its sets were
 * derived by reading; these were run.)
 *   Pre-fix script (NODE_MIN_MAJOR=18)                    → #1 #2 #3 #4 #5
 *   A  compare the major only                            → #1 #2 #5
 *   B  "cannot tell" counts as a pass                     → #3 #4
 *   C  the range hard-coded instead of read              → #2 #3 #4 #5
 *   D  the caret as filed ("same major")                 → #5
 *   E  no up-front check that every comparator is known  → #4
 *   B FIRST LEFT #4 GREEN, and that is how E exists. The evaluator stopped at the
 *   first failing comparator, so `20 - 22` on Node 24 failed the bare `20` and
 *   never reached `-`: #4 passed as "unsupported" rather than as
 *   "uninterpretable". The evaluator now checks every comparator's form before
 *   evaluating any, and #4 requires the UNVERIFIED verdict.
 * #6 (Alexey, c3-4 review #3), observed the same way (.scratch/c025/mutants9.py):
 *   The evaluator before the fix (a leading `*` skipped the alternative) → #6
 *   a leading `*` accepts the alternative                                → #6
 *   a leading `*` skips the form check                                   → #6
 *   THE LAST FIRST LEFT #6 GREEN. `* nonsense` is refused either way, because
 *   evaluating `nonsense` throws. #6 now also carries `* 20 - 22`, where the
 *   bare `20` fails on Node 24 before `-` is parsed, so only the form check can
 *   refuse it.
 *
 * TASK-025 COMMIT 4 — THE PER-MACHINE `blueprint` COMMAND (#34–#38, #37b).
 * ~/.local/bin/blueprint was hand-written and exec'd a checkout path, so moving
 * the blueprint (TASK-021 Stage B) would break every project on the machine from
 * a file no commit can fix. The installer writes a command that names no
 * checkout, owns it by byte-exact equality, and replaces a foreign one only on
 * --replace-blueprint-command, validated in the project it will serve.
 * PLAN-TASK-025 §8.1, §9.2.
 *
 * MUTATION RECORD — OBSERVED, each mutant alone on a copy of the tree outside any
 * git tree (.scratch/c025/mutants7.py). #37b is one case of many runs, so the
 * sub-run that failed first is named.
 *   Installer at the parent commit            → #34 #35 #36 #37 #37b #38
 *   M34a body execs "$ROOT/scripts/blueprint" → #34 #35 #37 #37b
 *   M34b installed after the OS branch        → #34 #35 #36 #37 #38
 *   M35a no scaffolding/ candidate            → #34 #35 #37b
 *   M35b exit 0 when no CLI is found          → #34 #35 #37b
 *   M36  rewrite unconditionally              → #36
 *   M37a overwrite anything                   → #37 (a)
 *   M37b write through the path, no temp      → #37 (a)
 *   M37c the marker line means "ours"         → #37 (c)
 *   K1   check mode drops the ⚠ line          → #37 (a) check
 *   R1   rm the target before preparing       → #37b (a): no backup
 *   R2   the body straight onto the target    → #37b (a)
 *   R3   swap before validating               → #37b (a): the backup is the new body
 *   R4   validate in $ROOT (revision 5)       → #37b (c) project without a CLI
 *   R5   skip the migrated-project test       → #37b (c) blueprint_source present
 *   R6   ignore --project                     → #37b (a2)
 *   R7   EXIT trap only, no signal handler    → #37b (d) INT to the installer alone
 *   R8   the resuming `trap … EXIT INT TERM`  → #37b (d) group INT
 *   M38  no shadow check                      → #38
 * (SUPERSEDED by the per-case record below, after #37b was split.)
 * WHERE THE PLAN'S PREDICTION WAS NOT WHAT RAN: R1 was predicted red in every
 * (c) and (d) run and R3 in the validation runs. Both go red earlier, at (a),
 * because the backup no longer holds the old wrapper, so the later runs are not
 * reached. R8 was not in the plan's catalogue. The plan predicted R7's run
 * exactly.
 *
 * #37b SPLIT, ONE CASE PER SUB-RUN (Alexey, c3-4 review #4), re-observed on a
 * copy (.scratch/c025/mutants9.py set9a). Case names are shortened:
 *   R1 rm the target before preparing  → (a) (a2) (b); (c) chmod, cp, mv, no-CLI;
 *                                        (d) all four
 *                                        [not (c) legacy or at-root: they are
 *                                        refused before the rm]
 *   R2 the body straight onto target   → the same eleven as R1, for the same
 *                                        reason
 *   R3 swap before validating          → (a) (a2) (b); (c) chmod, cp, no-CLI,
 *                                        legacy, at-root; (d) all four
 *                                        [not (c) mv: the shimmed mv makes the
 *                                        early swap fail too]
 *   R4 validate in $ROOT (revision 5)  → (c) no-CLI
 *   R5 skip the migrated-project test  → (c) legacy, at-root
 *   R6 ignore --project                → (a2)
 *   R7 EXIT trap only                  → (d) SIGINT to the installer alone
 *   R8 the resuming `trap … EXIT INT TERM` → (d) all four
 *   D1 no directory refusal            → (e) symlink to a directory
 *   D2 refuse a plain directory only   → (e) symlink to a directory
 *   [(e) plain directory stays green under D1: the backup's `cp -pP` fails on
 *   a directory before the swap, which is why the refusal must not rely on it]
 *
 * On the CLI side (set7b, the same copy): dropping scripts/lib/signals.sh from
 * MANAGED_FILES reddens bootstrap-contents #0 (BUG-015). Not sourcing it
 * reddens 36 of sync-by-address's 41 cases, since drift and pull then refuse.
 *
 * TASK-029 — U7 OF a2bp REQUEST PR #69 (linkedin-watcher-agent), #U7a and #U7b.
 * OBSERVED the same way (.scratch/c025/mutants8.py):
 *   CLI at the reproducer commit (silent skip) → #U7b (none): no gate line
 *   the command drops "$@"                     → #34 #37b #U7a #U7b
 *   gate line printed, no refusal              → #U7b (no-gate): exit 0
 *   refusal without the gate line              → #U7b (none)
 * NOT SEEN: a command that discards stderr leaves #U7a green (only #34 and #37b
 * go red, on the body bytes), because a healthy drift writes nothing to stderr.
 * #34's byte-exact body is what pins that.
 */

import { describe, it, expect, vi } from 'vitest'
import { closeSync, constants, existsSync, openSync, writeSync } from 'node:fs'
import { cp, lstat, readFile, readdir, readlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'

const SCRIPT = 'scripts/install-toolchain.sh'

/** A PATH whose `node` claims to be `version`. */
async function fakeNode(s: Scenario, version: string): Promise<string> {
  const preload = await s.fs.write(
    `preload-${version}.cjs`,
    `Object.defineProperty(process, 'version', { value: 'v${version}' })\n` +
      `Object.defineProperty(process.versions, 'node', { value: '${version}' })\n`,
  )
  const shims = await s.shimDir(`shims-${version}`)
  await shims.add(
    'node',
    `if [ "$1" = "--version" ]; then echo "v${version}"; exit 0; fi\n` +
      `exec "${process.execPath}" --require "${preload}" "$@"`,
  )
  return shims.path()
}

/** The one line `check` prints about node, or '' if it printed none. */
function nodeLine(output: string): string {
  return output.split('\n').find((l) => /^\s+[✓✗] node\b/.test(l)) ?? ''
}

async function check(s: Scenario, version: string, script = join(REPO_ROOT, SCRIPT)) {
  const r = await s.run('bash', [script, 'check'], {
    cwd: s.workspace.root,
    env: { PATH: await fakeNode(s, version) },
  })
  return { code: r.code, output: r.output, line: nodeLine(r.output) }
}

/** A copy of the script under a root whose tests/package.json this case controls. */
async function copyWithManifest(s: Scenario, tag: string, manifest: string | null): Promise<string> {
  const script = await s.fs.write(
    `${tag}/scripts/install-toolchain.sh`,
    await readFile(join(REPO_ROOT, SCRIPT), 'utf8'),
    { mode: 0o755 },
  )
  if (manifest !== null) await s.fs.write(`${tag}/tests/package.json`, manifest)
  return script
}

const engines = (range: string) => JSON.stringify({ engines: { node: range } })

describe('TASK-027 — check derives the Node requirement from tests/package.json', () => {
  it('#1 a Node inside the old major floor but outside the harness range is REJECTED', async () => {
    await scenario('install-toolchain-1', async (s) => {
      for (const v of ['20.0.0', '22.0.0', '21.7.3', '18.20.4']) {
        const r = await check(s, v)
        expect(r.line, `check accepted node v${v}:\n${r.output}`).toMatch(/✗ node/)
        expect(r.line).toContain(`v${v}`)
        expect(r.code, `a rejected node did not fail check:\n${r.output}`).toBe(1)
      }
      // TASK-067 raised the real floor to `>=22.18.0` (the first official Node
      // release with type stripping on by default) and dropped the `^20.19.0`
      // arm outright — so 20.19.0 moved from accepted to rejected, and belongs
      // with the rejection list above, not here. 22.12.0 is now also outside
      // the range; it stays here only as a version between "old floor" and
      // "new floor" — accepted before this fix, rejected after — a case the
      // rejection loop above did not cover.
      for (const v of ['22.18.0', '24.1.0']) {
        const r = await check(s, v)
        expect(r.line, `check rejected node v${v}:\n${r.output}`).toMatch(/✓ node v/)
      }
      for (const v of ['20.19.0', '22.12.0']) {
        const r = await check(s, v)
        expect(r.line, `check accepted node v${v}, but TASK-067 raised the floor past it:\n${r.output}`).toMatch(
          /✗ node/,
        )
      }
    })
  })

  it('#2 the range is READ from the manifest, not restated in the script', async () => {
    await scenario('install-toolchain-2', async (s) => {
      const script = await copyWithManifest(s, 'root', engines('>=99.0.0'))
      const r = await check(s, '24.1.0', script)
      expect(r.line, `a manifest demanding node 99 was ignored:\n${r.output}`).toMatch(/✗ node/)
      expect(r.output).toContain('>=99.0.0')
      expect(r.code).toBe(1)
    })
  })

  it('#3 a missing tests/package.json is reported, never replaced by a default floor', async () => {
    await scenario('install-toolchain-3', async (s) => {
      const r = await check(s, '24.1.0', await copyWithManifest(s, 'root', null))
      expect(r.line, `no manifest, yet node was declared fit:\n${r.output}`).toMatch(/✗ node/)
      expect(r.output).toContain('tests/package.json')
      expect(r.code).toBe(1)
    })
  })

  it('#4 a range this script cannot interpret is reported, never guessed at', async () => {
    await scenario('install-toolchain-4', async (s) => {
      const script = await copyWithManifest(s, 'root', engines('20 - 22'))
      const r = await check(s, '24.1.0', script)
      expect(r.line, `an uninterpretable range was accepted:\n${r.output}`).toMatch(/✗ node/)
      // The VERDICT, not merely a rejection. Node 24 also fails the bare `20`,
      // and an evaluator that short-circuits on it never parses `-`, so it
      // rejected this range as "unsupported" without ever finding it
      // uninterpretable — and a mutant passing every uninterpretable range left
      // this case green. Observed on the request as filed.
      expect(r.line, `the range was judged, not refused as uninterpretable:\n${r.output}`).toMatch(/UNVERIFIED/)
      expect(r.output).toContain('20 - 22')
      expect(r.code).toBe(1)
    })
  })

  it('#5 a zero-major caret follows npm: ^0.10.0 stops at 0.11, ^0.0.3 is exactly 0.0.3', async () => {
    await scenario('install-toolchain-5', async (s) => {
      const minor = await copyWithManifest(s, 'minor', engines('^0.10.0'))
      const inMinor = await check(s, '0.10.5', minor)
      expect(inMinor.line, `^0.10.0 rejected 0.10.5:\n${inMinor.output}`).toMatch(/✓ node v/)
      const pastMinor = await check(s, '0.11.0', minor)
      expect(pastMinor.line, `^0.10.0 accepted 0.11.0 — a caret below major 1 is not "same major":\n${pastMinor.output}`).toMatch(
        /✗ node/,
      )

      const patch = await copyWithManifest(s, 'patch', engines('^0.0.3'))
      const exact = await check(s, '0.0.3', patch)
      expect(exact.line, `^0.0.3 rejected 0.0.3:\n${exact.output}`).toMatch(/✓ node v/)
      const pastPatch = await check(s, '0.0.4', patch)
      expect(pastPatch.line, `^0.0.3 accepted 0.0.4:\n${pastPatch.output}`).toMatch(/✗ node/)
    })
  })

  it('#6 a wildcard is one comparator: it neither waives the ones after it nor their syntax check', async () => {
    await scenario('install-toolchain-6', async (s) => {
      // Alexey (Codex) review of 1cc78cf, finding 3: an alternative beginning
      // with `*` was accepted before any later token was read, so the manifest
      // stopped being the authority and unknown syntax stopped failing closed.
      const bound = await check(s, '24.1.0', await copyWithManifest(s, 'bound', engines('* >=99.0.0')))
      expect(bound.line, `"* >=99.0.0" accepted node 24.1.0:\n${bound.output}`).toMatch(/✗ node/)
      expect(bound.line, `"* >=99.0.0" is interpretable, so it must be judged:\n${bound.output}`).not.toMatch(/UNVERIFIED/)
      expect(bound.code).toBe(1)

      const junk = await check(s, '24.1.0', await copyWithManifest(s, 'junk', engines('* nonsense')))
      expect(junk.line, `"* nonsense" was not refused as uninterpretable:\n${junk.output}`).toMatch(/UNVERIFIED/)
      expect(junk.code).toBe(1)

      // The FORM CHECK after a wildcard, not only the evaluation: in `* 20 - 22`
      // the bare `20` fails on Node 24 before `-` is ever parsed, so only the
      // up-front check can call this range uninterpretable. `* nonsense` alone
      // cannot tell, because evaluating `nonsense` throws either way.
      const late = await check(s, '24.1.0', await copyWithManifest(s, 'late', engines('* 20 - 22')))
      expect(late.line, `"* 20 - 22" was judged, not refused as uninterpretable:\n${late.output}`).toMatch(/UNVERIFIED/)
      expect(late.code).toBe(1)

      // A lone wildcard still means any version.
      const any = await check(s, '24.1.0', await copyWithManifest(s, 'any', engines('*')))
      expect(any.line, `"*" rejected node 24.1.0:\n${any.output}`).toMatch(/✓ node v/)
    })
  })
})

// --- TASK-025 commit 4: the per-machine `blueprint` command (PLAN §8.1) -------

/** The superseded v1 body, verbatim: still ours, so replaced, and counted stale by check. */
const V1_BODY = [
  '#!/usr/bin/env bash',
  '# struct2flow-blueprint-command v1: written by scripts/install-toolchain.sh (TASK-025).',
  "# Runs THIS project's own blueprint CLI. The blueprint is read by its address,",
  '# so no checkout path belongs in this file. Edit the installer, not this copy.',
  'for c in ./scripts/blueprint ./scaffolding/scripts/blueprint; do',
  '  [ -x "$c" ] && exec "$c" "$@"',
  'done',
  'echo "blueprint: no scripts/blueprint in $PWD. Run from a project root," >&2',
  'echo "  or fetch the CLI and the libs it needs once with: BLUEPRINT_ROOT=<checkout> bash <checkout>/scripts/blueprint pull scripts/blueprint" >&2',
  'exit 1',
  '',
].join('\n')

/** The v2 body, verbatim (TASK-088 §3(a)). The second copy is the point: the case pins the bytes. */
const BODY = [
  '#!/usr/bin/env bash',
  '# struct2flow-blueprint-command v2: written by scripts/install-toolchain.sh (TASK-088).',
  "# Runs THIS project's own blueprint CLI. The blueprint is read by its address,",
  '# so no checkout path belongs in this file. Edit the installer, not this copy.',
  'for c in ./scripts/blueprint.mts ./scaffolding/scripts/blueprint.mts; do',
  '  [ -f "$c" ] && exec node "$c" "$@"',
  'done',
  'for c in ./scripts/blueprint ./scaffolding/scripts/blueprint; do',
  '  [ -x "$c" ] && exec "$c" "$@"',
  'done',
  'echo "blueprint: no scripts/blueprint.mts (or executable scripts/blueprint) in $PWD. Run from a project root," >&2',
  'echo "  or fetch the CLI and the libs it needs once with: BLUEPRINT_ROOT=<checkout> node <checkout>/scripts/blueprint.mts pull scripts/blueprint.mts" >&2',
  'exit 1',
  '',
].join('\n')

const FOREIGN = [
  'was not written by this installer, so it is left alone.',
  "  If it runs a checkout's scripts/blueprint, TASK-021 Stage B will break it.",
  '  Once every project has the address-reading CLI, replace it with:',
  '  bash scripts/install-toolchain.sh --replace-blueprint-command',
]

const stubText = (word: string) => `#!/usr/bin/env bash\necho ${word}\n`

async function stub(s: Scenario, rel: string, word: string): Promise<string> {
  return s.fs.write(rel, stubText(word), { mode: 0o755 })
}

/** One machine: an installer root (with a working CLI that prints ROOT), and a HOME. */
interface Machine {
  tag: string
  root: string
  installer: string
  home: string
  bin: string
  target: string
  targetRel: string
  path: string
}

async function machine(s: Scenario, tag: string, base: string): Promise<Machine> {
  const installer = await s.fs.write(`bp-${tag}/${SCRIPT}`, await readFile(join(REPO_ROOT, SCRIPT), 'utf8'), {
    mode: 0o755,
  })
  await s.fs.write(
    `bp-${tag}/scripts/lib/signals.sh`,
    await readFile(join(REPO_ROOT, 'scripts/lib/signals.sh'), 'utf8'),
  )
  await stub(s, `bp-${tag}/scripts/blueprint`, 'ROOT')
  await s.fs.write(`home-${tag}/.keep`, '')
  const home = s.workspace.path(`home-${tag}`)
  const bin = join(home, '.local/bin')
  return {
    tag,
    root: s.workspace.path(`bp-${tag}`),
    installer,
    home,
    bin,
    target: join(bin, 'blueprint'),
    targetRel: `home-${tag}/.local/bin/blueprint`,
    // No curl and no brew, so a plain install stops at the installer's own check
    // on either OS before any download; no blueprint, so the operator's real one
    // can never answer.
    path: base,
  }
}

function install(s: Scenario, m: Machine, args: string[], o: { cwd?: string; path?: string } = {}) {
  return s.run('bash', [m.installer, ...args], {
    cwd: o.cwd ?? s.workspace.root,
    env: { HOME: m.home, PATH: o.path ?? m.path },
  })
}

/** What the command at the target prints, run from `cwd`. */
async function prints(s: Scenario, m: Machine, cwd: string) {
  const r = await s.run(m.target, ['help'], { cwd, env: { HOME: m.home, PATH: m.path } })
  return r.stdout.trim()
}

async function dotNames(m: Machine, prefix: string) {
  return (await readdir(m.bin)).filter((n) => n.startsWith(prefix))
}

const baseline = (s: Scenario) => s.pathWithout(['curl', 'brew', 'blueprint'])

/** #37b: a machine whose target is a wrapper around a checkout printing OLD, and a project printing NEW. */
async function replacement(s: Scenario, tag: string, o: { link?: boolean; noCli?: boolean; legacy?: boolean } = {}) {
  const base = await baseline(s)
  const m = await machine(s, tag, base)
  const old = await stub(s, `old-${tag}/scripts/blueprint`, 'OLD')
  const wrapper = `#!/usr/bin/env bash\nexec ${old} "$@"\n`
  if (o.link) {
    await s.fs.write(`home-${tag}/.local/bin/.keep`, '')
    const ln = await s.run('ln', ['-s', old, m.target], { cwd: s.workspace.root })
    expect(ln.code, ln.output).toBe(0)
  } else {
    await s.fs.write(m.targetRel, wrapper, { mode: 0o755 })
  }
  await s.fs.write(
    `proj-${tag}/.blueprint-source`,
    'config_version = 2\n' +
      (o.legacy ? `blueprint_source = ${old}\n` : '') +
      'blueprint_remote = /nowhere.git\nblueprint_branch = main\nblueprint_release_branch = released\n',
  )
  if (!o.noCli) await stub(s, `proj-${tag}/scripts/blueprint`, 'NEW')
  return { m, base, old, wrapper, proj: s.workspace.path(`proj-${tag}`) }
}

type Replacement = Awaited<ReturnType<typeof replacement>>

/** The old command survived: same bytes, still runs, and no temp file was left. */
async function intact(s: Scenario, f: Replacement, what: string, output: string) {
  expect(await readFile(f.m.target, 'utf8'), `${what}: the old command changed:\n${output}`).toBe(f.wrapper)
  expect(await prints(s, f.m, f.proj), `${what}: the old command no longer runs`).toBe('OLD')
  expect(await dotNames(f.m, '.blueprint.new.'), `${what}: a temp file was left`).toEqual([])
}

/** The swap happened as §8.1 says. Returns the backup's path. */
async function replaced(s: Scenario, f: Replacement, what: string, r: { code: number | null; output: string }) {
  expect(r.code, `${what}:\n${r.output}`).toBe(0)
  expect(await readFile(f.m.target, 'utf8'), `${what}: the target is not the body`).toBe(BODY)
  expect(await prints(s, f.m, f.proj), `${what}: the new command does not run the project CLI`).toBe('NEW')
  const backups = await dotNames(f.m, '.blueprint-replaced.')
  expect(backups, `${what}: expected exactly one backup`).toHaveLength(1)
  expect(await dotNames(f.m, '.blueprint.new.'), `${what}: a temp file was left`).toEqual([])
  expect(r.output).toContain(`✓ blueprint command replaced (${f.m.target})`)
  const backup = join(f.m.bin, backups[0] ?? '', 'blueprint')
  expect(r.output).toContain(`restore it with: mv ${backup} ${f.m.target}`)
  return backup
}

describe('TASK-025 — the installer writes the per-machine blueprint command', () => {
  it('#34 the command is written, exact, executable, names no checkout, and runs the project CLI', async () => {
    await scenario('install-toolchain-34', async (s) => {
      const base = await baseline(s)
      const m = await machine(s, 'a', base)
      const r = await install(s, m, [])

      const st = await lstat(m.target).catch(() => null)
      expect(st?.isFile(), `no command written:\n${r.output}`).toBe(true)
      expect((st?.mode ?? 0) & 0o777).toBe(0o755)
      const written = await readFile(m.target, 'utf8')
      expect(written, 'the command is not §8.1’s body').toBe(BODY)
      expect(written).not.toContain(m.root)
      expect(r.output).toContain(`✓ blueprint command installed (${m.target})`)

      await s.fs.write('proj/scripts/blueprint', '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$PWD/args"\n', {
        mode: 0o755,
      })
      const proj = s.workspace.path('proj')
      const ran = await s.run('sh', ['-c', 'blueprint drift'], {
        cwd: proj,
        env: { HOME: m.home, PATH: `${m.bin}:${base}` },
      })
      expect(ran.code, ran.output).toBe(0)
      expect(await readFile(join(proj, 'args'), 'utf8')).toBe('drift\n')
    })
  })

  it('#35 layouts: scaffolding/scripts/blueprint runs; with neither, exit 1 and the message', async () => {
    await scenario('install-toolchain-35', async (s) => {
      const m = await machine(s, 'a', await baseline(s))
      await install(s, m, [])

      await stub(s, 'scaf/scaffolding/scripts/blueprint', 'SCAFFOLD')
      const scaf = await s.run(m.target, [], { cwd: s.workspace.path('scaf'), env: { HOME: m.home, PATH: m.path } })
      expect(scaf.code, scaf.output).toBe(0)
      expect(scaf.stdout.trim()).toBe('SCAFFOLD')

      await s.fs.write('none/.keep', '')
      const none = await s.run(m.target, ['drift'], { cwd: s.workspace.path('none'), env: { HOME: m.home, PATH: m.path } })
      expect(none.code, none.output).toBe(1)
      expect(none.stderr).toContain('blueprint: no scripts/blueprint.mts (or executable scripts/blueprint) in ')
      expect(none.stderr).toContain(
        'or fetch the CLI and the libs it needs once with: BLUEPRINT_ROOT=<checkout> node <checkout>/scripts/blueprint.mts pull scripts/blueprint.mts',
      )
    })
  })

  it('#36 idempotent: a second install does not rewrite the command', async () => {
    await scenario('install-toolchain-36', async (s) => {
      const m = await machine(s, 'a', await baseline(s))
      await install(s, m, [])
      // `touch -d @0` is GNU-only (BSD touch on macOS refuses it); `-t` with
      // the zone pinned to UTC is the epoch on both.
      const touched = await s.run('touch', ['-t', '197001010000.00', m.target], {
        cwd: s.workspace.root,
        env: { TZ: 'UTC' },
      })
      expect(touched.code, touched.output).toBe(0)
      const again = await install(s, m, [])
      expect((await stat(m.target)).mtimeMs, `the command was rewritten:\n${again.output}`).toBe(0)
      expect(again.output).toContain('✓ blueprint command already present')
    })
  })

  it('#37 never overwrites what it did not write: a wrapper, a symlink, a marked but edited body', async () => {
    await scenario('install-toolchain-37', async (s) => {
      const base = await baseline(s)

      // (a) today's hand-written wrapper
      const a = await machine(s, 'a', base)
      const wrapper = `#!/usr/bin/env bash\nexec ${a.root}/scripts/blueprint "$@"\n`
      await s.fs.write(a.targetRel, wrapper, { mode: 0o755 })
      const ra = await install(s, a, [])
      expect(await readFile(a.target, 'utf8'), `(a) the wrapper was overwritten:\n${ra.output}`).toBe(wrapper)
      expect(ra.output).toContain(`⚠ ${a.target} ${FOREIGN[0]}`)
      for (const line of FOREIGN.slice(1)) expect(ra.output).toContain(line)
      const ca = await install(s, a, ['check'])
      expect(ca.output, '(a) check did not report the foreign command').toContain(`⚠ ${a.target} ${FOREIGN[0]}`)
      expect(await readFile(a.target, 'utf8'), `(a) check changed the wrapper:\n${ca.output}`).toBe(wrapper)

      // (b) a symlink is never followed and never owned: one into a checkout,
      // and one to a file holding the EXACT released body — ownership is a
      // regular file's bytes, so a link to the right bytes is still foreign.
      const b = await machine(s, 'b', base)
      await s.fs.write('home-b/.local/bin/.keep', '')
      const releasedBody = await s.fs.write('elsewhere/blueprint', BODY, { mode: 0o755 })
      for (const linked of [join(b.root, 'scripts/blueprint'), releasedBody]) {
        const before = await readFile(linked, 'utf8')
        const ln = await s.run('ln', ['-sfn', linked, b.target], { cwd: s.workspace.root })
        expect(ln.code, ln.output).toBe(0)
        const rb = await install(s, b, [])
        expect((await lstat(b.target)).isSymbolicLink(), `(b) the link to ${linked} was replaced:\n${rb.output}`).toBe(true)
        expect(await readlink(b.target)).toBe(linked)
        expect(rb.output, `(b) a link to ${linked} was taken as the installer's`).toContain(`⚠ ${b.target} ${FOREIGN[0]}`)
        const cb = await install(s, b, ['check'])
        expect(cb.output, `(b) check did not report the link to ${linked}`).toContain(`⚠ ${b.target} ${FOREIGN[0]}`)
        expect(await readlink(b.target), `(b) check replaced the link to ${linked}`).toBe(linked)
        expect(await readFile(linked, 'utf8'), `(b) ${linked} was written through the link`).toBe(before)
      }

      // (c) the marker proves nothing: the body plus one edited line is foreign
      const c = await machine(s, 'c', base)
      const edited = `${BODY}# hand-edited\n`
      await s.fs.write(c.targetRel, edited, { mode: 0o755 })
      const rc = await install(s, c, [])
      expect(await readFile(c.target, 'utf8'), `(c) a marked, edited body was overwritten:\n${rc.output}`).toBe(edited)
      for (const line of FOREIGN.slice(1)) expect(rc.output).toContain(line)
      const cc = await install(s, c, ['check'])
      expect(cc.output).toContain(`⚠ ${c.target} ${FOREIGN[0]}`)
      expect(await readFile(c.target, 'utf8'), `(c) check changed the edited body:\n${cc.output}`).toBe(edited)
    })
  })

  // ONE CASE PER SUB-RUN (Alexey, c3-4 review #4). As one case, the first
  // failing run hid every later one, so R1 and R3 were seen red only at (a) and
  // the failure-path runs they break were never observed. Each case owns its
  // scenario now, and a mutant reddens every run it breaks.
  describe('#37b --replace-blueprint-command: the approved swap, and every failure before it leaves the old command', () => {
    it('(a) from the project: replaced, runs the project CLI, one backup of the old wrapper, no temp', async () => {
      await scenario('install-toolchain-37b-a', async (s) => {
        const f = await replacement(s, 'a')
        const r = await install(s, f.m, ['--replace-blueprint-command'], { cwd: f.proj })
        const backup = await replaced(s, f, '(a)', r)
        expect(await readFile(backup, 'utf8'), '(a) the backup is not the old wrapper').toBe(f.wrapper)
      })
    })

    it("(a2) from the installer's root with --project: the same result", async () => {
      await scenario('install-toolchain-37b-a2', async (s) => {
        const f = await replacement(s, 'a2')
        const r = await install(s, f.m, ['--replace-blueprint-command', `--project=${f.proj}`], { cwd: f.m.root })
        const backup = await replaced(s, f, '(a2)', r)
        expect(await readFile(backup, 'utf8')).toBe(f.wrapper)
      })
    })

    it('(b) a symlink to a file is replaced as a link: the backup is the link, the file it named is untouched', async () => {
      await scenario('install-toolchain-37b-b', async (s) => {
        const f = await replacement(s, 'b', { link: true })
        const backup = await replaced(s, f, '(b)', await install(s, f.m, ['--replace-blueprint-command'], { cwd: f.proj }))
        expect((await lstat(f.m.target)).isFile()).toBe(true)
        expect((await lstat(backup)).isSymbolicLink(), '(b) the backup is not the link').toBe(true)
        expect(await readlink(backup)).toBe(f.old)
        expect(await readFile(f.old, 'utf8'), '(b) the checkout CLI was written through the link').toBe(stubText('OLD'))
      })
    })

    for (const tool of ['chmod', 'cp', 'mv']) {
      it(`(c) ${tool} failing: non-zero, the old command intact and running, no temp`, async () => {
        await scenario(`install-toolchain-37b-fail-${tool}`, async (s) => {
          const f = await replacement(s, tool)
          const shims = await s.shimDir(`shim-fail-${tool}`)
          await shims.add(tool, 'exit 1')
          const r = await install(s, f.m, ['--replace-blueprint-command'], { cwd: f.proj, path: `${shims.dir}:${f.base}` })
          expect(r.code, `(c) ${tool} failing still exited 0:\n${r.output}`).not.toBe(0)
          await intact(s, f, `(c) ${tool} failing`, r.output)
        })
      })
    }

    it('(c) validation: a project with no scripts/blueprint is refused, even though the root has a CLI', async () => {
      await scenario('install-toolchain-37b-no-cli', async (s) => {
        const f = await replacement(s, 'no-cli', { noCli: true })
        const r = await install(s, f.m, ['--replace-blueprint-command'], { cwd: f.proj })
        expect(r.code, `(c) a project without scripts/blueprint was accepted:\n${r.output}`).not.toBe(0)
        await intact(s, f, '(c) no project CLI', r.output)
      })
    })

    it('(c) validation: a project still carrying blueprint_source is refused as not migrated', async () => {
      await scenario('install-toolchain-37b-legacy', async (s) => {
        const f = await replacement(s, 'legacy', { legacy: true })
        const r = await install(s, f.m, ['--replace-blueprint-command'], { cwd: f.proj })
        expect(r.code, `(c) a project still carrying blueprint_source was accepted:\n${r.output}`).not.toBe(0)
        expect(r.output).toContain(`✗ ${f.proj} is not a migrated project`)
        await intact(s, f, '(c) blueprint_source present', r.output)
      })
    })

    it("(c) validation: run from the installer's root without --project is refused", async () => {
      await scenario('install-toolchain-37b-at-root', async (s) => {
        const f = await replacement(s, 'at-root')
        const r = await install(s, f.m, ['--replace-blueprint-command'], { cwd: f.m.root })
        expect(r.code, `(c) the installer root was validated as the project:\n${r.output}`).not.toBe(0)
        await intact(s, f, '(c) from the root without --project', r.output)
      })
    })

    const interrupts: Array<[Sig, 'group' | 'alone']> = [
      ['SIGINT', 'group'],
      ['SIGTERM', 'group'],
      ['SIGINT', 'alone'],
      ['SIGTERM', 'alone'],
    ]
    for (const [sig, to] of interrupts) {
      it(`(d) ${sig} to the ${to} while the backup copies: died of it, the old command intact, no temp`, async () => {
        const tag = `${sig.toLowerCase()}-${to}`
        await scenario(`install-toolchain-37b-${tag}`, async (s) => {
          const f = await replacement(s, tag)
          const blocker = await seam(s, tag, 'cp')
          const { child, done } = start(s, f.m.installer, ['--replace-blueprint-command'], f.proj, {
            HOME: f.m.home,
            PATH: `${blocker.dir}:${f.base}`,
          })
          await reached(blocker)
          process.kill(to === 'group' ? -(child.pid ?? 0) : (child.pid ?? 0), sig)
          release(blocker)
          const d = await done
          expect(diedOf(d, sig), `(d) ${sig} to the ${to} did not end the installer\n${show(d)}`).toBe(true)
          await intact(s, f, `(d) ${sig} to the ${to}`, show(d))
        })
      })
    }

    // Alexey, c3-4 review #2: `mv -f temp target` with a directory (or a link to
    // one) as the target moves the command INTO it, returns 0, and the
    // installer reported "replaced" with no command in place.
    for (const shape of ['link', 'directory'] as const) {
      it(`(e) a target that is a ${shape === 'link' ? 'symlink to a directory' : 'directory'}: refused, nothing written inside it`, async () => {
        await scenario(`install-toolchain-37b-dir-${shape}`, async (s) => {
          const m = await machine(s, 'e', await baseline(s))
          await s.fs.write('home-e/.local/bin/.keep', '')
          await s.fs.write('referent/keep', 'kept\n')
          const referent = s.workspace.path('referent')
          if (shape === 'link') {
            const ln = await s.run('ln', ['-s', referent, m.target], { cwd: s.workspace.root })
            expect(ln.code, ln.output).toBe(0)
          } else {
            await s.fs.write('home-e/.local/bin/blueprint/keep', 'kept\n')
          }
          await s.fs.write(
            'proj-e/.blueprint-source',
            'config_version = 2\nblueprint_remote = /nowhere.git\nblueprint_branch = main\nblueprint_release_branch = released\n',
          )
          await stub(s, 'proj-e/scripts/blueprint', 'NEW')
          const inside = shape === 'link' ? referent : m.target

          const r = await install(s, m, ['--replace-blueprint-command'], { cwd: s.workspace.path('proj-e') })

          expect(r.code, `(e) a ${shape} target was "replaced":\n${r.output}`).not.toBe(0)
          if (shape === 'link') {
            expect((await lstat(m.target)).isSymbolicLink(), `(e) the link was replaced:\n${r.output}`).toBe(true)
            expect(await readlink(m.target)).toBe(referent)
          }
          expect((await readdir(inside)).sort(), `(e) something was written inside the ${shape}:\n${r.output}`).toEqual(['keep'])
          expect(await readFile(join(inside, 'keep'), 'utf8')).toBe('kept\n')
          expect(await dotNames(m, '.blueprint.new.'), `(e) a temp file was left:\n${r.output}`).toEqual([])
        })
      })
    }
  })

  it('#42 TASK-088: an owned v1 body is replaced by v2; a foreign body is kept', async () => {
    await scenario('install-toolchain-42', async (s) => {
      const base = await baseline(s)
      const m = await machine(s, 'a', base)
      await s.fs.write(m.targetRel, V1_BODY, { mode: 0o755 })
      const r = await install(s, m, [])
      expect(await readFile(m.target, 'utf8'), `v1 was not replaced:\n${r.output}`).toBe(BODY)
      expect(r.output).toContain(`✓ blueprint command installed (${m.target})`)
      expect(r.output).not.toContain(FOREIGN[0])

      const f = await machine(s, 'f', base)
      const foreign = `${V1_BODY}# hand-edited\n`
      await s.fs.write(f.targetRel, foreign, { mode: 0o755 })
      const rf = await install(s, f, [])
      expect(await readFile(f.target, 'utf8'), `a foreign body was replaced:\n${rf.output}`).toBe(foreign)
      expect(rf.output).toContain(`⚠ ${f.target} ${FOREIGN[0]}`)
    })
  })

  it('#43 TASK-088: v2 runs scripts/blueprint.mts with node, and falls back to an executable scripts/blueprint', async () => {
    await scenario('install-toolchain-43', async (s) => {
      const m = await machine(s, 'a', await baseline(s))
      await install(s, m, [])
      const env = { HOME: m.home, PATH: m.path }

      // 100644 on purpose: the body must run it through `node`, not exec it.
      await s.fs.write('mts/scripts/blueprint.mts', 'console.log("MTS", process.argv.slice(2).join(","))\n')
      await s.fs.write('mts/scripts/blueprint', '#!/usr/bin/env bash\necho SHELL\n', { mode: 0o755 })
      const mts = await s.run(m.target, ['a', 'b'], { cwd: s.workspace.path('mts'), env })
      expect(mts.code, mts.output).toBe(0)
      expect(mts.stdout.trim(), 'the .mts did not win over the shell file').toBe('MTS a,b')

      await s.fs.write('scaf/scaffolding/scripts/blueprint.mts', 'console.log("SCAF-MTS")\n')
      const scaf = await s.run(m.target, [], { cwd: s.workspace.path('scaf'), env })
      expect(scaf.stdout.trim()).toBe('SCAF-MTS')

      await stub(s, 'old/scripts/blueprint', 'SHELL-ONLY')
      const old = await s.run(m.target, [], { cwd: s.workspace.path('old'), env })
      expect(old.code, old.output).toBe(0)
      expect(old.stdout.trim()).toBe('SHELL-ONLY')
    })
  })

  it('#44 TASK-088: check exits 1 on an owned v1 body and 0 on v2; a foreign body only warns', async () => {
    await scenario('install-toolchain-44', async (s) => {
      const m = await machine(s, 'a', await baseline(s))
      // Every other tool `check` probes is a stub, so the command is the only variable.
      const tools = await s.shimDir('tools-44')
      for (const t of ['gitleaks', 'semgrep', 'osv-scanner', 'jq', 'shellcheck']) await tools.add(t, `echo ${t}`)
      const path = `${tools.dir}:${m.path}`
      await s.fs.write('bp-a/tests/package.json', await readFile(join(REPO_ROOT, 'tests/package.json'), 'utf8'))
      await install(s, m, [], { path })
      const ok = await install(s, m, ['check'], { path })
      expect(ok.output).toContain(`✓ blueprint command (${m.target})`)
      expect(ok.code, `check on a v2 body is not 0:\n${ok.output}`).toBe(0)

      await s.fs.write(m.targetRel, V1_BODY, { mode: 0o755 })
      const stale = await install(s, m, ['check'], { path })
      expect(stale.output).toContain('✗ blueprint command STALE')
      expect(stale.code, `check ignored a v1 body:\n${stale.output}`).toBe(1)

      await s.fs.write(m.targetRel, `${V1_BODY}# edited\n`, { mode: 0o755 })
      const foreign = await install(s, m, ['check'], { path })
      expect(foreign.output).toContain(`⚠ ${m.target} ${FOREIGN[0]}`)
      expect(foreign.code, `a foreign body was counted:\n${foreign.output}`).toBe(0)
    })
  })

  it('#38 a blueprint earlier on PATH is named', async () => {
    await scenario('install-toolchain-38', async (s) => {
      const base = await baseline(s)
      const m = await machine(s, 'a', base)
      const other = await stub(s, 'other/blueprint', 'OTHER')
      const r = await install(s, m, [], { path: `${s.workspace.path('other')}:${m.bin}:${base}` })
      expect(r.output).toContain(`⚠ blueprint resolves to ${other} first on PATH, not ${m.target}.`)
    })
  })
})

// --- TASK-029: U7 of a2bp request PR #69 (linkedin-watcher-agent) -------------
//
// The request made a SYMLINKED CLI load its lib/ from its physical path, and
// made drift refuse to report without its helpers. The symlink rewrite is not
// ported: commit 4 replaced the symlinked command with one that execs the
// project's own scripts/blueprint. What U7 proved still has to hold for that
// command, so its two assertions travel here. #U7a: the installed command is
// the project's CLI, byte for byte in what it reports. #U7b: a CLI missing its
// lib/ never produces a report, and says the gate is not armed (A-22).

async function gitOk(s: Scenario, cwd: string, args: string[]) {
  const r = await s.run('git', args, { cwd })
  expect(r.code, `git ${args.join(' ')} failed in ${cwd}:\n${r.output}`).toBe(0)
  return r.stdout.trim()
}

async function repo(s: Scenario, dir: string) {
  await gitOk(s, dir, ['init', '-q', '-b', 'main', '.'])
  await gitOk(s, dir, ['config', 'user.email', 't@local'])
  await gitOk(s, dir, ['config', 'user.name', 't'])
  await gitOk(s, dir, ['config', 'commit.gpgsign', 'false'])
  await gitOk(s, dir, ['add', '-A'])
  await gitOk(s, dir, ['commit', '-q', '-m', 'init'])
  return gitOk(s, dir, ['rev-parse', 'HEAD'])
}

/** A fixture blueprint remote with a `released` branch. */
async function releasedRemote(s: Scenario) {
  await s.fs.write('remote/CLAUDE.md', '# CLAUDE\nfor {{PROJECT_NAME}}\n')
  await s.fs.write('remote/docs/DoD.md', '# DoD\nowner {{PROJECT_NAME}}\n')
  await s.fs.write('remote/tests/fixture/test.sh', 'echo fixture\n')
  const dir = s.workspace.path('remote')
  const head = await repo(s, dir)
  await gitOk(s, dir, ['branch', 'released'])
  return { dir, head }
}

/**
 * A migrated project named `proj` (§7.2 steps 4–7) with a copy of this tree's
 * CLI. `lib` says how much of scripts/lib/ it has. Its DoD differs from the
 * remote's, so a real report has a drifted line to show.
 */
async function migrated(s: Scenario, tag: string, remote: { dir: string; head: string }, lib: 'all' | 'none' | 'no-gate') {
  const rel = `${tag}/proj`
  await s.fs.write(`${rel}/CLAUDE.md`, '# CLAUDE\nfor proj\n')
  await s.fs.write(`${rel}/docs/DoD.md`, '# DoD\nowner proj\nedited here\n')
  await s.fs.write(`${rel}/tests/fixture/test.sh`, 'echo fixture\n')
  await s.fs.write(`${rel}/.githooks/pre-push`, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  await s.fs.write(
    `${rel}/.blueprint-source`,
    [
      'config_version           = 2',
      `blueprint_remote         = ${remote.dir}`,
      'blueprint_branch         = main',
      'blueprint_release_branch = released',
      `bootstrap_sha            = ${remote.head}`,
      'bootstrap_date           = 2026-01-01',
      '',
    ].join('\n'),
  )
  const proj = s.workspace.path(rel)
  const scripts = join(REPO_ROOT, 'scripts')
  await cp(scripts, join(proj, 'scripts'), {
    recursive: true,
    filter: (p) =>
      lib === 'all' ||
      (lib === 'none' ? !p.startsWith(join(scripts, 'lib')) : p !== join(scripts, 'lib', 'gate.mts')),
  })
  await repo(s, proj)
  return proj
}

/** The one part of a drift report that differs between two honest runs. */
const untimed = (out: string) => out.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/g, '<time>')

describe('TASK-029 — U7 (PR #69): the installed command is the project CLI, and an incomplete CLI never reports', () => {
  it('#U7a from a migrated project, the installed command reports exactly what the project CLI reports', async () => {
    await scenario('install-toolchain-u7a', async (s) => {
      const base = await baseline(s)
      const m = await machine(s, 'a', base)
      await install(s, m, [])
      const proj = await migrated(s, 'a', await releasedRemote(s), 'all')
      const env = { HOME: m.home, PATH: base }
      const direct = join(proj, 'scripts/blueprint.mts')

      // Warm-up: the first run arms the gate and fills the cache, and says so.
      // Both compared runs then start from the same state.
      const warm = await s.run('node', [direct, 'drift'], { cwd: proj, env })
      expect(warm.code, warm.output).toBe(0)

      const viaDirect = await s.run('node', [direct, 'drift'], { cwd: proj, env })
      const viaCommand = await s.run(m.target, ['drift'], { cwd: proj, env })

      // NON-VACUITY: a real report, from the address, with the gate line and a
      // drifted file — or "identical" would hold for two runs that did nothing.
      expect(viaDirect.stdout).toContain('(released)')
      expect(viaDirect.stdout).toContain('gate:')
      expect(viaDirect.stdout).toMatch(/~ +docs\/DoD\.md/)

      expect(untimed(viaCommand.stdout), `the installed command's report differs\n${viaCommand.output}`).toBe(
        untimed(viaDirect.stdout),
      )
      expect(untimed(viaCommand.stderr)).toBe(untimed(viaDirect.stderr))
      expect(viaCommand.code).toBe(viaDirect.code)
    })
  })

  it('#U7b a project CLI missing its lib/ exits non-zero, says the gate is NOT armed, and prints no report', async () => {
    await scenario('install-toolchain-u7b', async (s) => {
      const base = await baseline(s)
      const m = await machine(s, 'a', base)
      await install(s, m, [])
      const remote = await releasedRemote(s)

      for (const lib of ['none', 'no-gate'] as const) {
        const proj = await migrated(s, lib, remote, lib)
        const r = await s.run(m.target, ['drift'], { cwd: proj, env: { HOME: m.home, PATH: base } })
        expect(r.code, `(${lib}) drift from an incomplete CLI exited 0\n${r.output}`).not.toBe(0)
        expect(r.output, `(${lib}) the gate was not armed and nothing said so (A-22)\n${r.output}`).toMatch(
          /gate:.*NOT armed/,
        )
        expect(r.output, `(${lib}) an incomplete CLI printed a clean report`).not.toContain(
          '✓ All blueprint-managed files match',
        )
        expect(r.output, `(${lib}) an incomplete CLI printed per-file report lines`).not.toMatch(/^\s*[~+!] \S/m)
        expect(
          await s.run('git', ['config', '--get', 'core.hooksPath'], { cwd: proj }).then((g) => g.stdout.trim()),
          `(${lib}) the gate was armed after all, so the message is false`,
        ).toBe('')
      }
    })
  })
})

// --- TASK-033: ShellCheck, installed on both OSes and reported by check -------
//
// The pre-push gate's shell lint stage BLOCKS without ShellCheck, so the one
// script that sets a machine up must install it and `check` must report it —
// a check narrower than what the gate needs is how a machine reports itself
// ready and is not. #40 and #41 install nothing for real: the OS is a `uname`
// shim, `brew` and `curl` are recording shims, and every other tool the install
// path would fetch is already "present" as a stub.

const SHELLCHECK_VERSION = '0.10.0'

/** The "N tool(s) missing" count `check` ends with, or 0 when it printed none. */
const missingCount = (out: string) => Number(/(\d+) tool\(s\) missing/.exec(out)?.[1] ?? 0)

/** Shims for an install run on `os` that touch no network: uname, and every other fetched tool as a stub. */
async function offlineInstall(s: Scenario, name: string, os: 'Linux' | 'Darwin') {
  const shims = await s.shimDir(name)
  for (const tool of ['gitleaks', 'osv-scanner', 'semgrep', 'jq']) await shims.add(tool, `echo "${tool} stub"`)
  await shims.add('uname', `case "$1" in -m) echo x86_64 ;; *) echo ${os} ;; esac`)
  return shims
}

describe('TASK-033 — the installer installs ShellCheck on macOS and Linux, and check reports it', () => {
  it('#39 check reports a present shellcheck, and counts a missing one as missing', async () => {
    await scenario('install-toolchain-39', async (s) => {
      // The node shim's directory only: fakeNode's PATH also carries the real
      // one, where an installed shellcheck would answer for the "missing" run.
      const nodeDir = (await fakeNode(s, '24.1.0')).split(':')[0] ?? ''
      const base = await s.pathWithout(['shellcheck'])
      const run = (path: string) =>
        s.run('bash', [join(REPO_ROOT, SCRIPT), 'check'], { cwd: s.workspace.root, env: { PATH: path } })

      const without = await run(`${nodeDir}:${base}`)
      expect(without.output, `check said nothing about a missing shellcheck:\n${without.output}`).toMatch(
        /✗ shellcheck\s+MISSING/,
      )

      const sc = await s.shimDir('sc')
      await sc.add('shellcheck', `echo "version: ${SHELLCHECK_VERSION}"`)
      const withIt = await run(`${sc.dir}:${nodeDir}:${base}`)
      expect(withIt.output, `check did not report a present shellcheck:\n${withIt.output}`).toMatch(/✓ shellcheck\b/)
      expect(
        missingCount(without.output),
        `a missing shellcheck is not counted:\n--- without ---\n${without.output}\n--- with ---\n${withIt.output}`,
      ).toBe(missingCount(withIt.output) + 1)
    })
  })

  it('#40 on Linux, install fetches the PINNED release and installs shellcheck into ~/.local/bin', async () => {
    await scenario('install-toolchain-40', async (s) => {
      const base = await s.pathWithout(['curl', 'brew', 'blueprint', 'shellcheck'])
      const m = await machine(s, 'a', base)
      const shims = await offlineInstall(s, 'offline-linux', 'Linux')

      // The release as GitHub ships it: shellcheck-v<ver>/shellcheck inside a .tar.xz.
      const member = `shellcheck-v${SHELLCHECK_VERSION}/shellcheck`
      await s.fs.write(`release/${member}`, `#!/bin/sh\necho "version: ${SHELLCHECK_VERSION}"\n`, { mode: 0o755 })
      const tarball = s.workspace.path('release.tar.xz')
      const tar = await s.run('tar', ['-cJf', tarball, '-C', s.workspace.path('release'), member], {
        cwd: s.workspace.root,
      })
      expect(tar.code, tar.output).toBe(0)

      // curl serves that file for the shellcheck URL, records every URL, and
      // fails any other fetch the way an unreachable host would.
      const urls = s.workspace.path('curl-urls')
      await shims.add(
        'curl',
        `out=""; url=""\n` +
          `while [ "$#" -gt 0 ]; do case "$1" in -o) out="$2"; shift ;; https://*) url="$1" ;; esac; shift; done\n` +
          `echo "$url" >> '${urls}'\n` +
          `case "$url" in *koalaman/shellcheck*) cp '${tarball}' "$out" ;; *) exit 22 ;; esac`,
      )

      const r = await install(s, m, [], { path: `${shims.dir}:${base}` })

      const url = `https://github.com/koalaman/shellcheck/releases/download/v${SHELLCHECK_VERSION}/shellcheck-v${SHELLCHECK_VERSION}.linux.x86_64.tar.xz`
      const fetched = await readFile(urls, 'utf8').catch(() => '')
      expect(fetched.split('\n'), `the pinned ShellCheck release was never fetched:\n${r.output}`).toContain(url)
      const installed = join(m.bin, 'shellcheck')
      const st = await stat(installed).catch(() => null)
      expect(st?.isFile(), `no shellcheck in ${m.bin}:\n${r.output}`).toBe(true)
      expect((st?.mode ?? 0) & 0o111, 'the installed shellcheck is not executable').not.toBe(0)
      expect(r.output).toContain('✓ shellcheck installed')
    })
  })

  it('#41 on macOS, install runs brew install shellcheck', async () => {
    await scenario('install-toolchain-41', async (s) => {
      const base = await s.pathWithout(['curl', 'brew', 'blueprint', 'shellcheck'])
      const m = await machine(s, 'a', base)
      const shims = await offlineInstall(s, 'offline-mac', 'Darwin')
      const calls = s.workspace.path('brew-calls')
      await shims.add(
        'brew',
        `echo "$*" >> '${calls}'\n` +
          `if [ "$1 $2" = "install shellcheck" ]; then printf '#!/bin/sh\\necho "version: ${SHELLCHECK_VERSION}"\\n' > '${shims.dir}/shellcheck'; chmod 755 '${shims.dir}/shellcheck'; fi\n` +
          `exit 0`,
      )

      const r = await install(s, m, [], { path: `${shims.dir}:${base}` })

      const brewed = await readFile(calls, 'utf8').catch(() => '')
      expect(brewed.split('\n'), `brew was never asked for shellcheck:\n${r.output}`).toContain('install shellcheck')
      expect(r.output).toContain('✓ shellcheck installed')
    })
  })
})

// --- the seam pattern (tests/sync-by-address), for #37b (d) -------------------
// Copied, not imported: that file is a spec, and importing it would register its
// cases here; tests/harness is not this task's to extend.

interface Seam {
  dir: string
  marker: string
  fifo: string
}

/** A `tool` shim that blocks the first time it runs, then behaves as the real tool. */
async function seam(s: Scenario, name: string, tool: string): Promise<Seam> {
  const dirName = `seam-${name}`
  const shims = await s.shimDir(dirName)
  const marker = s.workspace.path(dirName, 'reached')
  const fifo = s.workspace.path(dirName, 'release.fifo')
  const mk = await s.run('mkfifo', [fifo], { cwd: s.workspace.root })
  expect(mk.code, `mkfifo failed, so the seam would not block:\n${mk.output}`).toBe(0)
  const found = await s.run('sh', ['-c', `command -v ${tool}`], { cwd: s.workspace.root })
  const real = found.stdout.trim()
  expect(real, `no real ${tool} to hand over to`).not.toBe('')
  await shims.add(
    tool,
    `if [ ! -e '${marker}' ]; then\n` +
      `  exec 3<>'${fifo}'\n` +
      `  : > '${marker}'\n` +
      `  read -r _ <&3\n` +
      `  exec 3<&-\n` +
      `fi\n` +
      `exec '${real}' "$@"`,
  )
  return { dir: shims.dir, marker, fifo }
}

async function reached(seam: Seam) {
  await vi.waitFor(
    () => {
      if (!existsSync(seam.marker)) throw new Error(`the seam was never reached: ${seam.marker}`)
    },
    { timeout: 60_000, interval: 10 },
  )
}

function release(seam: Seam) {
  let fd: number
  try {
    fd = openSync(seam.fifo, constants.O_WRONLY | constants.O_NONBLOCK)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENXIO') return
    throw err
  }
  try {
    writeSync(fd, 'go\n')
  } catch (err) {
    // A group signal kills the shim, the fifo's only reader, and it can die
    // between our open and this write. It needed no release.
    if ((err as NodeJS.ErrnoException).code !== 'EPIPE') throw err
  } finally {
    closeSync(fd)
  }
}

interface Done {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

function start(s: Scenario, script: string, args: string[], cwd: string, env: Record<string, string>) {
  const child: ChildProcess = s.background('bash', [script, ...args], { cwd, env })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (d: Buffer) => {
    stdout += d.toString('utf8')
  })
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString('utf8')
  })
  const done = new Promise<Done>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
  return { child, done }
}

type Sig = 'SIGINT' | 'SIGTERM'

const diedOf = (d: Done, sig: Sig) => d.signal === sig || d.code === (sig === 'SIGINT' ? 130 : 143)

const show = (d: Done) => `code=${d.code} signal=${d.signal}\n${d.stdout}${d.stderr}`
