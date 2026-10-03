# struct2flow Stack Defaults

When a project doesn't say otherwise, this is the stack. Each project's
own `project_config_overview.md` + `project_config_paths.md` may
override per surface — but state **why** in one sentence so it's a
deliberate decision, not drift.

## Architecture

- **Style:** Domain-Driven Design (DDD) + Clean Code + Clean
  Architecture. Hexagonal (ports & adapters) whenever the surface
  warrants it — i.e. anything with non-trivial external integration
  (DB, HTTP, queues, third-party APIs). Pure utilities and one-shot
  scripts don't need ports.
- **Why:** keeps the domain pure and testable, makes adapter swaps
  (DynamoDB → Mongo, REST → GraphQL, sync → event-driven) a
  bounded change instead of a rewrite, and pushes infrastructure
  concerns to the edges so the core remains framework-agnostic.
- **Layering** (inside → out): `domain` (entities, value objects,
  domain services — no framework imports) → `application`
  (use-cases / interactors orchestrating the domain) → `ports`
  (interfaces the application depends on) → `adapters`
  (infrastructure implementations of the ports — DB, HTTP, AWS
  SDK, etc.). Dependencies only point inward.
- **Override:** if a project's surface is genuinely a thin CRUD
  wrapper or a one-shot script, full hexagonal is overkill — say
  so in `project_config_overview.md` with one sentence. Default
  assumption is hexagonal.

## Backend

- **Language / runtime:** Node.js / TypeScript.
- **Compute:** AWS Lambda (serverless-first). Reach for ECS / Fargate
  only when Lambda's 15-min ceiling, cold-start, or package-size limits
  bite.

## Frontend

- **Language:** TypeScript.
- **Framework:** React or Next.js — project's choice, document in
  `project_config_overview.md`.
- **Hosting:** AWS Amplify Hosting.

## Data

- **Default:** DynamoDB (key-value / single-table design).
- **Alternative:** MongoDB — pick when the access pattern needs
  ad-hoc query + flexible secondary indexes that DynamoDB can't model
  cleanly.
- **Avoid by default:** RDS / Aurora unless the workload is genuinely
  relational and the SQL semantics are load-bearing.

## Infrastructure

- **IaC:** AWS CDK (TypeScript).
- **Cloud:** AWS.
- **Posture:** serverless-first — Lambda + DynamoDB + API Gateway +
  Amplify Hosting + EventBridge before anything that runs 24/7.

## CI / Remote repo

- **Remote git:** AWS (CodeCommit). GitHub is the fallback when a
  project needs public visibility or external contributors.
- **Pipelines:** AWS CodePipeline + CodeBuild when the repo is on
  CodeCommit; GitHub Actions when the repo is on GitHub.

## Observability

The four non-negotiable capabilities (capture, agent-query, alert,
agent-diagnose-first) are defined in AGENTS.md §"Observability is a main
concern", with its per-push checklist in the recipe doc. The mechanism is project-specific — pick one of
the three recipes in [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md):

- **AWS-hosted / serverless (default for hosted projects):** CloudWatch
  structured JSON logs + a MALT-style admin debug route
  (`/api/admin/debug/last-failures`) + CloudWatch alarms → SNS → Slack.
  Frontend errors captured via a tiny `/api/client-errors` Lambda. No
  Sentry — the agent-led triage model makes a separate error UI
  redundant; Slack covers alerting and the agent reads CloudWatch
  directly.
- **Local app / desktop / CLI:** rotating file logs under
  `~/.stash2flow/logs/` + a `--diagnose` CLI flag the agent runs +
  desktop notification + Slack webhook on crash. Used in
  `linkedin-watcher-agent`.
- **Containerized service:** JSON to stdout + the platform-native log
  aggregator (CloudWatch for ECS / Loki or Elastic for k8s / journald
  for Docker-on-VM) + an admin route wrapping the aggregator's query
  API + platform-native alarms → Slack.

Each project declares its mechanism row in `project_config_overview.md`
§"Observability stack" — that table is the agent's first stop when it
needs to diagnose a production error.

**Product analytics (separate from error observability):** Plausible,
EU-hosted, cookie-free. The agent reads usage data via the Plausible
Stats API.

## Git author identity (fresh-clone bootstrap)

**Bootstrap inherits the operator's identity from `git config`.** It does not
write one. A blueprint that bakes a specific person into every derived repo
makes any other operator commit silently under someone else's name, which is
wrong for a framework meant to be forked and shared. `new-project.sh` therefore
fails early with instructions if no identity is configured, and echoes the
identity it is about to commit as.

**But read this before bootstrapping on a work machine.** If the identity
bootstrap inherits is a work address (e.g. `*.ext@<employer>.de`), it lands in
personal project history — conflating work and personal open-source identity,
and risking corporate IP-assignment ambiguity if the repo is ever published.
Inheritance makes that the *default* outcome, so the guard is yours to apply.

**Bootstrap makes the initial commit immediately**, so there is no window to set
a repo-local identity "after bootstrap but before the first commit". You have
exactly two correct moments:

```bash
# BEST — make the personal identity the global default, once per machine.
# Then override repo-locally in WORK repos. The blast radius of forgetting is
# then a work repo with a personal email, not published personal history
# carrying an employer address.
git config --global user.name  "Your Personal Name"
git config --global user.email "you@personal.example"

# OR — override for a single bootstrap run, without touching global config:
GIT_AUTHOR_NAME="Your Personal Name"  GIT_AUTHOR_EMAIL="you@personal.example" \
GIT_COMMITTER_NAME="Your Personal Name" GIT_COMMITTER_EMAIL="you@personal.example" \
  scripts/new-project.sh my-project
```

Bootstrap prints `🖋 Committing as: …` precisely so a wrong identity is visible
at the moment it is used rather than discovered later in `git log`. If you only
notice afterwards and the bootstrap commit is still the only one:
`git commit --amend --reset-author --no-edit`.

**If commits already exist under the wrong email**, rewrite with
`git filter-branch --env-filter` (or `git filter-repo`) after
creating a backup ref. Always keep the backup ref reachable until
the founder confirms the rewrite looks right, then drop it.

**Override:** if a struct2flow project is genuinely a work
project (client engagement, employer-sanctioned), use that
employer's email — state so in
`project_config_overview.md`.

## When to override

Override is normal. The default exists so that "new project, no
constraints, pick a stack" lands the same place every time and the
founder doesn't re-decide. If a project's customer, integration
target, or workload type makes a different choice obviously better
(e.g. a Python ML project; a deeply-relational app; an existing
codebase to extend), override it and write a single-sentence rationale
in the project's `project_config_overview.md` tech-stack block.
