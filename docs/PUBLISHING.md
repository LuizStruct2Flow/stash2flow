# PUBLISHING — runbook for first public push

> **This file is TRACKED, and it SHIPS to every derived project.** It is
> framework content: the process for taking a struct2flow project from local
> development to a public GitHub repository without leaking AI configurations
> or project-specific personal data.
>
> **It previously claimed to be gitignored and founder-only. It never was** —
> `git check-ignore` finds no rule and `git archive HEAD` contains it. That
> mattered because §2 asks you to write real names and emails into the grep
> below: a reader who believed the header would have put personal data into a
> tracked file and published it, which is the leak this runbook exists to
> prevent. Corrected 2026-09-10.
>
> Read this end-to-end before the first public push. Re-read sections
> 4 and 6 before every subsequent push.

## 0. What's at stake

Three categories of leak we are preventing:

1. **Project-specific personal data**: any project-specific personal
   content (positioning files, watchlists, user data, real fixtures,
   captured production logs, etc. — replace with whatever your project
   has).
2. **AI configurations**: the founder's Claude Code permission
   allowlist, and the multi-AI review chain itself — the runtime handoff
   history in `logs/state/signal-history.log` and review records such as
   `docs/doing/SLICE-*/CODEX_REVIEW.md`. **Not** the framework's own
   documents: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `AGENT_SIGNAL.md` and
   `docs/DoD.md` are tracked and publish with the repo (TASK-048,
   founder decision 2026-09-16).
3. **Operational state**: ongoing plan decisions and codex run logs —
   and the live handover, which is a case of its own:
   `docs/doing/HANDOVER.md` is TRACKED in the project and REDACTED at
   publish time (§3a). Tracking and publishing are different acts, and
   only the second one exposes in-flight work to strangers.

`.gitignore` excludes the still-private paths above (blueprint privacy
block); §3a's scrub removes the publish-time ones. This runbook is the
**process** that keeps both true over time.

## 1. Pre-flight check — what does the worktree state look like?

From the project root:

```bash
# 1a. Working tree + index state
git status --ignored
```

`Ignored files:` should include `docs/**/CODEX_REVIEW.md`,
`project_config_*.md`, `scripts/signal-watch.mts`,
`scripts/start-codex-signal-watch.mts`, `scripts/new-project.sh`,
`.claude/`, `.blueprint-source`, plus any project-specific privacy paths
you've added in the project's `.gitignore` extension block. The rest of
`docs/` (lifecycle artifacts) is PUBLIC and should NOT appear under
`Ignored files`.

**`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `AGENT_SIGNAL.md`, `docs/DoD.md`,
`docs/PUBLISHING.md` and `docs/doing/HANDOVER.md` are NOT here any more**
(TASK-048; `GEMINI.md` since TASK-084). They are tracked, so seeing them under `Ignored files` means
your `.gitignore` predates 2026-09-16 — AGENTS.md §"Your project's
`.gitignore` is yours" says what to run.

```bash
# 1b. Index state — what would actually publish if you `git push`?
# .gitignore does NOT untrack already-tracked files. This is the
# critical check: a tracked file ignores nothing.
git ls-files | grep -E '^(docs/.+/CODEX_REVIEW\.md|project_config_.*\.md|scripts/(signal-watch|start-codex-signal-watch|new-project)\.sh|\.claude/.*|\.blueprint-source)$' && echo "PRIVATE FILES STILL TRACKED — DO NOT PUSH" || echo "index clean"
```

Expected output: `index clean`.

If output is `PRIVATE FILES STILL TRACKED`, go to §3 and pick a path
(fresh repo with allowlist, or in-place untrack). Either resolves it.

**When you add a new kind of private file, extend this grep pattern
AND §3b's untrack command in the same commit.** Drift between the two
is a recurring failure mode. Extend the project's PUBLISHING.md
accordingly — this blueprint template covers only the framework
files; add your project-specific private paths (real-data fixtures,
secrets, watchlists, etc.) on top.

## 2. Confirm nothing personal lives in tracked content

**Do NOT edit the alternation in place — this file is tracked.** Pass your
markers on the command line, or keep them in an untracked file. Committing your
own names here is the leak you are checking for.

```bash
# Type your markers INLINE. Nothing personal is saved to disk.
git ls-files | xargs grep -l -E 'YourName|YourEmployer|you@example.com' 2>/dev/null || echo "clean"

# Or keep the list untracked and out of the tree entirely:
#   git ls-files | xargs grep -l -f ~/.config/struct2flow/personal-markers 2>/dev/null || echo "clean"
```

Expected output: `clean` — or a path that needs fixing.

(The `LICENSE` copyright line is the one allowed exception. Adjust the
grep if needed.)

## 3. Decide how to actually publish

The current local repo's git history includes the struct2flow bootstrap
commit (`chore(bootstrap)`). That commit **tracks** the still-private
files (`project_config_*.md`, `scripts/signal-watch.mts`,
`scripts/start-codex-signal-watch.mts`, `scripts/new-project.sh`,
`.claude/settings.json`). `.gitignore` does NOT untrack them — it only
prevents NEW additions. They will publish on a normal `git push` unless
we explicitly close the gap.

`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `AGENT_SIGNAL.md`, `docs/DoD.md` and
`docs/PUBLISHING.md` are **not** in that list any more: they are tracked
and publish deliberately (TASK-048). `docs/doing/HANDOVER.md` is tracked
too, and §3a redacts it at publish time rather than untracking it.

Three options, in decreasing safety:

### 3a. Fresh public repo via explicit allowlist (RECOMMENDED)

Create a brand-new repo populated by an **explicit PUBLIC_PATHS list**.
Never inherits the bootstrap commit; pulls only the files you name.

```bash
# Explicit allowlist of paths that ARE public.
# This is the contract — edit this list to match your project's actual
# public-tracked tree.
PUBLIC_PATHS=(
  README.md
  LICENSE
  .gitignore
  .env.example
  # — the framework's own root documents (TASK-048). They are tracked and
  # public; copying docs/ alone does NOT bring them, and §5 treats their
  # ABSENCE from the fresh clone as the finding. —
  CLAUDE.md
  AGENTS.md
  GEMINI.md
  AGENT_SIGNAL.md
  # — common project root files (adapt to your stack) —
  # package.json
  # package-lock.json
  # tsconfig.json
  # vitest.config.ts
  # eslint.config.js
  # — code + tests —
  # src/
  # tests/
  # — scripts: copy each PUBLIC script EXPLICITLY. Do NOT copy the
  # whole scripts/ folder; it contains struct2flow methodology files
  # (signal-watch.mts, start-codex-signal-watch.mts, new-project.sh)
  # that .gitignore correctly prevents from being committed but that
  # would end up on disk in the public-repo dir as untracked-gitignored
  # files — a latent leak risk if someone later force-adds.
  # scripts/<your-public-script>.ts
  # — templates for any private configs your project uses —
  # config/<name>.example.{md,json}
  # — committed synthetic fixtures (NEVER commit real personal data) —
  # data/fixtures/<name>.example.jsonl
  # data/fixtures/README.md
  # — pre-push gate —
  # .githooks/pre-push
  # — docs/ — lifecycle artifacts are public (BACKLOG.md, BUGS.md,
  # FEATURES.md, ACCEPTANCE_TESTS.md, SLICE-*/PLAN.md,
  # waiting-acceptance/*, done/*, requirements/*, mocks/* if you keep them).
  # docs/DoD.md and docs/PUBLISHING.md are public too (TASK-048). The
  # post-copy scrub below removes review records and the LIVE HANDOVER.
  docs/
)

SRC="$(git rev-parse --show-toplevel)"
DEST=~/sources/<your-project-name>-public

mkdir -p "$DEST"
cd "$DEST"
git init -b main

# Copy ONLY the allowlisted paths from the source working tree.
for p in "${PUBLIC_PATHS[@]}"; do
  if [ -e "$SRC/$p" ]; then
    mkdir -p "$(dirname "$p")"
    cp -R "$SRC/$p" "$p"
  fi
done

# Scrub what must not be PUBLISHED, which is a shorter list than what used
# to be gitignored (TASK-048). This is publish-time REDACTION of live work
# notes and review records, not the privacy block returning by the back door:
# the framework's own documents are tracked AND public, while the handover is
# tracked and redacted here, because tracking and publishing are different
# acts and only the second one shows in-flight work to strangers.
rm -f docs/doing/HANDOVER.md
find docs -name 'CODEX_REVIEW.md' -delete 2>/dev/null

# Verify nothing private slipped in. This is the §1b check, repeated
# on the filesystem rather than the git index, plus the handover.
find . -type f \( -name 'HANDOVER.md' -o -name 'CODEX_REVIEW.md' \
  -o -name 'project_config_*.md' \
  -o -name 'signal-watch.mts' -o -name 'start-codex-signal-watch.mts' \
  -o -name 'new-project.sh' -o -path './.claude/*' \
  -o -name '.blueprint-source' \) | head -20

# That find should return NOTHING. If it lists anything — stop, the
# allowlist let something private through, debug before continuing.

# Manually inspect the tree:
ls -A
git status

# First commit:
git add -A
git commit -m "Initial public release"

# Push to a NEW public GitHub repo (create the empty repo on GitHub
# first, then add it as the remote here):
git remote add origin git@github.com:<your-github-username>/<your-project>.git
git push -u origin main
```

The private dev repo at `$SRC` stays untouched and remains the
daily-development home. After the initial public push, ongoing public
updates are done by repeating the allowlist copy + commit + push in
`$DEST`.

### 3b. In-place untrack with `git rm --cached`

Drop private files from the index of the existing repo, keep them on
disk for local agent use. The bootstrap commit history still shows the
files **existed at bootstrap as templates**, but going forward they are
not in the index and not in subsequent commits.

The command list MUST match the §1b preflight pattern exactly,
otherwise the verification will print `index clean` while still leaking
something. If you add a new private file kind, update both lists in
the same commit.

```bash
cd "$(git rev-parse --show-toplevel)"

# Untrack ONLY the private files (keeps them on disk).
# docs/ lifecycle artifacts stay tracked and public, and since TASK-048 so do
# CLAUDE.md, AGENTS.md, GEMINI.md, AGENT_SIGNAL.md, docs/DoD.md and docs/PUBLISHING.md —
# they are the framework's own documents. docs/doing/HANDOVER.md is tracked too,
# so it is NOT untracked here — it is redacted in place below instead. Do not
# expect §3a's scrub to cover you: that is a step of the fresh-repo flow and it
# does not run on this path.
#
# All FIVE project_config_*.md, not three: A-27 added security and infra, which
# hold the threat model and the infra account IDs. This list said three for long
# enough to be worth naming — untracking "only the private files" while leaving
# the two most sensitive ones in the index is the failure it exists to prevent.
git rm --cached \
  $(git ls-files 'docs/**/CODEX_REVIEW.md') \
  project_config_overview.md project_config_paths.md project_config_dod.md \
  project_config_security.md project_config_infra.md \
  scripts/signal-watch.mts scripts/start-codex-signal-watch.mts scripts/new-project.sh \
  $(git ls-files '.claude/**' 2>/dev/null) \
  .blueprint-source

# Confirm index is now clean — the pattern MUST stay identical to §1b's:
git ls-files | grep -E '^(docs/.+/CODEX_REVIEW\.md|project_config_.*\.md|scripts/(signal-watch|start-codex-signal-watch|new-project)\.sh|\.claude/.*|\.blueprint-source)$' && echo "STILL TRACKED" || echo "index clean"

# Redact the live handover IN THIS REPO — §3b publishes this repo's own
# index, so whatever the file holds is what strangers read. Restore
# docs/doing/HANDOVER.md to the shipped stub: §2 WIP and §3 gotchas back to
# their placeholders, no in-flight work, no persona names, no review state.
# Keep the live notes untracked (.scratch/) until the push is done.
git add docs/doing/HANDOVER.md

# Gate — §2 WIP still carries its placeholder, so no in-flight work is
# described. It checks the section that names the work, NOT every line:
# §4's marker grep and your own read of the diff still apply.
grep -q '^\*(Nothing yet\.' docs/doing/HANDOVER.md && echo "handover redacted" || echo "HANDOVER STILL LIVE — DO NOT PUSH"

# Only once BOTH checks print clean: commit "private: untrack methodology"
# (the redacted handover included) and push.
```

**The permitted route is the gate, not the intent.** §3b hands the public
remote this repository's index as it stands, so a tracked handover with
content in it is a published handover — there is no publish-time step between
the two to save you. If the project needs a live, continuously-updated
handover on disk while still publishing, use **§3a**: only the fresh-repo flow
can keep the file tracked here and absent there. §3b's price for staying
in-place is that the handover stays a stub between pushes.

Caveat: prior history still has the bootstrap commit. Anyone fetching
your public repo can `git log --all` and see those file paths. Safer
to scrub history with `git filter-repo` (see §7) if that matters, or
just use §3a from the start.

### 3c. Continue with current history (NOT RECOMMENDED)

Push the current repo to the public remote with full history. Leaks the
bootstrap commit's methodology file list. Only consider this if you
have personally read every commit in `git log -p` and confirmed all
historical content is acceptable. For a fresh-bootstrap project with
template-only methodology content, this might be acceptable — but the
stated requirement is "without leaking AI configurations", which the
path names themselves are.

For the stated requirement, **option 3a is the right call**.

## 4. Before every push to the public remote

```bash
git status --ignored
git diff --cached
git diff
git log origin/main..HEAD
```

Look at every changed file in `git diff`. If any line mentions:

- Personal names (yours, customers, employers)
- Customer URLs, customer-data slugs, real-fixture content
- API keys, tokens, cookies (`.env` is gitignored — this is defense in
  depth)
- Struct2flow methodology hints (`OVER_TO_CODEX`, `radio over`,
  `CODEX_REVIEW`, `HANDOVER.md`)

**stop and remove it** before pushing.

## 5. Periodic audit (monthly or after major changes)

```bash
# 1. Scan tracked content for personal markers (same as step 2).
# 2. Re-read .gitignore — does it still cover everything personal?
# 3. Check the public remote in a browser; clone it fresh; verify the
#    fresh clone has no personal content.
git clone <public-remote-url> /tmp/pubclone-check
ls -la /tmp/pubclone-check
# Should NOT see: docs/doing/HANDOVER.md, docs/**/CODEX_REVIEW.md,
# project_config_*.md, .claude/, .blueprint-source.
# SHOULD see: src/, tests/, README.md, package.json (or your stack's
# equivalent), config/<name>.example.* files — and, since TASK-048,
# CLAUDE.md, AGENTS.md, GEMINI.md, AGENT_SIGNAL.md, docs/DoD.md and
# docs/PUBLISHING.md. Their ABSENCE from a fresh clone is now the
# finding, not their presence.
```

## 6. Adding new private content

When you add a new kind of personal file (a new config, a new fixture
type, a new methodology doc), update `.gitignore` **in the same commit**
that adds the file. Never let a private file exist tracked even for one
commit — git history is forever.

The structured way:

1. Add the file path to `.gitignore` first.
2. `git status --ignored` to confirm the file is recognized as ignored.
3. Create / edit the file.
4. `git status` — should show no changes to that file.

## 7. If you accidentally commit personal content

```bash
# If only in working tree — easy:
git rm --cached <path>
echo '<path>' >> .gitignore
git commit -m "private: gitignore <path>"

# If already pushed to the public remote — hard:
# Use git-filter-repo to scrub history. NOT git filter-branch.
git filter-repo --path <path> --invert-paths
git push --force-with-lease public main
# Force-push is destructive. Coordinate with anyone else who has cloned
# the public repo. Consider just deleting the public repo and re-pushing
# from a fresh option-3a tree if the leak is bad enough.
```

## 8. Final sanity check before declaring publish-ready

```bash
# From the project root:
ls -A     # should NOT show: project_config_*.md, .blueprint-source
cat README.md | grep -i 'struct2flow\|codex\|radio over'  # should return nothing
```

If all checks pass, the repo is publish-ready.
