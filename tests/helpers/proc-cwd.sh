#!/bin/sh
# tests/helpers/proc-cwd.sh — resolve a live process's working directory,
# portably.
#
# WHY THIS EXISTS (BUG-036). Three test helpers identified a process by reading
# `readlink -f /proc/<pid>/cwd`. That file is Linux procfs and macOS has no
# /proc at all, so on a Mac the read returned empty, the `case "$cwd" in "$WORK"*)`
# arm never matched, and every "how many of MY supervisors are running?" count
# came back 0 — while the supervisors were in fact running. Six cases in
# tests/agent-activity-bound failed closed and the pre-push gate could not pass
# on macOS at all, which meant nothing could be pushed from one.
#
# The sting is that the PRODUCT was already portable: scripts/agent-activity.sh
# start_token() branches on /proc/<pid>/stat versus BSD `ps -o lstart=`. Only
# the tests that gate the product assumed Linux. A suite that cannot run on a
# developer's OS does not report "unsupported" — it reports FAILURE, which is
# indistinguishable from the regression it was written to catch.
#
# bp_proc_cwd <pid>
#   Prints the absolute cwd of <pid> on stdout, or nothing if it cannot be
#   determined (process gone, permission denied, no mechanism available).
#   Callers MUST treat empty as "unknown", never as "does not match" — see
#   the vacuity note below.
#
# Two mechanisms, in order:
#   procfs  Linux. Cheapest, no fork beyond readlink.
#   lsof    BSD/macOS. `-a -p <pid> -d cwd -Fn` restricts to that one pid's cwd
#           descriptor and prints machine-readable fields; the cwd line is the
#           one starting `n`. -Fn is used rather than parsing columns because a
#           path containing spaces breaks column parsing (that is BUG-036's
#           case #7, which failed for this same reason).
bp_proc_cwd() {
  _bpc_pid="$1"
  [ -n "${_bpc_pid:-}" ] || return 0

  if [ -r "/proc/$_bpc_pid/cwd" ]; then
    readlink -f "/proc/$_bpc_pid/cwd" 2>/dev/null
    return 0
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -a -p "$_bpc_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
    return 0
  fi

  # No mechanism. Print nothing and let the caller decide — but see
  # bp_proc_cwd_available, which exists so a suite can refuse to run
  # vacuously rather than silently counting zero of everything.
  return 0
}

# bp_proc_cwd_available
#   True when SOME mechanism exists on this host. A suite whose assertions are
#   all of the form "exactly one of my processes is running" must call this and
#   fail loudly if it is false, because without a mechanism every such count is
#   0 and every assertion of the form "expected 0" passes for the wrong reason.
#   That is the vacuity trap tests/manifest and BUG-005 are about: a suite that
#   silently covers nothing still prints PASSED.
bp_proc_cwd_available() {
  [ -d /proc ] && return 0
  command -v lsof >/dev/null 2>&1
}
