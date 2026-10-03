# shellcheck shell=sh
# scripts/lib/feed.sh — the one way to append a line to the activity feed.
#
# The feed (logs/agent-activity.log) is the single tail-able stream of what every
# agent is doing. Several producers write to it: scripts/agent-activity.sh (the
# supervisor), scripts/log-activity.mts (Claude subagent hooks), scripts/watch-ci.sh
# (post-push CI), and the pre-push gate via scripts/lib/pipeline.sh.
#
# Each of those had — or was about to get — its own copy of "work out the path,
# append, rotate if it got long". That is the shape that produced A-09 (the feed
# and the dispatchers deriving the state dir two different ways) and BUG-010 (two
# roster readers that agreed only by coincidence). One appender instead.
#
# Rotation matters and is easy to get wrong. It is a RENAME — `mv` to
# `<feed>.1`, then one marker line into the new file — and BUG-129 is why:
#
#   * NOTHING IS LOST. The previous form was tail→tmp→`cat >`, which leaves a
#     window between the snapshot and the rewrite; a line appended inside it is
#     overwritten and gone. Every hook and gate stage calls this appender on the
#     same feed, so a racing writer is routine, and NO LOCK coordinates them —
#     this file is POSIX sh sourced by `#!/bin/sh` hooks, and `flock` is absent
#     on macOS, so locking every writer would put a tool the platform may not
#     have on the one path that must never fail a push. A rename closes the
#     window instead of guarding it: a writer that opened the old file appends
#     into the archive, a later one into the new file, and neither is dropped.
#   * THE FEED STAYS APPEND-ONLY, which tests/harness/canary.ts is built on.
#     History MOVES to `<feed>.1` rather than being deleted, so what the canary
#     captured is still a prefix of archive+live. The in-place trim deleted the
#     head, which reads as a fixture escape and turned innocent suites red
#     (tests/subagent-feed #9).
#
# THE COMMENT HERE USED TO SAY `mv` WOULD ORPHAN THE SUPERVISOR'S OPEN HANDLE,
# and that premise is false — it is what made the in-place rewrite look
# mandatory. scripts/agent-activity.sh's `emit` is `printf '%s\n' "$1" >>"$out"`,
# which REOPENS per line, and the only `exec N>` in that script targets its lock
# file. Nothing tracks this file by descriptor. Followers must therefore use
# `tail -F` (follow by NAME), which is what every doc that names the feed says.
#
# POSIX sh: sourced by scripts/lib/pipeline.sh, which is sourced by a #!/bin/sh
# hook.
#
# Usage:
#   . scripts/lib/feed.sh
#   feed_append "[GATE] ✓ secret scan · gitleaks  0.4s"     # timestamp is added
#
# Env:
#   AGENT_FEED_LOG        override the log path
#   AGENT_FEED_MAX_LINES  rotate above this many lines (default 4000)
#
# Exactly ONE archive is kept (`<feed>.1`), and rotating again replaces it.
# Deeper history is not this file's job: the feed summarises transcripts that are
# themselves durable. AGENT_FEED_KEEP_LINES is gone with the trim that used it —
# a rename keeps everything, so there is no "how much to keep" left to tune.

# Resolve the feed path once per process, from $BP_STATE_ROOT — the ONE
# derivation every consumer of per-project state already shares.
#
# BUG-077. This used to be `git rev-parse --show-toplevel`, which answers a
# question nothing here is asking: "what repository does my caller's git
# environment point at". Two separate ways that is the wrong answer:
#
#   * git exports GIT_DIR into every hook, and the gate runs the suites from a
#     pre-push hook — so a fixture's git environment silently redirects the
#     feed. That is BUG-014's mechanism and A-09's consequence, and the ban on
#     the idiom predates this file. Its scope was *state-dir consumers*, which
#     this file is not; the scope was never wrong, only narrower than the
#     hazard. tests/forbidden-idiom now scopes it to the hazard instead.
#   * After TASK-021 splits code from state, the repository root and the code
#     root are different directories. scripts/agent-activity.sh — the supervisor
#     that holds this file open and appends by offset — resolves its path from
#     its own physical location. Two derivations, one rendezvous: the supervisor
#     would write scaffolding/logs/agent-activity.log while the gate and the
#     subagent hooks wrote <repo>/logs/agent-activity.log. Two feeds, both
#     written, neither empty, nothing looking wrong.
#
# A caller that has not resolved BP_STATE_ROOT gets NO feed line and one
# complaint on stderr. That is deliberate: a missing line is recoverable, and a
# line written into the wrong project's feed is the defect A-09 exists to
# prevent. Resolve it the way every other consumer does, at initialisation:
#
#   BP_CODE_ROOT="$_bp_root"            # this script's own physical location
#   . "$_bp_root/scripts/lib/state-dir.sh"
#   BP_STATE_ROOT="$(bp_state_root)" || exit 9
feed_log_path(){
  if [ -n "${AGENT_FEED_LOG:-}" ]; then printf '%s' "$AGENT_FEED_LOG"; return 0; fi
  if [ -n "${_FEED_LOG:-}" ]; then printf '%s' "$_FEED_LOG"; return 0; fi
  if [ -z "${BP_STATE_ROOT:-}" ]; then
    echo "feed.sh: BP_STATE_ROOT is unset — dropping the feed line rather than" >&2
    echo "  guessing a project. Resolve it with bp_state_root at init." >&2
    return 9
  fi
  _FEED_LOG="$BP_STATE_ROOT/logs/agent-activity.log"
  printf '%s' "$_FEED_LOG"
}

# feed_append LINE — best-effort, NEVER fatal.
#
# Every caller is either a git hook or a background watcher. A logging failure
# must not block a push or change an exit status, so every branch swallows its
# error and returns 0. A feed line is worth having; it is never worth failing a
# push over.
feed_append(){
  _fa_log="$(feed_log_path)" || return 0
  [ -n "$_fa_log" ] || return 0
  _fa_dir="${_fa_log%/*}"
  [ -d "$_fa_dir" ] || mkdir -p "$_fa_dir" 2>/dev/null || return 0

  printf '%s %s\n' "$(date +%H:%M:%S)" "$1" >>"$_fa_log" 2>/dev/null || return 0

  _fa_max="${AGENT_FEED_MAX_LINES:-4000}"
  _fa_lines="$(wc -l <"$_fa_log" 2>/dev/null || echo 0)"
  if [ "$_fa_lines" -gt "$_fa_max" ] 2>/dev/null; then
    # `mv` and NOT a trim: atomic, loses no racing append, and moves the history
    # instead of deleting it. See the header — the inode argument that used to
    # forbid this rested on a premise that is not true of any writer.
    if mv -f "$_fa_log" "$_fa_log.1" 2>/dev/null; then
      # The new file says where its history went, so a reader following the feed
      # does not see it silently restart. Written best-effort like everything
      # here: a missing marker is worth less than a failed push.
      printf '%s [feed] rotated, previous history → %s\n' \
        "$(date +%H:%M:%S)" "${_fa_log##*/}.1" >>"$_fa_log" 2>/dev/null || true
    fi
  fi
  return 0
}
