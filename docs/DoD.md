# Definition of Done (DoD)

The quality bar and handoff contract for every agent on a struct2flow project.
§1–§6 are the rules, and §7 is what you walk before flipping the mic. A rule
marked *judgement* is checked by no mechanism, and nothing claims it is.

Project-specific extensions live in `project_config_dod.md`. This file is the
generic protocol, and a pull replaces it whole.

## §1 Lifecycle (parked + three founder-gated states)

```
docs/backlog/  →  docs/doing/  →  docs/waiting-acceptance/  →  docs/done/
                               (landed on main, CI green)    (founder accepts)
```

| State | What lives here | How items leave |
|---|---|---|
| `backlog/` | **Parked** work. Category is `KEEP`, `DEFER`, or `OBSOLETE`; every non-`OBSOLETE` row carries a re-open trigger. **Enforced by: `tests/lifecycle-docs` "TASK-070: every parked BACKLOG row has a valid Category marker and non-OBSOLETE rows have a re-open trigger".** | **Promotion** into `doing/`, or **cancellation**: delete the row and leave a one-line pointer in `docs/config/findings.md`. |
| `doing/` | Active work: `BUGS.md` and `BACKLOG.md` rows, `PLAN-*.md`, multi-file item folders, `HANDOVER.md`. | Its work is on `main` and CI is green. A plan with open slices stays, with its shipped slices marked DONE. |
| `waiting-acceptance/` | Landed work awaiting the founder's acceptance test. | The founder accepts it ("BUG-0XX is done", "accept item Y"). |
| `done/` | Founder-accepted work: the record of what was delivered, not merely merged. | Items don't leave. |

- **Reopen:** a rejected acceptance, a regression or a rework request moves the
  row back to `doing/` in the same turn.
- `waiting-acceptance/` is the only path into `done/`, and only the founder's
  acceptance moves anything there.
- **Someday / maybe** lives in `backlog/`; work starting this session or the next
  lives in `doing/`. A founder-led grooming pass moves items between them.
- **An item that needs more than one file gets a folder** named for it
  (`BUG-XXX-<slug>`, `SPIKE-XX-<NAME>`), and the folder travels with the row.
  Spike and prototype code never lives under production `src/`: a promoted arm is
  re-implemented there, not moved.

## §1b Work intake — the path every change takes

1. **All work refers to a backlog item** — a `TASK-`, `FEATURE-` or `BUG-` number
   with a row, including a defect found mid-session. A cancelled item's pointer
   in `docs/config/findings.md` is its record. *Checked by the gate, and by CI
   over every commit of a push.*
2. **A new item's row lands in `doing/` with its first work commit.** There is no
   separate filing or promotion commit (founder, 2026-09-16).
3. **One item per commit.** The subject starts with the item (`BUG#20:`,
   `FEATURE#3:`, `TASK#1:`), which `.githooks/commit-msg` enforces and CI
   checks for every commit of a push. A commit
   serving two items is two commits; the hook reads only the subject, so that
   part is yours. The body says *why*, since the diff already says what.
4. **Cross-provider review for major bugs, core-path changes and new features**
   (founder, 2026-09-17). An agent of the other provider reviews the named
   commits (§7F). Other items need no review. *Judgement.*

   **A finding becomes work only if it is real and practical:** it was observed
   (in a real run, project or incident), or it sits on a core path with a trigger
   someone would realistically hit. Anything else is one "known limit" line on
   the item and costs nothing more: no reproducer, no mutant, no re-review. The
   implementer applies this filter to every finding; a reviewer's "push after
   these fixes" is input, not an order (founder, 2026-09-16).
5. **All local gates green** (§4). Do not use `--no-verify`; Git records no
   attestation that a local hook ran, so this instruction is operational, not a
   detectable fact. CI independently re-runs the covered committed-content
   checks and gates `released`; §4 states the exact boundary and residual.
6. **Land it.** A maintainer pushes to `main`: trunk-based, no branches. An
   external contribution, such as a derived project asking the blueprint for a
   change, is a pull request, which `blueprint a2bp` files; there, landing is
   the merge.
7. **Landing moves the row to `waiting-acceptance/`**, once CI is green and never
   before the push. Confirmed moves ride in the next ordinary work commit or
   lifecycle pass; there is no separate commit per item.
8. **Artefacts travel with their parent item** — plan, reviews, mockups, spike
   code — in the same commit as the row. `tests/lifecycle-docs` #3 fails a push
   that leaves a folder behind.

## §1c Lifecycle management pass (`lcm`)

When the founder says `lcm`, reconcile the folders with reality:

1. Each item sits in the folder for its true state, with its plan or folder
   beside it.
2. The live baton's `Task` claims nothing that `ls docs/waiting-acceptance/`
   does not show.
3. `done/` holds only founder-accepted work.
4. The lifecycle documents say something true. Do not narrate status the folders
   already answer; where a second record is wanted, a test holds the two together
   (`tests/lifecycle-docs`, `tests/doc-links`).

The pass makes the non-gated moves itself (`doing/`↔`backlog/`, landed work to
`waiting-acceptance/`) and only surfaces the gated ones (acceptance, reopen).

## §2 Bug management

Every bug, minor or major:

1. **Sequential numbering**: `BUG-001`, `BUG-002`, … Numbers are never reused.
2. **One row in a `docs/{state}/BUGS.md`** matching the lifecycle (§1).
   The bug exists in exactly **one** of the BUGS.md files at any time.
   A defect-shaped change (something the founder would call broken) is a
   `BUG-` row, never a backlog row: `BUGS.md` is what the founder tests.
3. **A regression test names the bug**: `it('BUG-007: <one-line summary>', …)`.
   The bug number must be in the test's **title** — a comment mentioning it does
   not count (BUG-139). *Checked by the gate and by CI*, over the roots
   `project_config_paths.md` declares as `BP_TEST_ROOTS` (default `tests/`):
   - on the root `tests/vitest.config.ts` itself governs (the shipped
     `tests/`), only a `*.spec.ts` or `*.spec.tsx` counts, because that config
     is what runs it. On a project's own declared root elsewhere, its
     `.js`/`.jsx`/`.mjs`/`.cjs` spec forms count too (BUG-147) — that root
     runs on the project's OWN test runner, which `tests/vitest.config.ts` was
     never going to execute either way. Prose and the retired `*.test.*` form
     never count, on any root;
   - `docs/`, `.git/`, `scripts/` and `.githooks/` never count, nor does a root
     inside or containing one, and a root must resolve inside the project;
   - outside the blueprint, only the top level of `tests/` counts, because its
     subdirectories are shipped suites. Declare a root of your own, such as
     `e2e/`.
   - a bug that genuinely has no test — it does not reproduce, or similar —
     carries `**No regression test:** <reason>` on its own row instead, and the
     reason must be non-empty.

   A parked bug needs no test yet.
4. **A row states whether §3.1's reproducer-first pattern applies to it**:
   `**Reproducer: required.**` or `**Reproducer: not applicable — <reason>.**`,
   on the row itself. Whether a bug is the "product or runtime bug" §3.1 scopes
   the two-commit pattern to is judgement — a checker that infers it from
   touched files, labels or prose is the shape `findings.md` F-002 names, not a
   control. This follows BUG-139: turn the judgement call into data ON the row
   instead of asking anything to guess it. A missing field is an unjudged row,
   not a default either way.
5. **No recurring bugs**: a bug that comes back means its regression test was
   wrong, not "refile it".

**Minor vs major**:
- **Minor bug** (cosmetic, clearly scoped, low-impact) → fix directly.
- **Major bug** (affects a core USP path defined in
  `project_config_overview.md`, or has already had a failed fix attempt) →
  **plan first**, do NOT jump to implementation. Create
  `docs/doing/PLAN-BUG-XXX.md` with root cause analysis, affected files,
  fix approach, tests needed, rollback strategy. **Wait for Codex +
  Claude Code consensus** before implementing.

## §3 Tests

1. **Reproducer first for product bugs.** A product or runtime bug fix lands as
   two commits, `BUG#XX: minimal reproducer (failing)` and then `BUG#XX: <fix>`.
   The reproducer fails before the fix, and `git log` is the evidence. Whether
   the pattern applies to a given bug is *judgement*, recorded on the row's
   `Reproducer:` field (§2 rule 4) rather than inferred. Once a row declares
   `required`, the git-log order for it is checked — enforced by:
   `tests/reproducer-order` "#13 THE REAL RANGE — no BUG-NNN commit this push
   introduces lands without its declared reproducer".
2. **Determinism.** The project names its non-deterministic stages in
   `project_config_dod.md`. Everything downstream of them is tested without
   calling them, from captured fixtures with provenance metadata.
3. **Test layers.** One convention, `*.spec.ts` and `*.spec.tsx` (a JSX spec is
   the same TypeScript spec), in `src/` and `tests/` alike:

   | Layer | Where | Runs in |
   |---|---|---|
   | Unit | `*.spec.ts`, next to its source file | pre-push |
   | Integration / wire | `*.integration.spec.ts`, near its subject | pre-push |
   | Component (JSX) | `*.spec.tsx`, next to its source file | pre-push |
   | Data snapshot | `*.snap.spec.ts`, at the top of `tests/` | pre-push |
   | Pixel snapshot | project-defined | manual + CI |
   | E2E / acceptance | `tests/e2e/` in the blueprint; a declared root such as `e2e/` in a project | CI |

   Shared helpers, mocks and fixtures live in `tests/helpers/`. The runner's
   `include` names both spellings, and a layering lint such as
   `eslint-plugin-boundaries` exempts spec files.
4. **Snapshots are approval-based.** Approve locally, commit, review the diff.
   CI never runs with `-u` / `--update-snapshots`.
5. **Coverage thresholds are the project's**, declared in `project_config_dod.md`
   and enforced by its own test runner.
6. **An expensive suite is release tier:** named `*.release.spec.ts`, it runs in
   CI only, which gates the `released` branch projects pull. `tests/manifest`
   fails the push if CI stops running any suite or the gate any other. A cheap
   suite belongs in the gate.
7. **A check that cannot judge this project skips out loud**, printing
   `SKIP-NOTE: <case>: <reason>` via `skipVisibly` / `skipNote` in
   `tests/helpers/project-config.ts`. A bare `ctx.skip` reads as a pass —
   enforced by: tests/manifest "#live no runner under tests/ calls a bare skip — every skip states why".

## §4 Pre-push gate

`.githooks/pre-push` blocks a push when any stage fails, and prints every stage
with its duration and skip reason. It binds only a checkout whose
`core.hooksPath` is `.githooks`: `arm_gate` sets that from the feed and from
`blueprint drift`, and reports it on every run.

Git does not record whether that hook ran, so neither CI nor repository history
can detect a `--no-verify` bypass. The observable backstop in this repository is
that CI re-runs the covered committed-content checks on the pushed revision, and
`.github/workflows/security.yml` advances `released` only after `secret-scan`,
`sast`, `sca`, `commit-subjects`, and `ts-tests` are green. A bypassed push can
therefore land on `main`, but cannot fan out to derived projects, which pull
`released`. Every local stage relied on by that backstop has a CI counterpart —
enforced by: `tests/gate-ci-parity` "TASK-078: every local gate stage relied on
as a CI backstop has a CI counterpart". The check is directional: CI may be
stricter, and currently adds Semgrep's `p/javascript` and `p/typescript` packs
to the local `p/owasp-top-ten` pack.

The residual is explicit. CI does not re-run the local `settings.json` host-path
guard or two `dod-gate.mts` stages: `§7G` reads the untracked live baton, and
`§D·F·H` only prints judgement prompts. The backend, frontend, and IaC stages
are also dormant in this repository because those trees do not exist. Thus “CI
catches it” covers the security and committed-content checks named above, not
the whole local gate. The direction is consistent with the BUG-005 founder
decision of 2026-08-02: local coverage must not be silently demoted to CI-only;
any exception or deeper CI-only coverage is named and reviewable.

- **Never `--no-verify`** unless the founder asks. This cannot be inferred from
  Git history; the CI/`released` mechanism above contains the observable
  outcome. After pushing, watch CI, and fix a red run before moving on.
- **Lint warnings are ratcheted:** never loosen `--max-warnings` without a stated
  reason. ESLint and Prettier `--check` both block, and CI never rewrites files.
- **Project guards go after the `BLUEPRINT:END` marker** in
  `.githooks/pre-push-project`. The region between the markers is the
  blueprint's and a pull replaces it, so an edit there goes upstream with
  `blueprint a2bp`.
- **A ShellCheck finding is fixed, or disabled inline with a reason.** The
  severity is never lowered.
- **A tool the suites need goes in `scripts/install-toolchain.sh`**, which
  provisions CI and every developer machine alike.
- **Host-specific permission entries go in `.claude/settings.local.json`**, and a
  project's shared rules in `.claude/settings.project.json`. The gate refuses a
  committed `settings.json` that carries a home path.

## §5 Documentation in sync

- **A user-facing change** (a user can see, click or read it) updates every file
  in the project's doc-sync list, `project_config_dod.md` §"Doc-sync list", in
  the same commit as the code. `README.md` is on that list by default: if a
  visitor would notice the change, the README moves with it. Release notes are
  append-only. *Judgement* — which files belong on the list, and whether a
  given change touches one, stays a human call. What is not judgement is
  whether a listed row names a real surface: every non-`N/A` path on the list
  is checked against the tree (enforced by: `tests/doc-links` "THE REAL TREE
  — every path named in the doc-sync list exists").
- **A code-state change moves the internal artefact that describes it**, in the
  same commit: a fixed review finding gets `Status: Fixed` in
  `docs/config/findings.md`, not just its row; a new trust boundary gets its
  threat-model entry before the route ships. *Judgement — except that every
  finding carries a `Status:` line at all, and that `Deferred`/`Accepted`
  values carry the date/sign-off `docs/config/findings.md` §"Status schema"
  requires, which is not: enforced by: `tests/lifecycle-docs` "TASK-074:
  findingsMissingValidStatus flags a missing line, an undated Deferred, and a
  bare Accepted" and its `#live` counterpart over the real register.*
- **A rule change updates every document that restates the rule**, in the same
  commit. *Judgement.*
- **Project user-surface rules** (localization parity, no internal customer
  names on public pages, head invariants) live in `project_config_dod.md`
  §"User-surface rules" and are gated like tests.

Recipes per project shape, and the per-push checklist:
[`docs/DOCUMENTATION.md`](DOCUMENTATION.md).

## §6 Quality and the engineering concerns

The quality bar is `AGENTS.md` §"Quality is non-negotiable". Each engineering
concern's capabilities are in `AGENTS.md`, and its per-push checklist is in its
recipe doc: [`OBSERVABILITY.md`](OBSERVABILITY.md), [`SECURITY.md`](SECURITY.md),
[`INFRASTRUCTURE.md`](INFRASTRUCTURE.md) and
[`DOCUMENTATION.md`](DOCUMENTATION.md). Cost is declared per billable path in
`project_config_overview.md` §"Cost stack". *Judgement*, apart from the scans the
gate runs.

## §7 Handoff checklist (walk BEFORE flipping the mic)

Shipping is checked by the gate and CI, every item's row and every BUG's test by
the gate's DoD stages and CI, and the folders by `tests/lifecycle-docs`. What remains:

- **D. Docs in sync** — a user-facing change updated the doc-sync list in the
  same commit (§5). *Judgement.*
- **E. Project gates** — every gate `project_config_dod.md` declares for this
  kind of change is met. *Judgement unless the project wired it.*
- **F. Review of a commit, never the working tree** — when §1b rule 4 requires a
  review, the handoff names the exact commits (`git log --oneline <base>..HEAD`)
  and the reviewer reads that diff. `git status --short` goes in the handoff, and
  an in-scope entry, untracked ones included, is committed or the claimed scope
  is narrowed so it does not overlap; it is not declared away. *Judgement.*
- **G. Baton and handover** — the baton is published with
  `scripts/signal-set.sh`, never hand-edited; its `Task` says what the next actor
  does; `docs/doing/HANDOVER.md` is current (§10). *The gate checks the baton is
  well-formed.*
- **H. Self-audit** — for `OVER_TO_USER`, what the founder should test is listed
  concretely; each such item is in `waiting-acceptance/`, or the `Task` says CI
  is still in flight; `git status` shows nothing half-staged. *Judgement.*

## §8 When the DoD is not the gate

Read-only turns need no DoD. An infra-only operation needs no lifecycle artefact
unless it serves an item, but the baton is still updated. Parallel work outside
the mic holder's scope owns the DoD for its own changes.

## §10 Resume continuity — `docs/doing/HANDOVER.md`

A woken prompt has none of the sleeping prompt's memory and none of its background
tasks. `docs/doing/HANDOVER.md` is the bridge: one file, overwritten in place,
kept current as work lands and committed with the work that changes what is open
(enforced by: `tests/lifecycle-docs` "TASK-071: the canonical HANDOVER.md has no HANDOVER-*.md copies").

It is a take-over brief (founder, 2026-08-05), and it holds only:

1. **WIP** — what someone picking up open work would otherwise get wrong;
2. **Ephemeral state** — running monitors and how to re-arm them, a pipeline gate
   awaiting approval: what died with the session and no command reconstructs;
3. **Live hazards** — a trap still armed, with the command that checks it.

Anything a command answers (folder counts, `git status`, what shipped) does not
belong in it. Reasoning belongs in the commit, and lessons in the item's row.

**On wake**, read `HANDOVER.md` first, then the live baton, and re-establish the
ephemeral state before continuing.
