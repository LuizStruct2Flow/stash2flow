#!/bin/sh
# scripts/lib/watcher-lock.sh — is a dispatcher listening on this mic state?
#
# Sourced, not executed. Two callers, deliberately:
#   scripts/signal-watch.mts        TAKES the lock for its lifetime (TASK-063,
#                                    formerly scripts/codex-signal-watch.sh)
#   scripts/agent-activity.sh       TESTS it against the baton, every poll
#
# WHY THIS EXISTS (BUG-022)
#
# The mic state and the dispatcher's liveness are two facts that are
# unremarkable alone and conclusive together. Nothing compared them, so a
# dispatch into silence was indistinguishable from an agent thinking: the baton
# read OVER_TO_CODEX, the feed was quiet, and the run log — the only honest
# surface — is the one nobody reads. redcare lost ~40 minutes to this shape
# (their BUG-033) and this repo lost a BA dispatch to it on 2026-08-05.
#
# WHY A LOCK, AND NEVER THE PROCESS TABLE
#
# Every liveness check written during redcare's incident matched the checking
# shell's OWN command line — a `pgrep -f` for a pattern present in its own
# arguments — and was wrong three different ways. A lock cannot self-match. It
# is also repo-scoped, which is what distinguishes THIS project's watcher from
# another checkout's; a process-table match cannot tell them apart, and that is
# how a missing feed went unnoticed the same day.
#
# And `flock` is released by the KERNEL on death, including SIGKILL. So "can I
# take it?" answers "is a holder alive?" with no stale-pid ambiguity and no
# cleanup path to get wrong. scripts/agent-activity.sh already reasons exactly
# this way about its own supervisor lock; this is that oracle, reused.
#
# WHAT THIS PROVES, AND WHAT IT DOES NOT
#
# A held lock proves the claiming PROCESS EXISTS. It does NOT prove the watcher
# is HEALTHY: one that is alive but wedged — stopped, blocked, or spinning
# without polling — still reads `alive` here. Closing that needs a heartbeat the
# watchers do not write (a periodic touch plus a staleness threshold on its
# mtime), which is a change to every dispatcher rather than to this file. It is
# deliberately out of scope and recorded rather than half-built. What is fixed is
# the case that actually costs time: no listener at all.

# bp_watch_lock_path ROOT STATE → the lock file for a mic state.
#
# Named after the STATE rather than the agent, so an arbitrary dispatcher works
# without this file carrying a list of them. A list is a second place to forget
# something.
# bp_watch_lock_path BATON_DIR STATE → the lock file for a mic state.
#
# THE FIRST ARGUMENT IS THE DIRECTORY HOLDING THE BATON, not a repo root, and
# that distinction is the whole correctness argument.
#
# A lock belongs to the MIC it guards, not to the checkout the script was
# launched from. Resolving it from a root is resolving from the caller's
# position — the mistake this repo has now made four times (BUG-020's baked
# paths, A-09's split derivation, BUG-013's `.blueprint-root`, and this).
#
# It shipped that way for one commit and did real damage immediately:
# tests/signal-dispatch runs the REAL watcher against a FIXTURE baton, so the
# watcher resolved its root to the live blueprint and took the live repo's lock —
# leaving a record behind that made a checkout which had never run a watcher
# report `dead` forever, defeating the `none` case that exists to prevent exactly
# that false alarm. Worse, while the suite ran, a genuine watcher starting up
# would have been REFUSED by a lock a test was holding.
#
# Deriving from the baton's own directory makes isolation fall out rather than
# being bolted on: a fixture pointing `--file` at its own baton gets its own
# lock, with nothing to remember and no env var to set.
# bp_flock_cmd — prints the flock(1) provider, or nothing when there is none.
#
# WHY A RESOLVER RATHER THAN `command -v flock`. macOS ships no flock in the
# base system, and Homebrew's util-linux — the formula that provides it — is
# KEG-ONLY: `brew install util-linux` deliberately does not symlink its binaries
# onto PATH. So the command name alone finds nothing on the very machine that
# just installed it, and the platform that needs the probe is the only one where
# the answer is neither a plain yes nor a plain no.
#
# Same shape as bp_staleness_timeout_cmd's `timeout` → `gtimeout` fallback:
# prefer the plain name, fall back to where the platform actually put it, and
# print NOTHING rather than guess when neither is there. An oracle that cannot
# run must not answer.
#
# ONE RESOLVER, because two would disagree exactly where it matters. The hook
# that defers subagent bookends and the installer that claims to have satisfied
# it both call this; an installer deciding "present" by a different rule would
# report success for a machine the hook still cannot defer on (A-09's lesson:
# two independent derivations of one fact is two facts).
#
# BP_FLOCK_FALLBACKS is the seam the suites set (tests/subagent-feed #18) so a
# PATH without flock is genuinely a host without flock, on a Mac as much as on
# Linux. `=` and not `:=`, so an explicitly EMPTY value is preserved rather than
# refilled with the defaults. Production never sets it.
: "${BP_FLOCK_FALLBACKS=/opt/homebrew/opt/util-linux/bin/flock /usr/local/opt/util-linux/bin/flock}"
bp_flock_cmd() {
  if command -v flock >/dev/null 2>&1; then printf 'flock\n'; return 0; fi
  # shellcheck disable=SC2086 # deliberate split: the seam is a space-separated path list
  for _fc_c in $BP_FLOCK_FALLBACKS; do
    if [ -x "$_fc_c" ]; then printf '%s\n' "$_fc_c"; return 0; fi
  done
  return 1
}

bp_watch_lock_path() {
  _wl_dir="${1:-.}"
  _wl_state="$(printf '%s' "${2:-}" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_-' '_')"
  printf '%s/.watch-%s.lock' "$_wl_dir" "$_wl_state"
}

# bp_watch_liveness BATON_DIR STATE → prints `none`, `alive` or `dead`.
#
#   none   no lock file — no watcher ever claimed this state here. Says nothing,
#          because a project without watchers must never be warned about one it
#          never had. This is what makes the check safe on every poll.
#   alive  the lock is held.
#   dead   the file exists but nothing holds it. A dispatcher was demonstrably
#          expected and is demonstrably gone.
#
# Returns `none` when flock is unavailable rather than guessing. An oracle that
# cannot run must not answer, and a false "dead" would train the operator to
# ignore the one warning this exists to raise.
bp_watch_liveness() {
  _wl_file="$(bp_watch_lock_path "${1:-.}" "${2:-}")"

  [ -e "$_wl_file" ] || { printf 'none\n'; return 0; }
  command -v flock >/dev/null 2>&1 || { printf 'none\n'; return 0; }

  # A SUBSHELL, so the fd and any acquired lock die with it. Holding fd 7 open
  # in the caller would leave the FEED holding the watcher's lock — the checker
  # becoming the thing it checks for.
  if ( exec 7>>"$_wl_file"; flock -n 7 ) 2>/dev/null; then
    printf 'dead\n'
  else
    printf 'alive\n'
  fi
}

# bp_watch_hold BATON_DIR STATE FD → claim the lock for this process's lifetime.
#
# The caller passes its own fd number and never closes it: the lock is released
# when the process exits, by the kernel, whatever kills it. Returns non-zero if
# the lock is already held — another watcher is on this state, and starting a
# second is how two dispatchers race one baton.
bp_watch_hold() {
  _wl_file="$(bp_watch_lock_path "${1:-.}" "${2:-}")"

  _wl_fd="${3:-7}"
  mkdir -p "$(dirname "$_wl_file")" 2>/dev/null || return 1
  command -v flock >/dev/null 2>&1 || return 0   # no flock: proceed unguarded
  eval "exec ${_wl_fd}>>\"\$_wl_file\"" 2>/dev/null || return 1
  flock -n "$_wl_fd" 2>/dev/null || return 1
  return 0
}
