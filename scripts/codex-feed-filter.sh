#!/usr/bin/env bash
# codex-feed-filter — collapse `codex exec --json` JSONL into ONE concise line per
# action, matching scripts/agent-activity.sh's claude_feed() granularity.
#
# WHY: piping raw `codex exec` (non-json) into the feed echoed EVERYTHING codex
# printed — including every line of every file it read — drowning the
# [Persona - model - effort] feed. With `--json`, codex emits structured events
# and file CONTENTS are no longer feed lines (only the command is). This filter
# keeps just the high-level beats: codex's prose messages, the commands it runs,
# file changes, and a per-turn token tally. Reasoning + raw output are dropped.
#
# Usage (in the dispatcher / any codex call):
#   codex exec --json … 2>>"$LOG" | bash scripts/codex-feed-filter.sh >>"$LOG"
#
# Defensive: no jq → passthrough (never silently eat codex output); non-JSON
# preamble lines ("Reading additional input from stdin…") are skipped.
set -uo pipefail

if ! command -v jq >/dev/null 2>&1; then cat; exit 0; fi

while IFS= read -r line; do
  [ -n "$line" ] || continue
  printf '%s' "$line" | jq -rc '
    def clip(n): tostring | gsub("[\r\n]+";" ") | .[0:n];
    if .type == "item.completed" then
      (.item // {}) as $it
      | ( $it.type // "" ) as $t
      | if   $t == "agent_message"     then "💬 " + (($it.text // "") | clip(220))
        elif $t == "reasoning"          then empty
        elif $t == "command_execution"  then "> " + (($it.command // $it.cmd // $it.action // "cmd") | clip(100))
        elif $t == "file_change"        then "> change: " + (($it.path // (($it.changes // []) | map(.path // .) | join(", "))) | clip(120))
        elif ($t | test("call$"))       then "> " + (($it.name // $t) | tostring) + " " + (($it.command // $it.arguments // "") | clip(80))
        else empty end
    elif .type == "turn.completed" then
      "✓ turn done (" + ((.usage.output_tokens // 0) | tostring) + " out-tok)"
    elif .type == "error" then
      "⚠ " + ((.message // .error // "error") | tostring | .[0:140])
    else empty end
  ' 2>/dev/null || true
done
