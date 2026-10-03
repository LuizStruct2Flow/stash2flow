# struct2flow — blueprint

[![Status: alpha](https://img.shields.io/badge/Status-alpha-orange.svg)](#status)

> **A living operating system for AI-native software development.**

One git repo that codifies how I ship software — architecture, lifecycle,
quality, observability, security, IaC — plus the persona team of AIs that operates it.
Every project I build forks from here; every lesson learned travels back
upstream so every other project inherits it.

## What makes this different from "another opinionated framework"

- **A whole AI team shares one mic.** A configurable roster of personas
  (a gitignored, per-engineer `AGENT_ROSTER.md`, copied from
  [AGENT_ROSTER.example.md](AGENT_ROSTER.example.md) the way you'd copy
  `.env.example`) — each backed by whichever agent you run: Codex, Claude Code,
  Kimi, Gemini, Copilot, Qwen — coordinates through a single live baton at
  `logs/state/signal.md` (untracked per-checkout state, written only by
  `scripts/signal-set.sh`; `AGENT_SIGNAL.md` documents the protocol):
  radio-over handoff, one mic at a time, no overwrites or duplicate work.
  Persona names keep same-type agents distinct, so two Claude Code sessions
  never answer the same handoff. The roster is the single source of that
  identity — keyed by **role**, so renaming someone is one cell — and every
  script resolves through it; `scripts/agent-activity.sh --whoami` reports who
  a session is and which roster said so. The default team is 15 personas; edit
  the roster to fit your agents and credits. See [AGENT_SIGNAL.md](AGENT_SIGNAL.md)
  for the protocol, [AGENTS.md](AGENTS.md) for the shared rules every CLI
  provider works from, and `scripts/agent-activity.sh` for a live
  `[Persona - Agent]` feed.
- **The blueprint evolves with every project.** Patterns proven in
  production travel back upstream via `blueprint a2bp`; every project —
  current *and* future — gets every improvement within the same week
  one project learned it.
- **Enforced by tooling, not memos.** Eight concerns, all gated by code:
  pre-push hooks, scripts, CI. Rules live in code, not in docs nobody
  reads.

## The eight concerns it encodes

| Concern | Where | Pre-push gate |
|---|---|---|
| **Architecture** — DDD + Clean + Hexagonal | [STACK_DEFAULTS.md](STACK_DEFAULTS.md) | — |
| **Lifecycle** — four founder-gated states | [docs/DoD.md](docs/DoD.md) §1 | — |
| **Quality** — DoD, reproducer-first bug fixes, project-declared coverage | [docs/DoD.md](docs/DoD.md) §3, §4 | build · lint · prettier · test:coverage |
| **Observability (MALT)** — Monitoring · Alerting · Logging · Tracing | [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md) | — |
| **Security** — secret-scan, SAST, SCA, IaC scan, DAST | [docs/SECURITY.md](docs/SECURITY.md) | gitleaks · semgrep · osv-scanner |
| **Infrastructure as Code** — defined, reviewable, reproducible | [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) | cdk synth / terraform / helm lint |
| **Cost** — billable paths capped, logged, alerted; backlog-replay opt-in | [AGENTS.md §"Cost is a main concern"](AGENTS.md) | — |
| **Documentation** — internal + external, same-commit rule | [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md) + [docs/DoD.md §5](docs/DoD.md) | per-project grep hints in `pre-push-project` |

## Status

This repo is a **framework / template**, not a runnable application. It
bootstraps new struct2flow projects via `scripts/new-project.sh` and
stays alive across them via two-way sync (see [The sync model](#the-sync-model)).

**Alpha.** The patterns are stable; the names may still move. The
blueprint is intentionally incomplete — it contains *only what has been
proven in production* across struct2flow's existing projects.

---

## Create a new project

```bash
~/sources/struct2flow/blueprint/scripts/new-project.sh acme-flow
```

That copies the blueprint into `~/sources/struct2flow/acme-flow/`,
substitutes `stash2flow` placeholders, initializes git, wires
the `.githooks` path, and records the blueprint commit you forked from
in `.blueprint-source`.

After bootstrap:

1. `cd ~/sources/struct2flow/acme-flow`
2. `code .` (open in VS Code)
3. `bash scripts/install-toolchain.sh` (installs `gitleaks` + `semgrep` +
   `osv-scanner` for the pre-push gate — Homebrew on macOS, pinned release
   binaries into `~/.local/bin` on Linux; add `--infra` for the IaC set, and
   `check` to report what is present without installing anything)
4. Fill out `project_config_overview.md`, `project_config_paths.md`,
   `project_config_dod.md`, `project_config_security.md`,
   `project_config_infra.md` (`AGENTS.md` lists all five: **Claude Code** and
   **Gemini** `@`-import them into every session through `CLAUDE.md` and
   `GEMINI.md`, while Codex and Kimi open them by instruction, not
   automatically)
5. Start adding code under `backend/`, `frontend/`, etc.
6. Optional: **append** your project-specific guards to
   `.githooks/pre-push-project`, **after the `BLUEPRINT:END` marker**.
   Everything between `BLUEPRINT:BEGIN` and `BLUEPRINT:END` is
   blueprint-managed and is replaced by `blueprint pull`; everything after
   `END` is yours and is preserved byte-for-byte (BUG-029). Your own test
   suites go in `tests/<suite>/` and are invoked from below that marker —
   there is no table to register them in, because `tests/manifest` derives the
   suite set from the runners on disk.
   **Do not copy the `.example` over it** — that file ships already populated,
   wiring the regression suites that guard the blueprint-managed machinery your
   project runs (`blueprint pull`/`drift`/`a2bp`, `signal-set.sh`, the feed, the
   hooks, the gate renderer). Overwriting it takes 33 suites off your push path
   in one command. `.githooks/pre-push-project.example` is a menu of guard
   *shapes* to copy from, not a replacement file (BUG-028)

---

## What's in the blueprint

```
blueprint/
├── README.md                       ← this file
├── AGENTS.md                       ← the shared agent rules all four CLI providers read
├── CLAUDE.md                       ← imports AGENTS.md; plus Claude Code's own wake and hooks
├── GEMINI.md                       ← imports AGENTS.md for Gemini
├── AGENTS.blueprint.md             ← blueprint maintenance: trunk, a2bp integration, deck (not shipped)
├── AGENT_SIGNAL.md                 ← the coordination protocol: mic, rotation, four-eyes review
├── STACK_DEFAULTS.md               ← default tech stack for new struct2flow projects
├── project_config_overview.md      ← project-specific overview (stub)
├── project_config_paths.md         ← project-specific paths / URLs (stub)
├── project_config_dod.md           ← project-specific DoD extensions (stub)
├── project_config_security.md      ← project-specific threat model + scan thresholds (stub)
├── project_config_infra.md         ← project-specific envs / state / cost ceilings / rollback (stub)
├── .gitignore                      ← generic node + agent ignores
├── .githooks/
│   ├── pre-push                    ← generic security + build/lint/format/coverage gate
│   ├── commit-msg                  ← rejects a commit that does not name its backlog item
│   ├── pre-push-project            ← managed between the BLUEPRINT markers (wires the suites); APPEND your guards after BLUEPRINT:END
│   └── pre-push-project.example    ← a menu of guard shapes to copy FROM (never over)
├── .claude/
│   └── settings.json               ← generic AWS / git / shell permission allow-list
├── scripts/
│   ├── install-toolchain.sh        ← installs the gate's tools per-OS (brew on macOS, pinned binaries on Linux)
│   ├── signal-watch.mts             ← signal poller (whole-file generic; provider-agnostic, TASK-063)
│   ├── start-codex-signal-watch.mts ← Codex CLI launcher (uses stash2flow)
│   ├── new-project.sh              ← bootstrap a new project
│   └── blueprint                   ← sync CLI: drift / pull / a2bp (add to PATH)
├── config/
│   └── README.md                   ← two-file config convention (committed *.example, gitignored *)
└── docs/
    ├── DoD.md                      ← generic Definition of Done
    ├── OBSERVABILITY.md            ← capture / retrieve / alert recipes per runtime
    ├── SECURITY.md                 ← secret-scan / SAST / SCA / DAST recipes per runtime
    ├── INFRASTRUCTURE.md           ← IaC recipes per stack (CDK / Terraform / Helm-ArgoCD)
    ├── DOCUMENTATION.md            ← doc-sync recipes (internal + external; per-project shape)
    ├── PUBLISHING.md               ← runbook for publishing a project (or part of it) publicly
    ├── backlog/
    │   ├── README.md               ← parked-state lifecycle + categories (KEEP/DEFER/OBSOLETE)
    │   ├── BACKLOG.md              ← parked rows, each with a re-open trigger
    │   └── BUGS.md                 ← stub: parked bugs awaiting re-open triggers
    ├── doing/
    │   ├── README.md
    │   └── HANDOVER.md             ← canonical resume doc (template stub)
    ├── waiting-acceptance/README.md
    ├── done/README.md
    ├── config/README.md
    ├── requirements/README.md
    └── mocks/README.md
```

---

## The sync model

Once a project is bootstrapped, the blueprint stays alive. Two sync
directions, both founder-gated through the agent and both driven by a
single CLI: **`blueprint`** (at `scripts/blueprint.mts` in this repo).

### One-time setup

Run the toolchain installer once per machine, from this repo or any project:

```bash
bash scripts/install-toolchain.sh
```

Along with the gate's tools, it writes the `blueprint` command to
`~/.local/bin/blueprint`. That command runs **the CLI of the project you are
standing in** (`scripts/blueprint.mts`), so it names no checkout and keeps working
wherever the blueprint lives or moves. It works from a project root.

It never overwrites a `blueprint` it did not write. If you have an older
hand-written wrapper, or a symlink or `PATH` entry into a blueprint checkout,
replace it once your projects read the blueprint by its address:

```bash
bash scripts/install-toolchain.sh --replace-blueprint-command --project=<a migrated project>
```

That validates the new command in that project, keeps the old one in a backup
directory, and swaps with a single rename; it prints the one-line restore.

### 1. Pull (blueprint → project)

When you improve the blueprint (anything that benefits every project),
projects pull that improvement forward.

**Wake-time check.** At the start of any session, from the project root:

```bash
blueprint drift
```

Output: which blueprint-managed files differ from the blueprint, plus
the commit log of what's changed in the blueprint since this project was
last synced (read from `.blueprint-source`). The agent surfaces a short
summary and offers to pull forward.

**Which blueprint.** `drift` and `pull` read the blueprint **by its address** —
`blueprint_remote` in `.blueprint-source`, on the branch named by
`blueprint_release_branch` (else `blueprint_branch`) — never from a folder on
your machine. A bootstrapped project reads `released`: the newest `main` commit
on which the blueprint's CI passed, which a CI job fast-forwards and nothing else
moves. Every run refreshes a per-machine cache
(`${XDG_CACHE_HOME:-~/.cache}/struct2flow/`) and compares against the tip it just
fetched, and the header names that remote, branch and full SHA. So a blueprint
checkout that is behind, or ahead with unpushed commits, no longer changes the
answer. If the remote cannot be read, `drift` exits **5** and says that nothing
was compared. To compare against a local checkout on purpose — offline, or to
preview an unpushed blueprint change — export `BLUEPRINT_ROOT=<checkout>` for
that shell; the report then labels itself `LOCAL CHECKOUT … (BLUEPRINT_ROOT
override)`. `blueprint_source` is no longer read, and a leftover line is warned
about on every run until you delete it.

```bash
blueprint pull                    # interactive: per-file y/n/quit
blueprint pull docs/DoD.md        # pull a single file
blueprint pull --yes              # skip the per-file prompt (pull everything drifted)
```

A full `pull` records the full SHA of the commit it fetched and applied as
`bootstrap_sha`, so the next `drift` call shows the project as up-to-date. A
pull of named files leaves it alone, because the project is not synced to that
commit yet.
Review with `git diff` and commit in the project repo.

### 2. Push (project → blueprint) — `blueprint a2bp`

When you improve one of the blueprint-managed files in a project (e.g.
tightening a DoD rule, fixing a bug in the dispatcher script), copy the
change back to the blueprint:

```bash
blueprint a2bp docs/DoD.md scripts/signal-watch.mts
```

`a2bp` (apply-to-blueprint) **files a request**: it pushes a branch to the
blueprint's remote and opens a pull request. It writes into no working tree —
not yours, not the blueprint's — and it lands nothing. The blueprint
owner reads the request and implements it upstream: merging as-is, adapting, or
rewriting.

That is a statement about **what `a2bp` does**, not a wall around the blueprint.
Filing a request needs push access to the blueprint remote, so in the usual
same-owner setup a derived project's agent *could* push to `main` directly by
running plain `git` instead of `a2bp`. The request flow is a discipline the
command implements; making it a boundary needs a separate, narrower credential
(or a fork). See `project_config_paths.md` §"Back-propagation trust boundary".

It requires `config_version = 2` in `.blueprint-source`, naming
`blueprint_remote` and `blueprint_branch`; a version 1 config refuses and prints
the lines to add. Requests are always filed against `blueprint_branch` —
`blueprint_release_branch` only changes what `drift` and `pull` read. The remote is never inferred from a local checkout's `origin`,
because that would be right often enough to be trusted and silently wrong for
anyone tracking a fork.

`blueprint a2bp --dry-run <file>` resolves the base and shows the diff without
pushing. `blueprint prs` shows what is currently asked of the owner — and says
the list is *incomplete* if the API call fails, rather than printing an empty one
that reads as "nothing pending".

It does **not** currently surface pushed branches that have no PR, though this
paragraph used to claim it did. Observed 2026-07-31 from linkedin-watcher-agent: <!-- a2bp-allow: incident record naming the reporting project, not a live path -->
`a2bp` pushed `a2bp/<project>/<hash>`, printed `✓ request already open: null`,
and exited 3 ("filed") without ever creating a PR; `blueprint prs` then reported
`No open a2bp requests` — precisely the branch-without-PR state the sentence
promised to catch. Both halves are bugs, and the dangerous one is `a2bp`'s: a
green checkmark and a "filed" exit status over a request that does not exist.
Until they are fixed, confirm a filing landed by its PR URL, not by exit code.

Filing returns a **non-zero** status on purpose: filed is not landed, and no
script may read "PR opened" as "the blueprint has this".

`a2bp` also carries files that aren't in the blueprint-managed list: a
change to a file the blueprint does not ship (`templates/`, a blueprint-only
doc), or a new file. They go through the same guard and PR, and are marked
**not shipped** so the reviewer sees no project will receive them. If a file
*should* ship, the request is also a change to the blueprint's `.gitattributes`,
which decides what ships. Before contacting the remote, `a2bp` refuses anything inside
`.git`, a root `project_config_*.md` in any letter case, a symlink or a path under
one, a file named like
a secret (`.env`, `*.pem`, `*.key`, `id_rsa*`, …), and any file in which `gitleaks`
finds a secret. Once it has fetched the base, and before pushing anything, it
refuses an unmanaged file your project gitignores (tracked or not), because the
managed set is what that base ships. It also refuses a new path that differs from a blueprint path
only by letter case. And it refuses when `gitleaks` is missing or cannot run:
filing would publish bytes nothing scanned, and a later CI scan cannot
un-disclose them.

**The contamination guard.** It used to `cp` into the blueprint working tree,
which is how both BUG-002 and A-09 entered. That write path is gone, and the
guard that was added afterwards still runs — restoring `stash2flow` on the
lines a positional diff against the **fetched base** proves unchanged, then
scanning **every** staged line for host home paths, literal per-project state
dirs, and any project name that survived. Findings **stop the request**.

It is advisory with respect to the blueprint — a person decides what lands now —
and that is why there is **no `--force`**: the reviewer is the override. A
finding is fixed, or marked with a justified `a2bp-allow: <why>`. The promise is
narrow on purpose: on the default path a recognized finding cannot be filed. It
does not claim contamination is impossible; the scan is heuristic, and
`a2bp-allow` lets things through by design.

The restore is deliberately alignment-based rather than a search-and-replace:
`pull` substitutes an unambiguous token, but reversing would rewrite a bare
word that also appears in prose — for a project named `blueprint`, every
occurrence. Lines you edited are therefore left alone, and if one still
carries the project name the guard blocks so you can write the placeholder
explicitly. Mark a known-benign line with an inline `a2bp-allow: <why>` comment;
the justification is required.

Every staged line is scanned, including lines identical to the base — the
alignment-derived exemption was removed because it was the one path by which a
misattributed line could wave contamination through. The cost is real and
accepted: a project named after a common word blocks on its own generic prose.

One constraint the request flow adds: the branch carries your project's name, and
the name is never slugged into something valid, because a slug that differs from
the real name destroys the provenance the branch exists to carry. A project whose
directory basename cannot be a git ref component (`foo\bar`, `x*y`) can file no
request, and is told so explicitly.

### What's managed and what isn't

Nobody keeps a list. The managed set is **derived**: every file the blueprint's
`git archive HEAD` ships, minus the project-owned seeds (TASK-021). So bootstrap
and pull deliver the same set by construction, and `.gitattributes` alone
decides what ships. Run `blueprint files` to print it. Current contents include:

- **Top-level:** `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `AGENT_SIGNAL.md`,
  `STACK_DEFAULTS.md`
- **`docs/` (canonical references):** `DoD.md`, `OBSERVABILITY.md`,
  `SECURITY.md`, `INFRASTRUCTURE.md`, `PUBLISHING.md`
- **`scripts/`:** `install-toolchain.sh`, `signal-watch.mts`,
  `start-codex-signal-watch.mts`, `blueprint` itself
- **`tests/`** — every suite the archive ships (BUG-029). The regression suites guard blueprint-managed machinery your
  project runs, so they have to move forward with it. The blueprint's own
  TypeScript harness manifest lives here too and is `export-ignore`d, so it
  reaches no project until the migration ships it. Files the blueprint ships
  are created and updated
- **Retirement** — a full `blueprint pull` offers to delete a file the
  blueprint used to ship and no longer does, but only when your copy is
  byte-identical to a version it shipped. An edited copy is reported as yours
  and kept. The candidates come from the blueprint's history, so the order you
  pulled in does not matter
- **`.githooks/`:** `pre-push`, `commit-msg`,
  `pre-push-project.example`, and `pre-push-project` **between its
  `BLUEPRINT:BEGIN`/`END` markers** (it wires the suites, so it must travel
  with them; the region after `END` stays yours)
- **`.claude/`:** `settings.json`, landed by pull as the blueprint's file with the
  project's `.claude/settings.project.json` permission lists merged in (the
  blueprint's `ask`/`deny` always win; host-specific bits live in
  `settings.local.json`, gitignored)
- **Folder skeleton READMEs:** every `README.md` under `docs/` and `config/`

**Project-owned (never synced):**
- `.claude/settings.project.json`: this project's own Claude Code permission
  rules (`permissions.allow`/`ask`/`deny`/`additionalDirectories` only). Pull
  merges it into `settings.json` and never writes it. A project `allow` that a
  blueprint `ask` or `deny` names is dropped. A project whose `settings.json`
  already carries its own rules gets one refused pull, which prints them as this
  file, ready to review and save (TASK-042). `.claude/` is gitignored on purpose,
  so add it with `git add -f`, as for `settings.json`.
- The five `project_config_*.md` files (`overview`, `paths`, `dod`,
  `security`, `infra`) — these are *templates* seeded once at bootstrap
  and then evolve with the project
- `.githooks/pre-push-project` **after `BLUEPRINT:END`** — the top of the file
  is managed (see above); everything you append below the end marker is yours
  and survives every pull. It used to be excluded wholesale, which was right
  about the bottom and wrong about the top: the blueprint kept adding suites
  that no derived gate could invoke (BUG-029)
- `docs/doing/HANDOVER.md`, `docs/backlog/BACKLOG.md`, `docs/backlog/BUGS.md` —
  seeded from `templates/` at bootstrap (the blueprint's own copies hold its
  real work and are export-ignore'd), then evolve session-by-session
- Everything under `backend/`, `frontend/`, `infra/`, `docs/doing/`,
  `docs/waiting-acceptance/`, `docs/done/`, `docs/backlog/`,
  `docs/config/`, `docs/mocks/`, `docs/requirements/`

---

## Placeholder convention

The blueprint uses `stash2flow` and `{{YYYY-MM-DD}}` placeholders.
`new-project.sh` substitutes them on bootstrap. If you add a new
placeholder, document it here AND extend the substitution loop in
`scripts/new-project.sh`.

Current placeholders:
- `stash2flow` — kebab-case project name, used in `~/.{{NAME}}/`
  log paths and protocol preambles.
- `{{YYYY-MM-DD}}` — today's date, used in `HANDOVER.md` "Last updated"
  lines.
- `{{REPO_PATH}}` — absolute path to the project root, used in
  `AGENTS.md` example invocations. (Currently left as a placeholder
  string; the agent fills it on first session.)

---

## Editing the blueprint

### Founder workflow (direct commits)

The blueprint is itself a git repo. I commit directly on `main` with
descriptive messages. To roll forward improvements into existing
projects, I work through each project's agent and let the sync model
do the pull.

Anything project-specific that leaks into a blueprint file (a
storm2flow path, a customer name, a feature flag) is a bug — moved
into the equivalent `project_config_*.md` template instead.

### Contributing (PRs welcome)

Issues and pull requests are open. Two kinds of contributions land at
different speeds:

- **Fast track** — typos, clarity fixes, missing edge cases, broken
  links, doc improvements, bug fixes in the agent scripts or the
  pre-push gate. Open a PR with a [Conventional
  Commits](https://www.conventionalcommits.org/) message
  (`BUG#20: …`, `TASK#1: …` — enforced by `.githooks/commit-msg`); CI runs the pre-push gate
  locally, so make sure `bash scripts/install-toolchain.sh` has been run
  and `.githooks/pre-push` passes before opening the PR.
- **Slower track — new capabilities or new concerns.** The blueprint
  is **derived, not designed** (`AGENTS.blueprint.md` §"The
  blueprint is derived, not designed"): capabilities are admitted
  only after they have proven themselves in a real struct2flow
  project. If you want to propose a new recipe / gate / concern,
  open an **issue first** describing where it has been used in
  production and how it survived a follow-up round of work. We can
  discuss before any code lands. This isn't to be precious about
  the surface area — it's because intentional incompleteness is
  what makes the blueprint reliable.

**Out of scope:** project-specific content (customer names, internal
URLs, feature flags) belongs in a downstream project's
`project_config_*.md`, never in a blueprint-managed file. PRs that
hard-code such content will be asked to refactor.

**Before opening a PR:**
- `bash scripts/install-toolchain.sh` to install `gitleaks` + `semgrep` +
  `osv-scanner` (Homebrew on macOS, pinned release binaries into
  `~/.local/bin` on Linux). `bash scripts/install-toolchain.sh check` tells
  you what is still missing — and a missing scanner is `pipe_skip`ped rather
  than blocking, so a green gate on an unprepared machine has checked less.
- `.githooks/pre-push` to run the full gate locally (security +
  build + lint + format + tests + IaC validate).
- For any change to [docs/DoD.md](docs/DoD.md), [AGENTS.md](AGENTS.md),
  or a recipe doc, follow `AGENTS.blueprint.md`: the deck and every other
  document that restates the rule move in the same commit.
