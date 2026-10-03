// scripts/lib/scratch-tmpdir.mts — TASK-083.
//
// Every dispatched agent (Codex, Gemini, Kimi, and the local Ollama juniors)
// must write its temporary files under `<repo>/.scratch/tmp`, never `/tmp`
// (AGENTS.md "Running commands" — `.scratch/` is gitignored, scanned as part
// of the repo, and cleanable with an allowed `rm -rf .scratch/*`; `/tmp` is
// where cleanup fails and where most agents broke the rule on 2026-09-24/25).
//
// `mktemp`, `os.tmpdir()` in Node/Python, and most CLI tools read `TMPDIR`
// first — so setting it in the child's environment redirects them without
// touching every tool's own flags. One function, used by every launcher and
// by junior-dispatch.mts, so the path is derived once and cannot drift
// between them (the same reasoning CLAUDE.md gives for state-dir.sh).

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * scratchTmpDir — `<root>/.scratch/tmp`, created if missing. `root` is the
 * physical repository root each caller already resolves for itself (A-09 /
 * BUG-020 — never derived a second way here).
 */
export function scratchTmpDir(root: string): string {
  const dir = join(root, '.scratch', 'tmp')
  mkdirSync(dir, { recursive: true })
  return dir
}
