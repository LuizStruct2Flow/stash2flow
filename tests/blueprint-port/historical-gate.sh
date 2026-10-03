#!/bin/sh
# scripts/lib/gate.sh — GENERATED sourced adapter. DO NOT HAND-EDIT.
#
# TASK-067 / BUG-152: the gate-arming policy lives in scripts/lib/gate.mts
# now. This file is the small, mechanically re-renderable bridge that keeps
# both production callers (scripts/agent-activity.sh and scripts/blueprint)
# byte-identical: it defines the same shell function names the old shell
# library did and forwards each call to the matching `gate.mts` subcommand.
#
# scripts/shell-inventory-check.mts re-renders this exact file from the
# (function, subcommand) pairs below and requires whole-file byte equality —
# see CLAUDE.md "Shell to TypeScript, organically" for the ceiling this form
# is admitted under. Regenerating it by hand risks drifting from that
# renderer; treat the pairs as the source of truth.
#
# Sourced, not executed — same contract the old gate.sh carried.

_gate_bridge_mts="${BP_CODE_ROOT:-.}/scripts/lib/gate.mts"

# _gate_call SUBCOMMAND [ARGS...] — invokes the CLI and returns the CLI's
# exit status unchanged.
_gate_call() {
  if [ ! -f "$_gate_bridge_mts" ]; then
    echo "cannot find $_gate_bridge_mts — run: blueprint pull scripts/lib/gate.mts" >&2
    return 2
  fi
  node "$_gate_bridge_mts" "$@"
}

arm_gate() { _gate_call arm-gate "$1"; }
arm_push_keepalive() { _gate_call arm-push-keepalive "$1"; }
