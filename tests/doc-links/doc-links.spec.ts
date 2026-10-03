/**
 * tests/doc-links/doc-links.spec.ts — relative links under docs/ must resolve.
 *
 * WHY THIS EXISTS. Files move through the lifecycle constantly —
 * `doing/` → `waiting-acceptance/` → `done/` is the normal path — and every
 * move silently breaks the links pointing at the old location. Nothing notices
 * until a reader clicks one. On 2026-08-03 there were THIRTEEN broken links,
 * all from moves, and one had been wrong across two relocations. The founder
 * found them by opening the files; this is the check that replaces that.
 *
 * EQUIVALENCE RECORD (TASK-018-RULES R6, and the migration's own evidence).
 *
 * "Ported" is a claim, so it was measured rather than reviewed. FOURTEEN trees
 * — twelve perturbed ones, a healthy baseline, and the real `docs/` tree — were
 * built once and BOTH implementations run over each: the retiring
 * `tests/doc-links/test.sh`, copied into the fixture and run with the fixture as
 * its ROOT, and `scanDocLinks()`. The per-case verdicts (#0 and #1) were
 * compared mechanically. **They agreed on all fourteen inputs**, and the
 * `examined` COUNT was compared as well as the verdict on every one — two scans
 * can agree that "everything resolves" while examining different populations,
 * which is the subset-metric trap CLAUDE.md names for coverage.
 *
 * Two differences exist and are recorded rather than smoothed over:
 *
 *   - THE `)` LIMIT, which I expected to be a fail-OPEN hole and which
 *     measurement corrected. `[^)#][^)]*` stops at the first `)`, so
 *     `[x](gone(1).md)` yields the target `gone(1` — and BOTH implementations
 *     therefore REPORT the link, naming a path that does not occur in the file.
 *     Fail-noisy, identically (probed directly against the shell pipeline
 *     before this line was written). Pinned by case `#1-paren` rather than
 *     quietly improved: changing a verdict's text under a migration is how a
 *     reviewer loses the ability to compare the two.
 *   - File ORDER differs (`find | sort` vs. a sorted recursive walk), so the
 *     broken list can be permuted. The spec compares SETS, and the real tree
 *     produced identical order anyway.
 *
 * R6 NEGATIVE PROOF — per CASE, not per case GROUP.
 *
 * The record above compares VERDICT SETS between the shell suite and this
 * port. Three Codex reviews of neighbouring groups refused certification on
 * the same point: agreeing on `#3` does not say which of the cases NAMED `#3`
 * can be made red. So every `it()` here was put to the narrower question —
 * is there a perturbation OBSERVED to turn it red — and the answer is
 * recorded in docs/waiting-acceptance/TASK-018-R6-isolation/outputs/gap.txt, which names
 * the mutant(s) per case. The denominator comes from the runner rather than
 * from a grep, so the `it.each` tables are expanded rather than counted once.
 *
 * Thirteen cases, thirteen with an observed red. `#1 a DIRECTORY target
 * resolves` needed a mutant of its own — requiring a regular file is the one
 * defect that reports a work-item FOLDER as broken, and nothing else in the
 * population distinguishes it.
 */

import { describe, it, expect } from 'vitest'
import { dirname, join } from 'node:path'
import { REPO_ROOT, scenario, type Scenario } from '../harness/index.js'
import { scanDocLinks } from './doc-links.js'

/**
 * Write a small docs tree into the scenario and scan it.
 *
 * A MAP OF FILES rather than a builder with options, for the reason
 * `tests/manifest/fixture.ts` gives: a perturbation is then one `files.set`
 * line, readable in place, needing no vocabulary. The option-bag version of
 * that had six booleans within an hour.
 */
async function scanTree(
  s: Scenario,
  name: string,
  files: Record<string, string>,
  project: Record<string, string> = {},
  links: Record<string, string> = {},
): Promise<ReturnType<typeof scanDocLinks>> {
  const root = await s.workspace.dir(name, 'docs')
  for (const [rel, content] of Object.entries(files)) {
    await s.fs.write(join(name, 'docs', rel), content)
  }
  // Files beside docs/, at the project root: project_config_paths.md, a web root.
  for (const [rel, content] of Object.entries(project)) {
    await s.fs.write(join(name, rel), content)
  }
  // Symlinks at the project root: `path -> target`, target written verbatim, so
  // a case can point one out of the workspace on purpose. `ln` rather than
  // s.fs, which has no symlink verb and resolves a path's real parent by design.
  for (const [rel, target] of Object.entries(links)) {
    const at = s.workspace.path(join(name, rel))
    await s.fs.mkdirp(dirname(join(name, rel)))
    const r = await s.run('ln', ['-s', target, at], { cwd: s.workspace.root })
    expect(r.code, `could not create the symlink ${rel} -> ${target}\n${r.output}`).toBe(0)
  }
  return scanDocLinks(root)
}

/** Enough resolving links to clear the non-vacuity floor, plus a real target. */
function healthyTree(): Record<string, string> {
  const links = Array.from(
    { length: 25 },
    (_, i) => `- [target](target.md) number ${i}\n`,
  ).join('')
  return {
    'target.md': '# the file every link below points at\n',
    'INDEX.md': links,
  }
}

describe('doc-links — a relative link under docs/ resolves, or the scan says which does not', () => {
  it('#0+#1 the healthy fixture is green, and is seen doing work', async () => {
    // Without this every case below is meaningless: a perturbation that turns
    // the scan red proves nothing if the scan was red to begin with. And the
    // count is asserted because a scan that examines nothing passes trivially,
    // which is the BUG-005 shape the #0 floor exists to refuse.
    await scenario('doc-links-baseline', async (s) => {
      const scan = await scanTree(s, 'bp', healthyTree())

      expect(scan.broken).toEqual([])
      expect(scan.examined).toBe(25)
    })
  })

  it('#1 a link pointing at a file that MOVED is reported, naming file and target', async () => {
    await scenario('doc-links-moved', async (s) => {
      const files = healthyTree()
      // Exactly the 2026-08-03 shape: the item travelled to the next lifecycle
      // folder and the reference to its old home stayed behind.
      files['doing/PLAN.md'] = '[the bug](../doing/BUG-004-gate-arming/)\n'

      const scan = await scanTree(s, 'bp', files)

      expect(scan.broken).toHaveLength(1)
      expect(scan.broken[0]).toContain('doing/PLAN.md')
      expect(scan.broken[0]).toContain('../doing/BUG-004-gate-arming/')
    })
  })

  it('#0 a tree with too few links is a BROKEN EXTRACTOR, not a clean bill of health', async () => {
    await scenario('doc-links-vacuous', async (s) => {
      // The floor is the only thing standing between "every link resolves" and
      // "the regex matched nothing". The shell suite fails at <20; the number
      // lives in the spec below rather than in the scanner, because it is a
      // judgement about this repo's size, not a property of link extraction.
      const scan = await scanTree(s, 'bp', {
        'target.md': '# x\n',
        'INDEX.md': '[target](target.md)\n',
      })

      expect(scan.broken).toEqual([])
      expect(scan.examined).toBeLessThan(20)
    })
  })

  it('#1 a link inside BACKTICKS is prose about a link and is not examined', async () => {
    await scenario('doc-links-codespan', async (s) => {
      const files = healthyTree()
      // `[AGENT_ROSTER.md](AGENT_ROSTER.md)` in a file that documents linking.
      // The first version of the shell check reported it, and a guard that
      // calls correct prose broken is one people learn to ignore.
      files['prose.md'] = 'write it as `[x](does-not-exist.md)` in the doc\n'

      const scan = await scanTree(s, 'bp', files)

      expect(scan.broken).toEqual([])
      expect(scan.examined).toBe(25)
    })
  })

  it('#1 a link inside a FENCED block is an example and is not examined', async () => {
    await scenario('doc-links-fence', async (s) => {
      const files = healthyTree()
      files['fenced.md'] = '```md\n[x](does-not-exist.md)\n```\n'

      const scan = await scanTree(s, 'bp', files)

      expect(scan.broken).toEqual([])
      expect(scan.examined).toBe(25)
    })
  })

  it('#1 an UNCLOSED fence swallows the rest of the file, in both implementations', async () => {
    await scenario('doc-links-fence-unclosed', async (s) => {
      // `sed '/^```/,/^```/d'` with an odd number of fences deletes to EOF, and
      // the port reproduces it. Recorded as a case rather than left as a
      // surprise: a file whose fences are unbalanced has its links silently
      // unexamined, which is a fail-open edge BOTH versions share.
      const files = healthyTree()
      files['unclosed.md'] = '```\nnot closed\n[x](does-not-exist.md)\n'

      const scan = await scanTree(s, 'bp', files)

      expect(scan.broken).toEqual([])
    })
  })

  it('#1 http, mailto and autolink targets are not filesystem paths', async () => {
    await scenario('doc-links-external', async (s) => {
      const files = healthyTree()
      files['external.md'] = [
        '[a](https://example.com/nope)',
        '[b](http://example.com/nope)',
        '[c](mailto:nobody@example.com)',
        '[d](<https://example.com/angle>)',
        '',
      ].join('\n')

      const scan = await scanTree(s, 'bp', files)

      expect(scan.broken).toEqual([])
      expect(scan.examined).toBe(25)
    })
  })

  it('#1 a pure in-page anchor names no file, and an anchor SUFFIX is dropped', async () => {
    await scenario('doc-links-anchors', async (s) => {
      const files = healthyTree()
      files['anchors.md'] = [
        '[up](#a-heading-in-this-file)',
        '[over](target.md#a-heading-over-there)',
        '',
      ].join('\n')

      const scan = await scanTree(s, 'bp', files)

      expect(scan.broken).toEqual([])
      // 25 + the one anchored link. The pure `#` anchor is not counted, which
      // is what `[^)#]` in the shell regex decided.
      expect(scan.examined).toBe(26)
    })
  })

  it('#1 an anchored link whose FILE is gone is still reported', async () => {
    await scenario('doc-links-anchor-broken', async (s) => {
      const files = healthyTree()
      files['anchors.md'] = '[over](gone.md#a-heading)\n'

      const scan = await scanTree(s, 'bp', files)

      expect(scan.broken).toHaveLength(1)
      expect(scan.broken[0]).toContain('gone.md')
      // The anchor is NOT part of the reported target — it was stripped before
      // the existence test, so the message names the path a reader must fix.
      expect(scan.broken[0]).not.toContain('#a-heading')
    })
  })

  it('#1 a link in a NESTED folder resolves against its own directory', async () => {
    await scenario('doc-links-nested', async (s) => {
      const files = healthyTree()
      // The relocation class: `INDEX.md -> ../doing/…` was wrong across two
      // moves precisely because the target is relative to the FILE, not to
      // docs/. A scanner that resolved against the tree root would call this
      // broken and the real broken ones fine.
      files['a/b/deep.md'] = '[up two](../../target.md)\n'

      const scan = await scanTree(s, 'bp', files)

      expect(scan.broken).toEqual([])
      expect(scan.examined).toBe(26)
    })
  })

  it('#1 a DIRECTORY target resolves — a work-item folder is a legitimate link', async () => {
    await scenario('doc-links-dir', async (s) => {
      const files = healthyTree()
      files['BUG-004-gate-arming/PLAN.md'] = '# plan\n'
      files['ref.md'] = '[the folder](BUG-004-gate-arming/)\n'

      const scan = await scanTree(s, 'bp', files)

      expect(scan.broken).toEqual([])
    })
  })

  it('#1-paren a target containing `)` is TRUNCATED — reported, but under a name nobody can grep for', async () => {
    await scenario('doc-links-paren', async (s) => {
      // `[^)#][^)]*` stops at the first `)`, so the extracted target is
      // `gone(1` rather than `gone(1).md`. This was written expecting a
      // fail-OPEN hole and measurement said otherwise: both implementations
      // report the link, and both name a path that does not appear in the file.
      // Fail-NOISY, identically, so the port is faithful — and the misleading
      // message is recorded here rather than silently improved, because
      // changing a verdict's TEXT under a migration is how a reviewer loses
      // the ability to compare the two.
      const files = healthyTree()
      files['paren.md'] = '[x](gone(1).md)\n'

      const scan = await scanTree(s, 'bp', files)

      expect(scan.broken).toHaveLength(1)
      expect(scan.broken[0]).toContain('gone(1')
      expect(scan.broken[0]).not.toContain('gone(1).md')
    })
  })

  describe('TASK-045 — a site-absolute link resolves only through what the project declares', () => {
    // storm2flow's RELEASE-NOTES.md links /security.html and /terms/v1.html:
    // served pages, not repo files. Resolved against the filesystem root they
    // are all "broken", so the suite reported 13 correct links.
    const links = '[security](/security.html)\n[terms](/terms/v1.html#s2)\n'

    it('#2 a declared web root makes /security.html resolve when the file exists under it', async () => {
      await scenario('doc-links-webroot', async (s) => {
        const scan = await scanTree(s, 'bp', { ...healthyTree(), 'RELEASE-NOTES.md': links }, {
          'project_config_paths.md': '# Paths\n\n- BP_WEB_ROOT: `site/public`\n',
          'site/public/security.html': '<html></html>\n',
          'site/public/terms/v1.html': '<html></html>\n',
        })

        expect(scan.broken).toEqual([])
        expect(scan.examined).toBe(27)
      })
    })

    it('#2 an allowlisted site-absolute path passes, with no file behind it', async () => {
      await scenario('doc-links-webpaths', async (s) => {
        const scan = await scanTree(s, 'bp', { ...healthyTree(), 'RELEASE-NOTES.md': links }, {
          'project_config_paths.md': '# Paths\n\n- BP_WEB_PATHS: `/security.html /terms/v1.html`\n',
        })

        expect(scan.broken).toEqual([])
        expect(scan.examined).toBe(27)
      })
    })

    it.each([
      ['nothing is declared', {}],
      ['the web root lacks the file', { 'project_config_paths.md': '- BP_WEB_ROOT: `site`\n', 'site/other.html': 'x\n' }],
      ['the allowlist names another path', { 'project_config_paths.md': '- BP_WEB_PATHS: `/privacy.html`\n' }],
    ])('#2 an undeclared site-absolute link is still reported when %s', async (_tag, project) => {
      await scenario('doc-links-web-undeclared', async (s) => {
        const scan = await scanTree(s, 'bp', { ...healthyTree(), 'RELEASE-NOTES.md': '[security](/security.html)\n' }, project)

        expect(scan.broken).toHaveLength(1)
        expect(scan.broken[0]).toContain('/security.html')
      })
    })
  })

  describe('BUG-125 — a link resolves only to what a fresh clone of the repository contains', () => {
    // storm2flow's docs held `../../../../blueprint/docs/DoD.md`. It passed on
    // any machine with a sibling blueprint checkout, and is dead everywhere else.

    it('#3 a link that climbs OUT of the repository is reported, though its target exists on this disk', async () => {
      await scenario('doc-links-escape', async (s) => {
        await s.fs.write('outside.md', '# not in the repository\n')
        const scan = await scanTree(s, 'bp', { ...healthyTree(), 'ref.md': '[dod](../../outside.md)\n' })

        expect(scan.broken).toHaveLength(1)
        expect(scan.broken[0]).toContain('../../outside.md')
      })
    })

    it('#3 a local-only file INSIDE the repository still resolves — gitignored is not missing', async () => {
      await scenario('doc-links-local-only', async (s) => {
        // DECIDED, and pinned so it is not "tightened" back. A tracked-files rule
        // was built first and reported `DOCUMENTATION.md -> ../CLAUDE.md` in every
        // freshly bootstrapped project. TASK-048 later made the framework's own
        // docs tracked, so that example no longer exists — but the class does:
        // AGENT_ROSTER.md is per-engineer, `.scratch/` is agent scratch, and
        // project_config_security.md and project_config_infra.md stay local-only
        // by design (A-27). A link into any of those must still resolve for the
        // engineer who has the file. The scan runs over a plain directory here,
        // so nothing in it is tracked at all.
        const scan = await scanTree(s, 'bp', { ...healthyTree(), 'ref.md': '[roster](../AGENT_ROSTER.md)\n' }, {
          'AGENT_ROSTER.md': '# per-engineer, gitignored\n',
        })

        expect(scan.broken).toEqual([])
      })
    })

    it('#3 a declared web root outside the repository resolves nothing', async () => {
      await scenario('doc-links-webroot-escape', async (s) => {
        await s.fs.write('site/security.html', '<html></html>\n')
        const scan = await scanTree(s, 'bp', { ...healthyTree(), 'ref.md': '[security](/security.html)\n' }, {
          'project_config_paths.md': '- BP_WEB_ROOT: `../site`\n',
        })

        expect(scan.broken).toHaveLength(1)
        expect(scan.broken[0]).toContain('/security.html')
      })
    })

    it('#3 a site-absolute target cannot climb out through the web root', async () => {
      await scenario('doc-links-webpath-escape', async (s) => {
        await s.fs.write('outside.md', '# not in the repository\n')
        const scan = await scanTree(s, 'bp', { ...healthyTree(), 'ref.md': '[x](/../../outside.md)\n' }, {
          'project_config_paths.md': '- BP_WEB_ROOT: `site`\n',
          'site/index.html': '<html></html>\n',
        })

        expect(scan.broken).toHaveLength(1)
        expect(scan.broken[0]).toContain('/../../outside.md')
      })
    })

    // CONTAINMENT WAS LEXICAL, AND `stat` FOLLOWS SYMLINKS. So `repo/escape ->
    // ../outside` made `../escape/secret.md` read as a path inside the
    // repository while the file it opened was not. The check must compare the
    // PHYSICAL path.

    it('#4 a FILE symlink pointing out of the repository is reported', async () => {
      await scenario('doc-links-symlink-file', async (s) => {
        await s.fs.write('outside/secret.md', '# not in the repository\n')
        const scan = await scanTree(
          s,
          'bp',
          { ...healthyTree(), 'ref.md': '[x](../escape.md)\n' },
          {},
          { 'escape.md': '../outside/secret.md' },
        )

        expect(scan.broken).toHaveLength(1)
        expect(scan.broken[0]).toContain('../escape.md')
      })
    })

    it('#4 a DIRECTORY symlink pointing out of the repository is reported', async () => {
      await scenario('doc-links-symlink-dir', async (s) => {
        await s.fs.write('outside/secret.md', '# not in the repository\n')
        const scan = await scanTree(
          s,
          'bp',
          { ...healthyTree(), 'ref.md': '[x](../escape/secret.md)\n' },
          {},
          { escape: '../outside' },
        )

        expect(scan.broken).toHaveLength(1)
        expect(scan.broken[0]).toContain('../escape/secret.md')
      })
    })

    it('#4 a web root that is a symlink out of the repository serves nothing', async () => {
      await scenario('doc-links-symlink-webroot', async (s) => {
        await s.fs.write('outside/secret.html', '<html></html>\n')
        const scan = await scanTree(
          s,
          'bp',
          { ...healthyTree(), 'ref.md': '[x](/secret.html)\n' },
          { 'project_config_paths.md': '- BP_WEB_ROOT: `escape`\n' },
          { escape: '../outside' },
        )

        expect(scan.broken).toHaveLength(1)
        expect(scan.broken[0]).toContain('/secret.html')
      })
    })

    it('#4 a symlink inside the web root that leaves the SERVED directory is reported, though it stays in the repo', async () => {
      await scenario('doc-links-symlink-served', async (s) => {
        const scan = await scanTree(
          s,
          'bp',
          { ...healthyTree(), 'ref.md': '[x](/priv/notes.md)\n' },
          {
            'project_config_paths.md': '- BP_WEB_ROOT: `site`\n',
            'site/index.html': '<html></html>\n',
            'private/notes.md': '# in the repo, not served\n',
          },
          { 'site/priv': '../private' },
        )

        expect(scan.broken).toHaveLength(1)
        expect(scan.broken[0]).toContain('/priv/notes.md')
      })
    })

    it('#4 a symlink that stays inside the repository still resolves — the check refuses escapes, not symlinks', async () => {
      await scenario('doc-links-symlink-internal', async (s) => {
        const scan = await scanTree(
          s,
          'bp',
          { ...healthyTree(), 'ref.md': '[x](../alias.md)\n' },
          { 'real.md': '# the file the alias points at\n' },
          { 'alias.md': 'real.md' },
        )

        expect(scan.broken).toEqual([])
      })
    })
  })

  it('THE REAL TREE — every relative link under docs/ resolves', async () => {
    // No scenario(): this reads the repository and writes nothing, so a
    // workspace would be theatre. The floor is asserted first for the same
    // reason the shell suite asserted it first — a scan that examined nothing
    // would otherwise report a clean docs tree. This suite ships, so the floor
    // is what a FRESH project's docs hold: 17 once the blueprint's own documents
    // stopped shipping (TASK-021 Stage 2). The perturbation cases above prove
    // the extractor; the floor only has to catch one that finds nothing.
    const scan = await scanDocLinks(join(REPO_ROOT, 'docs'))

    expect(
      scan.examined,
      `only ${scan.examined} relative link(s) examined — the extractor is ` +
        `probably broken, so a pass proves nothing`,
    ).toBeGreaterThanOrEqual(10)
    expect(scan.broken, scan.broken.join('\n')).toEqual([])
  })
})
