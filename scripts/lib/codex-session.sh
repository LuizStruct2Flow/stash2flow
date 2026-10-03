#!/usr/bin/env bash
# scripts/lib/codex-session.sh — TASK-060.
#
# The roster's Model cell is what a Codex dispatch was ASKED to run with. The
# only record of what it ACTUALLY ran with is Codex's own session rollout file
# (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`), which carries a
# `turn_context` record with `payload.model` / `payload.effort`. Mirrors the
# Claude side (`scripts/lib/roster.sh:_bp_roster_ran_model`, TASK-059), which
# reads the model from a Claude subagent's own transcript rather than trusting
# what it was dispatched with.
#
# IDENTITY, NOT GUESSING — this used to be bounded guessing (newest file newer
# than a dispatch marker, matching cwd) because `codex exec --json` appeared to
# print no session/thread id. It does: `grep -a` over the vendored Codex binary
# (`@openai/codex-linux-x64`) turned up the literal event-type string
# `codex.thread.started` (the enum tag serializes as `thread.started`) and the
# field name `thread_id` as a distinct string constant. The rollout's own
# filename convention was already confirmed straight from a real dispatch
# (2026-09-17): `rollout-<timestamp>-<id>.jsonl` where `session_meta.payload.id`
# INSIDE the file equals that `<id>` suffix. Codex's `resume` subcommand takes
# "session id (UUID) or thread name" interchangeably, so `thread_id` and the
# rollout's `session_meta.payload.id` are the same identifier under two names.
#
# VERIFIED LIVE, 2026-09-17 16:08Z (codex-cli 0.154.0): `thread_id` sits at the
# top level of the `thread.started` event on `codex exec --json`'s stdout. A
# real Jesko dispatch resolved thread 01a0b020-5907-79f3-b279-4fcbc54f7e77 to
# its rollout file, and that file records model gpt-5.6-terra, effort medium.
# If a later Codex nests the field, `bp_codex_thread_id_from_stream` finds
# nothing and the run log says "actual model: unknown" — it never guesses.
#
# Usage:
#   . scripts/lib/codex-session.sh
#   bp_codex_thread_id_from_stream <raw_json_file>       # -> thread_id, rc 1 if no thread.started seen
#   bp_codex_rollout_for_thread <codex_home> <thread_id>  # -> rollout path, rc 1 if none / identity mismatch
#   bp_codex_model_effort <rollout_file>                  # -> "model<TAB>effort", rc 1 if not found / no jq

# The thread id from the FIRST `thread.started` event in a captured copy of
# `codex exec --json`'s raw stdout (the launcher `tee`s it there before
# filtering — see start-codex-signal-watch.mts). rc 1 if no such event was
# seen, no jq, or the file is unreadable: the caller reports "unknown", never
# invents an id.
bp_codex_thread_id_from_stream(){
  local f="${1:-}" id
  [ -r "$f" ] || return 1
  command -v jq >/dev/null 2>&1 || return 1
  id="$(jq -r 'select(.type == "thread.started") | (.thread_id // empty)' "$f" 2>/dev/null | head -1)"
  [ -n "$id" ] || return 1
  printf '%s' "$id"
}

# The rollout file named for this EXACT thread id — never "the newest file",
# never a cwd-based match. A decoy rollout for a different thread, however
# recent, is invisible to this lookup: the filename glob only matches the id
# itself. The filename is a NAMING CONVENTION, not proof by itself, so the
# match is confirmed against the file's own session_meta.payload.id before it
# is trusted — a colliding or truncated filename is rc 1, not a wrong file.
bp_codex_rollout_for_thread(){
  local codex_home="${1:-$HOME/.codex}" thread_id="${2:-}" f
  [ -n "$thread_id" ] || return 1
  command -v jq >/dev/null 2>&1 || return 1
  f="$(find "$codex_home/sessions" -type f -name "rollout-*-${thread_id}.jsonl" 2>/dev/null | head -1)"
  [ -n "$f" ] || return 1
  jq -e --arg id "$thread_id" \
       'select(.type == "session_meta") | select(.payload.id == $id)' \
       "$f" >/dev/null 2>&1 || return 1
  printf '%s' "$f"
}

# The LAST turn_context record in the file — a session can span several turns
# (e.g. a resumed one), and the most recent is what the run actually ran with
# most recently. rc 1 if the file is unreadable, has no jq, or carries no
# turn_context (an ultra-short-lived or malformed session).
bp_codex_model_effort(){
  local f="${1:-}" line
  [ -r "$f" ] || return 1
  command -v jq >/dev/null 2>&1 || return 1
  line="$(jq -rc 'select(.type == "turn_context") | [(.payload.model // empty), (.payload.effort // empty)] | @tsv' \
    "$f" 2>/dev/null | tail -1)"
  [ -n "$line" ] || return 1
  printf '%s' "$line"
}
