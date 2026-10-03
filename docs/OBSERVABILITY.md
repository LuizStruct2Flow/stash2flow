# Observability — capture, retrieve, alert, diagnose

The principle lives in [AGENTS.md](../AGENTS.md) §"Observability is a main
concern", and its per-push checklist closes this file. Both are
runtime-agnostic. This file holds the **recipes** — concrete patterns per
runtime so projects don't reinvent the wheel.

Pick one when you fill in `project_config_overview.md` §"Observability
stack". Combinations are fine (e.g. an AWS-hosted backend with a desktop
companion app).

> **Why these four capabilities aren't optional.** Quality of working
> software = how fast you can find and fix errors. The recipes below all
> deliver the same four capabilities; they just differ in plumbing:
> capture every error in structured form → retrieve it without human
> ferrying → alert when it's broken in production → diagnose first as
> the agent.

---

## Recipe A — AWS-hosted / serverless (default for hosted projects)

The struct2flow default per [STACK_DEFAULTS.md](../STACK_DEFAULTS.md):
Lambda + DynamoDB + Amplify Hosting + CDK + CodePipeline. Worked
example: storm2flow's "MALT" pattern (FEATURE-006), accepted in
production.

### 1. Capture — structured CloudWatch logs

Every Lambda logs JSON lines through a shared `logger` module. One line
per event; never `console.log(...)` with concatenated strings.

```ts
// src/observability/logger.ts (project copy)
type Level = 'debug' | 'info' | 'warn' | 'error';
export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  process.stdout.write(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    requestId: fields.requestId ?? process.env.AWS_LAMBDA_REQUEST_ID,
    ...fields,
  }) + '\n');
}

// usage at an error boundary:
try { ... }
catch (err) {
  log('error', 'generate.failed', {
    userId, error: { message: err.message, stack: err.stack, name: err.name },
  });
  throw err; // don't swallow — surface it
}
```

CloudWatch's JSON parser indexes every field; logs are queryable by
`level`, `event`, `userId`, `requestId`, anything you log.

### 2. Retrieve — the MALT admin route + log-grep

**MALT = "Most-recent Application Log Tail"**. A protected admin route
that returns the last N error log lines for the agent to read.

```ts
// src/routes/admin/debug.ts
router.get('/api/admin/debug/last-failures', requireAdmin, async (req, res) => {
  const limit = Number(req.query.limit ?? 20);
  const since = req.query.since ?? '30m';  // 30m ago
  const logs = await cloudWatchLogs.startQuery({
    logGroupName: `/aws/lambda/${process.env.SERVICE}`,
    startTime: Date.now() - parseDurationMs(since),
    endTime: Date.now(),
    queryString: `fields @timestamp, level, event, error.message, error.stack
                  | filter level = "error"
                  | sort @timestamp desc
                  | limit ${limit}`,
  });
  res.json({ since, limit, results: await pollUntilDone(logs.queryId) });
});
```

**The agent uses this route — and the equivalent AWS CLI command — instead
of asking the founder to paste logs.** From `feedback_use_malt_dont_ask_for_logs`
in memory:

```bash
# Direct CLI fallback when MALT route isn't reachable
aws logs filter-log-events \
  --log-group-name "/aws/lambda/<service>" \
  --start-time "$(date -u -d '30 minutes ago' +%s)000" \
  --filter-pattern '{ $.level = "error" }' \
  --max-items 20
```

### 3. Alert — CloudWatch alarm → SNS → Slack

Per-Lambda CDK construct that fires on error rate. Threshold + destination
in `project_config_dod.md`.

```ts
// infrastructure/lib/observability.ts
export function wireAlarms(scope: Construct, fn: lambda.Function, opts: {
  errorRatePerMin: number;
  topic: sns.ITopic;
}) {
  const alarm = new cloudwatch.Alarm(scope, `${fn.node.id}-ErrorRate`, {
    metric: fn.metricErrors({ period: cdk.Duration.minutes(5) }),
    threshold: opts.errorRatePerMin * 5,
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });
  alarm.addAlarmAction(new actions.SnsAction(opts.topic));
  return alarm;
}
```

Slack: an SNS subscription to an AWS-Chatbot Slack channel, or a
Lambda subscriber that POSTs to a Slack webhook. Channel routing
(`#alerts-prod` vs `#alerts-dev`) lives in `project_config_paths.md`.

### 4. Frontend error capture — `/api/client-errors`

CloudWatch only sees backend logs. For frontend exceptions, ship a tiny
endpoint the browser POSTs to via `window.onerror` / `unhandledrejection`:

```ts
// frontend/src/observability/report-client-error.ts
window.addEventListener('error', (e) => {
  navigator.sendBeacon('/api/client-errors', JSON.stringify({
    message: e.message, stack: e.error?.stack,
    url: location.href, userAgent: navigator.userAgent,
  }));
});

// backend route just logs structured
router.post('/api/client-errors', async (req, res) => {
  log('error', 'client.uncaught', { ...req.body, ip: req.ip });
  res.status(204).end();
});
```

Same MALT retrieval pattern then catches both backend + frontend errors.

---

## Recipe B — Local app / desktop / CLI (no cloud)

Worked example pattern: `linkedin-watcher-agent`. No AWS, no shared
backend; everything runs on the founder's machine.

### 1. Capture — rotating file logs

JSON lines to `~/.stash2flow/logs/app-YYYY-MM-DD.log`, daily
rotation, configurable retention (e.g. 14 days). Same `logger` interface
as Recipe A — the function body is what differs.

```ts
// src/observability/logger.ts (local-app variant)
import fs from 'node:fs';
import path from 'node:path';
const logDir = path.join(os.homedir(), `.${PROJECT_NAME}`, 'logs');
fs.mkdirSync(logDir, { recursive: true });
function logFilePath() {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(logDir, `app-${day}.log`);
}
export function log(level, event, fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }) + '\n';
  fs.appendFileSync(logFilePath(), line);
  if (level === 'error') process.stderr.write(line);
}
```

### 2. Retrieve — the `--diagnose` CLI flag

Built-in CLI command that prints the last N error lines from the log
files, no log-aggregator needed.

```bash
$ stash2flow --diagnose --last 20
[2026-06-01T10:14:22Z] error linkedin.fetch.failed userId=42 error.message="rate limit" error.stack="..."
[2026-06-01T10:11:08Z] error queue.drain.timeout queueDepth=312
...
```

```ts
// src/cli/diagnose.ts
export async function diagnose({ last = 20 }: { last?: number }) {
  const files = (await fs.promises.readdir(logDir))
    .filter(f => f.endsWith('.log')).sort().reverse();
  const errors: string[] = [];
  for (const f of files) {
    const lines = (await fs.promises.readFile(path.join(logDir, f), 'utf8')).split('\n');
    for (const line of lines.reverse()) {
      if (!line) continue;
      try { if (JSON.parse(line).level === 'error') errors.push(line); }
      catch { /* skip malformed */ }
      if (errors.length >= last) break;
    }
    if (errors.length >= last) break;
  }
  errors.forEach(l => console.log(l));
}
```

The agent runs `stash2flow --diagnose --last 20` instead of asking
for log paste.

### 3. Alert — desktop notification + Slack webhook on crash

For crashes (`process.on('uncaughtException')`, `process.on('unhandledRejection')`),
fire a desktop notification AND post to the project's Slack webhook in
`project_config_paths.md`:

```ts
// src/observability/crash-reporter.ts
process.on('uncaughtException', async (err) => {
  log('error', 'process.uncaught', { error: { message: err.message, stack: err.stack } });
  await notifyDesktop({ title: `${PROJECT_NAME} crashed`, body: err.message });
  await postSlack({ text: `🚨 ${PROJECT_NAME} crashed: ${err.message}` });
  process.exit(1);
});
```

For *rate-based* alerts (not just crash but "many errors in a short
window"), the `--diagnose` flag is the source of truth — the agent
schedules a periodic check against it, no CloudWatch needed.

### 4. Frontend error capture — same logger if Electron / Tauri

If the app has a UI process (Electron, Tauri, etc.), wire `window.onerror`
to call the main-process logger via IPC. Otherwise the CLI logger is
sufficient.

---

## Recipe C — Containerized service (Docker / ECS / Kubernetes)

For services that aren't Lambda-shaped but still run in the cloud
(long-running workers, web servers on Fargate, services in EKS, etc.).

### 1. Capture — JSON to stdout

The container logs JSON to stdout; the platform routes it. Same `logger`
shape as Recipe A; the destination differs.

```ts
// src/observability/logger.ts
export function log(level, event, fields = {}) {
  process.stdout.write(JSON.stringify({
    ts: new Date().toISOString(), level, event,
    service: process.env.SERVICE, ...fields,
  }) + '\n');
}
```

### 2. Retrieve — depends on aggregator

- **ECS / Fargate** → CloudWatch Logs → same MALT route + `aws logs
  filter-log-events` as Recipe A.
- **Kubernetes** → Loki / Elasticsearch / Datadog Logs → an admin route
  that wraps the aggregator's query API.
- **Docker on a VM** → journald with `--log-driver=journald` → admin
  route that wraps `journalctl -u <unit> --output=json --since=...`.

Pick the aggregator your platform already has; don't add a new one for
observability alone.

### 3. Alert — platform-native alarms → Slack

- ECS → CloudWatch alarms on service-level metrics (error rate, target
  health) → SNS → Slack.
- Kubernetes → Prometheus + Alertmanager → Slack.
- Docker on a VM → a small Lambda / cron job that polls journald and
  posts to Slack when errors per N minutes > threshold.

### 4. Frontend error capture — same `/api/client-errors` pattern

Identical to Recipe A.

---

## Cross-recipe rules (apply to all three)

These are the things the **principle** demands regardless of mechanism:

1. **Correlation IDs.** Every request / job carries a `requestId` (or
   `jobId`, `traceId`) generated at the entry point and threaded through
   every log line touched by that request. Without it, you can't
   reconstruct what happened.
2. **No error swallowing.** A `try/catch` that returns `null` or a default
   value is a bug. Even when the user-facing fallback is graceful, the
   error path **logs at `error` level** before falling back.
3. **PII in logs.** Document in `project_config_dod.md` what is allowed
   (`userId` — usually fine, hashed if sensitive) and what isn't
   (email, raw input text, tokens, anything from a payment field). The
   logger module ideally enforces this — a `redact: ['email', 'token']`
   passthrough is cheap and bulletproof.
4. **Agent-first triage.** The agent has documented diagnosis steps for
   the project's recurring error classes (cf. AGENTS.md §"Observability"
   capability #4). It checks them **before** asking the founder. If
   the agent can't resolve in a sensible number of steps, it surfaces
   the failure cleanly: "I ran these N retrieval queries, found these
   patterns, here are 2 hypotheses." Not "can you paste a log?".
5. **Frontend product analytics is separate from error observability.**
   Plausible (struct2flow default per STACK_DEFAULTS) covers product
   analytics — what users did. Error observability covers what broke.
   Don't mix them; they have different retention, different access
   patterns, and different privacy treatment.

## Per-push checklist

Walked with the handoff (DoD §7). These are judgement: only the scans the
gate runs are checked by a mechanism.

For every new user-facing route, command, or job:

- [ ] **Error capture** — structured error boundaries (level, event,
      correlation id, error.message, error.stack). No silent swallowing,
      no default-value fallbacks that hide failures.
- [ ] **Agent-readable retrieval path** — the project's MALT-equivalent
      pattern is documented and works: the agent can run one command (a
      log-grep, an admin debug route, a `--diagnose` CLI flag) and get
      the last N failures with full context. **No "paste me the log"
      asks to the founder.**
- [ ] **Alert wired** — threshold + destination declared in
      `project_config_dod.md` §"Alerting". A capability live in
      production without an alarm is not done.
- [ ] **Diagnosis runbook** — the agent has tried-and-true diagnosis
      steps for this error class, documented in `agents.internal.md`,
      a memory entry, or `docs/diagnosis.md`.

What you don't ship:
- Silent fallbacks that swallow errors with a default value.
- Unstructured log lines that can't be queried by field.
