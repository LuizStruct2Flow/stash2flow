#!/bin/bash
# scripts/lib/request-file.sh — file an a2bp request against the blueprint remote.
#
# The transport and recovery half of `blueprint a2bp`. Construction lives in
# request-build.sh; identity in request.sh; validation in request-inputs.sh and
# request-config.sh. This is what interleaves them, and the interleaving is the
# design: the determinism scrub removes the config where credentials live, so
# transport and construction CANNOT share an environment. Every transport step
# is followed by re-entering the scrubbed one.
#
# Plan: docs/doing/PLAN-A2BP-PR.md §6.4, §7.
# Requires: request.sh, request-build.sh
#
# shellcheck shell=bash

# Exit statuses, distinct so a script cannot mistake one outcome for another.
# shellcheck disable=SC2034 # read by scripts/blueprint.mts, which sources this file (cmd_a2bp)
{
BP_RC_OK=0                 # filed clean
BP_RC_PENDING=3            # filed, awaiting a decision — deliberately non-zero
BP_RC_BLOCKED=4            # a guard refused; nothing filed
BP_RC_FAILED=5             # the CLI could not do its job
BP_RC_NOTHING=6            # nothing to request
}

# --- bp_file_scratch ---------------------------------------------------------
# A scratch bare clone under the system temp dir — never inside either
# repository, where it would be picked up by the project's own git, the
# pre-push gate, or a `git add -A`.
bp_file_scratch() {
  mktemp -d "${TMPDIR:-/tmp}/a2bp.XXXXXXXX"
}

# --- bp_file_fetch_base SCRATCH REMOTE BRANCH -------------------------------
# Prints the resolved base SHA. Transport environment; the caller re-enters the
# scrubbed one for everything after.
bp_file_fetch_base() {
  local remote="$2" branch="$3" bare="$1/bare"

  # --object-format=sha1 explicitly: a host configured to default to SHA-256
  # rehashes identical content, so the same request would build to a different
  # commit and every retry adoption would fail to recognise its own work.
  bp_request_hermetic git init -q --bare --object-format=sha1 "$bare" || return 1

  if ! bp_request_transport_env git -C "$bare" fetch -q --depth 1 "$remote" "$branch" 2>/dev/null; then
    echo "could not fetch $branch from $remote" >&2
    echo "  (check the remote in .blueprint-source and your credentials)" >&2
    return 1
  fi
  bp_request_hermetic git -C "$bare" rev-parse FETCH_HEAD
}

# --- bp_file_remote_tip REMOTE BRANCH ---------------------------------------
bp_file_remote_tip() {
  bp_request_transport_env git ls-remote "$1" "refs/heads/$2" 2>/dev/null | awk 'NR==1{print $1}'
}

# --- bp_file_base_content BARE BASE PATH OUT --------------------------------
# Extract the base's version of PATH, for the contamination guard to align
# against. Empty file when the path is a creation.
#
# This is what frees a2bp from needing a local blueprint checkout at all: the
# guard used to align against $BLUEPRINT_ROOT/$f, which meant staging was
# computed against whatever stale copy the operator happened to have.
bp_file_base_content() {
  local bare="$1" base="$2" path="$3" out="$4"
  if bp_request_hermetic git -C "$bare" cat-file -e "$base:$path" 2>/dev/null; then
    bp_request_hermetic git -C "$bare" show "$base:$path" > "$out"
  else
    : > "$out"
  fi
}

# --- bp_file_push BARE REMOTE REF COMMIT ------------------------------------
# Push the request branch, adopting an existing one ONLY when its tip is exactly
# the commit just built.
#
# Never force-pushes, in any branch of this function. The branch namespace is
# keyed by content, so a differing tip under the same key means something this
# code does not understand happened — and overwriting it would destroy a request
# somebody may already be reviewing.
bp_file_push() {
  local bare="$1" remote="$2" ref="$3" commit="$4" existing

  existing=$(bp_request_transport_env git -C "$bare" \
    ls-remote "$remote" "refs/heads/$ref" 2>/dev/null | awk 'NR==1{print $1}')

  if [ -n "$existing" ]; then
    if [ "$existing" = "$commit" ]; then
      # The identical request, already filed — same project, content and base.
      # Adopt it rather than failing: this is the ordinary retry after a
      # network error, and it is only safe because the build is byte-
      # reproducible (tests/a2bp-build/a2bp-build.spec.ts #3, #4).
      echo "  branch already present with the identical commit — adopting it" >&2
      return 0
    fi
    echo "The request branch already exists on the remote with a DIFFERENT tip." >&2
    echo "  branch: $ref" >&2
    echo "  remote: $existing" >&2
    echo "  local:  $commit" >&2
    echo "Refusing to force-push. Someone may already be reviewing that request." >&2
    return 1
  fi

  if ! bp_request_transport_env git -C "$bare" \
       push -q "$remote" "refs/heads/$ref:refs/heads/$ref" 2>/dev/null; then
    echo "push of $ref to $remote was rejected" >&2
    return 1
  fi
}

# --- bp_file_existing_pr REMOTE_SLUG REF ------------------------------------
# Prints "<state>\t<url>" for an existing PR on this branch, if any.
#
# Queried for ANY state, not just open. Re-filing a request the blueprint owner
# has already closed is worse than failing: it re-spends the reviewer attention
# this design exists to protect, and reads as though the decision was not seen.
# BUG-011 — `.[0] // empty` is load-bearing. With a bare `.[0]`, an EMPTY list
# yields null, and jq interpolates null into a string as the literal "null" —
# so this printed `null<TAB>null` and the caller read a non-existent PR as an
# existing one, reporting a request as filed when none was. `// empty` makes jq
# emit nothing at all for an absent element, which is what "no PR" must look
# like. The interpolation is the trap: `.[0].url` alone would have been empty,
# but inside "\(…)" null becomes text.
bp_file_existing_pr() {
  local slug="$1" ref="$2"
  command -v gh >/dev/null 2>&1 || return 1
  gh pr list --repo "$slug" --head "$ref" --state all \
     --json state,url --jq '.[0] // empty | "\(.state)\t\(.url)"' 2>/dev/null
}

# --- bp_file_pr_body PROJECT BASE REMOTE BRANCH UNSHIPPED SPEC... -----------
# The PR body. It records the BASE SHA deliberately: the base re-check narrows
# the window between "base was current" and "push landed" but cannot close it,
# so the residual is surfaced where a reviewer can see whether the base has
# moved since.
#
# UNSHIPPED is a newline-delimited list of paths outside the managed set
# (TASK-037). Each is marked in the file list, so the reviewer judges it as a
# blueprint-only change rather than one every project will pull.
bp_file_pr_body() {
  local project="$1" base="$2" remote="$3" branch="$4" unshipped="$5"; shift 5
  local spec path

  printf 'A back-propagation **request** from `%s`.\n\n' "$project"
  printf 'This is a feature REQUEST, not a feature implementation. It says an\n'
  printf 'improvement proved itself downstream; how it lands in the blueprint —\n'
  printf 'merged as-is, adapted, or rewritten — is the blueprint owner'"'"'s call,\n'
  printf 'as is which ripples (deck, recipe docs, README) travel with it.\n\n'
  printf '**Base:** `%s` on `%s`\n\n' "$base" "$branch"
  printf 'If the base has moved since, review the diff against that commit rather\n'
  printf 'than against the current tip.\n\n'
  printf '**Files:**\n\n'
  for spec in "$@"; do
    path=${spec%%:*}
    case $'\n'"$unshipped" in
      *$'\n'"$path"$'\n'*)
        printf -- '- `%s` (**not shipped**: not managed, so no existing project receives it)\n' "$path" ;;
      *) printf -- '- `%s`\n' "$path" ;;
    esac
  done
  printf '\n---\n_Filed by `blueprint a2bp`. The contamination guard ran on the project\n'
  printf 'side; it is heuristic and advisory, so review the diff on its merits._\n'
}
