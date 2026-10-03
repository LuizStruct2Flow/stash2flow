#!/bin/bash
# scripts/lib/request.sh — identity and construction for an a2bp feature request.
#
# `blueprint a2bp` files a REQUEST against the blueprint: a branch plus a pull
# request saying "this improvement proved itself downstream". It writes into no
# working tree. The blueprint owner reads the request and implements upstream.
#
# Plan: docs/doing/PLAN-A2BP-PR.md. Design rationale and the sixteen review
# rounds behind these contracts: docs/doing/PLAN-A2BP-PR-REVIEW.md.
#
# Two things in here carry the weight:
#
#   bp_request_key    the branch identity. Length-framed, so no component's
#                     content can be mistaken for a delimiter.
#   bp_request_build  the commit. Built with plumbing in a scrubbed environment
#                     so the same inputs produce the same SHA on any machine —
#                     which is what makes retry adoption possible at all.
#
# shellcheck shell=bash

# --- SHA-256, portably --------------------------------------------------------
# Linux ships sha256sum; macOS ships shasum. Resolved once, and absence is fatal
# rather than silently falling back to a weaker digest.
bp_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | cut -d' ' -f1
  else
    echo "bp_sha256: no sha256sum or shasum available" >&2
    return 1
  fi
}

# --- bp_request_frame -------------------------------------------------------
# Emit one length-framed record: <byte-count><space><bytes>.
#
# Framing, rather than a delimiter, because every component is attacker- or
# accident-influenced: a remote URL, a branch name, a project directory name and
# file content can all contain newlines, spaces, or whatever character a
# delimiter scheme picked. A byte count cannot be forged by content.
bp_request_frame() {
  local bytes="$1" len
  len=$(printf '%s' "$bytes" | wc -c | tr -d ' ')
  printf '%s %s' "$len" "$bytes"
}

# bp_request_frame_file — same, for content read from a file, so binary-ish
# bytes never pass through a shell variable.
bp_request_frame_file() {
  local f="$1" len
  len=$(wc -c < "$f" | tr -d ' ')
  printf '%s ' "$len"
  cat "$f"
}

# --- bp_request_key ---------------------------------------------------------
# bp_request_key <remote> <branch> <base_sha> <project> <spec>...
#
# Each <spec> is  <path>:<mode>:<content-file>  and specs MUST already be
# sorted byte-wise by path and de-duplicated by the caller — the key is a pure
# function of what it is given, so ordering is the caller's contract to keep.
#
# Prints the lowercase-hex SHA-256 digest.
bp_request_key() {
  local remote="$1" branch="$2" base="$3" project="$4"
  shift 4

  {
    bp_request_frame "v3"
    bp_request_frame "$remote"
    bp_request_frame "$branch"
    bp_request_frame "$base"
    bp_request_frame "$project"

    local spec path mode cfile
    for spec in "$@"; do
      path=${spec%%:*}
      mode=${spec#*:}; mode=${mode%%:*}
      cfile=${spec#*:*:}
      bp_request_frame "$path"
      bp_request_frame "$mode"
      bp_request_frame_file "$cfile"
    done
  } | bp_sha256
}

# --- bp_request_ref ---------------------------------------------------------
# bp_request_ref <project> <digest> → the branch name, validated.
#
# `git check-ref-format` validates the COMPLETE candidate rather than a
# hand-written character list: a project name can be individually legal and
# still compose into an invalid ref, and git's rules (leading dot, `.lock`
# suffix, `@{`, `..`, control characters) are git's to know.
#
# Failure refuses with the reason. It never slugs the name into something valid,
# because a slug that differs from the project's real name breaks the provenance
# the ref exists to carry.
# check-ref-format is necessary but NOT sufficient: a slash is perfectly legal
# in a ref, so a project named `a/b` would yield `a2bp/a/b/<digest>` — an extra
# namespace level that git accepts happily and that breaks `prs` parsing, which
# reads the project from a fixed position. Found by testing git's real answers
# instead of assuming them; a hand-written rule list would not have caught it
# either, because the rule being violated is ours, not git's.
bp_request_ref() {
  local project="$1" digest="$2" candidate

  case "$project" in
    "")   echo "bp_request_ref: project name is empty" >&2; return 1 ;;
    */*)  echo "bp_request_ref: project name '$project' contains '/' — it must be a single ref component, or it would add a namespace level that 'blueprint prs' cannot parse" >&2
          return 1 ;;
  esac

  candidate="a2bp/${project}/${digest}"
  if ! git check-ref-format --branch "$candidate" >/dev/null 2>&1; then
    echo "bp_request_ref: '$candidate' is not a valid branch name (project name '$project' cannot be used as a ref component)" >&2
    return 1
  fi
  printf '%s' "$candidate"
}

# --- The construction environment -------------------------------------------
# Object construction must be hermetic: identical inputs produce an identical
# commit SHA on any machine. Everything below is an ambient input that would
# otherwise leak in — .gitattributes and clean filters via `git add` (which is
# why this never uses a working tree), the object format (a SHA-256 repo rehashes
# identical content), hooks, signing, locale, and config injection.
#
# TRANSPORT DOES NOT USE THIS. Credentials live in exactly the config this
# scrubs, so fetch/push run in the operator's environment — see
# bp_request_transport_env.
#
# NOTE for callers setting a deliberate date or identity: this unsets
# GIT_AUTHOR_DATE and GIT_COMMITTER_DATE, so `GIT_AUTHOR_DATE=x
# bp_request_hermetic git commit-tree ...` DOES NOT WORK — the value is stripped
# and git falls back to the wall clock. Set them inside the scrub instead:
# `bp_request_hermetic env GIT_AUTHOR_DATE=x git commit-tree ...`. This was a
# real bug (see request-build.sh), and it was invisible to any test whose two
# builds completed within the same second.
bp_request_hermetic() {
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE \
      -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES \
      -u GIT_CONFIG -u GIT_CONFIG_COUNT \
      -u GIT_AUTHOR_DATE -u GIT_COMMITTER_DATE \
      GIT_CONFIG_NOSYSTEM=1 \
      GIT_CONFIG_GLOBAL=/dev/null \
      LC_ALL=C \
      "$@"
}

# Transport keeps credential inputs (GIT_SSH_COMMAND, askpass, agent state,
# helpers, proxies) because silently breaking authenticated remotes is not
# acceptable. It still refuses the variables that would redirect which
# repository, index or object store is being operated on, or inject config.
#
# The list is also DATA, for a caller that must start transport as ONE external
# process. A function run in the background forks a subshell first, so `$!`
# names that subshell rather than the transport, and the transport cannot be
# signalled by pid (TASK-025, the sync refresh). One list, used both ways.
BP_REQUEST_TRANSPORT_UNSET=(
  -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE
  -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES
  -u GIT_CONFIG -u GIT_CONFIG_COUNT
)
bp_request_transport_env() {
  env "${BP_REQUEST_TRANSPORT_UNSET[@]}" "$@"
}

# --- Minimum git version ----------------------------------------------------
# 2.32 is set by GIT_CONFIG_GLOBAL, which is how the global config is scrubbed
# without editing the operator's files. `init --object-format` needs 2.29 and
# the `update-index --cacheinfo` comma form needs 2.0, both behind it.
BP_REQUEST_MIN_GIT="2.32"

bp_request_check_git_version() {
  local found major minor
  found=$(git --version | awk '{print $3}')
  major=${found%%.*}
  minor=${found#*.}; minor=${minor%%.*}
  if [ "$major" -gt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -ge 32 ]; }; then
    return 0
  fi
  echo "bp_request: git $found found, $BP_REQUEST_MIN_GIT or newer required" >&2
  echo "  (GIT_CONFIG_GLOBAL, used to isolate object construction, needs 2.32)" >&2
  return 1
}
