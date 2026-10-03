/**
 * tests/permission-policy/permission-policy.spec.ts — BUG-118.
 *
 * Parallelism class: read-only (reads this repo's own .claude/settings.json and
 * mutates nothing, so no scenario workspace).
 *
 * AN IRREVERSIBLE ACTION MUST BE GATED BEHIND `ask`, NEVER `allow`.
 *
 * `Bash(aws codepipeline put-approval-result *)` sat in `allow` with nothing in
 * `ask` or `deny` overriding it, so an agent in any derived project could approve
 * a PRODUCTION deployment with no confirmation. A manual approval action exists
 * to put a human in the loop, and the editor's permission prompt is where that
 * human actually stands — so while the pattern is auto-approved, the gate
 * approves itself. Surfaced from storm2flow as PR #64 (numbered BUG-110 there,
 * which this repo had already allocated).
 *
 * Asserted against this repo's OWN settings.json rather than a fixture, because
 * the defect was a value in the shipped file and a fixture would pass over it.
 * Parsed as JSON rather than grepped, so the pattern appearing in a comment or an
 * unrelated key cannot satisfy it.
 *
 * Matched on the SUBSTRING `put-approval-result`, not the exact entry: derived
 * projects have already drifted on the spacing (storm2flow spells it
 * `put-approval-result*`, no space before the star), and a test that recognises
 * one spelling goes quietly green on the other.
 *
 * TASK-042 (#4-#9) — A PROJECT'S OWN RULES SURVIVE PULL, AND CANNOT UNDO BUG-118.
 * `.claude/settings.json` is whole-file managed and JSON carries no markers, so
 * every pull used to replace it and delete the project's rules. A project now
 * keeps them in `.claude/settings.project.json`, which pull never writes; pull
 * lands the blueprint's settings with the project's permission lists merged in,
 * and drops any project `allow` that a blueprint `ask` or `deny` names. Those
 * cases run pull against a fixture blueprint, one scenario workspace each.
 */
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'

const APPROVAL = 'put-approval-result'
const BUCKETS = ['allow', 'ask', 'deny'] as const

type Permissions = Partial<Record<(typeof BUCKETS)[number], string[]>>

async function permissions(): Promise<Permissions> {
  const raw = await readFile(join(REPO_ROOT, '.claude/settings.json'), 'utf8')
  return (JSON.parse(raw) as { permissions?: Permissions }).permissions ?? {}
}

describe('BUG-118 — approving a deployment is a decision, not a default', () => {
  it('#1 no put-approval-result spelling is auto-approved in `allow`', async () => {
    const p = await permissions()
    expect(
      (p.allow ?? []).filter((e) => e.includes(APPROVAL)),
      'a deployment approval in `allow` means the agent approves production with '
        + 'no prompt — the prompt IS the human approval step for a manual gate',
    ).toEqual([])
  })

  it('#2 the pattern is in `ask`, so the agent can still approve — after being asked', async () => {
    // Non-vacuity for #1: deleting the entry outright would also empty `allow`.
    const p = await permissions()
    expect(
      (p.ask ?? []).filter((e) => e.includes(APPROVAL)).length,
      'the entry must be MOVED to `ask`, not deleted: approving from the editor is '
        + 'the point, it just has to be confirmed',
    ).toBeGreaterThan(0)
  })

  it('#3 the pattern sits in exactly one bucket, and that bucket is `ask`', async () => {
    const p = await permissions()
    const where = BUCKETS.filter((b) => (p[b] ?? []).some((e) => e.includes(APPROVAL)))
    expect(
      where,
      'a pattern in more than one bucket makes the effective decision depend on '
        + 'precedence nobody reads',
    ).toEqual(['ask'])
  })
})

// --- TASK-042 ---------------------------------------------------------------

const CLI = join(REPO_ROOT, 'scripts/blueprint.mts')
const ASK = 'Bash(aws codepipeline put-approval-result *)'
const DENY = 'Bash(sudo rm *)'
const PROJECT_RULE = 'Bash(aws logs tail *)'
const LAYER = '.claude/settings.project.json'
const PERMISSION_KEYS = ['allow', 'ask', 'deny', 'additionalDirectories']

interface Proposal {
  permissions: Record<string, string[]>
}

/**
 * The project file a migration refusal prints, parsed back out of the output.
 *
 * Parsed rather than eyeballed because the guarantee under test is that what
 * pull PRINTS is a file the next pull accepts — a substring check would pass on
 * a proposal that is merely close.
 */
function proposalFrom(output: string): Proposal {
  const lines = output.split('\n')
  const start = lines.findIndex((l) => /^ {8}\{$/.test(l))
  const end = lines.findIndex((l) => /^ {8}\}$/.test(l))
  expect(start, `no proposal block in:\n${output}`).toBeGreaterThanOrEqual(0)
  expect(end, `unterminated proposal block in:\n${output}`).toBeGreaterThan(start)
  return JSON.parse(lines.slice(start, end + 1).join('\n')) as Proposal
}

interface Settings {
  permissions: Required<Permissions> & { additionalDirectories?: string[] }
  hooks?: unknown
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n'

async function git(s: Scenario, cwd: string, args: string[]) {
  return s.run('git', args, { cwd })
}

async function initRepo(s: Scenario, dir: string) {
  await git(s, dir, ['init', '-q', '-b', 'main', '.'])
  await git(s, dir, ['config', 'user.email', 't@local'])
  await git(s, dir, ['config', 'user.name', 't'])
  await git(s, dir, ['config', 'commit.gpgsign', 'false'])
}

function blueprintSettings(extraAllow: string[]): Settings {
  return {
    permissions: { allow: ['Bash(git status)', ...extraAllow], ask: [ASK], deny: [DENY] },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard' }] }] },
  }
}

/**
 * A blueprint whose settings.json gains one allow entry in its second commit,
 * and a project bootstrapped from the first. `tests/fixture/test.sh` is there
 * because `tests/` is a managed directory whose expansion fails closed.
 */
async function fixture(
  s: Scenario,
  tag: string,
  // null: the project has NO settings.json — the ordinary new-managed-file path.
  projectSettings: Settings | null,
  layer?: unknown,
  // Raw blueprint bytes, for the case where they are not JSON at all.
  blueprintRaw?: string,
) {
  const bp = await s.workspace.dir(tag, 'bp')
  await s.fs.write(join(bp, '.claude/settings.json'), blueprintRaw ?? json(blueprintSettings([])))
  await s.fs.write(join(bp, 'tests/fixture/test.sh'), 'echo fixture\n')
  await s.fs.write(join(bp, '.blueprint-root'), '')
  await initRepo(s, bp)
  await git(s, bp, ['add', '-A'])
  await git(s, bp, ['commit', '-q', '-m', 'one'])
  const first = (await git(s, bp, ['rev-parse', 'HEAD'])).stdout.trim()
  await s.fs.write(
    join(bp, '.claude/settings.json'),
    blueprintRaw ?? json(blueprintSettings(['Bash(git log *)'])),
  )
  await git(s, bp, ['add', '-A'])
  await git(s, bp, ['commit', '-q', '-m', 'two'])

  const p = await s.workspace.dir(tag, 'proj')
  if (projectSettings) await s.fs.write(join(p, '.claude/settings.json'), json(projectSettings))
  if (layer !== undefined) await s.fs.write(join(p, LAYER), json(layer))
  await s.fs.write(
    join(p, '.blueprint-source'),
    [
      'config_version   = 2',
      `blueprint_remote = ${bp}`,
      'blueprint_branch = main',
      `bootstrap_sha    = ${first}`,
      'bootstrap_date   = 2026-01-01',
      '',
    ].join('\n'),
  )
  await initRepo(s, p)
  await git(s, p, ['add', '-A'])
  await git(s, p, ['commit', '-q', '-m', 'init'])
  return p
}

async function settingsOf(p: string): Promise<Settings> {
  return JSON.parse(await readFile(join(p, '.claude/settings.json'), 'utf8')) as Settings
}

/** Drift's verdict on settings.json: the line naming it, or none. */
function driftLine(output: string): string | undefined {
  return output.split('\n').find((l) => l.includes('.claude/settings.json'))
}

describe('TASK-042 — a project keeps its own permission rules across pull', () => {
  const layered = {
    permissions: { allow: [PROJECT_RULE, ASK, DENY], additionalDirectories: ['../shared'] },
  }

  it('#4 a full pull lands the blueprint update AND keeps the project file rules; the project file is untouched', async () => {
    await scenario('permission-policy-4', async (s) => {
      const p = await fixture(s, 'a', blueprintSettings([]), layered)
      const layerBefore = await readFile(join(p, LAYER), 'utf8')

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })
      expect(r.code, r.output).toBe(0)

      const got = await settingsOf(p)
      expect(got.permissions.allow, 'the blueprint update did not land').toContain('Bash(git log *)')
      expect(got.permissions.allow, 'the project rule was deleted by pull').toContain(PROJECT_RULE)
      expect(got.permissions.additionalDirectories, 'project additionalDirectories lost').toEqual(['../shared'])
      expect(got.hooks, 'hooks are the blueprint key, taken from the blueprint').toEqual(blueprintSettings([]).hooks)
      expect(await readFile(join(p, LAYER), 'utf8'), 'pull wrote the project-owned file').toBe(layerBefore)
    })
  })

  it('#5 a project allow cannot re-allow what the blueprint asks or denies', async () => {
    await scenario('permission-policy-5', async (s) => {
      const p = await fixture(s, 'b', blueprintSettings([]), layered)
      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })
      expect(r.code, r.output).toBe(0)

      const got = await settingsOf(p)
      expect(
        got.permissions.allow.filter((e) => e === ASK || e === DENY),
        'a project allow re-allowed a blueprint ask/deny entry (BUG-118 undone)',
      ).toEqual([])
      expect(got.permissions.ask, 'the blueprint ask entry was lost').toEqual([ASK])
      expect(got.permissions.deny, 'the blueprint deny entry was lost').toEqual([DENY])
    })
  })

  it('#6 drift judges the MERGED result: a pulled layered project is not drifted', async () => {
    await scenario('permission-policy-6', async (s) => {
      const p = await fixture(s, 'c', blueprintSettings([]), layered)

      // Non-vacuity: before the pull the file really is behind.
      const before = await s.run('node', [CLI, 'drift'], { cwd: p })
      expect(driftLine(before.output), before.output).toMatch(/~.*\.claude\/settings\.json/)

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })
      expect(r.code, r.output).toBe(0)
      const after = await s.run('node', [CLI, 'drift'], { cwd: p })
      expect(
        driftLine(after.output),
        `drift still reports settings.json after a pull — a project with its own rules would read as drifted forever:\n${after.output}`,
      ).toBeUndefined()
    })
  })

  it('#7 migration: settings.json with rules the blueprint does not ship and no project file is REFUSED, then pulls once the file exists', async () => {
    await scenario('permission-policy-7', async (s) => {
      const legacy = blueprintSettings([PROJECT_RULE])
      const p = await fixture(s, 'd', legacy)
      const before = await readFile(join(p, '.claude/settings.json'), 'utf8')

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })
      expect(r.code, `a refused settings.json must exit 4:\n${r.output}`).toBe(4)
      expect(await readFile(join(p, '.claude/settings.json'), 'utf8'), 'the project rules were overwritten').toBe(
        before,
      )
      expect(r.output, 'the refusal must show the rule and where it goes').toContain(PROJECT_RULE)
      expect(r.output).toContain(LAYER)

      const drift = await s.run('node', [CLI, 'drift'], { cwd: p })
      expect(driftLine(drift.output), drift.output).toMatch(/✗.*\.claude\/settings\.json/)

      await s.fs.write(join(p, LAYER), json({ permissions: { allow: [PROJECT_RULE] } }))
      const again = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })
      expect(again.code, again.output).toBe(0)
      const got = await settingsOf(p)
      expect(got.permissions.allow).toContain(PROJECT_RULE)
      expect(got.permissions.allow).toContain('Bash(git log *)')
    })
  })

  it('#8 a project file that sets anything but permission lists is refused, not half-applied', async () => {
    await scenario('permission-policy-8', async (s) => {
      const p = await fixture(s, 'e', blueprintSettings([]), { hooks: {}, permissions: { allow: [PROJECT_RULE] } })
      const before = await readFile(join(p, '.claude/settings.json'), 'utf8')

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })
      expect(r.code, r.output).toBe(4)
      expect(r.output).toMatch(/settings\.project\.json must/)
      expect(await readFile(join(p, '.claude/settings.json'), 'utf8')).toBe(before)
    })
  })

  it('#9 a project with no rules of its own and no project file pulls exactly as before', async () => {
    await scenario('permission-policy-9', async (s) => {
      const p = await fixture(s, 'f', blueprintSettings([]))
      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })
      expect(r.code, r.output).toBe(0)
      expect(await readFile(join(p, '.claude/settings.json'), 'utf8')).toBe(
        json(blueprintSettings(['Bash(git log *)'])),
      )
    })
  })

  // --- Alexey's cross-provider review, 2026-09-16 --------------------------

  it('#10 blueprint settings that are not JSON are refused even when the project has no settings.json', async () => {
    await scenario('permission-policy-10', async (s) => {
      // The ordinary NEW-managed-file path: nothing to merge, nothing to
      // migrate, so the copy used to run with no parse at all and land
      // `{broken` in a project. Nothing downstream validates it either.
      const p = await fixture(s, 'g', null, undefined, '{broken\n')

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })
      expect(r.code, `malformed blueprint settings must be refused:\n${r.output}`).toBe(4)
      await expect(
        readFile(join(p, '.claude/settings.json'), 'utf8'),
        'pull landed blueprint bytes that are not JSON',
      ).rejects.toThrow()
    })
  })

  it('#11 the printed migration proposal is a valid project file, and unsupported legacy keys are named', async () => {
    await scenario('permission-policy-11', async (s) => {
      // `permissions.otherList` is legacy and the project file cannot carry it.
      // Printing it into the proposal made the next pull reject the very file
      // the refusal told the operator to write.
      const legacy = {
        permissions: { ...blueprintSettings([PROJECT_RULE]).permissions, otherList: ['foo'] },
        hooks: blueprintSettings([]).hooks,
      } as unknown as Settings
      const p = await fixture(s, 'h', legacy)

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })
      expect(r.code, r.output).toBe(4)
      expect(r.output, 'an unsupported legacy key was neither carried nor named').toContain(
        'permissions.otherList',
      )

      const proposal = proposalFrom(r.output)
      expect(Object.keys(proposal), 'the proposal is not shaped like a project file').toEqual([
        'permissions',
      ])
      expect(
        Object.keys(proposal.permissions).filter((k) => !PERMISSION_KEYS.includes(k)),
        'the proposal holds a key the project file schema rejects, so saving it fails the next pull',
      ).toEqual([])
      expect(proposal.permissions.allow).toContain(PROJECT_RULE)

      // The guarantee itself: saving what was printed ends the migration.
      await s.fs.write(join(p, LAYER), json(proposal))
      const again = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })
      expect(again.code, `the printed proposal was rejected as a project file:\n${again.output}`).toBe(0)
      const got = await settingsOf(p)
      expect(got.permissions.allow).toContain(PROJECT_RULE)
      expect(got.permissions.allow).toContain('Bash(git log *)')
    })
  })

  // --- Alexey's review of the fix, 2026-09-16, finding 4 -------------------

  it('#12 a project file holding TWO JSON objects is refused, not read as one of them', async () => {
    await scenario('permission-policy-12', async (s) => {
      // The blueprint side is guarded; the project side is not. `jq -e` over a
      // STREAM reports the LAST predicate, and the merge slurps and takes .[1]
      // — the first object. So this passed its shape check on one object and
      // merged the other, and the allow list came out empty.
      const p = await fixture(s, 'i', null)
      await s.fs.write(
        join(p, LAYER),
        `{}\n{"permissions":{"allow":[${JSON.stringify(PROJECT_RULE)}]}}\n`,
      )

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })

      expect(r.code, `a two-object project layer was accepted:\n${r.output}`).toBe(4)
      expect(r.output, 'the refusal does not say what is wrong with the file').toMatch(
        /single JSON object/i,
      )
    })
  })

  it('#12b a layer whose FIRST object is unsupported is refused, although the last one is fine', async () => {
    await scenario('permission-policy-12b', async (s) => {
      // `jq -e` reports the last value's truthiness, so a trailing `{}` waves
      // an unsupported first object through.
      const p = await fixture(s, 'j', null)
      await s.fs.write(join(p, LAYER), '{"hooks":{"PreToolUse":[]}}\n{}\n')

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })

      expect(r.code, `an unsupported first object was accepted:\n${r.output}`).toBe(4)
    })
  })

  it('#13 legacy settings holding TWO objects are refused, not migrated from the first', async () => {
    await scenario('permission-policy-13', async (s) => {
      const p = await fixture(s, 'k', null)
      await s.fs.write(
        join(p, '.claude/settings.json'),
        `{}{"permissions":{"allow":[${JSON.stringify(PROJECT_RULE)}]}}\n`,
      )

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })

      expect(r.code, `a two-object settings.json was accepted:\n${r.output}`).toBe(4)
      expect(r.output).toMatch(/single JSON object/i)
    })
  })

  it('#14 a layer that is an array, a number or null is refused as the wrong SHAPE, not as broken JSON', async () => {
    await scenario('permission-policy-14', async (s) => {
      // They are perfectly valid JSON. Saying otherwise sends the operator
      // looking for a syntax error that is not there.
      for (const [tag, body] of [
        ['array', '[]\n'],
        ['number', '42\n'],
        ['null', 'null\n'],
      ] as const) {
        const p = await fixture(s, `l-${tag}`, null)
        await s.fs.write(join(p, LAYER), body)

        const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })

        expect(r.code, `a ${tag} layer was accepted:\n${r.output}`).toBe(4)
        expect(r.output, `a ${tag} is valid JSON — the refusal must not call it invalid`).not.toMatch(
          /not valid JSON/i,
        )
      }
    })
  })

  it('#14b legacy settings that are an array or a number are refused as the wrong shape too', async () => {
    await scenario('permission-policy-14b', async (s) => {
      // This is the path Alexey's wording note is about: the migration branch
      // reports a jq failure as "not valid JSON", which an array plainly is.
      for (const [tag, body] of [
        ['array', '[]\n'],
        ['number', '42\n'],
      ] as const) {
        const p = await fixture(s, `n-${tag}`, null)
        await s.fs.write(join(p, '.claude/settings.json'), body)

        const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })

        expect(r.code, `a ${tag} settings.json was accepted:\n${r.output}`).toBe(4)
        expect(r.output, `a ${tag} is valid JSON — the refusal must not call it invalid`).not.toMatch(
          /not valid JSON/i,
        )
      }
    })
  })

  it('#15 legacy settings that are null are refused, not silently replaced', async () => {
    await scenario('permission-policy-15', async (s) => {
      const p = await fixture(s, 'm', null)
      await s.fs.write(join(p, '.claude/settings.json'), 'null\n')

      const r = await s.run('node', [CLI, 'pull', '--yes'], { cwd: p })

      expect(r.code, `null settings.json was overwritten without a word:\n${r.output}`).toBe(4)
    })
  })
})
