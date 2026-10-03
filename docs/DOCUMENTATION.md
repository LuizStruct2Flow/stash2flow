# Documentation — internal + external, in sync with reality

The principle lives in [AGENTS.md](../AGENTS.md) §"Documentation is a main
concern", and its per-push checklist closes this file. Both are
runtime-agnostic. This file holds the **recipes** — concrete patterns per
project shape so projects don't reinvent the wheel.

Pick one when you fill in `project_config_overview.md` §"Documentation
stack" and `project_config_dod.md` §"Doc-sync list".

> **Why these four capabilities aren't optional.** Stale docs are the
> silent failure mode of every otherwise-healthy project — no exception,
> no alert, just compounding embarrassment until a customer notices. The
> recipes below all deliver the same four capabilities; they just differ
> in tooling and surface area: external docs touched in the same commit
> as the user-facing change → internal artefacts moved with the state
> they describe → every document restating a rule moved with the rule
> → drift detected, not assumed away.

---

## Recipe A — Single-repo README-only (small projects, CLIs, internal tools)

Smallest surface. One repo. No separate marketing site, no help portal,
no public status page. Customers (or operators) read the README + the
release notes; that's it.

### External docs (sync list)

| File | Audience | Trigger | Sync rule |
|---|---|---|---|
| `README.md` | Customer / operator | Any user-facing change (CLI surface, install path, config) | Update in the same commit as the code |
| `docs/RELEASE-NOTES.md` | Customer / operator | Every push that ships a change | Append an entry; never edit history |
| `LICENSE` | Customer / operator | Year change, copyright-holder change | Annual review |

### Internal docs (sync list)

| File | Audience | Trigger | Sync rule |
|---|---|---|---|
| `docs/config/FEATURES.md` | Team / agent | New / removed / renamed user-visible feature | Update in the same commit as the code |
| `docs/config/findings.md` | Team / Codex review | Codex / Claude Code review finding raised or fixed | `Status: Fixed` block in the same commit as the fix |
| `docs/doing/BUGS.md` / `waiting-acceptance/BUGS.md` / `done/BUGS.md` | Team / agent | Bug numbered, fixed, founder-accepted | Lifecycle move in the same commit as the lifecycle action (DoD §1) |
| `docs/doing/HANDOVER.md` | Future-self / next session | End of any meaningful unit of work | Overwrite in place (DoD §10) |

### Mechanism

- **All docs in markdown**, in the repo. No separate platform.
- **`docs/RELEASE-NOTES.md` is append-only** — every push that ships a
  user-noticed change adds a `## YYYY-MM-DD — <one-line>` entry. CI
  rejects the push if a tracked code file changed in `backend/` or
  `frontend/` and `docs/RELEASE-NOTES.md` didn't — unless the commit
  message carries `[no-release-notes]` (per the existing release-notes
  guard pattern in `.githooks/pre-push-project.example`).
- **README is the canonical entry point** per DoD §5.

### What you don't ship

- A README that claims a feature works when the CLI flag was removed.
- A `RELEASE-NOTES.md` that skips a month's worth of pushes.
- A bug fix without a `BUGS.md` lifecycle move.

---

## Recipe B — Static-site marketing + docs (most struct2flow projects with a customer-facing app)

Customer-facing web app + a separate static site for marketing and docs.
The marketing site lives under `docs-site/` and renders via Mintlify /
Astro Starlight / Nextra / Docusaurus.

### External docs (sync list)

| File | Audience | Trigger | Sync rule |
|---|---|---|---|
| `README.md` | Visitor / future hire | Architecture / setup change | Same commit as the change |
| `docs-site/content/features/*.md` | Customer | New / changed / removed user-facing feature | Same commit as the code |
| `docs-site/content/release-notes/YYYY-MM-DD.md` | Customer | Every push that ships a user-noticed change | New file per push (or per day); never edit history |
| `docs-site/content/pricing.md` | Customer | Plan / tier / price change | Same commit as the billing code |
| `docs-site/content/changelog.md` | Customer | Same as release notes (often the public-facing view) | Generated from release-notes files; verify in CI |
| `docs-site/content/legal/privacy.md` | Customer / regulator | New data class collected, new processor, new region | Same commit as the data-collection code; legal review required |
| `docs-site/content/legal/terms.md` | Customer / regulator | Pricing / liability / dispute terms change | Same commit as the relevant product / billing change; legal review required |
| `docs-site/content/api/*.md` | Customer / integrator | API surface change (new endpoint, new field, removal) | OpenAPI spec generated from code; markdown summaries hand-curated and synced same commit |

### Internal docs (sync list)

| File | Audience | Trigger | Sync rule |
|---|---|---|---|
| `docs/config/FEATURES.md` | Team / agent | New / removed / renamed feature | Same commit |
| `docs/config/ACCEPTANCE_TESTS.md` | Team / QA | New acceptance test catalogued or retired | Same commit as the test |
| `docs/config/findings.md` | Team / Codex review | Finding raised, fixed, or accepted | `Status: Fixed` block in same commit as the fix |
| `docs/doing/PLAN-*.md` | Team / agent / Codex | Plan-driven work in flight | Lifecycle move at each stage transition (DoD §1) |
| `docs/doing/BUGS.md` etc. | Team / agent | Bug numbered, fixed, accepted | Lifecycle move (DoD §1) |
| `project_config_security.md` (threat model) | Team / agent | New trust boundary / auth surface / sensitive data class | Same commit as the route / data path |
| `project_config_infra.md` (rollback procedure, drift cadence) | Team / on-call | New prod resource | Same commit as the IaC change |
| `docs/doing/HANDOVER.md` | Future-self / next session | End of any meaningful unit of work | Overwrite in place (DoD §10) |

### Mechanism

- **`docs-site/` is generated from markdown** via the chosen platform.
  Build runs in CI; PRs include a preview deploy.
- **Public release notes are generated** from per-day markdown files,
  rendered into `docs-site/content/changelog.md` at build time. Markdown
  files are append-only.
- **OpenAPI spec is generated from code** (e.g. `zod-to-openapi`,
  `tsoa`) and committed; markdown summaries reference the spec by
  endpoint key so divergence shows up in diff.
- **Marketing-site previews** are deployed per PR (Cloudflare Pages /
  Vercel / Amplify Hosting) so the founder sees the public-facing
  delta before merge.
- **Legal-doc changes** (privacy, terms) are gated on a
  `legal-reviewed` PR label that the founder owns.

### What you don't ship

- A new public route without a `docs-site/content/features/*.md` entry.
- A pricing change without a `pricing.md` commit and a release-notes entry.
- A new data class (PII / payment / telemetry) collected without a
  matching privacy-policy clause in the same commit.
- An OpenAPI endpoint removed without the same removal in the markdown
  summary.

---

## Recipe C — Customer help portal + public status + privacy/TOS (mature SaaS)

Larger surface: a dedicated help portal (Intercom / Zendesk / Crisp), a
public status page (Statuspage / Better Uptime / self-hosted), legal
docs that may need versioning, and the marketing site from Recipe B.

### External docs (sync list)

All of Recipe B's external docs, plus:

| File / surface | Audience | Trigger | Sync rule |
|---|---|---|---|
| Help portal articles (Intercom / Zendesk) | Customer support / customer | New user-facing feature, common issue, FAQ-worthy change | Same week as the release; portal article links from the in-app help icon |
| Public status page (Statuspage / Better Uptime) | Customer | Outage, planned maintenance, post-incident summary | Real-time; tooling-driven where possible; manual editorial for postmortem |
| Legal docs (versioned `privacy-vYYYY-MM-DD.md`, `terms-vYYYY-MM-DD.md`) | Customer / regulator | Material change | Old version archived, new version added; users notified per the previous version's notification clause |
| In-app changelog UI | Customer | Every release | Generated from `release-notes/YYYY-MM-DD.md` files |
| Public roadmap (e.g. Productboard, Canny) | Customer / investor | Roadmap commitment moves status | Status update in the same week as the lifecycle move (`backlog/` → `doing/` → `waiting-acceptance/`) |

### Internal docs (sync list)

All of Recipe B's internal docs, plus:

| File | Audience | Trigger | Sync rule |
|---|---|---|---|
| `docs/architecture/ADR-*.md` (Architecture Decision Records) | Team / agent / new hire | Architectural decision taken (or reversed) | Same commit as the code change that embodies the decision; numbered ADR-NNN |
| `docs/runbooks/*.md` | On-call / agent | New on-call scenario observed; new alert fires for the first time | Same week as the alert wiring |
| `docs/done/INCIDENT-YYYY-MM-DD.md` | Team / regulator | Production incident | Within 48h of resolution (SECURITY.md §"Incident response") |
| Project-specific compliance docs (SOC 2 / ISO 27001 / GDPR DPA) | Auditor | Control change, evidence requirement | Same week as the control change; quarterly review |

### Mechanism

- **Help portal articles authored in the portal**, with a tracked
  `docs-site/content/help-index.md` listing article ID → URL → summary
  so the agent can find / reference them. Portal articles are NOT
  source-controlled, but the index is.
- **Status page is partially automated**: incidents reported via
  CLI / Slackbot when an alert fires; post-incident summaries hand-
  written within 24h.
- **Legal docs are versioned** — never edit-in-place once published;
  archive the previous version and add the new one. Users notified
  per the previous version's notification clause.
- **ADRs follow the standard 1-pager** (context / decision / consequences),
  numbered, dated. Reversed decisions reference the prior ADR.
- **Runbooks are co-located** with the alert wiring — same PR adds the
  alert + the runbook + the link from the alert payload.

### What you don't ship

- An outage that doesn't hit the public status page within 5 minutes.
- A privacy-policy change without the previous version archived and
  user notification triggered.
- An architectural decision without an ADR.
- A new alert that pages someone without a runbook URL in the alert
  payload.

---

## Cross-recipe rules (apply to all three)

These bind every project regardless of doc stack.

### Same-commit rule

If a user can **see / click / read** the change, every file in the
project's external sync list gets touched in the same commit as the
code. Not the same PR — the same commit. "I'll do docs later" is what
DoD §5 is designed to prevent.

The exception is help-portal articles and external services that can't
be commit-gated (status page, legal review). For those, the rule
softens to "same week"; the in-repo index (`docs-site/content/help-index.md`)
still moves in the same commit.

### Promotion criteria for the sync list

A document **joins the sync list** when:

1. The team has missed updating it once and someone (founder, customer,
   investor) noticed.
2. OR it's customer-facing and exists at a stable URL.
3. OR it's referenced from another sync-list file (transitive trust).

A document **leaves the sync list** when:

1. The artefact it describes no longer exists (feature deleted, route
   removed).
2. OR the document has been replaced by a better-located equivalent
   (consolidation pass).

Promotions / removals are committed as part of a doc-sync-list change
PR, not silently.

### Pre-push drift hint (mechanism-agnostic)

Same shape as the `.claude/settings.json` host-path guard or the
release-notes guard: a grep-based check in `.githooks/pre-push-project`
that fires on common drift patterns. The exact patterns are
project-specific (declared in `project_config_dod.md` §"User-surface
rules"), but the shape is:

```sh
# Example: a new file under frontend/pages/ must be referenced in FEATURES.md
NEW_PAGES=$(git diff --cached --name-only --diff-filter=A -- 'frontend/pages/*.tsx')
if [ -n "$NEW_PAGES" ]; then
  for p in $NEW_PAGES; do
    slug=$(basename "$p" .tsx)
    if ! grep -q "$slug" docs/config/FEATURES.md; then
      echo "❌ New page $p has no entry in docs/config/FEATURES.md"
      exit 1
    fi
  done
fi
```

The guard is **best-effort** — it catches obvious cases, not nuance.
For nuance, the §7.D handoff checklist is the human gate.

### Handoff-time check (per DoD §7.D)

The handoff checklist asks: *every file in the project's doc-sync list,
updated in the same commit as the code?* The agent walks the list
explicitly before flipping `OVER_TO_USER`. If a sync-list file claims
"feature X works" but the commit log shows feature X was removed, the
handoff is a lie.

---

## What you don't ship (cross-recipe)

- A user-facing change without the matching sync-list entry, period.
- A doc that quotes a flag, route, or feature that no longer exists.
- A help article whose URL 404s.
- A privacy policy that doesn't reflect the data classes the code
  actually collects (a `[SEC]` finding by definition — escalate per
  SECURITY.md §"Incident response").
- A release notes file that skips a push.
- A deck slide that states a count or a rule the code no longer has.

## Per-push checklist

Walked with the handoff (DoD §7). These are judgement: only the scans the
gate runs are checked by a mechanism.

The project's sync list lives in `project_config_dod.md` §"Doc-sync
list" as **two tables**: External (customer-facing) and Internal
(team-facing). Both tables are non-optional.

For every push that includes a **user-facing change** (a customer can
see / click / read it):

- [ ] **External sync clean** — every file in the External table
      touched in the same commit as the code. README, release notes,
      feature page, help article (or index entry), pricing,
      changelog, API docs — whichever rows apply. Same commit, not
      "same PR".
- [ ] **Privacy / TOS check** — if the change adds a new data class
      collected, a new processor, a new region, or material liability
      / pricing terms, the privacy policy / TOS gets the matching
      clause **in the same commit**, with a `legal-reviewed` label
      requested.
- [ ] **Public roadmap moves** — if the project uses one (Recipe C),
      the roadmap status (`backlog/` → `doing/` → `waiting-acceptance/`)
      is reflected publicly in the same week.

For every push that **changes code state** (regardless of user
visibility):

- [ ] **Internal sync clean** — every file in the Internal table
      affected by the change is updated in the same commit.
      `FEATURES.md`, `ACCEPTANCE_TESTS.md`, `findings.md` (with
      `Status: Fixed`), `PLAN-*.md` lifecycle move, threat-model
      entry, ADR (if architectural), runbook (if new alert).
- [ ] **`HANDOVER.md` current** — per [DoD.md](DoD.md) §10, which means **WIP, ephemeral
      state and live hazards only**. A fresh prompt reading it plus the
      lifecycle folders and `git log` can resume. If you added anything a
      command already answers, take it back out.

What you don't ship:
- A user-facing change without the matching external sync-list entry.
- A doc that quotes a flag, route, or feature that no longer exists.
- A new data class collected without a privacy clause.
