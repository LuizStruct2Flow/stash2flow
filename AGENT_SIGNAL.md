# Agent Signal — the mic, rotation and four-eyes review

Canonical rules for how the team agents — **Codex, Claude Code, Gemini, Kimi and
GitHub Copilot** — coordinate in this repo. The live state is the LIVE baton at
`logs/state/signal.md` (untracked, written only by `scripts/signal-set.sh` —
BUG-019); **this file is the protocol** (how the radio works). `AGENTS.md`, the
shared rules every provider reads, points here rather than duplicating it.

**Shared-rules self-check.** `AGENTS.md` must begin with the heading
"Agent instructions — shared by the four CLI providers". If it does not, this
project's `AGENTS.md` predates the TASK-084 switch: stop, tell the founder and
run `blueprint pull AGENTS.md` before any coordinated work.

Watch every agent live in one place: `bash scripts/agent-activity.sh --daemon`,
then `tail -F logs/agent-activity.log`. One tail-able
`[Persona - model - effort]` feed (mic changes + each agent's actual work) written
to `logs/agent-activity.log`. `--stop` ends it; `--status` reports whether it runs.

**This file is the protocol. It is not the baton.**

The live baton lives at **`logs/state/signal.md`**, which is untracked
per-checkout state. Read it with:

```bash
bash scripts/agent-activity.sh --whoami   # who am I
cat logs/state/signal.md                  # who holds the mic
```

Write it with **`scripts/signal-set.sh`, which is the only supported writer**:

```bash
scripts/signal-set.sh --holder <Persona> --state ACTIVE      --task '...'
scripts/signal-set.sh --holder <Persona> --state OVER_TO_CODEX --task-file .scratch/task.md
```

Do **not** hand-edit the baton rows. One writer publishes the whole baton in a
single atomic `mv`, so a poller can never sample a half-written state — `Task`
from the previous round beside the new `State` was a real defect, twice.

## Why the live state is not in this file

It used to be, and that was a bug (**BUG-019**). A tracked file holding live
runtime state is fine until you notice that git *owns* tracked files in the
working tree: `git switch`, `git checkout <file>`, `git stash` and `git rebase`
all rewrite them — correctly, by their own contract — **including while an agent
is mid-dispatch**.

Reproduced live rather than inferred: a `git checkout AGENT_SIGNAL.md` reverted
the baton while Codex was claiming the mic, and it stopped, correctly — *"the
baton changed before I could claim it."* Nothing failed. The watcher simply had
nothing left to claim. A dispatch that dies loudly costs minutes; one that dies
silently costs the session.

It was rare until every change became a branch + PR. The mechanism never
changed; the frequency changed by an order of magnitude.

This is the same split already used for
[`AGENT_ROSTER.md`](AGENT_ROSTER.example.md): live per-checkout state stays
untracked, the tracked artefact carries what every checkout shares.

## The protocol

`Holder` is a **persona name** from [AGENT_ROSTER.md](AGENT_ROSTER.md) — read
yours with `--whoami`, never assume it, since the roster is per-engineer. The
one other legal value is `Nobody`, the seed value meaning the mic is free.
`scripts/signal-set.sh` and the gate both refuse anything else (BUG-140): a
Holder naming nobody dispatches against nobody.

## On wake — minimum read

At the start of every session or after any "wake" prompt, read before doing
substantive work:

- `logs/state/signal.md` — the LIVE baton: current holder, state, handoff task.
  **Untracked** per-checkout state, so a branch operation cannot rewrite it
  under a running dispatch (BUG-019). Written ONLY via `scripts/signal-set.sh`.
- `AGENT_SIGNAL.md` (this file) — the coordination protocol. Tracked, and
  carries no live state.
- `AGENTS.md` — shared project rules and delivery process, and the list of this
  project's config files to open.
- `docs/config/*.md` — stable product, acceptance, and findings context.
- `docs/doing/*.md` — active bugs, backlog items, and plans.
- `docs/waiting-acceptance/*.md` — pushed work awaiting founder acceptance.

The Claude Code prompt the founder talks to **directly** is the **Orchestrator** —
the persona named in the `Orchestrator` row of your gitignored `AGENT_ROSTER.md`
(template: [AGENT_ROSTER.example.md](AGENT_ROSTER.example.md)). **Read the name
from that row rather than assuming it**; `bash scripts/agent-activity.sh --whoami`
prints it. Rosters are per-engineer, so no name written here would be right for
everyone. On wake it
**adopts that persona** (its `Holder` value) and **ensures the live activity feed
is running** — `bash scripts/agent-activity.sh --daemon` — which cleans the log and
streams to `logs/agent-activity.log` (see [Watching it live](#watching-it-live));
watch it with `tail -f`, it does not open a terminal for you. A kernel `flock` makes
concurrent starts a no-op. **Spawned, non-primary personas must not start it** —
they adopt their own assigned persona and participate. See `CLAUDE.md` §"On wake".

## The mic (radio-over)

Before substantive work, **read the signal first** and confirm the mic is
available:

- proceed if `State = IDLE`
- proceed if `State = OVER_TO_<your agent>`
- proceed if `Holder = <your agent>`
- otherwise stop and report that another actor has the mic

After confirming the mic is available, claim it by updating:

- `Holder` — the **persona** that owns the mic: a `Name` cell from
  your `AGENT_ROSTER.md` (template:
  [AGENT_ROSTER.example.md](AGENT_ROSTER.example.md)), or `Nobody` when the
  mic is free — nothing else (§"The protocol", BUG-140). Use the
  persona name, NOT the bare backing-agent type — that is what lets multiple
  sessions on the same backing agent (e.g. several Claude Code personas) coexist
  without colliding. Each session acts only when `Holder` is its own persona.
- `State` — `ACTIVE` while working, `OVER_TO_<NAME>` when handing off to a specific
  persona (e.g. `OVER_TO_KATHRIN`, `OVER_TO_CHRISTIAN`), `OVER_TO_USER`, or `IDLE`
- **A handback to the BACKING-AGENT type — `OVER_TO_CLAUDE`, `OVER_TO_CODEX` —
  is valid, not a defect.** It means "I am done, route this": the Orchestrator
  picks it up and dispatches to the right persona, which is its job. A dispatched
  agent often has no reason to know which persona should get the work next, and
  guessing would be worse than handing back. Founder decision, 2026-08-02 —
  recorded because the alternative reading (that a non-persona handback is a
  roster bug, BUG-010's class) is plausible enough that it was raised once and
  would be raised again.
- `Task` — one short sentence naming the current work
- `Last update` — absolute date

Keep the live baton **slim**: the four rows above only. History lives in
`logs/state/signal-history.log`, appended by `signal-set.sh` on every flip —
it used to be `git log -p AGENT_SIGNAL.md`, and the journal is more accurate
on one axis, because it also records flips that were never committed.
Per-slice decisions live in the relevant
`docs/doing/PLAN-*.md`.

### Rules

- **ACTIVE-on-claim — claiming the mic means setting `State = ACTIVE` (founder direction
 ).** The moment an agent takes the mic — whether the state was
  `OVER_TO_<you>`, `IDLE`, or you are picking up open work — it **must** flip
  `State` to `ACTIVE` (and set `Holder` to itself) *before* doing the work, not
  after. Leaving the state at `OVER_TO_<you>` while you work hides that the work
  has started, so others can't tell the mic is in use versus merely handed to
  you. `ACTIVE` = "in use right now"; flip back to `OVER_TO_<target>` only when
  you hand off.
- The `ACTIVE` state locks WHO IS COORDINATING THE SIGNAL, not WHO MAY EDIT
  FILES. While another agent is `ACTIVE`:
  - **Always allowed**: investigative / read-only work (Read, Grep, log
    lookups, AWS API queries), planning work (drafting `PLAN-*.md`, designing
    approaches), and writing prompts for subagents.
  - **Allowed in parallel**: implementation work on files outside the active
    holder's declared `Task` scope. Surface what you did in your next signal
    flip — don't silently land changes mid-handoff.
  - **Blocked**: edits to files that overlap with the active holder's declared
    `Task` scope, unless the founder explicitly interrupts or the signal is
    clearly stale.
- If the state is `OVER_TO_CODEX`, `OVER_TO_CLAUDE`, `OVER_TO_GEMINI`,
  `OVER_TO_KIMI`, or `OVER_TO_COPILOT`, that agent may proceed directly with its review/fix without
  waiting for the founder to ask again.
- When handing off, update the state to the target actor and include `OVER` in
  the state value, e.g. `OVER_TO_CODEX`.
- Use `OVER_TO_USER` when founder acceptance, rejection, or product direction is
  needed.
- Before flipping to `OVER_TO_USER`, walk [docs/DoD.md](docs/DoD.md) §7. If
  `ls docs/waiting-acceptance/` doesn't show the artefacts the `Task` field
  claims are waiting, the handoff is not done.
- **Every work item you name to the founder carries a link and a plain line.** A
  bare ID (`BUG-012`, `TASK-034`, `#71`) is the agent's shorthand, not the
  founder's memory: an agent that has been working autonomously and then asks
  "approve TASK-034?" hands over a decision without its context. Wherever an item
  is mentioned — a decision request, a handoff summary, the live baton's `Task` —
  link the line that defines it (`docs/doing/BACKLOG.md:NN`,
  `docs/doing/BUGS.md:NN`, `docs/doing/PLAN-*.md:NN`, or its current lifecycle
  folder) and say in one sentence what it does. Look the line up; never guess it.

**Agents stay active after a handoff** — after flipping the state to
`OVER_TO_CODEX`, `OVER_TO_GEMINI`, `OVER_TO_KIMI`, `OVER_TO_COPILOT`, or
`OVER_TO_USER`, an agent does NOT go silent waiting for a prompt. It keeps re-reading the live baton
until the state advances (e.g. `OVER_TO_CLAUDE`), then claims the mic and
continues. Stop only when there's genuinely nothing to do (signal `IDLE`, no open
plans, all bugs in `done/`).

## Who does the work — load balancing across providers

**Founder rule, 2026-09-20.** Work is spread across every provider that has
quota. Not "may be" — is. A provider sitting idle while another burns its
allowance is the failure this rule exists to stop.

| Kind of work | Who does it |
|---|---|
| **Plan review** | **All three providers, seeking consensus.** Not one reviewer — Claude, Codex and Kimi each review, and the plan advances on what they agree. |
| **Writing code** | **The ROLE is chosen by the work. The PROVIDER is chosen by rotation within that role.** A back-end task goes to a back-end engineer — the next one in rotation among the back-end personas with quota. |
| **Anything else** | Load-balanced the same way, inside the role the work belongs to. There is no category exempt from this. |
| **Orchestration** | **Claude only.** The Orchestrator is the founder-facing session. |
| **`git push`** | **Claude only.** Pushing is the one outward-facing act, and it stays with the founder-facing session. Every dispatch preamble says so. |
| **`git add` / `git commit`** | **Every provider.** A dispatched agent commits its own work (founder, 2026-09-20). `.githooks/commit-msg` already refuses a subject that names no item, so the convention is enforced by the hook rather than by withholding the verb. |

**A provider with zero quota leaves the rotation** for as long as its quota is
unavailable, and rejoins when it returns. It is not skipped once and then
retried on the next dispatch — it is out, and coming back is a state change.

**A provider is routed only work it can VERIFY** (founder, 2026-09-21). Quota is
not the only way a provider can be unable to do an item. Codex's
`workspace-write` sandbox keeps every `.git` directory read-only, so it cannot
run a suite that builds a fixture git repository. An item whose proof is such a
suite, like a whole-file port of a script those suites drive, skips Codex and
goes to the next persona in that role. That is a fact about the provider, not a
preference: BUG-144's first attempt was written blind for exactly this reason,
and 25 tests it could not run failed. Record a skip like this where the rotation
is recorded, with its reason, so the capability gap is visible rather than a
habit of avoiding one provider.

**Why this is a rule and not a preference:** the cheapest provider to reach for
is whichever one the Orchestrator is already running on, and that is Claude.
Left to convenience, every dispatch lands on Claude, the other two subscriptions
pay for nothing, and the cross-provider review that catches what one model's
blind spot hides (see §"Four-eyes" below) never has a second opinion available.

### Role first, provider second

**Founder rule, 2026-09-20.** Load balancing never overrides competence. The
work decides the **role** — a back-end change goes to a back-end engineer, an
infra change to infra, a test to QA. Only then does the rotation choose **which**
of that role's personas takes it, among those whose provider has quota.

So the rotation is **per role family**, not one global queue. Back-End turning
to Codex says nothing about whose turn it is in QA.

**Roles are matched by family, ignoring the numeric suffix.** `Back-End-1`,
`Back-End-2` and `Back-End-3` are one role with three representatives; the digit
is which representative, not which job. That is already how
`scripts/team-kickoff.sh` reads roles for its introductions, so the convention
is not new here.

**Check the coverage before relying on it.** The rule assumes each role has a
representative per provider, and on a real roster that is often untrue — a role
covered by two providers rotates between two, and a role covered by one does not
rotate at all. **That is a roster gap, not a licence to cross roles**: a back-end
task does not go to a front-end persona because the back-end rotation is
exhausted. It waits, or the founder is told the role is short.

`node scripts/rotation.mts coverage [<family>]` answers "who covers this role"
in one command, rather than a thing to remember: `bp_roster_rows` plus a strip
of the `-N` suffix, for every family or one.

### The rotation turns per WORK ITEM, and the agent ends with it

**Founder rule, 2026-09-20.** The rotation advances per **work item** — one
`BUG-`/`TASK-`/`FEATURE-` number — not per dispatch. The item is assigned to the
next provider with quota, and every slice of that item runs on it.

**When the item is done, the agent shuts down.** It is not kept alive for the
next item, and it is not resumed across an item boundary. The next item gets a
fresh agent with a fresh context.

**Both halves are about the same cost.** A resumed agent carries its whole
transcript into work that has nothing to do with it, so it gets steadily more
expensive while getting no better informed about the new task — and two such
agents alive at once is the expensive case squared. Measured on TASK-063, where
one agent was resumed three times across slices of the same item: 133k tokens,
then 167k, then 328k for the same quality of answer. Ending it and briefing a
fresh one costs a paragraph and resets the meter.

**What this changes in practice, and it is not free.** Two specialists working
different slices of one item in parallel now share a provider, because the
provider is the item's. Cross-provider parallelism moves from *within* an item
to *between* items. That is the trade the rule makes deliberately: predictable
rotation and bounded context, against concurrency inside a single item.

**A watcher is not an agent.** `start-<provider>-signal-watch.sh` is a stateless
poller holding a lock — leave it running. What shuts down is the session or
subagent that did the work and accumulated the context.

### Two things this collides with, and how they resolve

**Round-robin picks the AUTHOR. Four-eyes constrains the REVIEWER.** They
compose: the rotation chooses who writes, and the review must then come from a
provider that did not. No conflict unless the rotation has shrunk to one.
`node scripts/rotation.mts next <family> --item <ID>` picks the author,
`node scripts/rotation.mts review <family> --item <ID>` the reviewer.

**When only one provider has quota, four-eyes cannot be satisfied.** That is a
real state, not a hypothetical, and it must not be resolved by quietly letting a
provider review itself — the rule's entire value is that the reviewer has a
different blind spot. `review` exits 4 in exactly that state, naming the
family and the one provider left. Hold the push and tell the founder, who
decides whether to wait for quota or waive the review for that change. **A
waiver is the founder's, never an agent's**, recorded as
`node scripts/rotation.mts assign <persona> --item <ID> --reason "<founder's waiver>"`.

### Defaults the Orchestrator applies until told otherwise

These fill gaps the rule above does not decide. They are defaults, not founder
decisions — correct them and they change.

- **Consensus means the reviewers agree on what must change.** Where they
  genuinely disagree, the Orchestrator does not cast a tie-breaking vote: it
  reports the disagreement and what each provider argued, and the founder
  decides. A reviewer's finding is input, not an order (DoD §1b rule 4), so
  "two out of three" is not a verdict.
- **Quota exhaustion is detected from the provider's own refusal**, not
  predicted. The signal watcher records it automatically after every dispatch
  (`node scripts/rotation.mts record`, wired into `scripts/signal-watch.mts`);
  an agent that is not watcher-dispatched (a Claude subagent, an Ollama
  junior) records its own with the same command.

**This used to be prose, and prose is the weak form.** TASK-065 mechanised the
rotation and the quota state: `node scripts/rotation.mts <next|review|assign|
record|retry|coverage>` is now where this section's rules are enforced, not
just written down — the direction TASK-062 sets for every rule in this repo.
Its event log is `logs/state/rotation.log`, per-checkout state, exactly like
the baton.

## Four-eyes cross-provider review (mandatory before push)

**Every change is reviewed by a DIFFERENT backing provider than the one that wrote
it, before it is pushed.** Claude Code, Codex and Kimi (and Gemini / Copilot)
cross-check each other — no provider both writes and blesses-for-push the same code. The loop:

1. **Provider A implements and commits** its slice (`Holder` = an A persona).
2. A **flips the mic to a Provider-B persona** (`OVER_TO_<B>`), naming the
   commit(s) to review.
3. **B reviews.** The reviewer's job is **both** code correctness **and** ensuring
   the change honors the **blueprint rules and the DoD** (`docs/DoD.md` §7:
   co-located tests, lint/format, two-commit reproducer for
   bug-class fixes, doc-sync, etc.). A change that is "correct" but violates a
   blueprint/DoD rule is **not** clean.
4. If B needs **no changes** → **B is the only one allowed to `push`.**
5. If B needs changes → **B makes the changes itself, commits, documents the
   reasons** (commit message / plan file), and **flips back to A for review**.
6. Repeat: each round the reviewer either pushes (zero changes) or becomes the new
   writer (made changes) and hands back. **Push happens only from a clean
   cross-provider review.**

**Invariant:** the last agent to write/commit always hands to the OTHER provider;
only a reviewer who needed zero changes pushes. Every line is seen by both
providers before it reaches the remote.

**Git-hand for sandboxed providers.** If a provider's sandbox cannot run `git`
(e.g. Codex `workspace-write` blocks `.git`), the orchestrator (Claude Code
primary) acts as the git-hand — committing / pushing on that provider's behalf
with explicit attribution (`Co-Authored-By` + persona name in the message). The
**review alternation is preserved exactly**: the provider that did NOT write the
code is the one whose clean review authorizes the push.

## Reactivity — three mechanisms (preferred order)

1. **`Monitor`-based mtime poll (push-style, preferred).** Spawn a persistent
   `Monitor` task at the start of any session where the signal is non-IDLE. The
   script polls the live baton's mtime every 2 s and emits one stdout line per
   change — each line arrives as a task notification that wakes the session
   asynchronously, even between turns. Exact command:

   ```bash
   cd <project-root>
   # RC-6: `stat -f %m` is macOS syntax; on GNU it means "filesystem status" and
   # `%m` is invalid, printing a block to stdout while exiting 1. Probe once.
   if stat -c %Y . >/dev/null 2>&1; then mt(){ stat -c %Y "$1"; }; else mt(){ stat -f %m "$1"; }; fi
   # BUG-019: watch the LIVE baton, resolved through the same helper production
   # uses. This recipe used to name AGENT_SIGNAL.md, which is now protocol prose
   # — a monitor pointed there never fires, and the session that armed it goes
   # blind exactly when it believes it is covered. Resolving rather than
   # hardcoding means the recipe follows the baton if it ever moves again.
   . scripts/lib/state-dir.sh
   SIG=$(agent_signal_file "$PWD")
   last=$(mt "$SIG")
   while true; do
     sleep 2
     new=$(mt "$SIG" 2>/dev/null)
     if [ -n "$new" ] && [ "$new" != "$last" ]; then
       last=$new
       holder=$(grep '^| Holder ' "$SIG" | head -1 | sed 's/^| Holder *| //; s/ *|$//')
       state=$(grep '^| State ' "$SIG" | head -1 | sed 's/^| State *| //; s/ *|$//')
       echo "[signal-change] Holder=$holder State=$state"
     fi
   done
   ```

   Invoke via the `Monitor` tool with `persistent: true`, `timeout_ms: 3600000`
   (1 h — the tool's hard max), description `"live baton state-line change
   watcher (Holder + State)"`. Latency ~2 s, zero token cost between events,
   self-noise tolerable (fires on own writes too — just re-read and continue).

   **1-hour cliff.** The Monitor tool caps `timeout_ms` at 3 600 000 (1 h). The
   watcher dies silently at that point. Respawn it at the top of a new turn if
   (a) state is non-IDLE and (b) the previous event hasn't arrived within ~45 min.
   If unsure whether the old one is alive, it's cheaper to respawn than miss a
   handoff.

2. **`ScheduleWakeup` polling (fallback for `/loop` mode).** Every 15–30 min the
   agent wakes, re-reads the signal, and either resumes (if state advanced) or
   reschedules. Costs tokens per poll. Use when Monitor isn't available.

3. **Turn-triggered read (passive fallback).** Always re-read the signal at the
   start of every founder turn. Zero cost between turns, but only reacts when the
   founder next sends a message.

Default to (1). If the founder says "stop polling" / "just wait for my next
message", cancel via `TaskStop` and rely on (3).

## Dispatching Codex (signal-driven, not a direct CLI call)

Claude Code does **not** invoke `codex` directly. Codex is woken by a
signal-driven dispatcher that watches the live baton and runs the real Codex
CLI whenever the mic flips to `OVER_TO_CODEX`. Three pieces:

1. **The dispatcher (start once, leave running).** Launch
   `scripts/start-codex-signal-watch.mts` (delegates to the shared,
   provider-agnostic `scripts/signal-watch.mts`, TASK-063) via the **`Monitor` tool with
   `persistent: true`** so it survives in the background and streams run markers
   back as notifications:

   ```
   Monitor (persistent): cd <repo> && node scripts/start-codex-signal-watch.mts 2>&1
   ```

   It polls every 2 s; on each poll where `State = OVER_TO_CODEX` with a
   `Holder|State|Task` key it hasn't fired yet, it runs `codex exec` with the
   verbatim `Task` field wrapped in the radio-over preamble. **The model is the
   `Holder` persona's:** its roster `Model` cell resolves to
   `-m <slug> -c model_reasoning_effort=<effort>` (`bp_roster_model_for_name`).
   A cell that does not resolve refuses the dispatch in the run log and the feed;
   a `Holder` that is not a Codex persona runs the codex default and says so.
   So name the Codex persona in `--holder`, as below. **Trigger is
   state-based:** starting the dispatcher while the signal is already
   `OVER_TO_CODEX` fires it on the first poll — no re-flip needed.

2. **Trigger Codex by flipping the signal, never by calling `codex`.** Write the
   prompt into `Task` **first**, then set `State -> OVER_TO_CODEX` **last**. The
   dispatcher polls every 2s and fires on the `State` edit, so flipping first
   dispatches the *previous* round's Task — a real agent run against work that
   is already finished. **The dispatcher must already be running before you
   flip** — otherwise the trigger fires into the void (the #1 mistake).

   **The supported way to hand off is `scripts/signal-set.sh`**, which composes
   the whole baton and moves it into place in one atomic write:

   ```sh
   scripts/signal-set.sh --holder Jesko --state OVER_TO_CODEX --task-file prompt.md
   ```

   There is then no window in which the new `State` sits beside the previous
   round's `Task`, at any pause length. Hand-editing the two rows still works
   and the watcher additionally waits for the signal to stop changing
   (`AGENT_SIGNAL_SETTLE`, default 6s) — but that is a **mitigation, not a
   boundary**: pause longer than the settle value between the two edits and the
   stale Task is dispatched anyway. `tests/signal-dispatch/` case #5
   demonstrates that limit deliberately rather than describing it.

   This exists because the rule was written down here and in HANDOVER and then
   violated twice in one session by its own author — a rule you must remember
   at the moment you are busy is the wrong kind of fix (the A-22 lesson). The
   first attempt refused any `Task` byte-identical to the last dispatched one;
   four-eyes rejected it, correctly, because task text is not a round identity,
   identical instructions can legitimately recur, and that block lasted the
   whole life of the watcher. Pinned by `tests/signal-dispatch/` (CI, ~80s).

3. **Where output lands.** `logs/state/codex-runs.log` (full run log),
   `logs/state/codex-last-message.md` (final message), `logs/state/signal.log`
   (trigger log). Codex flips the signal back to
   `Holder=<the Orchestrator's roster name> / State=OVER_TO_CLAUDE` itself,
   resolved at dispatch time from the roster's `Orchestrator` row — never a
   hardcoded name, since it varies project to project and engineer to
   engineer. Keep a signal-change
   `Monitor` (mechanism 1) armed so Claude Code wakes on the flip-back.

**Claude personas (TASK-059).** Claude Code has no signal dispatcher: the
Orchestrator spawns them. `scripts/claude-agents.sh`, run on every session start,
writes `.claude/agents/<name-lowercase>.md` for each Claude Code persona except the
Orchestrator, with `model:` and `effort:` from its `Model` cell. Dispatch a persona
with `subagent_type: <name-lowercase>` so it runs on its own model; do not pass a
`model` override, which would replace it.

**Codex binary discovery** (in `start-codex-signal-watch.mts`): `$CODEX_BIN`, then
`codex` on `PATH`, then `~/.vscode/extensions/*/bin/*/codex`. Set
`CODEX_BIN=/path/to/codex` to override. **Common failure modes:** dispatcher not
running when the signal flips; calling `codex` directly (bypasses the protocol);
binary not found; wrong log path (it is `logs/state/` inside the project, not `~/`).

## Dispatching Gemini (signal-driven)

Mirror of the Codex dispatcher, for Gemini. `scripts/start-gemini-signal-watch.mts`
(via the shared `signal-watch.mts` poller with `--state OVER_TO_GEMINI`) runs
the headless Gemini CLI on each flip to `OVER_TO_GEMINI`. Use the headless CLI, not
the interactive IDE agent (it stalls): `GOOGLE_GENAI_USE_GCA=true gemini
--skip-trust --yolo --prompt "..."`. Output lands in `logs/state/gemini-runs.log`
and `logs/state/gemini-last-message.md`. **Caveat:** instruct Gemini to edit
ONLY the `Holder`/`State`/`Task` fields on hand-back — it has flattened the whole
signal table before; keep a git copy to restore.

## Dispatching Kimi (signal-driven)

The same mirror again, for Kimi. `scripts/start-kimi-signal-watch.mts` (via the
shared `signal-watch.mts` poller with `--state OVER_TO_KIMI`) runs the
headless Kimi CLI on each flip to `OVER_TO_KIMI`. Output lands in
`logs/state/kimi-runs.log` and `logs/state/kimi-last-message.md`.

**What is Kimi-specific and worth knowing before you dispatch one:**

- The binary is `kimi` (`KIMI_BIN` overrides) and its home is `~/.kimi-code/`. <!-- a2bp-allow: the Kimi CLI's own home, a tool dotdir like ~/.codex, not a project path; BUG-155 adds it to the known list -->

  **`-p` / `--prompt` is the whole story, and it takes no autonomy flag.** The
  interactive `--auto` and `-y/--yolo` modes exist, but kimi 2.0.2 refuses to
  start when either is combined with `--prompt` (*"Cannot combine --prompt with
  --auto"*) — prompt mode has nobody to ask, so it already never interrupts, and
  it writes files with no approval step. Do not "harden" the dispatcher by adding
  `--auto`: it turns every dispatch into an immediate CLI error. This is measured
  on the binary, not read off `--help`, which does not say so.
- **Kimi's efforts are `low`, `high`, `max` — there is no `medium`.** A roster
  cell that names one is refused rather than silently substituted, which is why
  the example roster's Kimi rows read `high` where their peers read `medium`
  ([AGENT_ROSTER.example.md](AGENT_ROSTER.example.md)).
- The model ranking behind `frontier-N` comes from the roster's
  `Kimi models, best first:` line, not from a provider cache. Kimi's own
  `config.toml` lists the models it has but does not rank them, so the ordering
  is a fleet decision and lives where fleet decisions live.
- **Kimi's "AGENTS.md total exceeds 32 KB" warning never reaches a headless
  agent** — it goes to a session-warnings channel `-p` does not show. The
  byte cap on `AGENTS.md` (`tests/instruction-files`) is the guard that fires.

## GitHub Copilot (notify-only)

`GitHub Copilot` is a recognized team agent handed the mic via the live baton
like the others. To hand off, set `Holder = GitHub Copilot` + `State =
OVER_TO_COPILOT` with a one-line `Task`.

Unlike Codex/Gemini/Kimi there is **no autonomous Copilot dispatcher**:
`scripts/start-copilot-signal-watch.sh` is **notify-only** — it echoes signal
changes and, on `OVER_TO_COPILOT`, prints the `Task` so a human operator (driving
Copilot in the IDE) picks it up. It does not invoke any Copilot CLI. Copilot then
does the work and flips the mic back per the rules above.

## Watching it live

**First agent to wake ENSURES the feed is running:** run
`bash scripts/agent-activity.sh --daemon`. It is idempotent — a kernel `flock`,
not a pidfile — so concurrent wakes cannot produce a second feed, and it returns
immediately. `--stop` stops it; `--status` reports whether it is up.

> **BUG-001:** the old guard was a pidfile + `kill -0` check, which is TOCTOU-racy
> and whose EXIT trap unlinked the shared lock. Concurrent wakes all won, each
> spawning immortal `tail -F` followers. Do not reintroduce "just run the script"
> as the wake step — spawned personas must not start it at all.

On start it:

1. **cleans old entries** — truncates `logs/agent-activity.log` so it can't
   explode across sessions (fresh log per session),
2. **streams** a single `[Agent]`-prefixed feed of each agent's **actual work
   output**, so you don't switch prompts:
   - `[Claude Code]` — text + tool calls from the live session transcript
     (`~/.claude/projects/.../<session>.jsonl`, via jq; private thinking excluded),
   - `[<Persona> - <model> - <effort>]` for every Codex, Gemini and Kimi
     dispatch — written by the provider's own **launcher**, which knows who holds
     the mic, rather than pumped from a run log by the feed, which cannot
     (BUG-021, TASK-063, BUG-141). The run logs still exist in `logs/state/` as
     the full record; the feed simply does not read them,
   - mic/state changes from the live baton.
   Copilot is notify-only (it runs in the IDE; no log to tail).

- `scripts/start-all-watchers.sh` — starts the autonomous dispatchers (Codex,
  Gemini, Kimi) **and** the notify-only watcher (Copilot) in the background. Start
  individual watchers by name when you don't want a specific dispatcher up.

## History

Hand-off history is `logs/state/signal-history.log`, appended by
`signal-set.sh` on every flip.

It used to be `git log -p AGENT_SIGNAL.md`, and losing that was the real cost of
this change — weighed deliberately rather than waved away. Mic flips are local
operational events; the durable decisions they surround belong in
`docs/doing/PLAN-*.md` and the review documents, which are tracked. The journal
is also more accurate in one respect: it records flips that were never
committed, which `git log` could never show.
