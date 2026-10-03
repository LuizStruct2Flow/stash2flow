#!/bin/bash
# scripts/lib/staleness.sh — is the local blueprint checkout behind its remote?
#
# Used only where `blueprint drift` still compares against a LOCAL checkout: in
# the blueprint itself, and in a derived project under the BLUEPRINT_ROOT
# override. There it can print "✓ all files match the blueprint HEAD" while
# meaning "you match your local copy of it, which is six weeks old", so this
# says how far behind that copy is. By default drift reads the blueprint by its
# address and answers from a tip it just fetched (TASK-025), where there is no
# local copy to judge.
#
# Two constraints shape everything here:
#
#   1. This runs at every agent wake, usually with no TTY. A prompt that blocks,
#      or a network call that hangs, breaks the wake protocol — which is worse
#      than the stale checkout it was trying to report.
#   2. It reads and possibly writes ANOTHER repository. That is the same shape
#      as the direct write the PR plan removes from a2bp, so the bounds are the
#      contract, not implementation taste: fast-forward only, clean tree only,
#      tracked branch only, never automatic.
#
# Plan: docs/doing/PLAN-A2BP-PR.md §3b.
#
# shellcheck shell=bash

# How long the remote gets to answer. Long enough for a cold SSH handshake,
# short enough that a black-holed remote does not stall a wake.
BP_STALENESS_TIMEOUT="${BP_STALENESS_TIMEOUT:-8}"

# --- bp_staleness_timeout_cmd ------------------------------------------------
# Prints the timeout provider, or nothing if there is none.
#
# Absence is NOT fatal here, unlike the secret scan (.githooks/pre-push), and
# the difference is deliberate: an unbounded secret scan that gets skipped means
# secrets ship, so it must block. An unbounded staleness probe means a wake
# hangs. Both are unacceptable, so this degrades to `unknown` — which reports
# honestly and costs nothing — rather than either hanging or claiming currency.
bp_staleness_timeout_cmd() {
  if command -v timeout >/dev/null 2>&1; then
    printf 'timeout'
  elif command -v gtimeout >/dev/null 2>&1; then
    printf 'gtimeout'
  fi
}

# --- bp_staleness_assess ROOT BRANCH -----------------------------------------
# Emits key=value lines on stdout. Never fails the caller; the verdict IS the
# return value, so an unreachable remote is a status rather than an error.
#
#   status   current | behind | ahead | diverged | unknown
#   count    commits behind, when known
#   remote   the resolved remote name
#   offer    ff | no          — may a fast-forward be offered?
#   blocker  none | dirty | detached | wrong-branch | no-remote | unreachable
#            | no-timeout | not-behind
#   verified yes | no    — was the behind-relation proved against local objects?
#                          `no` is the ordinary case (nothing fetched yet); the
#                          offer stands, because `merge --ff-only` adjudicates
#                          for real at write time.
#
# `offer=ff` requires ALL of: status=behind, a clean tree, HEAD on BRANCH, and
# the local commit being a strict ancestor of the remote one. Anything else is
# information without an action — a merge or rebase decision belongs to the
# operator, not to a prompt inside another repo's drift check.
bp_staleness_assess() {
  local root="$1" branch="$2"
  local remote head_branch local_sha remote_sha tcmd count

  # --- which remote? The branch's own upstream, falling back to origin. ------
  remote=$(git -C "$root" config --get "branch.$branch.remote" 2>/dev/null)
  if [ -z "$remote" ]; then
    if git -C "$root" remote get-url origin >/dev/null 2>&1; then
      remote="origin"
    else
      printf 'status=unknown\nblocker=no-remote\noffer=no\n'
      return 0
    fi
  fi

  tcmd=$(bp_staleness_timeout_cmd)
  if [ -z "$tcmd" ]; then
    printf 'status=unknown\nremote=%s\nblocker=no-timeout\noffer=no\n' "$remote"
    return 0
  fi

  # --- ask the remote -------------------------------------------------------
  # ls-remote rather than fetch: it is read-only and leaves the operator's
  # object store exactly as it found it. Reporting must not have side effects.
  remote_sha=$("$tcmd" "$BP_STALENESS_TIMEOUT" \
    git -C "$root" ls-remote "$remote" "refs/heads/$branch" 2>/dev/null | awk 'NR==1{print $1}')
  if [ -z "$remote_sha" ]; then
    printf 'status=unknown\nremote=%s\nblocker=unreachable\noffer=no\n' "$remote"
    return 0
  fi

  local_sha=$(git -C "$root" rev-parse HEAD 2>/dev/null)
  if [ -z "$local_sha" ]; then
    printf 'status=unknown\nremote=%s\nblocker=unreachable\noffer=no\n' "$remote"
    return 0
  fi

  if [ "$local_sha" = "$remote_sha" ]; then
    printf 'status=current\nremote=%s\nblocker=none\noffer=no\n' "$remote"
    return 0
  fi

  # --- relation ------------------------------------------------------------
  # The remote commit may be absent locally (the usual case when behind), so
  # every ancestry question is asked defensively: `cat-file -e` first, because
  # merge-base on an unknown object errors and an errored merge-base must not
  # read as "not an ancestor".
  local have_remote=0 behind=0 ahead=0
  git -C "$root" cat-file -e "${remote_sha}^{commit}" 2>/dev/null && have_remote=1

  if [ "$have_remote" -eq 1 ]; then
    git -C "$root" merge-base --is-ancestor "$local_sha" "$remote_sha" 2>/dev/null && behind=1
    git -C "$root" merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null && ahead=1
  fi

  local status blocker="none" offer="no" verified="yes"
  if [ "$have_remote" -eq 0 ]; then
    # The ORDINARY case: behind, and the remote's commits were never fetched, so
    # there is no local object to ask about ancestry.
    #
    # An earlier version refused to offer here, on the reasoning that an
    # unverified relation should not be acted on. That reasoning was sound and
    # the conclusion was still wrong: this is not an edge case, it is what
    # "behind" normally looks like, so refusing on it disabled the feature in
    # exactly the situation it exists for.
    #
    # Offering is safe because the offer is not the write. bp_staleness_fast_
    # forward fetches and then uses `merge --ff-only`, so git adjudicates
    # ancestry against real objects at write time and refuses without touching
    # the checkout. The cost of being wrong here is a declined merge and a clear
    # message — not a damaged repository. `verified=no` lets the caller word it
    # honestly rather than promise a fast-forward it has not confirmed.
    status="behind"; verified="no"
  elif [ "$behind" -eq 1 ]; then
    status="behind"
    count=$(git -C "$root" rev-list --count "$local_sha..$remote_sha" 2>/dev/null)
  elif [ "$ahead" -eq 1 ]; then
    status="ahead"; blocker="not-behind"
  else
    status="diverged"; blocker="not-behind"
  fi

  # --- may we offer? -------------------------------------------------------
  if [ "$status" = "behind" ] && [ "$blocker" = "none" ]; then
    head_branch=$(git -C "$root" symbolic-ref --quiet --short HEAD 2>/dev/null)
    if [ -z "$head_branch" ]; then
      blocker="detached"
    elif [ "$head_branch" != "$branch" ]; then
      blocker="wrong-branch"
    elif [ -n "$(git -C "$root" status --porcelain 2>/dev/null)" ]; then
      # Includes untracked files on purpose. A fast-forward that lands a file
      # where an untracked one sits fails halfway, and "halfway" in someone
      # else's repository is the worst outcome available.
      blocker="dirty"
    else
      offer="ff"
    fi
  fi

  printf 'status=%s\nremote=%s\nblocker=%s\noffer=%s\nverified=%s\n' \
    "$status" "$remote" "$blocker" "$offer" "$verified"
  [ -n "${count:-}" ] && printf 'count=%s\n' "$count"
  printf 'remote_sha=%s\n' "$remote_sha"
  return 0
}

# --- bp_staleness_fast_forward ROOT BRANCH REMOTE ----------------------------
# The only write. --ff-only is not belt-and-braces over the assess checks: those
# were computed against a remote sha read seconds ago, and this re-fetches. If
# the remote moved in between such that a fast-forward is no longer possible,
# git refuses and the checkout is untouched.
bp_staleness_fast_forward() {
  local root="$1" branch="$2" remote="$3" tcmd
  tcmd=$(bp_staleness_timeout_cmd)
  [ -n "$tcmd" ] || return 1

  "$tcmd" "$BP_STALENESS_TIMEOUT" git -C "$root" fetch --quiet "$remote" "$branch" || return 1
  git -C "$root" merge --ff-only FETCH_HEAD || return 1
}
