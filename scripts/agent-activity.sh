#!/usr/bin/env bash
# Unified agent activity feed — ONE tail-able stream, one [Persona - model - effort]
# prefix per line (TASK-059; [Persona - Backing] for a persona with no Model cell),
# merging:
#   - AGENT_SIGNAL.md mic changes           → [<Holder>] <State> — <Task>
#   - Codex, Gemini and Kimi dispatches     → labelled by their OWN launcher,
#     per persona, at the point of dispatch (BUG-021, TASK-063, BUG-141). This
#     feed pumps no provider run log: a pump chosen here is bound once at daemon
#     start, while the mic changes hands many times under it.
#   - this repo's newest Claude transcript  → [<persona> - <model> - <effort>] <line>
#   - each Agent-tool subagent's transcript → [<persona> - <model it ran on> - <effort>] <line>
#
# Usage:
#   bash scripts/agent-activity.sh            # foreground; Ctrl-C stops
#   bash scripts/agent-activity.sh --daemon   # detach; idempotent; returns at once
#   bash scripts/agent-activity.sh --stop     # stop the running feed
#   bash scripts/agent-activity.sh --status   # is it running?
#   bash scripts/agent-activity.sh --whoami   # which persona this session is
#   tail -F logs/agent-activity.log           # follow from anywhere (-F: it rotates)
#
# Env:
#   AGENT_STATE_HOME=...  state dir for dispatcher run logs
#                         (default <repo>/logs/state — BUG-020: inside the
#                         project, so deleting it deletes the state)
#   AGENT_PERSONA=...     OVERRIDE this session's persona. Default comes from
#                         the roster's Orchestrator row, never from a literal
#                         here (BUG-010).
#   AGENT_BACKING=...     OVERRIDE this session's backing agent. Default is the
#                         roster's Backing agent cell for the resolved persona.
#
# ---------------------------------------------------------------------------
# BUG-001 — why this is written the way it is.
#
# The previous design spawned one `tail -F` per watched file, per instance, and
# never reaped them. `tail -F` follows by NAME and retries forever, so a
# finished subagent's transcript kept its follower alive indefinitely. Combined
# with a TOCTOU pidfile guard that let N concurrent wakes all win, this reached
# ~17,400 script instances and ~8,700 tails on one host, exhausted
# fs.inotify.max_user_instances (128) — at which point GNU tail silently
# degrades to 1-second stat polling — and pegged ~24 of 32 threads for 2.7 days
# at zero application load.
#
# This version is ONE resident process that tracks a byte offset per file and
# reads only the delta. No follow-by-name, no process per transcript, no
# inotify instances, and attribution is free because the reader already knows
# which path it read. Design + 5 rounds of cross-provider review:
# docs/doing/PLAN-BUG-001.md.
# ---------------------------------------------------------------------------

set -uo pipefail

# --- physical script root (A-09 / BUG-020) -----------------------------------
# Resolved from THIS FILE, through symlinks. See scripts/signal-watch.mts
# for why $0, cwd and `git rev-parse` are each wrong here. The block below is
# byte-identical in every consumer and tests/state-dir/ #7 enforces that: it
# cannot be shared as a lib, because finding the lib is the very problem it
# solves.
_bp_self="${BASH_SOURCE[0]}"
_bp_hops=0
while [ -L "$_bp_self" ] && [ "$_bp_hops" -lt 40 ]; do
  _bp_dir="$(cd -P "$(dirname "$_bp_self")" && pwd)"
  _bp_self="$(readlink "$_bp_self")"
  case "$_bp_self" in /*) ;; *) _bp_self="$_bp_dir/$_bp_self" ;; esac
  _bp_hops=$((_bp_hops + 1))
done
if [ -L "$_bp_self" ]; then
  echo "FATAL: symlink chain for $_bp_self exceeds 40 hops — cycle?" >&2
  exit 1
fi
_bp_root="$(cd -P "$(dirname "$_bp_self")/.." && pwd)"
BP_CODE_ROOT="$_bp_root"
repo_root="$_bp_root"
# Sourced here rather than further down, because agent_signal_file() lives in
# the same lib and the baton is resolved immediately below. A use-before-source
# yields an empty path silently instead of failing.
. "$repo_root/scripts/lib/state-dir.sh"
BP_STATE_ROOT="$(bp_state_root)" || exit 9
# BUG-019: the LIVE baton is untracked state, resolved through the one shared
# helper. Reading the tracked AGENT_SIGNAL.md here would read protocol prose,
# and — worse, before the split — a file git rewrites under a live dispatch.
signal_file="$(agent_signal_file)"
# BUG-077: the STATE root, not this script's CODE root. The supervisor holds
# the feed open and appends by offset while scripts/lib/feed.sh appends by path,
# so the two must derive the same file from the same rule — that is A-09's whole
# argument, and `$repo_root/logs` here versus a state-root path there is exactly
# the split it forbids. Identical today (the roots coincide in a flat tree);
# after the scaffolding/ move it is the difference between one feed and two.
log_dir="$BP_STATE_ROOT/logs"; mkdir -p "$log_dir"
out="$log_dir/agent-activity.log"
lock_file="$log_dir/.agent-activity.lock"
state_file="$log_dir/.agent-activity.state"

# Generic, project-neutral state dir. Derived from the repo name so a derived
# project reads the dispatcher logs IT writes — never another project's
# (BUG-002: this used to hardcode ~/.linkedin-watcher-agent).  a2bp-allow: that
# path is the incident record, quoted in a comment, not a live path. The derivation is
# shared with the dispatchers via scripts/lib/state-dir.sh so both sides compute
# the identical directory — one mechanism, never two (A-09). Sourced above.
state_dir="$(agent_state_dir)"; mkdir -p "$state_dir"

# --- who is this session? (BUG-010) ----------------------------------------
# The roster's Orchestrator row is the source of truth. AGENT_PERSONA is an
# OVERRIDE — a spawned, non-primary persona declares itself with it — not the
# default. It used to be `${AGENT_PERSONA:-<a name>}`, which made renaming the
# roster do nothing at all and shipped one fleet's persona name to every derived
# project (same class as BUG-002).
. "$repo_root/scripts/lib/roster.sh"

# The watcher-liveness oracle, shared with scripts/signal-watch.mts (TASK-063,
# formerly scripts/codex-signal-watch.sh) which takes the lock this tests
# (BUG-022). Guarded rather than sourced outright: a
# project that has pulled the feed but not this lib must keep its feed, and lose
# only the dead-watcher warning. watcher_liveness_line no-ops without it.
[ -r "$repo_root/scripts/lib/watcher-lock.sh" ] && . "$repo_root/scripts/lib/watcher-lock.sh"

#
# Re-resolvable ON PURPOSE. The supervisor is long-lived and the roster is a
# live config file, so resolving identity once at startup makes the feed report
# whatever the roster said when the daemon booted — a rename then does nothing
# until someone restarts it, and nothing says so. That was the first fix's gap:
# it moved the truth from a literal in the source to a snapshot taken at boot,
# which is closer but still not the roster. `resolve_identity` is called at
# startup and again whenever the roster file changes underneath us.
resolve_identity(){
  persona="${AGENT_PERSONA:-}"
  if [ -z "$persona" ]; then
    persona="$(bp_roster_name_for_role "$BP_STATE_ROOT" Orchestrator)"
    # Fail visibly, and fall back to the ROLE rather than to somebody's name: a
    # feed labelled [Orchestrator] is obviously unresolved, where a feed labelled
    # with a plausible name is indistinguishable from a correct one.
    [ -n "$persona" ] || persona="Orchestrator"
  fi
  if [ -n "${AGENT_BACKING:-}" ]; then
    self_label="$persona - $AGENT_BACKING"
  else
    self_label="$(bp_roster_label "$BP_STATE_ROOT" "$persona")"
  fi
}

# Cheap change token for the roster: which file, how big, when touched. Same
# shape as the signal file's size+inode token — an unchanged roster costs one
# stat per tick and emits nothing.
roster_token(){
  local f; f="$(bp_roster_file "$BP_STATE_ROOT" 2>/dev/null)" || { printf 'none'; return; }
  printf '%s:%s:%s' "$f" "$(f_size "$f")" "$(f_mtime "$f")"
}

TICK="${AGENT_FEED_TICK:-2}"
MAX_FRAGMENT="${AGENT_FEED_MAX_FRAGMENT:-1048576}"   # 1 MiB force-flush bound
SUBAGENT_MAX_AGE_MIN="${AGENT_FEED_SUBAGENT_AGE:-180}"

# --- portable stat (RC-6 / A-06) -------------------------------------------
# `stat -f %m f || stat -c %Y f` is NOT a portable fallback: on GNU coreutils
# `stat -f` means "filesystem status", so `%m` is invalid — it prints a
# multi-line block to STDOUT and exits 1. `$(a || b)` captures BOTH outputs, so
# the "mtime" became a blob containing live free-block counters that change on
# every write. The change detector then fired on nearly every poll. Probe once,
# then call only the correct form.
if stat -c %Y . >/dev/null 2>&1; then
  f_size(){  stat -c %s "$1" 2>/dev/null; }
  f_inode(){ stat -c %i "$1" 2>/dev/null; }
  f_mtime(){ stat -c %Y "$1" 2>/dev/null; }
else
  f_size(){  stat -f %z "$1" 2>/dev/null; }
  f_inode(){ stat -f %i "$1" 2>/dev/null; }
  f_mtime(){ stat -f %m "$1" 2>/dev/null; }
fi

ts(){ date +%H:%M:%S; }

# --- roster lookup ----------------------------------------------------------
# Delegates to scripts/lib/roster.sh. It used to grep `"| $name |"` with literal
# single spaces, so a column-padded table — what every markdown formatter emits
# — never matched, and the miss was indistinguishable from "no roster", so it
# degraded in silence (BUG-010, half 2). The shared parser trims fields and
# warns once per unresolved name.
# Delegates to bp_roster_label, which is shared with scripts/start-codex-signal-
# watch.sh. It used to build the string here, which is why the Codex launcher
# had no way to produce the same label and every Codex line arrived as a bare
# [CODEX] (BUG-021).
persona_label(){
  bp_roster_label "$BP_STATE_ROOT" "$1"
}

# --- who is behind one subagent transcript? (BUG-027, BUG-124) ---------------
# Every subagent transcript has a sibling agent-<id>.meta.json: the dispatch
# `description` (the only place the PERSONA appears), `agentType`
# (`general-purpose` for nearly all of them), and `parentAgentId` on a helper a
# subagent started. bp_roster_subagent_label turns that into the label, and the
# hook's bookends call the same function, so the two cannot disagree (BUG-010,
# BUG-021) — which they did until BUG-124, when the hook derived its own.
#
# Falls back to a truncated id rather than failing. A stable, unhelpful label
# beats a feed that stops.
#
# Cached by the caller (LABEL[]), because the meta file is written at dispatch
# and re-resolving it every tick would cost a jq per subagent per tick forever.
# The MODEL is a separate story (TASK-059): a transcript discovered before its
# first assistant record has no ran model yet, so bp_roster_subagent_label falls
# back to the configured alias (or, for a nested subagent, no model at all) —
# and that fallback used to get cached FOREVER, so a stream never picked up the
# real model even after the transcript started recording one. The caller tracks
# whether the model was known at resolution time (label_model_known) and keeps
# re-resolving — one jq check per tick, same cost as any other cached lookup —
# until it is, then the label is stable for the stream's life exactly as before.
subagent_label(){
  local f="$1" aid="$2"
  bp_roster_subagent_label "$BP_STATE_ROOT" "${f%.jsonl}.meta.json" 2>/dev/null ||
    printf 'sub:%s - Claude Code' "${aid:0:6}"
}

# rc 0: the transcript beside this meta file already has a ran model recorded.
label_model_known(){
  [ -n "$(_bp_roster_ran_model "${1%.jsonl}.meta.json")" ]
}

# Resolve once now; the supervisor re-resolves whenever the roster changes.
resolve_identity
field(){ grep "^| $1 " "$signal_file" 2>/dev/null | head -1 | sed "s/^| $1 *| //; s/ *|\$//"; }

# ===========================================================================
# CLI modes
# ===========================================================================

# The lock is the liveness oracle, NOT the state file. flock is released by the
# kernel on death — including SIGKILL — so "can I take the lock?" answers
# "is a supervisor alive?" with no stale-pid ambiguity.
feed_is_running(){
  exec 8>"$lock_file"
  if flock -n 8; then
    flock -u 8; exec 8>&-
    return 1          # acquired => nothing running
  fi
  exec 8>&-
  return 0            # held => a supervisor is alive
}

# Identity token: pid alone is not unique across reuse, so pair it with the
# process start time (Linux: /proc/<pid>/stat field 22; BSD: ps -o lstart=).
start_token(){
  local pid="$1"
  if [ -r "/proc/$pid/stat" ]; then
    awk '{ n=split($0,a,") "); print a[n] }' "/proc/$pid/stat" 2>/dev/null \
      | awk '{print $20}'
  else
    ps -o lstart= -p "$pid" 2>/dev/null | tr -s ' '
  fi
}

write_state(){
  # Atomic publish: temp + mv on the same filesystem.
  local tmp="$state_file.$$"
  { echo "pid=$1"; echo "nonce=$2"; echo "token=$3"; echo "codehash=$4"; } >"$tmp" && mv -f "$tmp" "$state_file"
}

read_state(){
  [ -f "$state_file" ] || return 1
  s_pid=$(sed -n 's/^pid=//p'   "$state_file" | head -1)
  s_nonce=$(sed -n 's/^nonce=//p' "$state_file" | head -1)
  s_token=$(sed -n 's/^token=//p' "$state_file" | head -1)
  # ALL THREE required — rev 5 F-2': any missing field fails closed. The nonce
  # is not decoration: `start_token` on Linux is starttime in clock ticks since
  # BOOT, so after a reboot a fresh process can legitimately carry the same
  # pid AND the same token as the dead supervisor. The random nonce is what
  # makes a state file written before a reboot distinguishable from one written
  # after it.
  [ -n "${s_pid:-}" ] && [ -n "${s_nonce:-}" ] && [ -n "${s_token:-}" ]
}

# --- code identity (BUG-135) -------------------------------------------------
# "The code this daemon runs" = this script's own resolved path plus every
# scripts/lib/*.sh it sources. Found by grepping the script's own source for
# scripts/lib/<name>.sh references, rather than a hand-maintained list — a new
# `. "$repo_root/scripts/lib/foo.sh"` is then covered for free, instead of
# silently sitting outside the check (the exact kind of drift BUG-135 is
# about: code changes, nothing notices).
code_files(){
  printf '%s\n' "$_bp_self"
  grep -oE 'scripts/lib/[A-Za-z0-9_.-]+\.sh' "$_bp_self" | sort -u | sed "s#^#$repo_root/#"
}

# A cheap content identity, not a security digest — cksum is enough to detect
# "this file's bytes differ from what the running daemon last read."
code_hash(){
  local f
  { while IFS= read -r f; do
      [ -r "$f" ] && cat "$f"
    done <<<"$(code_files)"
  } | cksum | awk '{print $1}'
}

read_codehash(){
  [ -f "$state_file" ] || return 1
  sed -n 's/^codehash=//p' "$state_file" | head -1
}

# Fail-closed: signal ONLY a process whose recorded identity still matches.
# Any mismatch, missing field, or unreadable process => refuse and exit non-zero.
# There is deliberately no fallback to command-line matching.
resolve_supervisor(){
  read_state || { echo "[agent-activity] running, but no readable state file" >&2; return 2; }
  local live; live="$(start_token "$s_pid")"
  [ -n "$live" ] || { echo "[agent-activity] cannot read identity of pid $s_pid — refusing to signal" >&2; return 2; }
  [ "$live" = "$s_token" ] || { echo "[agent-activity] pid $s_pid start-token mismatch (pid reuse?) — refusing to signal" >&2; return 2; }
  echo "$s_pid"
}

cmd_status(){
  if feed_is_running; then
    if pid=$(resolve_supervisor); then
      echo "[agent-activity] running (pid $pid)"; return 0
    fi
    return 2
  fi
  # Not running => any state file is stale by definition.
  rm -f "$state_file"
  echo "[agent-activity] not running"
  return 1
}

cmd_stop(){
  if ! feed_is_running; then
    rm -f "$state_file"
    echo "[agent-activity] not running — nothing to stop."
    return 0
  fi
  local pid; pid=$(resolve_supervisor) || return 2
  kill -TERM "$pid" 2>/dev/null
  # Wait on the LOCK becoming free — the authoritative "it is gone" signal.
  local i=0
  while [ $i -lt 50 ]; do
    feed_is_running || { rm -f "$state_file"; echo "[agent-activity] stopped."; return 0; }
    sleep 0.1; i=$((i+1))
  done
  kill -KILL "$pid" 2>/dev/null
  sleep 0.3
  rm -f "$state_file"
  echo "[agent-activity] stopped (SIGKILL)."
}

cmd_daemon(){
  if feed_is_running; then
    # BUG-135: a running daemon sourced its code once, at start. Left alone
    # forever, it keeps serving that snapshot after a fix or a `blueprint
    # pull` changes it — invisibly, since nothing here restarts it. Compare
    # what's actually running against what's on disk NOW; only a PROVEN
    # difference restarts it, so an unchanged tree is still left alone.
    #
    # `[ -f "$state_file" ]` gates it deliberately, not `read_codehash`'s own
    # emptiness: the lock (what `feed_is_running` tests) is taken a few
    # instructions before `write_state` runs, so #1's 50-concurrent-`--daemon`
    # race can observe "a supervisor holds the lock" before that supervisor
    # has written its state file. Treating that ordinary startup window as
    # "changed" turned it into a stop/restart storm among the 50 racers and
    # left a late winner outliving the test's own `--stop`. A state file that
    # exists but has no codehash line is unambiguous instead — only ever
    # written by pre-BUG-135 code — so that case still restarts.
    if [ -f "$state_file" ]; then
      local live_hash cur_hash
      live_hash="$(read_codehash)"
      cur_hash="$(code_hash)"
      if [ -n "$live_hash" ] && [ "$live_hash" = "$cur_hash" ]; then
        echo "[agent-activity] already running — leaving it."
        return 0
      fi
      echo "[agent-activity] running daemon's code has changed since it started (BUG-135) — restarting."
      cmd_stop >/dev/null 2>&1
    else
      echo "[agent-activity] already running — leaving it."
      return 0
    fi
  fi
  # setsid ONLY here, so the foreground contract stays unambiguous.
  setsid "$0" --supervise >/dev/null 2>&1 &
  # BUG-037 — this was `sleep 0.4` followed by ONE check. Measured on macOS the
  # supervisor takes ~0.6 s to acquire the lock, so the check ran before the
  # thing it was checking for, and `--daemon` printed "failed to start" and
  # exited 1 while the supervisor was alive and healthy. On a faster box startup
  # fits inside 0.4 s, which is why a fixed sleep looked correct for months.
  #
  # A false "failed to start" is not cosmetic here. cmd_daemon's own guard is
  # `feed_is_running`, so a caller that believes the failure and retries gets a
  # SECOND supervisor — the unbounded-spawn shape that BUG-001 rode to load 175
  # for 2.7 days. The idempotency guard is only as good as the report it gives.
  #
  # Poll instead of guessing, with the same 5 s bound and 0.1 s tick cmd_stop
  # already uses. A timing assumption removed beats a magic number enlarged.
  local i=0
  while [ $i -lt 50 ]; do
    if feed_is_running; then echo "[agent-activity] started (daemon) → $out"; return 0; fi
    sleep 0.1; i=$((i+1))
  done
  echo "[agent-activity] failed to start (no lock held after 5s)" >&2; return 1
}

# ===========================================================================
# The supervisor
# ===========================================================================

declare -A OFFSET INODE LABEL LABEL_MODEL_KNOWN

emit(){
  # The supervisor writes BOTH sinks itself — no `tee` process, so the
  # "exactly one resident process" contract holds in foreground too.
  if [ "${AGENT_FEED_FOREGROUND:-0}" = "1" ]; then printf '%s\n' "$1"; fi
  printf '%s\n' "$1" >>"$out"
}

# Project one Claude/subagent transcript record to its visible text.
#
# $3 = 1 to ADMIT sidechain records, 0 to drop them. BUG-027: the filter is a
# property of WHICH FILE is being read, not a global rule, and one function
# served two files with opposite requirements.
#   - the session transcript also carries the subagents' records, flagged
#     isSidechain — dropping them there is what stops every subagent line
#     appearing twice, once unlabelled.
#   - a subagent's OWN transcript is 100% sidechain by construction, so the same
#     filter discarded every record in it. That is the blackout: the feed went
#     silent for the entire duration of any delegated work, which punished the
#     rule it exists to serve — working solo kept the feed alive.
project_jsonl(){
  local line="$1" who="$2" side="${3:-0}"
  printf '%s' "$line" | jq -rc --argjson side "$side" '
    select(.type=="assistant" and ($side == 1 or (.isSidechain != true))) | .message.content[]? |
    if .type=="text" then .text
    elif .type=="tool_use" then "> " + .name + ": " + ((.input.description // .input.command // .input.file_path // "")|tostring|.[0:90])
    else empty end' 2>/dev/null |
  while IFS= read -r o; do
    [ -n "$o" ] && emit "$(ts) [$who] $o"
  done
}

emit_delta(){
  # $1 = file, $2 = prefix-bytes file, $3 = kind, $4 = label
  local kind="$3" who="$4"
  case "$kind" in
    jsonl)     while IFS= read -r line; do [ -n "$line" ] && project_jsonl "$line" "$who" 0; done <"$2" ;;
    jsonl-sub) while IFS= read -r line; do [ -n "$line" ] && project_jsonl "$line" "$who" 1; done <"$2" ;;
    *)         return 1 ;;
  esac
}

# Read the appended bytes of one file and emit the complete records in them.
#
# Three invariants, each earned in review (PLAN-BUG-001 §3):
#  1. Read EXACTLY the snapshot range. `tail` alone reads to whatever EOF it
#     sees while running, which may exceed the size we stat'd; advancing to the
#     old size duplicates, advancing to a re-stat skips.
#  2. Keep the payload OUT of $(). Command substitution strips ALL trailing
#     newlines, so a snapshot ending in a complete record loses the delimiter
#     and k becomes 0 — the feed would stall on a quiet file.
#  3. Fragment length in BYTES (LC_ALL=C). awk's length() counts characters in
#     a multibyte locale; a two-byte 'é' reported as 1 advances one byte past
#     the real newline and corrupts the record.
pump(){
  local f="$1" kind="$2" who="$3"
  [ -f "$f" ] || return 0

  local size inode off tmp got k frag
  size="$(f_size "$f")"; inode="$(f_inode "$f")"
  [ -n "$size" ] || return 0

  if [ "${INODE[$f]:-}" != "$inode" ]; then     # rotated / replaced
    INODE["$f"]="$inode"; OFFSET["$f"]=0
  fi
  off="${OFFSET[$f]:-0}"
  [ "$size" -lt "$off" ] && off=0               # truncated
  [ "$size" -eq "$off" ] && { OFFSET["$f"]=$off; return 0; }

  # --- test hooks (inert unless explicitly set) ---------------------------
  # PLAN §4 cases #10 and #18 pin the two hardest properties of this loop:
  # exactly-once delivery when a writer appends DURING the bounded read, and
  # no-consumption when the sink comes up short. Neither is observable from
  # outside without making the race deterministic, so the seams live here.
  # Both are no-ops in normal operation.
  local want=$(( size - off ))
  if [ -n "${AGENT_FEED_TEST_SLOW_READ:-}" ]; then
    sleep "$AGENT_FEED_TEST_SLOW_READ"     # #10: widen the snapshot→read window
  fi
  # #18: the variable names a SENTINEL PATH, and the short capture applies only
  # while that path exists — so a test can clear the fault mid-run and assert
  # the same supervisor then delivers the deferred range. A static toggle can't
  # express that: restarting re-seeds the offset at EOF (see seed_offset), which
  # is correct behaviour but would look like data loss.
  if [ -n "${AGENT_FEED_TEST_SHORT_SINK:-}" ] && [ -e "$AGENT_FEED_TEST_SHORT_SINK" ] \
     && [ "$want" -gt 1 ]; then
    want=$(( want - 1 ))
  fi

  tmp="$log_dir/.delta.$$"
  tail -c +$((off+1)) "$f" 2>/dev/null 9>&- | head -c "$want" 9>&- >"$tmp"
  got=$(wc -c <"$tmp" 2>/dev/null | tr -d ' ')
  # Success is "the bounded sink captured the whole range", NOT the pipeline's
  # exit status: head -c closing early can SIGPIPE tail during a concurrent
  # append, which is benign.
  if [ "${got:-0}" -ne $((size - off)) ]; then rm -f "$tmp"; return 0; fi

  if [ "$(tail -c 1 "$tmp" | od -An -tx1 | tr -d ' \n')" = "0a" ]; then
    k=$got
  else
    frag=$(LC_ALL=C awk 'END{print length($0)}' "$tmp")
    k=$(( got - frag ))
    if [ "$frag" -ge "$MAX_FRAGMENT" ]; then
      emit "$(ts) [agent-activity] force-flushed a ${frag}-byte line with no newline in $f"
      k=$got
    fi
  fi

  # Advance ONLY after the bytes were materialized AND emitted. The rule is
  # "emit complete bytes, then advance": if the sink fails, those bytes must be
  # re-read next tick, not silently consumed. (`set -e` is not in force here, so
  # this has to be explicit.)
  if [ "$k" -gt 0 ]; then
    if head -c "$k" "$tmp" >"$tmp.p" 2>/dev/null && emit_delta "$f" "$tmp.p" "$kind" "$who"; then
      OFFSET["$f"]=$(( off + k ))
    fi
    rm -f "$tmp.p"
  else
    OFFSET["$f"]=$off
  fi
  rm -f "$tmp"
}

# Files present at the supervisor's FIRST scan start at EOF so a feed started
# now never replays a finished agent's history (matches the old `tail -n0`).
# AGENT_SIGNAL.md is the exception: it emits its current state once at startup
# so the feed opens showing the baton.
#
# BUG-137: a file first DISCOVERED on a later scan is a different case — it was
# created (or first matched a glob) while the supervisor was already running,
# so any bytes it holds now were written during this supervisor's lifetime.
# Seeding it at EOF silently drops whatever a subagent wrote between the file's
# creation and the scan that finds it (a nested helper's first Bash call, in
# the case that surfaced this). Callers pass mode="zero" for that case; default
# stays "eof" for everything seeded before the loop's first pass, and for the
# `$out`-pointer files (see supervise_body) where zero-seeding on a later
# switch would replay an already-populated file instead of skipping ahead.
seed_offset(){
  local f="$1" mode="${2:-eof}"
  [ -f "$f" ] || return 0
  if [ -z "${OFFSET[$f]+set}" ]; then
    if [ "$mode" = "zero" ]; then
      OFFSET["$f"]=0
    else
      OFFSET["$f"]="$(f_size "$f")"
    fi
    INODE["$f"]="$(f_inode "$f")"
  fi
}

# Change token for AGENT_SIGNAL.md — CONTENT, not size+inode and not a bare
# timestamp.
#   - size+inode is a *stream* identity (right for offset resets), not a
#     *change* token: an in-place edit preserving byte length and inode is
#     invisible, and rewriting a Task field to the same width is exactly the
#     kind of edit agents make. A real mic change would never reach the feed.
#   - mtime alone can alias when two edits land inside one timestamp tick.
# cksum is POSIX, costs one read of a small file per tick, and fires exactly
# when the bytes change. RC-6 was "call the correct stat form", not "stop
# detecting changes" — this satisfies both.
signal_token(){ cksum < "$signal_file" 2>/dev/null; }

signal_line(){
  local holder state task
  holder=$(field Holder); state=$(field State); task=$(field Task)
  task=$(printf '%s' "$task" | tr -d '*' | cut -c1-100)
  emit "$(ts) [$(persona_label "${holder:-?}")] ${state:-?} — $task"
}

# --- is anyone actually holding the mic? (BUG-022) --------------------------
#
# The mic state and the dispatcher's liveness are unremarkable alone and
# conclusive together, and nothing compared them — so `State = OVER_TO_CODEX`
# with no watcher alive looked exactly like an agent thinking. This feed is the
# right place precisely because it already polls on a timer and already reads
# the baton, so the comparison costs one file check per tick.
#
# EDGE-TRIGGERED. A line every poll would train the operator to skim past the
# feed, which is the failure this is meant to prevent rather than cause. It
# fires on the transition into `dead` and again only after recovery.
#
# `dead_last` is the edge memory; it is deliberately keyed on the STATE too, so
# a mic that moves from one dead dispatcher to another re-warns.
dead_last=""
watcher_liveness_line(){
  local state live
  command -v bp_watch_liveness >/dev/null 2>&1 || return 0
  state=$(field State)
  case "$state" in
    OVER_TO_*) ;;
    *) dead_last=""; return 0 ;;   # mic is not handed out; nothing to compare
  esac

  # From the baton's own directory, so the feed and the watcher rendezvous on
  # the mic rather than on a repo root they might each resolve differently.
  live="$(bp_watch_liveness "$(dirname "$signal_file")" "$state" 2>/dev/null)"
  if [ "$live" = dead ]; then
    if [ "$dead_last" != "$state" ]; then
      dead_last="$state"
      emit "$(ts) [feed] ⚠ $state is held but NO watcher is listening — the dispatch is going nowhere."
      emit "$(ts) [feed]   restart it, or hand the mic back with scripts/signal-set.sh."
    fi
  else
    # Covers `alive` and `none` alike. `none` means no watcher ever claimed this
    # state here, which is a project that runs none — never a warning.
    dead_last=""
  fi
}

supervise(){
  exec 9>"$lock_file"
  if ! flock -n 9; then
    echo "[agent-activity] already running — leaving it."
    return 0
  fi

  # CLOSE FD 9 IN EVERY CHILD — one choke point, not per-command.
  #
  # `exec 9>lock` is NOT close-on-exec, so every child inherits the locked
  # descriptor. The lock is only released when the LAST holder exits, so a
  # SIGKILLed supervisor whose `sleep $TICK` child is still alive keeps the lock
  # held — and the next `--daemon` sees "already running" and refuses to start.
  # That is Codex round-1 blocker #1 resurfacing: I argued it was structurally
  # impossible because there are no LONG-lived children, but short-lived ones
  # inherit it just the same, and the tick sleep is a child on every iteration.
  # Wrapping the whole body in `{ ... } 9>&-` closes FD 9 for everything spawned
  # inside while this shell keeps the lock, so no per-command `9>&-` can be
  # forgotten. Regression: tests/agent-activity-bound/agent-activity-bound.release.spec.ts #4.
  supervise_body 9>&-
}

supervise_body(){
  local nonce; nonce="$$-$(od -An -tu4 -N4 /dev/urandom 2>/dev/null | tr -d ' ' || echo 0)"
  write_state "$$" "$nonce" "$(start_token "$$")" "$(code_hash)"

  local stop=0
  # Ordinary single-process teardown: no `kill 0` (it signals the shell running
  # the trap, re-entering traps and making exit status nondeterministic), and
  # no orphan sweep — there are no long-lived children to orphan.
  trap 'stop=1' INT TERM

  # BUG-129 — THE FEED IS APPEND-ONLY, INCLUDING ACROSS RESTARTS. This was
  # `: >"$out"`, one wipe per supervisor start. `emit` is the only other writer, so
  # that single line was the whole of the feed's non-append behaviour — and
  # tests/harness/canary.ts is built on the feed being append-only, reading a
  # truncation as a fixture escape. CLAUDE.md tells every wake to start the feed,
  # so any suite running when a wake landed went red for something the change
  # under test never touched (tests/subagent-feed #9). A guard that reds for
  # innocent reasons gets muted, which costs more than it protects.
  #
  # Fixed HERE rather than by teaching the canary to excuse truncation: the
  # canary's model was right and this line was wrong. Feed truncation therefore
  # stays a hard failure that still means something. Regression:
  # tests/agent-activity-bound #20.
  #
  # The log grows across restarts, and scripts/lib/feed.sh caps it — by RENAME,
  # to `<feed>.1`, which keeps every byte and every racing append. This comment
  # used to say size-capped rotation "is NOT built"; that was wrong on both
  # counts, since feed.sh had rotated at 4,000 lines all along and did it by
  # rewriting the file in place. The canary question it deferred is answered:
  # tests/harness/canary.ts reads the archive, so a rotation is a NOTE and a lost
  # history is still a failure.
  if [ -s "$out" ]; then
    emit "$(ts) [agent-activity] feed restarted → $out"
  else
    emit "$(ts) [agent-activity] feed started → $out"
  fi

  local sig_last="" sig_now proj newest ros_last ros_now prev_label
  proj="$HOME/.claude/projects/$(printf '%s' "$repo_root" | sed 's#/#-#g')"

  signal_line   # current baton, once
  sig_last="$(signal_token)"
  ros_last="$(roster_token)"

  # No provider run log is seeded or pumped here. Each launcher labels output
  # while it knows the dispatch holder; a raw pump would lose that identity and
  # repeatedly emit a still-growing unterminated CLI line.

  # BUG-137 — true only for the loop's first pass. A subagent transcript that
  # the glob below matches on THIS pass existed (or was already fully written)
  # before the supervisor took its first look, same as every other file seeded
  # above; one discovered on a LATER pass was born under a running supervisor,
  # so it is zero-seeded instead (see seed_offset's own comment).
  local first_scan=1

  while [ "$stop" -eq 0 ]; do
    # Roster: re-resolve WHO WE ARE when it changes. Emits only when the label
    # actually moves, so re-saving the file without renaming anyone is silent.
    # The line is worth emitting: a rename is otherwise invisible in the very
    # stream whose labels it changes, which is how "you are still logging as
    # anna" happened.
    ros_now="$(roster_token)"
    if [ "$ros_now" != "$ros_last" ]; then
      ros_last="$ros_now"
      prev_label="$self_label"
      resolve_identity
      [ "$self_label" != "$prev_label" ] \
        && emit "$(ts) [$self_label] identity follows the roster: was '$prev_label'"
    fi

    # Signal file: size+inode identity, so an unchanged file emits nothing.
    if [ -f "$signal_file" ]; then
      sig_now="$(signal_token)"
      if [ -n "$sig_now" ] && [ "$sig_now" != "$sig_last" ]; then
        sig_last="$sig_now"; signal_line
      fi
      # OUTSIDE the change guard, deliberately. The dangerous case is a baton
      # that has NOT changed for a long time while its listener died under it —
      # exactly what a change-triggered check would never see (BUG-022).
      watcher_liveness_line
    fi

    # Codex is NOT merged here. Its launcher appends to the feed itself, with
    # the persona that holds the mic for that dispatch — a fact this loop cannot
    # know, because a label chosen here is bound once at daemon start while the
    # mic changes hands many times under it (BUG-021).
    #
    if command -v jq >/dev/null 2>&1; then
      # "newest" always EOF-seeds, deliberately, even past first_scan: the
      # newest-session pointer can SWITCH to a file that already existed (a
      # resumed old session regaining the newest mtime), and that file can
      # carry a whole prior conversation. Zero-seeding on the switch would
      # replay that history into the feed, which is exactly what seeding
      # exists to prevent — so this call keeps the old, single behaviour.
      newest=$(ls -t "$proj"/*.jsonl 2>/dev/null | head -1)
      if [ -n "$newest" ]; then
        seed_offset "$newest"
        pump "$newest" jsonl "$self_label"
      fi
      for f in "$proj"/*/subagents/agent-*.jsonl; do
        [ -e "$f" ] || continue
        [ -n "$(find "$f" -mmin "-$SUBAGENT_MAX_AGE_MIN" 2>/dev/null)" ] || continue
        if [ -z "${LABEL[$f]+set}" ]; then
          aid="$(basename "$f" .jsonl | sed 's/^agent-//')"
          LABEL["$f"]="$(subagent_label "$f" "$aid")"
          label_model_known "$f" && LABEL_MODEL_KNOWN["$f"]=1
          # BUG-137: zero-seed a subagent transcript discovered after the
          # supervisor's first scan — it was created under a running
          # supervisor, so whatever it holds at discovery was written during
          # this run and must be delivered, not skipped.
          seed_offset "$f" "$([ "$first_scan" -eq 1 ] && echo eof || echo zero)"
        elif [ -z "${LABEL_MODEL_KNOWN[$f]+set}" ]; then
          aid="$(basename "$f" .jsonl | sed 's/^agent-//')"
          LABEL["$f"]="$(subagent_label "$f" "$aid")"
          label_model_known "$f" && LABEL_MODEL_KNOWN["$f"]=1
        fi
        pump "$f" jsonl-sub "${LABEL[$f]}"
      done
    fi

    first_scan=0
    sleep "$TICK"
  done

  trap - INT TERM EXIT          # disable traps before cleanup
  rm -f "$state_file"
  emit "$(ts) [agent-activity] feed stopped"
  return 0
}

# BUG-004: arm the pre-push gate from a path that already runs on every wake.
# Only for the modes an agent actually invokes to START the feed — arming as a
# side effect of `--status` ("is it running?") or `--stop` would be a surprising
# config change in answer to a question.

# --whoami answers the question that had no answer while BUG-010 was open:
# "the roster says one thing and the feed says another — which one is this
# session?". Identity was only observable by reading log lines, so a wrong
# answer looked exactly like a right one. It prints the resolved label on
# stdout and the roster it came from on stderr, so both the value and its
# provenance are checkable without starting the feed.
cmd_whoami(){
  printf '%s\n' "$self_label"
  printf 'roster: %s\n' "$(bp_roster_file "$BP_STATE_ROOT" 2>/dev/null || echo '<none found>')" >&2
  [ -n "${AGENT_PERSONA:-}" ] && printf 'persona: AGENT_PERSONA override\n' >&2
  [ -n "${AGENT_BACKING:-}" ] && printf 'backing: AGENT_BACKING override\n' >&2
  return 0
}

case "${1:-}" in
  --stop)      cmd_stop ;;
  --status)    cmd_status ;;
  --whoami)    cmd_whoami ;;
  --daemon)    [ -r "$repo_root/scripts/lib/gate.mts" ] && node "$repo_root/scripts/lib/gate.mts" arm-gate "$BP_STATE_ROOT"
               [ -r "$repo_root/scripts/lib/gate.mts" ] && node "$repo_root/scripts/lib/gate.mts" arm-push-keepalive "$BP_STATE_ROOT"
               cmd_daemon ;;
  --supervise) AGENT_FEED_FOREGROUND=0 supervise ;;          # internal: daemon child
  "")          [ -r "$repo_root/scripts/lib/gate.mts" ] && node "$repo_root/scripts/lib/gate.mts" arm-gate "$BP_STATE_ROOT"
               AGENT_FEED_FOREGROUND=1 supervise ;;          # foreground
  *)           echo "usage: $0 [--daemon|--stop|--status|--whoami]" >&2; exit 2 ;;
esac
