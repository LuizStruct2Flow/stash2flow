@AGENTS.md

**Self-check.** The text imported above must begin with the heading
"Agent instructions — shared by the four CLI providers". If it does not, this
project's `AGENTS.md` predates TASK-084: tell the founder and run
`blueprint pull AGENTS.md` before any other work.

The shared rules are in `AGENTS.md`, which every provider reads. The sections
this file used to hold (the main concerns, "Agent Coordination", "Running
commands", "Team Workflow", "Blueprint sync" and the rest) are there under the
same headings, so a reference to "CLAUDE.md §X" means that heading there. The
coordination protocol is `AGENT_SIGNAL.md`. This file holds only what binds
Claude Code alone; a rule any other provider should follow goes in `AGENTS.md`.

## Claude Code only

### On wake — the primary session is the Orchestrator

The Claude Code prompt the founder talks to **directly** is the **Orchestrator**.
Its name is the `Name` cell of the `Orchestrator` row in
[AGENT_ROSTER.md](AGENT_ROSTER.md) (`bash scripts/agent-activity.sh --whoami`
prints it); never assume it. That name is your `Holder`, and handoffs to you are
`OVER_TO_<NAME>`.

**A `SessionStart` hook does the rest of the wake** (`scripts/session-start.sh`,
wired in `.claude/settings.json`): it starts the activity feed and runs
`blueprint drift`, and its report is in your context. A drift line reading
`UNKNOWN` means nothing was compared: tell the founder, and never report the
project as in sync. If drift shows changes, summarise them and offer
`blueprint pull`; do not pull silently.

**Then arm the wake-time Monitors**, `persistent: true`, each emitting only on
change: the mic (`logs/state/signal.md`, every `Holder`/`State` change, not just
`OVER_TO_<you>`), and whatever `project_config_paths.md` §"Wake-time Monitors"
declares. Then orchestrate the roster.

## Spawning personas

Spawn specialized agents (backend, frontend, infra, QA, design) with the `Agent`
tool and the right `subagent_type`. For a roster persona that is its lowercase
name, so it runs on its own model; do not pass a `model` override
(`AGENT_SIGNAL.md`, "Claude personas").

## Enforcement that binds Claude Code only

`.claude/settings.json` enforces some shared rules for Claude Code sessions; no
other provider reads it, so for them the rule text is the whole of it:

- its `deny` list refuses writes into `/tmp`, commands naming a `/tmp/` path
  and `mktemp` without `-p` (`AGENTS.md` §"Running commands");
- `PreToolUse` runs `scripts/no-chain-guard.sh`, which refuses chained
  commands, and `scripts/flip-checks.mts`, which warns at a mic flip;
- `Stop` runs `scripts/link-guard.mts`, which refuses a reply whose item ids
  are not links (`AGENT_SIGNAL.md` §"Rules").
