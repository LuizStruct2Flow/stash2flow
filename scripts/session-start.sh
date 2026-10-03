#!/usr/bin/env bash
# scripts/session-start.sh — the Claude Code SessionStart hook (TASK-022 #20).
#
# Replaces the wake steps an agent used to be asked to remember: start the
# activity feed, and check the project against the blueprint. Claude Code adds
# this script's stdout to the session's context, so the session sees the result.
#
# Contract (PLAN-TASK-022 §4.2):
#   - never blocks or breaks a session start: always exits 0;
#   - the feed and drift are independent — neither runs on the other's status;
#   - a drift failure is reported as UNKNOWN, never as clean;
#   - bounded, not backgrounded: a backgrounded drift could not report into the
#     session, so drift's own timeouts are cut from 30 s + 8 s to 8 s + 4 s.
#     Offline, a session start waits at most ~12 s; the hook's own `timeout` in
#     settings.json is the backstop.
#
# Relative paths throughout, from the project root: this ships to every derived
# project, which may have no feed script or no .blueprint-source. A session can
# start in a subdirectory, so the root is this script's parent, not the cwd.
set -u
cd "$(dirname "$0")/.." || exit 0

echo "== session start =="

# 1. The feed. First, so a later hang cannot stop it. Idempotent per repository.
if [ -f scripts/agent-activity.sh ]; then
  bash scripts/agent-activity.sh --daemon 2>&1 | head -5
else
  echo "feed: scripts/agent-activity.sh not present — not started."
fi

# 2. Drift, bounded. Its exit status decides only the verdict line below.
if [ -f scripts/blueprint.mts ]; then
  out="$(BP_FETCH_TIMEOUT="${BP_FETCH_TIMEOUT:-8}" BP_STALENESS_TIMEOUT="${BP_STALENESS_TIMEOUT:-4}" \
    node scripts/blueprint.mts drift 2>&1 </dev/null)"
  rc=$?
  printf '%s\n' "$out" | head -40
  if [ "$rc" -eq 0 ]; then
    echo "drift: checked (exit 0) — report above."
  else
    echo "drift: UNKNOWN — blueprint drift exited $rc (unreachable or failed). Do NOT report this project as in sync."
  fi
else
  echo "drift: UNKNOWN — scripts/blueprint.mts not present, so nothing was compared."
fi

# 3. Claude persona subagent definitions, from the roster's Model cells (TASK-059).
if [ -f scripts/claude-agents.sh ]; then
  bash scripts/claude-agents.sh 2>&1 | head -40
else
  echo "claude-agents: scripts/claude-agents.sh not present — persona agents not generated."
fi

echo "Next: arm the wake-time Monitors (CLAUDE.md §\"On wake\")."
exit 0
