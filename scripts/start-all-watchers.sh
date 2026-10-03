#!/usr/bin/env bash
# Start all signal watchers (codex, copilot, gemini, kimi) in the background and log to ./logs/
# WARNING: This helper may start autonomous dispatchers (Codex, Gemini, Kimi)
# which invoke CLIs. Use intentionally; prefer starting notify-only watchers by name.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
logs_dir="$repo_root/logs"
mkdir -p "$logs_dir"

start_watch(){
  script="$repo_root/scripts/$1"
  logfile="$logs_dir/$1.log"
  if [ -x "$script" ]; then
    nohup "$script" >>"$logfile" 2>&1 &
    echo "Started $1 -> $logfile"
  else
    echo "Script $script not executable or missing; try: chmod +x $script" >&2
  fi
}

dispatchers=(start-codex-signal-watch.mts start-gemini-signal-watch.mts start-kimi-signal-watch.mts)
notifiers=(start-copilot-signal-watch.sh)

echo "Starting dispatchers: ${dispatchers[*]}"
for s in "${dispatchers[@]}"; do
  start_watch "$s"
done

echo "Starting notifiers: ${notifiers[*]}"
for s in "${notifiers[@]}"; do
  start_watch "$s"
done

echo "All requested watchers started (if scripts were present). Logs: $logs_dir"
