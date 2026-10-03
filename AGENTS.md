# Agent instructions — shared by the four CLI providers

This file is the struct2flow **generic** agent protocol, and every provider
works from it: Codex and Kimi read it natively, Claude Code through `CLAUDE.md`
and Gemini through `GEMINI.md`, which each import it (TASK-084). Project rules
belong in the files below, never in this one, because a pull replaces this file
whole.

## Read these first — this project's own configuration

Claude Code and Gemini load the files below automatically, because they follow
`@` imports. Codex, Kimi and every other agent: open each one that exists before
substantive work. A missing file is normal, because `agents.internal.md` is
optional and `AGENTS.blueprint.md` exists only in the blueprint.

- @project_config_overview.md
- @project_config_paths.md
- @project_config_dod.md
- @project_config_security.md
- @project_config_infra.md
- @agents.internal.md
- @claude.internal.md
- @AGENTS.blueprint.md

`claude.internal.md` is that file's old name, still imported for one release so
an existing copy is not orphaned: rename yours to `agents.internal.md`.

**`agents.internal.md` is the project's own file, and nothing in the blueprint
ever writes it.** It is not managed, so `blueprint pull` cannot replace it, and
no bootstrap seeds one — the import above names a file that does not exist until
the project creates it. It is the place for agent context that belongs to this
project rather than to the framework: house rules, local runbooks, notes a
session should carry that no other project should inherit. It is every
provider's, not Claude's alone.

**Whether it is tracked is the project's decision.** Commit it and the whole team
gets it; add it to `.gitignore` and it stays on one machine. Nothing in the
framework reads it or depends on the choice. This is what makes the split
possible: the generic protocol can be tracked and public, because the private
half has a home of its own.

**`AGENTS.blueprint.md` exists only in the blueprint.** It holds the rules for
maintaining the blueprint itself: its trunk, implementing a back-propagation
request, publishing the deck. It does not ship, so in a project the import is
skipped exactly as a missing `agents.internal.md` is, and this file carries only
what operates a project or asks the blueprint for a change (TASK-021).

## Agent Coordination

The agents on this project coordinate through the live baton at
`logs/state/signal.md` — untracked per-checkout state, written only by
`scripts/signal-set.sh` — the slim live "radio over" baton (Holder / State /
Task / Last update; history in `logs/state/signal-history.log`, appended on
every flip). **Do not hand-edit the baton rows** — one writer publishes the
whole baton atomically, so no poller can sample a half-written state. `Holder`
is a **persona name** from the team roster, not a bare agent type.

- **`AGENT_ROSTER.md`** — the team (who's who): each persona, its role, and its
  backing agent. **Per-engineer and gitignored, on the `.env` model**: the tracked
  template is [AGENT_ROSTER.example.md](AGENT_ROSTER.example.md); you copy it once
  (`cp AGENT_ROSTER.example.md AGENT_ROSTER.md`) and edit your copy. Each engineer
  runs a different fleet — different agents, subscriptions and quotas — so the live
  roster is neither shared nor overwritten by a blueprint sync. The `Backing agent`
  column is free text (Claude Code, Codex, Kimi, Gemini, Copilot, Qwen, …); only
  autonomous dispatch needs a matching signal watcher.
- **[AGENT_SIGNAL.md](AGENT_SIGNAL.md)** — the coordination protocol: mic states,
  the ACTIVE-on-claim rule, rotation, four-eyes review, reactivity and how each
  backing agent is dispatched. Read it before any coordinated work, and make
  both checks below before you act on it or claim the mic. Each is separate:
  passing the first does not pass the second.
  1. Its first heading must read
     "Agent Signal — the mic, rotation and four-eyes review". If it does not,
     `AGENT_SIGNAL.md` predates TASK-084: stop, tell the founder and run
     `blueprint pull AGENT_SIGNAL.md`.
  2. Its opening self-check must require `AGENTS.md`'s heading
     "Agent instructions — shared by the four CLI providers". If it does not,
     `AGENT_SIGNAL.md` predates the TASK-084 switch even when check 1 passed:
     stop, tell the founder and run `blueprint pull AGENT_SIGNAL.md`.

Watch the whole team live in one terminal: `bash scripts/agent-activity.sh --daemon`
then `tail -F logs/agent-activity.log` streams
a single `[Persona - model - effort]` feed. `bash scripts/team-kickoff.sh` runs a
round-robin kick-off to confirm the roster after editing it.

**The Orchestrator is the Claude Code session the founder talks to**; its wake is
in `CLAUDE.md` §"On wake". **Agents without Claude hooks (Codex, Gemini, Kimi)
wake by hand:** run `node scripts/blueprint.mts drift` and report a non-zero exit as
unknown, then `bash scripts/agent-activity.sh --daemon` regardless of the drift
result.

## Running commands — one per call, chains only when dependent

**One command per tool call.** Do not join independent commands with `;`, `&&`
or `||`: permission is granted per command pattern, and a compound string is
matched as one unit, which also defeats the deny list. Chain only commands that
genuinely depend on each other; a pipe qualifies. Never wrap a command until it
stops matching its allowlist entry — run it plainly and let the prompt happen,
or ask for it to be allowed.

`scripts/no-chain-guard.sh` blocks chains, including operators inside quoted
text and heredocs. Write a commit message or a snippet to `.scratch/`
(in-project and gitignored) and run or reference the file:
`git commit -F .scratch/msg`.

**Everything temporary goes in `.scratch/`, including a tooling workspace** — a
scratch clone, a worktree, a dispatch fixture. Create it with
`mktemp -d -p .scratch` and remove it when done. This used to carve out
workspaces "a tool will walk" and send them to a system temp dir, which was
wrong on both halves (TASK-064):

- **Nothing walks it.** `.scratch/` is gitignored, and the gate's scanners honour
  that — measured, not assumed: the pre-push semgrep step scans 198 files here
  and enters `.scratch/` for none of them. `gitleaks protect --staged` sees only
  the index, and `blueprint files` is `git archive`, so an untracked workspace is
  invisible to it by construction.
- **`/tmp` is where cleanup fails.** `rm -rf .scratch/*` is an allowed command
  and `rm -rf /tmp/...` is not, so an agent that follows the old advice cannot
  remove what it made and leaves litter the founder deletes by hand. That is what
  happened when a dispatcher fixture went to `mktemp -d` (2026-09-20).

**Refused by the tools, not only stated here** (founder, 2026-09-25, after
the rule was found broken by most of one session's agents):
`.claude/settings.json` denies `Edit(//tmp/**)` (every Write and Edit into
`/tmp`), Bash commands that name a `/tmp/` path, and `mktemp` without `-p`.
It binds Claude Code only. Codex, Kimi and Gemini read no Claude settings, so
for them the rule is still their brief.

`.gitignore` already said so — *"Kept INSIDE the repo so the work is visible next
to the code that prompted it, rather than hidden in a system temp dir"* — and
this file contradicted it for long enough to send an agent the wrong way.

**This governs what an AGENT creates, not the test suites.** A suite's fixture
roots are governed by its own isolation contract and stay where that contract
puts them; do not migrate them here on the strength of this rule.

## Before Every Push

The pre-push gate (`.githooks/pre-push`) blocks a failing push, and CI is the
backstop. What it expects of you — never `--no-verify`, the lint ratchet, where
project guards go — is [docs/DoD.md](docs/DoD.md) §4.

## Definition of Done — read before every handoff

[`docs/DoD.md`](docs/DoD.md) holds the lifecycle, the work-intake rules, bug
management and the handoff checklist. Walk its §7 before flipping the baton.

## Documentation Structure

```
docs/
├── DoD.md                ← Definition of Done (read before every handoff)
├── config/               ← stable reference (FEATURES.md, ACCEPTANCE_TESTS.md, findings.md)
├── backlog/              ← parked work
├── doing/                ← active work (BUGS.md, BACKLOG.md, PLAN-*.md, HANDOVER.md)
├── waiting-acceptance/   ← landed on main, awaiting founder acceptance
├── done/                 ← founder-accepted work
├── requirements/         ← cross-cutting specs referenced by several plans
└── mocks/                ← design mockups and throwaway prototypes
```

How an item moves between those folders is [docs/DoD.md](docs/DoD.md) §1, and
bug numbering, regression tests and the plan-first process for a major bug are
§2.

## Team Workflow

- Work as a team: delegate to specialized personas (backend, frontend, infra,
  QA, design). How Claude Code spawns one is `CLAUDE.md` §"Spawning personas";
  the others are dispatched through the mic (`AGENT_SIGNAL.md`)
- Use agents for all non-trivial work — even small bug fixes should be
  delegated rather than quick-fixed inline
- **Spread the work across providers — [AGENT_SIGNAL.md](AGENT_SIGNAL.md)
  §"Who does the work".** Plan review goes to all three seeking consensus. For everything else
  **the work picks the ROLE and the rotation picks the PROVIDER within it** — a
  back-end task goes to the next back-end engineer in rotation, never to another
  role because that role's turn is inconvenient. **The rotation turns per WORK
  ITEM**, so one item runs entirely on one persona, and a provider at zero quota
  leaves the rotation until it returns. **Orchestration and `git push` are the
  Claude session's alone — every provider commits its own work** (founder,
  2026-09-20), because `.githooks/commit-msg` already enforces the subject
  convention and withholding the verb enforces nothing extra. Reaching for the provider you are
  already running on is the thing this rule forbids, because that is always the
  cheapest move and always the same answer.
- **An agent ends with its work item.** Do not resume one across an item
  boundary — brief a fresh agent instead. A resumed agent drags its whole
  transcript into work it has nothing to do with, so it costs more each time
  while knowing no more about the new task, and two such agents at once is that
  cost squared.
- **Commits:** the subject starts with the item it serves (`BUG#20:`,
  `FEATURE#3:`, `TASK#1:`), one item per commit, and the body says why
  ([docs/DoD.md](docs/DoD.md) §1b rules 1 and 3). `.githooks/commit-msg` refuses
  any other subject, and CI checks every commit of a push to `main`.
- Trunk-based development: a maintainer pushes to `main` and uses feature
  toggles, not branches. An external contribution is a pull request, which for
  the blueprint is what `blueprint a2bp` files (§"Back-propagating").
- Test layers, reproducer-first bug fixes, snapshots and the release tier:
  [docs/DoD.md](docs/DoD.md) §3. Coverage thresholds are the project's, in
  `project_config_dod.md`.

## Quality is non-negotiable

This product's value is the quality of what it delivers. Therefore:

- **Quality is non-negotiable.** If a fix "works" but the approach is
  ugly, brittle, or stitched from overlapping fallbacks, it is not a
  fix — it is a deferred regression. Stop, step back, find the
  solution that belongs in the codebase.
- **Don't chase shortcuts.** Patch-on-patch stacks are a signal the
  architecture is being worked around, not fixed. When you catch
  yourself adding a third fallback layer to compensate for the second
  one compensating for the first, escalate to team + Codex for a
  clean redesign — don't keep patching.
- **Pick the most evolutionary solution.** The right solution is the
  one that the next person (or the next bug) will thank you for. It
  composes well with the existing primitives, it survives adjacent
  changes, and it removes surface area rather than adding it. Pay the
  larger up-front cost when it eliminates a class of problems —
  especially on the core USP paths named in `project_config_overview.md`.
- **Delight the customer.** Acceptance is not "the test passes" — it
  is "the founder and the customer would show this to someone else."
  That's the bar. Anything short of that is unfinished work.

When in doubt between a quick patch and a slower clean rewrite, pick
the clean rewrite. Document why in the plan file and push for team +
Codex alignment before committing.

## Observability is a main concern

Quality is how fast errors are found and fixed. Every project captures every
error path (no silent fallback, no `try/catch` that returns success); makes every
captured error agent-queryable, and the agent uses that path before asking the
founder for logs; alerts when a shipped capability fails in production; and has
the agent diagnose first, pinging a human only when it cannot resolve the problem.
The mechanism is a recipe in [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md),
declared in `project_config_overview.md` §"Observability stack".

Of the capture rule, one syntactic form is checked and the rest is judgement
(TASK-073, audit row C095): a bindingless `catch {}` under `scripts/` or
`tests/` that neither rethrows nor carries a comment of at least two words in
the block saying why swallowing is right there cannot land —
enforced by: tests/forbidden-idiom "#live no bindingless catch under scripts/ or tests/ swallows without saying why".
Whether those words are true, a bound `catch (e)` that never reads `e`, and a
catch that logs and then returns success remain review questions.

## Cost is a main concern

Every billable path (LLM, paid API, metered storage or egress) is priced, capped
and alertable **before** it is wired into a loop: a budget cap in code that halts
rather than logs; structured spend per call (`{model, input_tokens,
output_tokens, usd}`); a rising-edge alert when spend passes the cap; and backlog
replay only behind an explicit operator flag (`--catch-up`,
`--replay-since=…`), because a repaired path must never silently bill for the
backlog that piled up while it was broken. Each path is declared in
`project_config_overview.md` §"Cost stack".

## Security is a main concern

No secrets in code or git history, and a leaked one is rotated before it is
investigated. Static analysis blocks OWASP top-10 patterns at `WARNING+`, and
every suppression carries a justification naming the threat-model entry that
makes it safe. Dependencies and infrastructure are scanned on every push and
nightly. The agent triages and fixes findings itself, pulling the founder in only
for a risk-acceptance decision or a supply-chain incident. The mechanism is a
recipe in [docs/SECURITY.md](docs/SECURITY.md); the threat model and thresholds
live in `project_config_security.md`.

## Infrastructure as Code is a main concern

Everything in prod is defined in code, and a resource created out of band is
imported or deleted within the week. Every change is reviewed as its plan diff
(`cdk diff`, `terraform plan`, `helm diff`), environments are parameters of the
same code, and drift is detected nightly and resolved by codifying or reverting,
never ignored; drift open over 24 h is a `findings.md` entry. The mechanism is a
recipe in [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md); environments, cost
ceilings and rollback live in `project_config_infra.md`.

## Documentation is a main concern

Stale documentation fails silently, so keeping it in sync is a rule:
[docs/DoD.md](docs/DoD.md) §5. Recipes per project shape are in
[docs/DOCUMENTATION.md](docs/DOCUMENTATION.md), declared in
`project_config_overview.md` §"Documentation stack".

## Code Quality

- Run periodic code reviews using multiple perspectives (reuse, quality, efficiency, junior comprehension)
- Eliminate redundant DB reads — cache data in middleware, don't re-fetch
- Remove dead code: unused imports, parameters, constants, state fields
- Don't duplicate logic — extract shared helpers
- **SonarQube** audits bugs, vulnerabilities, smells and coverage: `npm run sonar`
  scans (`scripts/sonar.sh`) and `scripts/sonar-api.sh` queries the results. The
  triage workflow is in the header of `scripts/sonar.sh`; a Quality Gate `ERROR`
  blocks the handoff to the founder.

## Shell to TypeScript, organically (TASK-067)

**New code is TypeScript.** A new script, library or gate stage under
`scripts/` is `.mts` (see `scripts/tsconfig.json`), not `.sh` — no big bang
migration, but nobody adds a new shell script either.

**A shell file you must change is migrated first, whole file — never a
subcommand or a function.** The founder overruled the 2-to-1 majority that
wanted a shrink-into-a-dispatcher middle ground, on cost, in front of him
(docs/done/PLAN-TASK-067-shell-to-typescript.md §"Review synthesis"): a
one-line fix to the shell `scripts/blueprint` meant porting all 2,257 lines first, not
extracting the one function that changed. The migration is its own commit,
behaviour-identical, proven by the existing suites and by a mutant caught in
the port; the change the item actually wanted comes after, so a reviewer can
tell a port from a fix.

**A port deletes the shell file** (TASK-088, founder, 2026-10-03). The
migration moves the file's entire logic into a new `.mts` at the same stem, and
the old shell file is DELETED, not left behind as a shim or an adapter. In the
same commit every hook, allowlist entry, doc, workflow, suite and managed script
that named the old path names the `.mts`, and the tests that only pinned the
shim or the adapter go with it. Dated records keep the old path.

**A legacy shell caller is repointed without being ported** (founder ruling,
2026-10-03). A caller that is still shell is edited to name the `.mts`, and that
edit must be the ONLY change to the file. It may only:

- rename the path of a ported file (by path, or by a bare basename only one
  ported file has);
- keep its interpreter, as `node` (a bare `X` stays bare only when the `.mts`
  is executable);
- drop the line that sourced a ported library;
- call `node L.mts sub` in place of a sourced function, with its own source
  line's prefix and the environment prefix the checker's function table lists.

Anything else forces the file's port. `scripts/shell-inventory-check.mts`
verifies it: two directional canonicalisers reduce the BASE blob and the HEAD
content, and the text must be equal, so a BASE form left in HEAD fails. Each
sourced library earns one reviewed table row, landed in a mutant-tested commit
before the commit that deletes its shell file. **The renaming trap:** a caller's
row stays at its pre-edit sha, so its BASE blob is judged on every push. If a
ported `.mts` is renamed or folded into another file, every caller repointed at
it is `CHANGED` on every push until ported. Never rename or fold a ported `.mts`
while a legacy caller names it.

**One named exception: a Git hook.** TASK-088 supersedes TASK-018 §3.3 except
for this case. Git fixes a hook's name, and Node cannot run an extensionless
TypeScript file, so a ported hook keeps a two-line `exec` entry at the hook's
path (`#!/usr/bin/env bash` / `exec node "$(dirname "$0")/<hook>.mts" "$@"`),
recognised only under `.githooks/`.

**Runtime: Node's own type stripping, no flag, no dependency.** `.mts` scripts
run on an official Node build (`engines.node` in `tests/package.json`) with no
`tsx`, `ts-node`, Bun or Deno — they must run before `npm ci` installs
anything. `scripts/install-toolchain.sh` probes this as a CAPABILITY, not a
version number: a Node whose version satisfies the range can still be a
distro/vendored build with type stripping compiled out.

**Closed exceptions that stay whole shell, stated so the list cannot silently
grow:** `scripts/install-toolchain.sh` (and the libs it sources, while it
sources them), `scripts/no-chain-guard.sh`, `scripts/run-ts-suites.sh` — each
keeps the gate's toolchain-bootstrap or fail-closed-without-Node property that
a `.mts` port cannot have (TASK-018 §3.3). `.githooks/pre-push` and
`.githooks/pre-push-project` are NOT in this exception list: they are legacy
shell files like any other, and the first change that actually touches either
one migrates that WHOLE file (a Git hook keeps its two-line `exec` entry, per
the hook exception above), same as any other legacy shell file —
TASK-018 §3.3 only means the gate's ENTRY stays an entry that fails closed
without Node, not that the file's logic may migrate gradually. Everything else
is either unmigrated shell or a `.mts` port.

**Enforcement is a committed inventory, judged against a BASE it cannot
edit — not a diff heuristic, and not self-referential.** Currently **in this
blueprint only** (a derived project's own shell is its own decision; its
changes to managed scripts reach the blueprint through `a2bp`, where the gate
applies). `scripts/shell-inventory.json` lists every shell file with its git
blob sha; `scripts/shell-inventory-check.mts` reads that file at a BASE ref
the pushed range cannot have edited (locally `@{u}`/`origin/main`, in CI
`github.event.before`), never at the tip of the push itself — reading it from
the pushed tree would let one commit patch a legacy file and update its own
recorded sha in the same breath. Against that base it refuses: a shell file
neither list covers, a legacy row HEAD adds or changes, an exempt entry HEAD
grows, a legacy file whose BASE blob changed other than by the reference
rewrites above (or a hook entry), and a row removed without its file being migrated or disappearing. Wired through `scripts/run-ts-suites.sh` (exempt), never
by editing a legacy shell file to call it — that would force the migration the
rule exists to phase in gradually.

## Architecture Principles

- No hardcoded configuration — everything configurable via admin UI and stored in the project's config store
- Keep it simple — don't over-engineer
- **DRY — reuse before you add. Avoid creating unnecessary routes/endpoints,
  modals, or services when an existing one already does the job.** Before
  adding a new API route or UI surface, check whether an existing flow
  covers it. A new route is justified only when no existing path fits;
  say why in the plan. Redundant routes/surfaces are a review-blocking
  finding.
- Preserve user work where applicable; show diffs so users can see exactly what changed

## Blueprint sync (struct2flow framework)

This file, with `CLAUDE.md`, `GEMINI.md` and `AGENT_SIGNAL.md`, is sourced from
the struct2flow **blueprint** at `~/sources/struct2flow/blueprint/`.
Project-specific extensions live in the five `project_config_*.md` files at the
repo root, listed at the top of this file.

Sync is driven by a single CLI — `blueprint`. Its per-machine command is
written by `bash scripts/install-toolchain.sh` and runs the CLI of the project
you are standing in, so it names no checkout. The agent uses it directly; do
not hand-roll `diff -ru` invocations.

### Drift and pull

`blueprint drift` compares this project with the blueprint's fetched tip; every
agent runs it at wake (§"Agent Coordination"). Exit 5 means the blueprint could not be
read, which is **not** a clean report. After a non-empty `blueprint pull`
(`--yes` only when the founder asks), review with `git diff` and commit;
`.blueprint-source` is updated by the pull, never by hand.

### Back-propagating (apply-to-blueprint)

When you improve a generic rule in a blueprint-managed file, **offer to
back-propagate it** rather than committing it only here: *"This change to
`docs/DoD.md` looks generic — back-propagate it so other projects inherit it?"*
If yes:

```bash
blueprint a2bp --dry-run docs/DoD.md   # show the request, push nothing
blueprint a2bp docs/DoD.md             # file it
blueprint prs                          # what is currently asked of the blueprint owner
```

`a2bp` pushes a branch to the blueprint's remote and opens a pull request. It
lands nothing: a human merges. **Exit 3 means filed, not landed**, and no script
may read it as "the blueprint has this". It refuses what must not travel
(secrets, project config, a project name or host path left in the file) and says
why; a contamination finding is fixed, or its line marked with a justified
`a2bp-allow: <why it is safe>`. It is a convention the command implements, not a
wall: an agent with push access could bypass it
(`project_config_paths.md` §"Back-propagation trust boundary").

**Propose what has held up**: "the next two bugs in this area didn't regress",
not "it worked once". **A change is generic** if every struct2flow project would
benefit. One that names this project, a customer, a local incident or a local
path belongs in the `project_config_*.md` files, never upstream.

### What blueprint sync covers

Nobody keeps a list of synced files. The managed set is **derived**: every file
the blueprint's `git archive` ships at the commit sync reads, minus the
project-owned seeds (`TEMPLATE_FILES` in `scripts/blueprint.mts`), so bootstrap and
pull deliver the same set and `.gitattributes` alone decides what ships
(TASK-021). Run `blueprint files` to print it. If you catch
yourself adding a project-specific incident or path to a blueprint-managed
file, move it to the right `project_config_*.md` before committing.

On the blueprint's own pushes this is scanned, not just advised — enforced by:
tests/contamination-push-scan "TASK-079: a planted contaminated line fails the
pushed-diff scan, and removing it passes", via the `contamination` job in
`.github/workflows/security.yml`, which hands the pushed diff's added lines to
`scripts/lib/contamination.sh`'s own checker — for the files that ship: a path
whose `export-ignore` attribute is set reaches no project, and this repo's own
incident records quote host paths on purpose. That is after-the-fact by design
(TASK-079, founder decision 2026-09-22): once contamination lands on `main` it
publishes to every downstream project on the next `blueprint pull`, and the CI
scan detects it after the push — the release job's `needs` list is what keeps
a red result from advancing `released`. The only pre-publication stop is still
`a2bp`'s own scan at filing time.

### Your project's `.gitignore` is yours (TASK-048)

`.gitignore` is seeded at bootstrap and is **not** managed, so a
blueprint change to it reaches NEW projects only. A project bootstrapped before
2026-09-16 still excludes the framework's own documents, and every doc link into
them is dead in a clone. To adopt the change:

1. Delete these six lines from your `.gitignore`: `/CLAUDE.md`, `/AGENTS.md`,
   `/AGENT_SIGNAL.md`, `docs/DoD.md`, `docs/PUBLISHING.md`,
   `docs/doing/HANDOVER.md`.
2. Run `git status`. Some of them may already be tracked — a project that
   force-added one keeps it — so "nothing changed" here is a legitimate
   outcome and not a failure.
3. Track whatever is still untracked:

```bash
git add CLAUDE.md AGENTS.md AGENT_SIGNAL.md \
        docs/DoD.md docs/PUBLISHING.md docs/doing/HANDOVER.md
```

Keep `project_config_*.md` ignored — A-27 put the threat model and the infra
account IDs there. If your copy of any of the six has **diverged** from the
blueprint's — a locally edited `AGENTS.md`, say — tracking it publishes that
divergence: run `blueprint drift` and reconcile first, not after. And if you
publish this repo publicly, re-read `docs/PUBLISHING.md` first: its preflight
and its allowlist changed with this.

**`.claude/settings.json` is managed, but a project's own permission rules are
not lost.** Put them in `.claude/settings.project.json`: it is tracked and
project-owned, and it holds only `permissions.allow`/`ask`/`deny`/`additionalDirectories`.
`blueprint pull` lands `settings.json` as the blueprint's file with those lists
merged in, and `drift` compares that merged result. The blueprint's `ask` and
`deny` always win: a project `allow` naming one is dropped, so a rule the
blueprint tightened (BUG-118) cannot be re-allowed from a project. Never
hand-edit `settings.json` for a project rule — the next pull refuses it until
the rule moves to the project file (TASK-042).

End of the shared agent instructions.
