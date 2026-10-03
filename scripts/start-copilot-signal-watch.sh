#!/usr/bin/env bash
# NOTIFY-ONLY: This watcher only notifies a human/operator when the mic flips to
# GitHub Copilot. It does NOT invoke any Copilot CLI or act as an autonomous
# dispatcher. Operators claim the mic by RUNNING scripts/signal-set.sh, then act
# manually. Do not hand-edit the baton (BUG-019: one writer, atomic publication).
# Lightweight watcher for the live baton that notifies when the mic flips to GitHub Copilot
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/state-dir.sh
BP_CODE_ROOT="$repo_root"
. "$repo_root/scripts/lib/state-dir.sh"
BP_STATE_ROOT="$(bp_state_root)" || exit 9
# BUG-019: the LIVE baton is untracked state, resolved through the one shared
# helper. Reading the tracked AGENT_SIGNAL.md here would read protocol prose,
# and — worse, before the split — a file git rewrites under a live dispatch.
signal_file="$(agent_signal_file)"
last=""
echo "Starting Copilot signal watcher (watching $signal_file)"
if [ ! -f "$signal_file" ]; then
  echo "No live baton at $signal_file — run scripts/signal-set.sh once to seed it" >&2
  exit 1
fi
# BUG-001 / RC-6: `stat -f %m f || stat -c %Y f` is NOT a portable fallback. On
# GNU coreutils `-f` means "filesystem status", so `%m` is invalid — it prints a
# multi-line block to STDOUT and exits 1, and `$(a || b)` captures BOTH. The
# "mtime" then contained live free-block counters that change on every write, so
# this watcher re-announced [signal-change] every 2s into an unrotated log.
# Probe once, then call only the correct form.
if stat -c %Y . >/dev/null 2>&1; then
  file_mtime(){ stat -c %Y "$1" 2>/dev/null; }
else
  file_mtime(){ stat -f %m "$1" 2>/dev/null; }
fi

last=$(file_mtime "$signal_file")
while true; do
  sleep 2
  new=$(file_mtime "$signal_file")
  if [ -n "$new" ] && [ "$new" != "$last" ]; then
    last=$new
    holder=$(grep '^| Holder ' "$signal_file" | head -1 | sed 's/^| Holder *| //; s/ *|$//') || holder=""
    state=$(grep '^| State ' "$signal_file" | head -1 | sed 's/^| State *| //; s/ *|$//') || state=""
    task=$(grep '^| Task ' "$signal_file" | head -1 | sed 's/^| Task *| //; s/ *|$//') || task=""
    echo "[signal-change] Holder=$holder State=$state"
    if [ "$state" = "OVER_TO_COPILOT" ] || [ "$holder" = "GitHub Copilot" ]; then
      echo "=== Copilot handoff detected ==="
      echo "Task: $task"
      echo "Claim the mic with: scripts/signal-set.sh --holder <you> --state ACTIVE --task ..."
      echo "Protocol: AGENT_SIGNAL.md. Walk docs/DoD.md before acting."
    fi
  fi
done
