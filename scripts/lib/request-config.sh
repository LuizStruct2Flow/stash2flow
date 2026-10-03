#!/bin/bash
# scripts/lib/request-config.sh — read and validate .blueprint-source for a2bp.
#
# a2bp now pushes to a remote. Where it pushes is therefore a security-relevant
# input, and every failure mode here is "the request went somewhere the operator
# did not intend" — which is not a recoverable mistake once it has left the
# machine. So this module refuses rather than infers, everywhere.
#
# In particular it does NOT fall back to the local blueprint checkout's `origin`.
# That would usually be right, which is exactly what makes it dangerous: it would
# be silently wrong for anyone whose checkout tracks a fork.
#
# Plan: docs/doing/PLAN-A2BP-PR.md §8.
#
# shellcheck shell=bash

BP_CONFIG_VERSION_SUPPORTED=2

# --- bp_config_field FILE KEY ------------------------------------------------
# `key = value`, first occurrence wins, surrounding whitespace stripped. Absent
# is empty, not an error — the caller decides which absences matter.
bp_config_field() {
  local file="$1" key="$2" line
  line=$(grep -m1 "^[[:space:]]*${key}[[:space:]]*=" "$file" 2>/dev/null) || return 0
  printf '%s' "${line#*=}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

# --- bp_config_load FILE -----------------------------------------------------
# Emits `BP_CFG_<KEY>=<value>` lines for eval by the caller, or prints the
# refusal and returns non-zero.
#
# Validation order is fixed and checked before ANY remote contact, so a
# misconfigured project cannot get as far as pushing a branch.
bp_config_load() {
  local file="$1" version remote branch read_branch

  if [ ! -f "$file" ]; then
    echo "no $file here — run a2bp from a struct2flow project root" >&2
    return 1
  fi

  version=$(bp_config_field "$file" config_version)

  if [ -z "$version" ]; then
    # Absent means version 1: the local-path-only file every project bootstrapped
    # before this change. Refuse with the exact lines to add rather than guess a
    # push destination.
    echo "$file is a version 1 config (no config_version) and a2bp now files a" >&2
    echo "request against the blueprint's REMOTE, which version 1 does not name." >&2
    echo >&2
    echo "Add these lines, with the remote you actually want to file against:" >&2
    echo >&2
    echo "  config_version   = 2" >&2
    echo "  blueprint_remote = git@github.com:<owner>/<blueprint>.git" >&2
    echo "  blueprint_branch = main" >&2
    echo >&2
    echo "This is not inferred from the local checkout's origin on purpose: that" >&2
    echo "would be right often enough to be trusted and wrong for anyone whose" >&2
    echo "checkout tracks a fork. Pushing a request to the wrong repository is" >&2
    echo "not a recoverable mistake." >&2
    return 1
  fi

  case "$version" in
    ''|*[!0-9]*)
      echo "$file has a non-numeric config_version '$version'" >&2
      return 1 ;;
  esac

  if [ "$version" -gt "$BP_CONFIG_VERSION_SUPPORTED" ]; then
    # Naming BOTH numbers matters: the operator is usually running an older CLI
    # against a newer project, and "unsupported version" alone does not say
    # which side to update.
    echo "$file declares config_version $version, but this CLI understands up to" >&2
    echo "$BP_CONFIG_VERSION_SUPPORTED. Update the blueprint CLI rather than" >&2
    echo "lowering the version — a newer config may mean fields this CLI would" >&2
    echo "silently ignore." >&2
    return 1
  fi

  if [ "$version" -lt "$BP_CONFIG_VERSION_SUPPORTED" ]; then
    echo "$file declares config_version $version; a2bp requires $BP_CONFIG_VERSION_SUPPORTED." >&2
    echo "Add blueprint_remote and blueprint_branch, then set config_version = 2." >&2
    return 1
  fi

  remote=$(bp_config_field "$file" blueprint_remote)
  if [ -z "$remote" ]; then
    echo "$file declares config_version 2 but blueprint_remote is empty or absent." >&2
    return 1
  fi

  # The bootstrap placeholder. `new-project.sh` writes it deliberately rather
  # than guessing a remote, so it is the NORMAL state of a fresh project — and it
  # is non-empty, which means the emptiness check above waves it straight
  # through. Without this, a2bp would try to push to a repository literally named
  # FILL-ME-IN and fail with a transport error naming neither the file nor the
  # field.
  case "$remote" in
    FILL-ME-IN|FILL_ME_IN|'<owner>/<blueprint>'|*'<owner>'*)
      echo "$file still has the bootstrap placeholder for blueprint_remote:" >&2
      echo "  blueprint_remote = $remote" >&2
      echo >&2
      echo "Set it to the blueprint repository this project files requests against," >&2
      echo "e.g. git@github.com:<your-org>/blueprint.git — it is not inferred from" >&2
      echo "the local checkout's origin, because that would be silently wrong for" >&2
      echo "anyone whose checkout tracks a fork." >&2
      return 1 ;;
  esac

  # `branch` defaults to main only under version 2, where its absence is a
  # deliberate omission rather than a config that predates the field.
  branch=$(bp_config_field "$file" blueprint_branch)
  [ -n "$branch" ] || branch="main"

  # A branch name that is not a valid ref would fail later, mid-transport, with
  # a git error naming neither the file nor the field.
  if ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then
    echo "$file has blueprint_branch = '$branch', which is not a valid branch name." >&2
    return 1
  fi

  # TASK-025 — the branch `drift` and `pull` READ, optional. `released` in a
  # derived project: the newest main commit on which every CI job passed, which
  # the blueprint's release job fast-forwards. Absent means blueprint_branch, so a
  # project mid-migration keeps working. It is a separate field rather than a new
  # value for blueprint_branch because blueprint_branch is a2bp's pull-request
  # base, and requests must never be filed against the branch CI owns — so
  # BP_CFG_BRANCH stays exactly what it was. The config version stays 2: a CLI
  # that predates this field does not read the remote at all.
  read_branch=$(bp_config_field "$file" blueprint_release_branch)
  if [ -n "$read_branch" ] && ! git check-ref-format --branch "$read_branch" >/dev/null 2>&1; then
    echo "$file has blueprint_release_branch = '$read_branch', which is not a valid branch name." >&2
    return 1
  fi
  [ -n "$read_branch" ] || read_branch="$branch"

  printf 'BP_CFG_VERSION=%s\n' "$version"
  printf 'BP_CFG_REMOTE=%q\n' "$remote"
  printf 'BP_CFG_BRANCH=%q\n' "$branch"
  printf 'BP_CFG_READ_BRANCH=%q\n' "$read_branch"
}
