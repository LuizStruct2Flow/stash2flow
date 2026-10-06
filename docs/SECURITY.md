# Security — keep secrets out, find vulns fast, fix before deploy

The principle lives in [AGENTS.md](../AGENTS.md) §"Security is a main
concern", and its per-push checklist closes this file. Both are
runtime-agnostic. This file holds the **recipes** — concrete patterns per
runtime so projects don't reinvent the wheel.

Pick one when you fill in `project_config_overview.md` §"Security stack".
Combinations are fine (e.g. an AWS-hosted backend that also ships a
desktop companion app).

> **Why these four capabilities aren't optional.** Quality of working
> software degrades to zero the moment something is exploited in
> production. The recipes below all deliver the same four capabilities;
> they just differ in tooling and where the gate fires:
> keep secrets out of git → catch OWASP patterns before push →
> watch dependencies + infra for CVEs continuously → fix-before-deploy
> for everything that touches a customer surface.

---

## Recipe A — AWS-hosted / serverless (default for hosted projects)

The struct2flow default per [STACK_DEFAULTS.md](../STACK_DEFAULTS.md):
Lambda + DynamoDB + Amplify Hosting + CDK + CodePipeline.

### 1. Keep secrets out — `gitleaks` in the pre-push hook

`.githooks/pre-push` runs `gitleaks detect` over **the commits being
pushed** — `remote_sha..local_sha` for every ref git names on the hook's
stdin. Blocks on detection. Catches AWS keys, OpenAI tokens, JWT secrets,
arbitrary high-entropy strings, etc.

> **Not `protect --staged` (A-03).** `--staged` scans the git *index*, and at
> pre-push time the index is empty because the commit is already made.
> Measured with a real secret in the outgoing commit: `protect --staged`
> reported "0 commits scanned, ~0 bytes ... no leaks found" and exited 0.
> The gate was a no-op in the normal commit-then-push flow for as long as it
> existed. If you are copying this recipe into another project, copy the
> `detect --log-opts` form.

A new branch has an all-zero remote sha, so there is no range — and nothing
local is trustworthy enough to subtract. `refs/remotes/<dest>/*` is a namespace
selector, not an answer from the destination: a stale-ahead or hand-created ref
there would subtract commits the destination need not have, which under-scans.
So a **new ref is scanned in full**, over its whole reachable history. A branch
deletion publishes nothing and is not scanned.

> **The budget conflict, decided rather than implied.** A full-history scan is
> unbounded; the ≤30 s pre-push ceiling is not. Both cannot hold silently, so
> the local scan is **capped** (`GITLEAKS_TIMEOUT_SECONDS`, default 20) and an
> unfinished scan **blocks** with a distinct "INCOMPLETE" message — it is
> neither a clean scan nor a crashed scanner. Raise the cap deliberately for a
> one-off, push a narrower range, or let CI carry the full history. What is not
> on offer is skipping quietly to stay inside the budget.

For accidental commits that already happened: `gitleaks detect` over
the full history, then rewrite with `git filter-repo` and rotate the
leaked credential immediately. **The credential is compromised the
moment it lands on `origin`** — assume it's been scraped within
minutes.

Secrets at runtime live in AWS Secrets Manager / Parameter Store,
fetched at Lambda cold-start. Never in `.env` files committed to the
repo, never in CDK string literals.

### 2. SAST — Semgrep + ESLint security plugins

**Semgrep** runs in pre-push with `--config=auto` (mostly community
OWASP rules + struct2flow-specific patterns). Typical PR cost: 5-10s.
Blocks on any finding ≥ `WARNING` severity unless suppressed inline
with a justification comment.

**ESLint** carries `eslint-plugin-security` +
`eslint-plugin-no-unsanitized` in the workspace's eslint config.
Already part of the lint gate (DoD §4), so cost is zero
incremental.

CI runs the deeper Semgrep pack
(`--config=p/owasp-top-ten --config=p/r2c-security-audit`) — slower,
not pre-push budget.

**A scan that could not read the code is not a clean scan.** Semgrep exits 0
with zero findings when it could only partly parse a file, so the gate reads
`.errors`, not just the exit status and the results array: any error the policy
does not accept makes the run INCOMPLETE — retried once single-job, then
blocking. An error list the gate cannot decode blocks too. CI applies the same
classification (BUG-126).

**Accepted risk — shell parse errors are not analysed.** The SAST gate accepts
one class of Semgrep diagnostic: a `Syntax error` or `PartialParsing` on a shell
script, identified by a `.sh`/`.bash` extension or by a shebang naming sh, bash
or dash. Semgrep's bash parser rejects valid scripts — 18 ShellCheck-clean files
in the blueprint alone — so blocking on them would block every push. The cost is
real: an unparsed region of a shell file is not analysed, and a rule finding
inside it would be missed. ShellCheck is not a substitute: it enforces shell
correctness rather than security rules, and its coverage is narrower than the
exception's, since `sh_lint` lints only tracked files under `scripts/` and
`.githooks/` while the exception accepts shell files anywhere, including a
`.bash` file with no shebang. The gate does not independently prove a file's
language either, so a deliberately false shell shebang is accepted. Everything
else — any other error type, any other language, an error with no path — blocks.

### 3. SCA — `osv-scanner` for dependency CVEs

Pre-push: `osv-scanner scan source --recursive --format=json .`, with the
severity applied over the JSON. A vulnerability rated **Medium** or above
(CVSS >= 4.0) blocks. Anything lower is printed but does not block, and you
track it in `docs/config/findings.md` as a planned upgrade.

CI applies the same MEDIUM+ rule, on every push and nightly
(`.github/workflows/security.yml`, `sca` job). A *new* CVE in something
we already use fails the nightly run and fires an alert (same SNS →
Slack pipe as MALT).

### 4. IaC scan — `trivy config` over the CDK output

CI step before any deploy: `cdk synth` then `trivy config cdk.out/`.
Catches public S3 buckets, missing SSE, over-permissive IAM
statements, security-group `0.0.0.0/0` ingress, unencrypted RDS, etc.

Severity policy: **High** or **Critical** → blocks the deploy.
**Medium** → allowed but recorded in `findings.md` for cleanup.

### 5. DAST — OWASP ZAP baseline against the preview environment

CI pipeline (CodePipeline): after the preview env is healthy, run
ZAP baseline scan against the API Gateway URL. Passive only, ~5 min.
Findings annotate the build but only **High** or **Critical** block
promotion to prod.

Nightly: full active scan against the prod URL (read-paths only —
nothing that mutates state). Results land in S3, summarized in the
same Slack channel as MALT alerts.

### 6. Threat model — `project_config_security.md`

Each project carries a `project_config_security.md` (sibling to
`project_config_dod.md`) listing:

- **Trust boundaries** — what's the public surface, what's
  intra-VPC, what's per-tenant.
- **Auth surfaces** — Cognito / Auth0 / custom; token lifetime;
  refresh policy.
- **Sensitive data classes** — PII, payment, credentials; storage
  + transport + retention rules per class.
- **Adversary assumptions** — what we defend against, what we
  don't (out-of-scope by design).
- **Incident playbook** — first 10 minutes, escalation, comms.

The threat model is reviewed at every **major** feature plan —
same gate as the §2 major bug consensus.

---

## Recipe B — Local app / desktop / CLI (no cloud)

Apps with no deployed HTTP surface (Electron / Tauri desktop, CLIs,
local-first utilities).

### 1. Keep secrets out

Same `gitleaks` pre-push hook as Recipe A. Plus: any local config the
app writes (token cache, keystore) must live under the OS keychain
or an OS-protected user dir (`~/Library/Keychains` on macOS,
Credential Manager on Windows, `libsecret` on Linux). Never plain
JSON on disk.

### 2. SAST — Semgrep + ESLint security plugins

Same as Recipe A.

### 3. SCA — `osv-scanner` over lockfiles

Same as Recipe A. Critical for desktop apps because users install the
shipped artifact directly — a vulnerable dependency travels into every
install.

### 4. Signed releases — supply-chain integrity

Distribution artifacts (DMG / MSI / AppImage / npm tarball) are
signed and the public key + SHAs are published with the release.
For Electron / Tauri: codesign on macOS, signtool on Windows. For
CLIs distributed via npm: enable `npm provenance`.

### 5. No DAST (no remote surface)

Skip ZAP / Nuclei. There's nothing remote to scan. The threat model
shifts to: malicious update server, compromised lockfile, local
privilege escalation. Cover via §1 + §3 + §4.

### 6. Threat model — same `project_config_security.md`

Adapted for desktop:

- **Trust boundaries** — user filesystem, OS keychain, update server.
- **Auth surfaces** — none, or device-bound tokens.
- **Sensitive data classes** — what the app stores locally, encrypted
  at rest (`age` / `libsodium`).
- **Update channel** — signed, fetched over HTTPS, public key pinned.
- **Adversary assumptions** — same machine, malicious dependencies,
  spoofed update server.

---

## Recipe C — Containerized service (Docker / ECS / Kubernetes)

For services packaged as containers (struct2flow's fallback when
Lambda's 15-min ceiling or package size bite).

### 1. Keep secrets out

Same `gitleaks` pre-push. At runtime, secrets come from the
orchestrator's secret store (ECS task definition `secrets`,
Kubernetes `Secret`, etc.). Never in the image, never in env-vars
baked into the Dockerfile.

### 2. SAST — same as Recipe A

### 3. SCA — `osv-scanner` over lockfiles, same as A

### 4. Container image scan — `trivy image`

CI step right after `docker build`:
`trivy image --severity HIGH,CRITICAL --exit-code 1 <image>:<tag>`.
Blocks the push to ECR / GHCR on any High/Critical CVE in the
**base image or any layer**. Forces base-image refresh discipline.

### 5. IaC scan — `trivy config` over Kubernetes manifests / Terraform / CDK

Catches the same drift class as Recipe A.4 in the orchestrator's
own config language.

### 6. DAST — OWASP ZAP against the service's HTTP surface

Same shape as Recipe A.5. If the service is internal-only (no public
ingress), skip the prod scan but keep the preview-env baseline scan.

### 7. Threat model — `project_config_security.md`

Container-specific additions:

- **Image provenance** — base image source, signed?
- **Runtime sandboxing** — read-only root FS, dropped capabilities,
  no privileged mode, seccomp profile.
- **Network egress** — does the container need outbound internet?
  If not, deny by default at the orchestrator level.

---

## Cross-recipe rules (apply to all three)

These bind every project regardless of stack.

### Pre-push gate — what runs locally

Per the blueprint pre-push hook (DoD §4):

1. `gitleaks detect --log-opts=<remote>..<local>` — fails on any secret in
   the commits being pushed (**not** `protect --staged`, which scans an index
   that is empty at pre-push time — A-03)
2. `semgrep --config=auto` — fails on `WARNING+` severity
3. `osv-scanner scan source --recursive .` — fails on a `MEDIUM+` vulnerability (CVSS >= 4.0); lower ones are reported, not blocking
4. (lint security plugins ride inside `npm run lint` — already wired)

There is no wall-clock ceiling. A scan too slow for every push moves to
CI (Semgrep deep packs are the usual offender, not gitleaks).

### CI / pipeline gate — not all of these run on every push

Of the four steps below, only Deep SAST runs on every push — alongside the
secret scan and SCA, which are documented above under "Pre-push gate" and
also run in CI on every push (`secret-scan` + `sast` + `sca` jobs in
`.github/workflows/security.yml`). In the blueprint's own repository a fourth
job, `contamination`, hands the pushed diff's added lines (shipping files only)
to `scripts/lib/contamination.mts`'s checker and keeps `released` from advancing
over a host path or foreign state dir (TASK-079); it is skipped, not green, in
a derived project. That workflow has no trivy or ZAP job at
all, because this blueprint ships no container and deploys nothing. Container
scan, IaC scan and DAST baseline are recipe content for a project that has
wired the matching pipeline stage: they fire only when that stage runs, not
on every push.

| Step | Tool | Runs when | Blocks on | Where the finding lives |
|---|---|---|---|---|
| Deep SAST | `semgrep --config=p/owasp-top-ten --config=p/r2c-security-audit` | Every push (CI) | Any HIGH | PR comment + `findings.md` |
| Container scan | `trivy image` (Recipe C only) | Right after `docker build`, not every push | HIGH+ CVE | Blocks ECR push |
| IaC scan | `trivy config` | Before a deploy that touches CDK/Terraform/k8s output, not every push | HIGH+ misconfig | Blocks deploy |
| DAST baseline | `zap-baseline.py` | After the preview env is healthy (deploy pipeline), not every push | HIGH+ alert | Blocks promote to prod |

### Nightly scans

- `osv-scanner` over all lockfiles — catches *new* CVEs in deps we
  already use. Same `MEDIUM+` block as the push. Alert routes through
  the same MALT pipe.
- ZAP full active scan against prod (read-paths only).
- Nuclei against deployed targets — template-based, complementary
  to ZAP.

### Findings register

`docs/config/findings.md` is the canonical place where every
security finding lives until fixed or accepted. Same register as
Codex review findings — security findings carry a `[SEC]` tag.
A finding marked **Status: Accepted** has a sign-off line naming
who accepted the risk and why. A sub-`MEDIUM` CVE tracked here
instead of blocking the push uses **`Status: Deferred: <date>`**
for its planned upgrade date — one field, not a separate one (the
register's own §"Status schema" says why). Every finding block
carries a valid `Status:` line at all — enforced by:
`tests/lifecycle-docs` "TASK-074: findingsMissingValidStatus flags
a missing line, an undated Deferred, and a bare Accepted" and its
`#live` counterpart. Whether the named status is still true stays
judgement.

### Incident response

When a security finding hits production:

1. **Stop the bleed** — disable the affected route / rotate the
   leaked secret / pin the vulnerable dep at a known-good version.
   Speed beats elegance here.
2. **Write the bug** — `BUG-XXX` in `docs/doing/BUGS.md` with the
   `[SEC]` tag. Two-commit pattern still applies: reproducer first,
   fix second.
3. **Notify per project policy** — if PII / payment / credentials
   were exposed, the `project_config_security.md` §"Incident
   playbook" names who gets paged and the regulatory clock.
4. **Postmortem** — `docs/done/INCIDENT-YYYY-MM-DD.md` with timeline,
   root cause, what the gate missed, what changes (new rule? new
   scanner? new pre-push step?). The DoD evolves from real incidents,
   not hypotheticals.

---

## What you don't ship

- Hard-coded secrets, even "just for local dev" — that file will be
  committed eventually.
- `// eslint-disable-next-line` or `# nosec` / `// nosemgrep` without
  a justification comment naming the threat model entry that makes
  the suppression safe.
- A new public route without a corresponding ZAP baseline run.
- A dep upgrade that introduces a new MEDIUM+ CVE without an immediate
  rollback or pin.
- A `findings.md` entry left untriaged across two consecutive
  grooming passes — either fix, defer with a date, or mark
  `Status: Accepted` with a sign-off.

## Per-push checklist

Walked with the handoff (DoD §7). These are judgement: only the scans the
gate runs are checked by a mechanism.

For every push:

- [ ] **Secret scan clean** — `gitleaks detect` over the commits being
      pushed passed in pre-push. No `--no-verify` shortcut. If a secret was
      *ever* committed, it's been rotated, not just removed — the commit
      does not have to reach `origin` for the credential to be burned.
      (Not `protect --staged`: that scans the index, which is empty once the
      commit exists, so it scanned nothing at all — A-03.)
- [ ] **SAST clean** — Semgrep + lint security plugins ran clean
      (or every suppression has a justification comment naming the
      threat-model entry that makes it safe).
- [ ] **SCA clean** — `osv-scanner` reports zero `MEDIUM`+ vulnerabilities
      (CVSS >= 4.0) in project dependencies. This is what the pre-push hook
      and CI both block on. Anything below `MEDIUM` is reported, not
      blocking, and tracked in `docs/config/findings.md` with a planned
      upgrade date.
- [ ] **IaC clean** (if the push touches CDK / Terraform / k8s
      manifests) — `trivy config` reports zero `HIGH`+ findings.

For every push that adds a **new public surface** (route, command,
container with ingress):

- [ ] **Threat-model entry exists** — `project_config_security.md`
      §"Trust boundaries" / §"Auth surfaces" / §"Sensitive data
      classes" covers the new surface.
- [ ] **DAST baseline scheduled** — CI ZAP baseline against the
      preview environment is wired and passing (Recipe A / C) OR a
      written justification why no DAST applies (Recipe B).
- [ ] **Findings register reviewed** — every `[SEC]` finding in
      `docs/config/findings.md` is either fixed, deferred with a
      date, or `Status: Accepted` with a sign-off.

What you don't ship:
- Hard-coded secrets, even "just for local dev".
- `// eslint-disable-next-line` / `// nosemgrep` / `# nosec`
  without a justification comment.
- A new public route without a corresponding ZAP baseline run.
- A dep upgrade that introduces a new `MEDIUM`+ CVE without an
  immediate rollback or pin.
