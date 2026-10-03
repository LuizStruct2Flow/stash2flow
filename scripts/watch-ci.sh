#!/usr/bin/env bash
# scripts/watch-ci.sh — render the SERVER side of the pipeline after a push.
#
# FEATURE-002, second half. The pre-push gate shows what ran on this machine;
# this shows the required checks GitHub runs after the commits land. Together
# they are the whole pipeline, and the split matters: the local gate BLOCKS,
# CI only REPORTS. For a failing test that distinction is academic — you fix
# forward. For a secret it is everything: once pushed to a public repo it is
# world-readable, and CI's answer can only ever be "rotate that credential",
# never "that did not happen".
#
# Backgrounded by .githooks/pre-push after the gate passes. It must therefore be
# unable to hurt anything:
#   - it NEVER blocks the push (the hook does not wait on it),
#   - it NEVER changes the push's exit status,
#   - it always exits, on a hard deadline, even if no run ever appears.
#
# BUG-001 is why the last point is written down: a helper that waits forever for
# something that will never arrive is exactly how this host ended up with ~17,400
# unreaped processes. One process, one deadline, no retry loop without a bound.
#
# Usage:
#   bash scripts/watch-ci.sh <sha> [timeout_seconds]
#   AGENT_CI_WATCH=0   disables it entirely (set in the environment)

set -uo pipefail

SHA="${1:-}"
DEADLINE="${2:-600}"
POLL="${AGENT_CI_POLL:-15}"

[ -n "$SHA" ] || { echo "usage: watch-ci.sh <sha> [timeout_seconds]" >&2; exit 2; }
command -v gh >/dev/null 2>&1 || exit 0    # no gh, nothing to watch — silently fine

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
# One appender, shared with the gate renderer — it owns the path resolution and
# the inode-preserving rotation. This file used to inline its own append, which
# is how two writers to the same log drift apart on rotation and one of them
# orphans the supervisor's open handle.
#
# BUG-077: feed.sh no longer asks git where it is. The state root is resolved
# here, once, the way every other consumer resolves it — $repo_root is this
# script's CODE root, and bp_state_root walks up from it to the project.
BP_CODE_ROOT="$repo_root"
. "$repo_root/scripts/lib/state-dir.sh"
BP_STATE_ROOT="$(bp_state_root)" || exit 0
# shellcheck source=scripts/lib/feed.sh
. "$repo_root/scripts/lib/feed.sh"

# Emit to the terminal AND to the activity feed, so the result is visible
# whether or not anyone is still looking at the shell that pushed.
say(){ printf '%s\n' "$1"; feed_append "[CI] $1"; }

started=$(date +%s)
elapsed(){ echo $(( $(date +%s) - started )); }

# Wait for the run to be created — a push does not produce one instantly.
run_id=""
while [ -z "$run_id" ]; do
  [ "$(elapsed)" -lt "$DEADLINE" ] || { say "no CI run appeared for ${SHA:0:7} within ${DEADLINE}s — check 'gh run list'"; exit 0; }
  run_id="$(gh run list --commit "$SHA" --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
  # jq renders a missing .[0] as the literal string "null" — the exact trap that
  # made BUG-011 report a PR as filed when none existed. Treat it as empty.
  [ "$run_id" = "null" ] && run_id=""
  [ -n "$run_id" ] || sleep "$POLL"
done

say "CI started for ${SHA:0:7} — $(gh run view "$run_id" --json url --jq .url 2>/dev/null)"

# Report each check ONCE, as it reaches a terminal state. `comm` against the
# previous snapshot is what keeps this from re-announcing every poll.
prev=""
while :; do
  if [ "$(elapsed)" -ge "$DEADLINE" ]; then
    say "stopped watching ${SHA:0:7} after ${DEADLINE}s — CI still running; 'gh run watch $run_id'"
    exit 0
  fi

  snap="$(gh run view "$run_id" --json jobs \
          --jq '.jobs[] | "\(.name)\t\(.conclusion // "pending")"' 2>/dev/null || true)"
  cur="$(printf '%s\n' "$snap" | grep -v 'pending$' | sort || true)"
  comm -13 <(printf '%s\n' "$prev") <(printf '%s\n' "$cur") 2>/dev/null \
    | while IFS="$(printf '\t')" read -r name concl; do
        [ -n "$name" ] || continue
        case "$concl" in
          success) say "  ✓ $name" ;;
          skipped) say "  – $name (skipped)" ;;
          *)       say "  ✗ $name ($concl)" ;;
        esac
      done
  prev="$cur"

  status="$(gh run view "$run_id" --json status --jq .status 2>/dev/null || echo '')"
  if [ "$status" = "completed" ]; then
    concl="$(gh run view "$run_id" --json conclusion --jq .conclusion 2>/dev/null || echo '?')"
    if [ "$concl" = "success" ]; then
      say "CI PASSED for ${SHA:0:7} in $(elapsed)s"
    else
      say "CI $(printf '%s' "$concl" | tr '[:lower:]' '[:upper:]') for ${SHA:0:7} — gh run view $run_id --log-failed"
    fi
    exit 0
  fi
  sleep "$POLL"
done
