# Infrastructure as Code — defined, reviewable, reproducible

The principle lives in [AGENTS.md](../AGENTS.md) §"Infrastructure as Code
is a main concern", and its per-push checklist closes this file. Both
are runtime-agnostic. This file holds the **recipes** — concrete patterns
per IaC stack so projects don't reinvent the wheel.

Pick one when you fill in `project_config_overview.md` §"Infra stack" and
`project_config_infra.md`. Combinations are fine (e.g. an AWS-first
backend with a small Kubernetes workload for batch jobs).

> **Why these four capabilities aren't optional.** Quality of working
> software depends on the environment matching its definition. Drift
> between code and prod is the silent killer of reproducibility — and
> reproducibility is what makes "it worked in staging" meaningful. The
> recipes below all deliver the same four capabilities; they just differ
> in tooling and where state lives: define everything in code → make
> every change a reviewable diff → keep environments reproducible from
> the same source → detect drift continuously, never assume it away.

---

## Recipe A — AWS-first / CDK TypeScript (default for hosted projects)

The struct2flow default per [STACK_DEFAULTS.md](../STACK_DEFAULTS.md):
Lambda + DynamoDB + Amplify Hosting + CDK + CodePipeline.

### 1. Define — CDK in `infra/`

```
infra/
├── bin/                    # CDK app entry point (one file per region/account)
├── lib/
│   ├── stacks/             # one file per stack (api, data, frontend, observability…)
│   ├── constructs/         # reusable L3 constructs for project-specific patterns
│   └── config/             # per-env config (sizing, alarm thresholds, feature flags)
├── test/                   # snapshot tests for CDK output
├── cdk.json
└── package.json
```

One CDK app, multiple stacks. **Environments are parameters**, not
copy-pasted apps — `cdk deploy --context env=staging` selects the
config, never a second `infra-staging/` tree.

### 2. Plan — `cdk diff` in PR comments

Pre-push runs `cdk synth` to catch syntax + missing imports.

CI (CodePipeline `pr` stage) runs `cdk diff --context env=dev` against
the deployed dev stack and posts the output as a PR comment. **That
comment is the review artifact** — reviewers look at the diff, not just
the TypeScript. A PR that touches `infra/` without a `cdk diff` comment
attached is incomplete.

### 3. Apply — CodePipeline-driven, manual approval before prod

```
PR merge → CodeBuild synth → dev deploy (auto)
                          → staging deploy (auto, post-smoke)
                          → manual approval gate
                          → prod deploy
```

No local `cdk deploy --profile prod`. Ever. Prod deploys are
pipeline-only, with the manual approval token issued by the founder.
Local CDK is for `synth` / `diff` / `deploy --context env=dev` only.

### 4. Verify — post-deploy smoke + `cdk doctor`

Each stage in the pipeline runs:
- `cdk doctor` to flag CDK/CFN inconsistencies
- A project-defined smoke test against the deployed env (typically a
  health endpoint hit + a sentinel write/read through the data path)

If the smoke fails, the pipeline halts and the previous stack version
stays live. No partial rollouts.

### 5. Drift detection — nightly `cdk diff` cron

A scheduled EventBridge rule runs `cdk diff` against each env nightly.
Any non-empty diff fires the same alert pipe as MALT (SNS → Slack).
Two outcomes:
- **Codified** — the out-of-band change was legitimate (manual hotfix
  during incident); the next PR brings the change into the CDK code
  and the alert clears.
- **Reverted** — the change is wrong; revert via console *or* by
  redeploying the current CDK state, then add an alert on the same
  resource so it doesn't happen again silently.

A drift alert open for >24h is a finding logged in
`docs/config/findings.md`.

### 6. Environments — context-based, one stack class per env

`cdk.json`:
```json
{
  "context": {
    "envs": {
      "dev":     { "account": "111111111111", "region": "eu-central-1", "sizing": "small" },
      "staging": { "account": "222222222222", "region": "eu-central-1", "sizing": "small" },
      "prod":    { "account": "333333333333", "region": "eu-central-1", "sizing": "prod" }
    }
  }
}
```

New env = add one row + run the pipeline. Never a hand-crafted
"feature-branch sandbox" that diverges from this shape — spin a
short-lived ephemeral env from the same code instead.

### 7. Cost — CDK Nag + Infracost pre-deploy

CodePipeline runs **CDK Nag** (security/cost AWS Solutions checks) on
synthesized templates. Findings ≥ `WARNING` block the deploy unless
suppressed with a `// cdk-nag-suppress: <rule-id> — <justification>`
comment referencing `project_config_infra.md` §"Suppressions register".

For monthly cost delta:
- **Infracost** estimates the cost delta from `cdk diff`. Delta > the
  threshold in `project_config_infra.md` §"Cost ceilings" requires
  founder approval comment on the PR before merge.
- Stack-level CloudWatch budget alarms (declared in CDK) catch
  surprise overruns at runtime.

---

## Recipe B — Multi-cloud / portable (Terraform or Pulumi)

When the project ships into customer-managed cloud accounts, or
deliberately stays cloud-agnostic (rare for struct2flow defaults but
needed for some integrations).

### 1. Define — Terraform in `infra/` (or Pulumi)

```
infra/
├── modules/                # reusable modules (one per logical resource group)
├── envs/
│   ├── dev/                # env-specific terragrunt.hcl OR backend config
│   ├── staging/
│   └── prod/
├── shared/                 # shared providers, locals, version pins
└── README.md               # how to bootstrap remote state
```

State lives in **S3 + DynamoDB lock** (or equivalent). State is never
in git, never on a laptop. `terraform init -backend-config=…` per env.

### 2. Plan — `terraform plan` artifact in PR

Same model as Recipe A.2: CI runs `terraform plan -lock=false -no-color`
for each env and posts the output as a PR comment. The plan is the
review artifact.

For Pulumi: `pulumi preview --diff` produces the equivalent.

### 3. Apply — pipeline-driven, manual approval before prod

```
PR merge → CI plan → dev apply (auto)
                  → staging apply (auto, post-smoke)
                  → manual approval gate
                  → prod apply
```

Local `terraform apply` is forbidden against staging/prod. Dev-only.
The CI role is the only role with prod-apply IAM.

### 4. Verify — post-apply smoke

Same shape as A.4. Plus: `terraform plan` post-apply must be empty
("no changes"). If it isn't, the apply didn't converge — that's a
deploy failure.

### 5. Drift detection — nightly `terraform plan`

Scheduled job runs `terraform plan -detailed-exitcode` per env nightly.
Exit code 2 ("changes present") fires the same alert pipe. Same
codify-or-revert outcomes as A.5.

### 6. Environments — separate state per env, same modules

`envs/{dev,staging,prod}/` use the **same module versions** —
parameterized by `terraform.tfvars`. Never a divergent module per env.
If a feature is only in dev, gate it behind a tfvar flag, not a forked
module.

### 7. Cost — `infracost` + provider-native budget alarms

`infracost diff` in CI. Same threshold-in-`project_config_infra.md`
rule as Recipe A. Plus AWS Budgets / GCP Budget alerts / Azure Cost
Management notifications declared in Terraform itself.

---

## Recipe C — Kubernetes-native (Helm + ArgoCD / Flux)

For projects that deploy as containers into a managed Kubernetes
cluster (EKS / GKE / AKS / self-hosted). GitOps model: cluster state
is pulled from a git branch by ArgoCD or Flux.

### 1. Define — Helm charts + ArgoCD `Application` manifests

```
infra/
├── charts/                 # Helm charts per service
│   ├── api/
│   ├── worker/
│   └── …
├── envs/
│   ├── dev/values.yaml
│   ├── staging/values.yaml
│   └── prod/values.yaml
└── argocd/
    └── applications/       # ArgoCD Application CRDs per env per chart
```

Underlying infra (cluster, IAM, VPC) is still CDK/Terraform per
Recipe A or B — Helm only handles workload state inside the cluster.

### 2. Plan — `helm diff upgrade` + `argocd app diff`

CI runs `helm template` + `helm diff upgrade` per chart per env. The
output is posted as a PR comment. ArgoCD's own `app diff` is the
canonical apply-time diff.

### 3. Apply — GitOps; ArgoCD reconciles from the chosen branch

No `kubectl apply` / `helm install` from a laptop against staging or
prod. Ever. The flow:

```
PR merge → dev branch updated → ArgoCD dev app reconciles (auto-sync)
        → smoke passes
        → promote-to-staging PR
        → staging branch updated → ArgoCD staging app reconciles
        → manual approval gate (PR or ArgoCD UI)
        → prod branch updated → ArgoCD prod app reconciles
```

### 4. Verify — health checks + post-reconcile smoke

ArgoCD waits on `Application` health (readiness probes + custom health
checks) before reporting sync success. Project-defined smoke runs as a
post-sync hook.

### 5. Drift detection — ArgoCD reports it natively

ArgoCD's "OutOfSync" status *is* the drift detector. `OutOfSync` for
>24h on a prod app is a finding. Auto-sync ON for non-prod, auto-sync
OFF for prod (manual reconcile after explicit approval — surfaces
drift instead of silently re-applying it).

### 6. Environments — branch-per-env or kustomize overlays

Two valid layouts:
- **Branch-per-env** — `main` → prod, `staging` → staging, `dev` → dev.
  Promotion = PR from one branch to the next.
- **Single-branch + overlays** — Kustomize / Helm values overlays
  select the env. ArgoCD apps point at the same path with different
  values files.

Pick one in `project_config_infra.md`; don't mix.

### 7. Cost — `kubecost` + cluster-level budget alarms

`kubecost` runs in-cluster, attributes spend per namespace/workload.
Same `>$X/month` threshold rule as Recipes A and B. Cluster-level
budget alarms come from the underlying CDK/Terraform.

---

## Cross-recipe rules (apply to all three)

These bind every project regardless of IaC stack.

### Define-everything-in-code rule

If a resource exists in prod and is not defined in code: it's either
imported into the IaC tree **within the same week**, or it's deleted.
A "we'll codify it later" resource is a drift incident waiting to
happen.

The one exception: ephemeral resources created by the IaC tool itself
during deploy (CDK assets bucket, Terraform state lock table). Those
are bootstrapped once per account and tracked in
`project_config_infra.md` §"Bootstrap resources".

### Reviewable-diff rule

Every PR that touches `infra/` carries a plan/diff artifact in the PR
comments. This is enforced by CI (the comment is required for the
"infra" check to pass). The artifact is the review surface; reviewing
the TypeScript/HCL alone is **not** sufficient — too easy to miss what
CloudFormation/Terraform will actually do.

### No-secrets-in-IaC rule

IaC string literals never contain real secret values. Secrets come
from Secrets Manager / SSM Parameter Store / Vault at deploy time,
resolved by the resource's IAM role. This is also enforced by
`gitleaks` in `.githooks/pre-push` (Recipe-cross rule from
`docs/SECURITY.md`).

### State + lock storage

| Tool | State | Lock |
|---|---|---|
| CDK | CloudFormation stack (in account) | CloudFormation native |
| Terraform | S3 bucket (per account, encrypted, versioned) | DynamoDB table |
| Pulumi | Pulumi Cloud OR S3 backend | Pulumi Cloud OR DynamoDB |

State backend config is declared per env in `project_config_infra.md`
§"State backends" — including the *bootstrap* steps to create the
bucket/table on a fresh account.

### Pre-push gate — what runs locally

| Step | Tool | Blocks on |
|---|---|---|
| IaC validate | `cdk synth` / `terraform validate` / `helm lint` | syntax / missing imports / template errors |
| IaC config scan | `trivy config` (see `docs/SECURITY.md` Recipe A §4) | HIGH+ misconfig |

Both are fast for typical project sizes. For very large CDK apps,
`cdk synth` can drift past 10 s — move it to CI if it slows every push,
but keep `trivy config` local (it's fast).

### CI gate — what runs after push

| Step | Tool | Blocks on |
|---|---|---|
| Plan diff | `cdk diff` / `terraform plan` / `helm diff upgrade` | comment posted to PR (not blocking, but required for review) |
| Security check | `cdk-nag` (Recipe A) / `tfsec` (Recipe B) / `kube-score` (Recipe C) | HIGH+ finding |
| Cost diff | `infracost` / `kubecost` | delta > threshold in `project_config_infra.md` |
| Snapshot test | `cdk synth` snapshot vs committed baseline | diff requires founder approval |

### Nightly drift scan

Per recipe: `cdk diff` cron / `terraform plan -detailed-exitcode` /
ArgoCD `OutOfSync` watcher. Alerts route through the same MALT pipe.
A drift alert open >24h is a `findings.md` entry.

### Rollback procedure

Each project declares the rollback path per stack in
`project_config_infra.md` §"Rollback procedure". The canonical shape:

1. **Identify the last known-good revision** — git SHA on `main` whose
   pipeline ran clean against prod.
2. **Roll forward, not back** — redeploy that SHA. CloudFormation
   handles in-place rollback automatically on apply failure;
   Terraform / Helm do not, so you redeploy the previous code.
3. **Stateful resource constraint** — if the rolled-back change
   migrated data, the rollback procedure names the data-migration
   reversal step explicitly. No assumed-symmetric migrations.

---

## What you don't ship

- A resource clicked together in the AWS / GCP / Azure console with
  a "I'll codify it later" comment.
- An IaC string literal containing a real secret, password, or
  long-lived token.
- A prod-apply / prod-deploy run from a laptop. Ever.
- A PR touching `infra/` without an attached `cdk diff` / `terraform
  plan` / `helm diff` comment.
- A new prod resource without a corresponding entry in the rollback
  procedure.
- An infra change deployed straight to prod without traversing
  dev → staging → prod, unless it's an emergency fix and is documented
  as such in the next `docs/done/INCIDENT-YYYY-MM-DD.md`.
- A drift alert left open >24h without either a "codify" PR or a
  "revert + add alarm" PR linked.

## Per-push checklist

Walked with the handoff (DoD §7). These are judgement: only the scans the
gate runs are checked by a mechanism.

For every push that touches `infra/` (CDK / Terraform / Helm):

- [ ] **Synth/plan clean** — `cdk synth` / `terraform validate` /
      `helm lint` succeeds. The pre-push gate (DoD §4) blocks otherwise.
- [ ] **Reviewable diff in the PR** — `cdk diff` / `terraform plan` /
      `helm diff upgrade` output is attached as a PR comment. The
      diff is the review artifact, not the TypeScript / HCL alone.
- [ ] **No out-of-band resources referenced** — no hand-created ARNs
      being imported by string, no "create this in the console first"
      steps assumed.
- [ ] **Environment parity** — change applies cleanly to all declared
      envs (dev / staging / prod) per `project_config_infra.md`, not
      just one.
- [ ] **Cost impact named** — if change adds resources whose monthly
      cost exceeds the threshold in `project_config_infra.md`
      §"Cost ceilings", PR body calls it out and the founder
      approves explicitly before merge.
- [ ] **Drift report from last nightly scan attached** if a relevant
      drift alert is open on a resource the PR touches.

For every push that adds a **new prod resource** (anything
customer-traffic-bearing or state-holding):

- [ ] **Rollback procedure named** — `project_config_infra.md`
      §"Rollback procedure" covers the new resource, including any
      stateful-resource reversal steps.
- [ ] **Deploy traversal documented** — PR shows the dev → staging →
      prod path the change will take. Emergency-fix exceptions land
      in the next `docs/done/INCIDENT-YYYY-MM-DD.md`.

What you don't ship:
- A resource clicked together in the cloud console with "I'll codify
  it later".
- An IaC string literal containing a real secret (use Secrets Manager
  / SSM / Vault).
- A prod apply / deploy from a laptop. Ever.
- An infra change deployed straight to prod without traversing
  dev → staging → prod, unless it's an emergency fix documented as
  such.
- A drift alert left open >24h without either a "codify" or
  "revert + add alarm" PR linked.
