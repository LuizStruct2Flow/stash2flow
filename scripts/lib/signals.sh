#!/bin/bash
# scripts/lib/signals.sh — interrupting a script must STOP it.
#
# _bp_terminating_traps CLEANUP — run CLEANUP on EXIT, and on INT or TERM run it,
# clear the traps and die of that same signal.
#
# `trap cleanup EXIT INT TERM` is the obvious shape and it is WRONG: a trapped INT
# runs the handler and then RESUMES the script, so an interrupted pull cleaned up
# and went on to its next write. Re-raising with the trap cleared is what makes
# the caller see 130 or 143 and makes nothing after the signal run (measured 12/12
# across fetch, compare and write, foreground and `wait`, under `set -euo
# pipefail`). EXIT still covers `die` and normal returns.
#
# SHARED, not copied (TASK-025). Callers:
#   scripts/install-toolchain.sh  --replace-blueprint-command (§8.1). Without it,
#                                 an INT sent to the installer alone while it
#                                 waited on a child was absorbed, and the swap
#                                 completed (§R4 #2).
# TASK-081: scripts/blueprint used to be the other caller (drift and pull,
# PLAN-TASK-025 §1.4). It is the ported scripts/blueprint.mts now, which
# cannot source a shell trap — plan §4 implements the same "clean up, clear,
# die of the same signal" rule natively in TS instead (§3 P1).
# a2bp still installs the resuming shape (BUG-116) and adopts this by replacing
# `trap _a2bp_cleanup EXIT INT TERM` with `_bp_terminating_traps _a2bp_cleanup`.
#
# shellcheck shell=bash

_bp_terminating_traps() {
  # shellcheck disable=SC2064  # the cleanup's NAME is bound here, on purpose
  trap "$1" EXIT
  # shellcheck disable=SC2064
  trap "_bp_on_signal $1 INT" INT
  # shellcheck disable=SC2064
  trap "_bp_on_signal $1 TERM" TERM
}

_bp_on_signal() {
  "$1"
  trap - "$2" EXIT
  kill -s "$2" "$$"
}
