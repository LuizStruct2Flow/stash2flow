#!/bin/bash
# scripts/lib/request-build.sh — build an a2bp request commit.
#
# A derived project's repository has history UNRELATED to the blueprint's, so
# there is no common ancestor to commit against locally. The request is built in
# a scratch bare clone, against the fetched blueprint base, with git plumbing
# only — no working tree ever holds the content, because `git add` runs the
# content through .gitattributes and clean filters and those vary per machine.
#
# Determinism is not a nicety here: retry adoption compares a rebuilt commit's
# SHA against the remote tip, so if the build is not byte-reproducible the retry
# silently degrades to "always refuse".
#
# Plan: docs/doing/PLAN-A2BP-PR.md §6.
# Requires: scripts/lib/request.sh
#
# shellcheck shell=bash

# --- bp_build_validate_base BARE BASE_SHA PATH... ---------------------------
# The fetched base is a separate tree with its own shape, and a target path may
# be blocked by what is already there. Every refusal names the path and what was
# found, because "refused" without the reason sends the operator to read a tree
# by hand.
bp_build_validate_base() {
  local bare="$1" base="$2"; shift 2
  local path entry mode type parent rc=0

  for path in "$@"; do
    entry=$(bp_request_hermetic git -C "$bare" ls-tree "$base" -- "$path" 2>/dev/null)
    if [ -n "$entry" ]; then
      mode=$(printf '%s' "$entry" | awk '{print $1}')
      type=$(printf '%s' "$entry" | awk '{print $2}')
      case "$type/$mode" in
        blob/100644|blob/100755) : ;;
        tree/*)
          echo "  base holds a DIRECTORY at $path — replacing a tree with a file is a restructure, not an edit to a file" >&2
          rc=1 ;;
        blob/120000)
          echo "  base holds a SYMLINK at $path — overwriting it would change what every consumer resolves" >&2
          rc=1 ;;
        commit/*)
          echo "  base holds a SUBMODULE at $path" >&2
          rc=1 ;;
        *)
          echo "  base holds an unrepresentable mode $mode ($type) at $path" >&2
          rc=1 ;;
      esac
    else
      # Absent: it, and each parent, must not differ from a base path only by
      # case. A git tree holds `Readme.md` beside `README.md`; a case-folding
      # checkout (macOS by default) cannot, so the request would break every
      # such consumer. An exact parent is fine: that is where the file goes.
      # ponytail: ASCII case folding (awk tolower); Unicode folding if a
      # non-ASCII collision ever matters.
      local clash
      clash=$(bp_request_hermetic git -C "$bare" -c core.quotePath=false \
                ls-tree -r -t --name-only "$base" 2>/dev/null | \
              BP_T="$path" awk '
                BEGIN { n = split(ENVIRON["BP_T"], c, "/"); p = ""
                        for (i = 1; i <= n; i++) { p = (i == 1 ? c[1] : p "/" c[i]); want[tolower(p)] = p } }
                { l = tolower($0); if ((l in want) && want[l] != $0) { print; exit } }')
      if [ -n "$clash" ]; then
        echo "  base holds '$clash', which differs from $path only by case — a case-insensitive checkout cannot hold both" >&2
        rc=1
        continue
      fi
      # Every existing parent component must be a real tree, or the
      # entry cannot be created without restructuring the base.
      parent=$(dirname "$path")
      while [ "$parent" != "." ] && [ "$parent" != "/" ]; do
        entry=$(bp_request_hermetic git -C "$bare" ls-tree "$base" -- "$parent" 2>/dev/null)
        if [ -n "$entry" ]; then
          mode=$(printf '%s' "$entry" | awk '{print $1}')
          if [ "$mode" != "040000" ]; then
            echo "  base has a non-directory at '$parent' (mode $mode), so $path cannot be created" >&2
            rc=1
          fi
          break
        fi
        parent=$(dirname "$parent")
      done
    fi
  done
  return $rc
}

# --- bp_build_request BARE BASE REF PROJECT SPEC... -------------------------
# Builds the commit and points REF at it. Prints the commit SHA.
#
# Specs are <path>:<mode>:<content-file>, pre-sorted and de-duplicated by the
# caller — the same contract bp_request_key relies on, so the commit and the key
# describe the same request.
bp_build_request() {
  local bare="$1" base="$2" ref="$3" project="$4"
  shift 4
  local specs=("$@")

  local idx="$bare/a2bp-index"
  rm -f "$idx"

  # SEED THE INDEX FROM THE BASE FIRST. Without this, `update-index --cacheinfo`
  # populates an empty index and `write-tree` yields a tree containing ONLY the
  # target paths — the request would propose deleting the entire blueprint
  # except the files it changes. One line between a working mechanism and a
  # catastrophic one.
  if ! GIT_INDEX_FILE="$idx" bp_request_hermetic git -C "$bare" read-tree "$base"; then
    echo "bp_build_request: could not read base tree $base into the index" >&2
    return 1
  fi

  local spec path mode cfile blob
  for spec in "${specs[@]}"; do
    path=${spec%%:*}
    mode=${spec#*:}; mode=${mode%%:*}
    cfile=${spec#*:*:}

    # --no-filters is the point: it bypasses .gitattributes and clean filters,
    # which is why no working tree is used anywhere in this function.
    blob=$(bp_request_hermetic git -C "$bare" hash-object -w --no-filters --stdin < "$cfile") || return 1
    GIT_INDEX_FILE="$idx" bp_request_hermetic git -C "$bare" \
      update-index --add --cacheinfo "$mode,$blob,$path" || return 1
  done

  local tree
  tree=$(GIT_INDEX_FILE="$idx" bp_request_hermetic git -C "$bare" write-tree) || return 1

  # Commit identity and dates are fixed and environment-independent. The date is
  # the base commit's own committer date — available without a clock, and it
  # ties the request to the base it was built from.
  local basedate msg commit
  basedate=$(bp_request_hermetic git -C "$bare" show -s --format='%ct %cz' "$base") || return 1
  msg=$(printf 'a2bp: %d file(s) from %s\n' "${#specs[@]}" "$project"
        printf '\n'
        for spec in "${specs[@]}"; do printf '%s\n' "${spec%%:*}"; done)

  # The identity and dates are set INSIDE the scrub, via `env`, not outside it.
  #
  # bp_request_hermetic exists to unset ambient GIT_* variables, and
  # GIT_AUTHOR_DATE / GIT_COMMITTER_DATE are two of the ones it unsets — so
  # setting them on the wrapper's own command line got them stripped again, and
  # commit-tree fell back to the WALL CLOCK. The build was therefore
  # non-deterministic, and only across a one-second boundary: two runs inside the
  # same second agreed, so the determinism cases passed locally and the flow
  # broke under the pre-push gate, where the runs were slow enough to straddle a
  # second. Setting them after the scrub is what makes the fixed date actually
  # reach git.
  commit=$(printf '%s' "$msg" | \
    bp_request_hermetic env \
      GIT_AUTHOR_NAME=a2bp GIT_AUTHOR_EMAIL=a2bp@blueprint.invalid \
      GIT_COMMITTER_NAME=a2bp GIT_COMMITTER_EMAIL=a2bp@blueprint.invalid \
      GIT_AUTHOR_DATE="$basedate" GIT_COMMITTER_DATE="$basedate" \
    git -C "$bare" \
      -c core.hooksPath=/dev/null -c commit.gpgsign=false \
      -c core.autocrlf=false -c i18n.commitEncoding=UTF-8 \
      commit-tree "$tree" -p "$base") || return 1

  # ASSERT THE RESULT rather than trust the construction. This is what would
  # have caught an unseeded index: a tree missing every unrelated file shows up
  # immediately as a diff touching far more than the target paths.
  bp_build_assert "$bare" "$base" "$commit" "${specs[@]}" || return 1

  bp_request_hermetic git -C "$bare" update-ref "refs/heads/$ref" "$commit" || return 1
  printf '%s' "$commit"
}

# --- bp_build_assert BARE BASE COMMIT SPEC... -------------------------------
# The commit's parent is the captured base, its diff against that base touches
# EXACTLY the target paths, and each target blob's bytes are the staged bytes.
bp_build_assert() {
  local bare="$1" base="$2" commit="$3"; shift 3
  local specs=("$@")

  local parent
  parent=$(bp_request_hermetic git -C "$bare" rev-parse "$commit^" 2>/dev/null)
  if [ "$parent" != "$base" ]; then
    echo "bp_build_assert: parent is $parent, expected the captured base $base" >&2
    return 1
  fi

  local want got spec
  want=$(for spec in "${specs[@]}"; do printf '%s\n' "${spec%%:*}"; done | LC_ALL=C sort)
  got=$(bp_request_hermetic git -C "$bare" diff --name-only "$base" "$commit" | LC_ALL=C sort)
  if [ "$want" != "$got" ]; then
    echo "bp_build_assert: the commit changes a different set of paths than requested." >&2
    echo "  requested: $(printf '%s' "$want" | tr '\n' ' ')" >&2
    echo "  changed:   $(printf '%s' "$got" | tr '\n' ' ')" >&2
    echo "  (a much larger 'changed' set means the index was not seeded from the base)" >&2
    return 1
  fi

  local path mode cfile actual_mode
  for spec in "${specs[@]}"; do
    path=${spec%%:*}
    mode=${spec#*:}; mode=${mode%%:*}
    cfile=${spec#*:*:}
    actual_mode=$(bp_request_hermetic git -C "$bare" ls-tree "$commit" -- "$path" | awk '{print $1}')
    if [ "$actual_mode" != "$mode" ]; then
      echo "bp_build_assert: $path has mode $actual_mode, expected $mode" >&2
      return 1
    fi
    if ! bp_request_hermetic git -C "$bare" show "$commit:$path" | cmp -s - "$cfile"; then
      echo "bp_build_assert: $path in the commit does not match the staged bytes" >&2
      return 1
    fi
  done
  return 0
}
