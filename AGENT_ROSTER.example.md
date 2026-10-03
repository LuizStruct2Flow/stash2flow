# Agent Roster — EXAMPLE

> **This is the template, not the live roster.** It works like `.env.example`:
> copy it once, then edit your copy freely.
>
> ```bash
> cp AGENT_ROSTER.example.md AGENT_ROSTER.md   # your personal roster (gitignored)
> ```
>
> **`AGENT_ROSTER.md` is gitignored and per-engineer.** Your teammates run
> different agents with different subscriptions and quotas — one has Claude Code
> and Codex, another adds Gemini or Qwen, a third only has what their employer
> licenses. A committed roster would force one person's fleet onto everyone and
> be overwritten on every blueprint sync. So the *example* is blueprint-managed
> and the *live roster* is yours.
>
> **Backing agents are open-ended.** The rows below use Claude Code, Codex and
> Kimi because those are the ones the dispatchers in
> [AGENT_SIGNAL.md](AGENT_SIGNAL.md) ship with, but the `Backing agent` column is free text
> — put `Gemini`, `GitHub Copilot`, `Qwen`, or anything else you actually run.
> Only two things depend on the value: the live feed prints it as the label
> `[Persona - model - effort]` once the persona has a `Model` cell, and any agent you want *dispatched autonomously*
> needs a signal watcher (see [AGENT_SIGNAL.md](AGENT_SIGNAL.md) §Dispatching). An agent
> with no watcher still works — you drive it yourself and it participates in the
> baton normally.

The team. Each member is a **persona** with a fixed **name**, a **role**, and the
**backing agent** that powers it. The persona name is what goes in the
`Holder` field of the live baton `logs/state/signal.md` (published by
`scripts/signal-set.sh`) and in `OVER_TO_<NAME>` handoffs — so two
sessions backed by the same agent type (e.g. two Claude Code sessions) stay
distinguishable. This prevents the same-type collision where two "Claude Code"
sessions both answer `OVER_TO_CLAUDE` and fight over the mic.

**This roster is the DEFAULT starting point — change your copy to fit your
fleet.** Each engineer configures their own constellation from the agents they
have access to and the credits / quota those agents carry. There is no fixed
team. Edit the members below: rename personas, add or drop roles, and set each
one's backing agent to whatever you actually run.

## Members (default)

| Role | Name | Backing agent | Model |
|---|---|---|---|
| Orchestrator | Sylvia | Claude Code | session-based |
| PO | Klaus | Claude Code | frontier-2:medium |
| BA-1 | Annika | Claude Code | frontier-2:medium |
| BA-2 | Kathrin | Codex | frontier-2:medium |
| BA-3 | Joan | Kimi | frontier-2:high |
| Architect-1 | Christian | Claude Code | frontier-1:high |
| Architect-2 | Alexey | Codex | frontier-1:high |
| Architect-3 | Slava | Kimi | frontier-1:high |
| UX | Nicole | Claude Code | frontier-2:medium |
| Front-End-1 | Yannik | Claude Code | frontier-2:medium |
| Front-End-2 | Alex | Codex | frontier-2:medium |
| Front-End-3 | Adam | Kimi | frontier-2:high |
| Back-End-1 | Matthias | Claude Code | frontier-2:medium |
| Back-End-2 | Andreas | Codex | frontier-2:medium |
| Back-End-3 | Jonathan | Kimi | frontier-2:high |
| QA-1 | Vitali | Claude Code | frontier-2:medium |
| QA-2 | Jesko | Codex | frontier-2:medium |
| QA-3 | Vijay | Kimi | frontier-2:high |
| Security-1 | Markus | Claude Code | frontier:high |
| Security-2 | Stefan | Codex | frontier:high |
| Security-3 | Florian | Kimi | frontier:high |
| Infrastructure-1 | Philipp | Claude Code | frontier-2:medium |
| Infrastructure-2 | Elias | Codex | frontier-2:medium |
| Infrastructure-3 | Thomas | Kimi | frontier-2:high |

Claude models, best first: fable, opus, sonnet, haiku
Kimi models, best first: kimi-code/k3, kimi-code/k3-256k, kimi-code/kimi-for-coding, kimi-code/kimi-for-coding-highspeed

**Model** is `<tier>:<effort>`: `frontier` is the provider's best model and
`frontier-N` is N places down its ranked list, so no cell names a model version.
The Orchestrator row is the one exception: its cell is `session-based`, because
the founder picks that session's model at start, not the roster.

**The effort half is the provider's own vocabulary, not a shared scale.** Claude
Code takes `low` … `max`; Codex takes whatever its model's
`supported_reasoning_levels` allow; **Kimi takes `low`, `high`, `max` — it has no
`medium`**, which is why the Kimi rows read `high` where their Claude and Codex
peers read `medium`. Resolution reads each provider's own list and refuses a cell
that names an effort the model does not support, so a wrong cell fails loudly
rather than running at some silently-substituted setting.

**Every delivery role carries one persona per provider**, because the rotation
that spreads work is scoped to a ROLE — a back-end task goes to a back-end
engineer, and only then does the rotation pick which one ([AGENT_SIGNAL.md](AGENT_SIGNAL.md)
§"Who does the work"). A role missing a provider simply rotates across fewer,
and never borrows from another role. The trailing digit is which representative,
not which job; the ordering below (Claude, Codex, Kimi) is a convention for
readability and **nothing reads it** — resolution is by role name, so a fleet
with different providers just numbers them differently.

**`PO`, `UX` and `Orchestrator` are deliberately single-provider.** They are
judgement and coordination roles rather than delivery ones, and the Orchestrator
is by rule the founder-facing session.

Default backing-agent totals: **10 Claude Code, 7 Codex, 7 Kimi.** **Gemini and
GitHub Copilot are also supported** (see [AGENT_SIGNAL.md](AGENT_SIGNAL.md)) but aren't in
the default roster, because on many setups those are free-tier accounts with
limited credits (Gemini throttles on quota; GitHub Copilot may have no headless
CLI to dispatch). If you have paid Gemini / Copilot, give them personas.

**The Orchestrator is the operator's primary, human-facing session** — the Claude
Code prompt the founder talks to and wakes. Whoever holds that row dispatches the
watcher-backed personas (Codex, Gemini, Kimi), hands off to / spawns the other
Claude personas, integrates their work, and owns coordination. The other personas are launched by
the Orchestrator or by the founder as needed.

> **Renaming a persona means editing ONE cell — the Name column above.**
> Everything else refers to the **role**, never the shipped example name, so a
> rename cannot leave half the file describing someone who no longer exists.
> This paragraph used to name the default Orchestrator four times; renaming the
> row then left the prose contradicting the table, which is what made the rename
> look like it had not worked.
>
> The same rule holds outside this file: `CLAUDE.md`, `AGENTS.md` and the scripts
> resolve the Orchestrator **from this table**, and cite the default name only as
> an example. If you find a name hard-coded anywhere that a role would do, that is
> a bug — the roster is per-engineer, and no two fleets share names.

## How identity works on the signal

- **`Holder` = persona name** (e.g. `Holder | Sylvia`), never the bare
  backing-agent type. Handoffs use `OVER_TO_<NAME>` (e.g. `OVER_TO_KATHRIN`,
  `OVER_TO_CHRISTIAN`).
- **Each session knows its own persona** (assigned on wake) and acts ONLY when the
  mic is for it — `Holder = <me>` or `State = OVER_TO_<ME>`. It ignores handoffs
  meant for other personas, even ones on the same backing agent. This is what lets
  multiple same-backing personas coexist without colliding.
- **ACTIVE-on-claim applies**: on claiming the mic, set `State = ACTIVE` and `Holder = <your
  persona>` before working (see [AGENT_SIGNAL.md](AGENT_SIGNAL.md)).

## Dispatch (backing agent → how the persona is launched)

- **Claude Code** personas: spawned by the Orchestrator as
  `subagent_type: <name-lowercase>`. `scripts/claude-agents.sh` writes each one's
  `.claude/agents/<name>.md` (model and effort from the `Model` cell) on every
  session start; the Orchestrator row gets none, since the founder picks that
  session's model.
- **Codex / Gemini / Kimi** personas: launched by their dispatcher
  (`start-codex-signal-watch.mts` / `start-gemini-signal-watch.mts` /
  `start-kimi-signal-watch.mts`). All three drive the same provider-agnostic
  polling engine, so a fourth provider is a launcher, not an engine. The dispatch
  task names the persona/role for the run; a persona in `Holder` runs on the
  model its `Model` cell resolves to, and — for Codex and Gemini — the effort
  too. **Kimi is the exception: the effort is REQUESTED, not applied.** Kimi
  2.0.2 has no per-invocation effort flag, so the cell's effort is only what was
  asked for; what actually governs the run is the `[thinking]` effort (or
  `default_effort`) already configured in Kimi own `config.toml`, and the feed
  label reflects that applied value, not the roster cell, or omits effort
  entirely when the config cannot be read (TASK-063 cross-provider review).
- **GitHub Copilot** personas: notify-only unless a headless Copilot CLI is
  installed — a human operator drives Copilot in the IDE (see AGENT_SIGNAL.md).

**Optional enhancement (not wired by default):** make the dispatchers roster-aware
— fire on `OVER_TO_<persona>` (resolved to the backing agent via this table) and
inject the persona + role into the run preamble, so `OVER_TO_SLAVA` launches Kimi
acting as Architect-1. Until then, route those personas via `OVER_TO_CODEX` /
`OVER_TO_GEMINI` / `OVER_TO_KIMI` with the target persona named in `Holder`/`Task`.

## Live team feed

`scripts/agent-activity.sh` streams one tail-able `[Persona - model - effort]` feed
(every agent's mic moves + the watcher-backed providers' run output + the
orchestrator's session output). The first agent to wake starts it; it cleans its log and opens a tail
terminal. `scripts/team-kickoff.sh` runs a round-robin kick-off where each persona
presents itself and hands the mic to the next — a quick way to confirm the roster
and the coordination loop after editing this file.
