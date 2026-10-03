#!/bin/bash
# scripts/lib/request-inputs.sh — validate the files a request is built from.
#
# This decides which bytes leave the operator's machine, so every rule here is
# about a path resolving to something other than what was typed. `a2bp` is the
# only write path from a project into the generic blueprint and is how BUG-002
# and A-09 both got in; the contamination guard checks the CONTENT, and this
# checks that the content came from where the operator said.
#
# TASK-037 — a request may carry a file the blueprint does NOT ship: a change to
# a blueprint-only file, or a new file. Membership in MANAGED_FILES no longer
# decides whether a path is accepted, only whether it is labelled "not shipped".
# That check used to be the only thing keeping `.git/` and secrets out of a
# request, so those are now guards of their own: `.git` paths, symlinked
# parents, ignored files (tracked or not), secret filenames, and a gitleaks scan
# of every input's content — all before any remote contact.
#
# Plan: docs/doing/PLAN-A2BP-PR.md §5.1.
# Requires: request.sh (bp_request_transport_env)
#
# shellcheck shell=bash

# --- bp_inputs_canonicalise PATH ---------------------------------------------
# Resolve `.` and `..` and collapse duplicate separators, TEXTUALLY — without
# consulting the filesystem, so symlinks are not followed here. Following them
# would resolve a path to a location the operator never named, which is the
# thing the symlink check below exists to catch; canonicalising through them
# would launder exactly that case before it could be seen.
#
# Emits a project-relative path, or fails if the result escapes the root.
bp_inputs_canonicalise() {
  local path="$1" part out=""

  case "$path" in
    /*) echo "bp_inputs: '$path' is absolute; give a project-relative path" >&2
        return 1 ;;
  esac

  local IFS='/'
  # shellcheck disable=SC2086
  set -- $path
  for part in "$@"; do
    case "$part" in
      ''|'.') continue ;;
      '..')
        if [ -z "$out" ]; then
          # Refused rather than clamped. Clamping would silently turn
          # `../../etc/passwd` into `etc/passwd` — a different file that might
          # well exist, quietly filed instead of the refusal the operator needs.
          echo "bp_inputs: '$path' escapes the project root" >&2
          return 1
        fi
        case "$out" in
          */*) out=${out%/*} ;;   # pop one component
          *)   out="" ;;          # popped the last one; back at the root
        esac
        continue ;;
      *) if [ -z "$out" ]; then out="$part"; else out="$out/$part"; fi ;;
    esac
  done

  if [ -z "$out" ]; then
    echo "bp_inputs: '$path' does not name a file" >&2
    return 1
  fi
  printf '%s' "$out"
}

# --- bp_inputs_mode PATH -----------------------------------------------------
# 100755 if executable by anyone, else 100644. Git records only that bit.
bp_inputs_mode() {
  if [ -x "$1" ]; then printf '100755'; else printf '100644'; fi
}

# --- bp_inputs_is_managed CANON MANAGED_LIST_FILE ----------------------------
# Is this canonical path shipped to derived projects? MANAGED_LIST_FILE holds one
# managed file per line — cmd_a2bp derives it from the fetched base's archive
# (TASK-021), so the list is per file and an exact match is the whole test.
bp_inputs_is_managed() {
  grep -qxF -- "$1" "$2"
}

# --- _bp_inputs_ignored ROOT CANON -------------------------------------------
# Refuses (status 1, with the reason) a path the project's .gitignore ignores,
# or one whose ignore status cannot be answered.
#
# Outside the managed set, the project's .gitignore is what separates content
# from local state (AGENT_ROSTER.md, logs/). Managed paths skip this only because
# they are shipped content by definition.
#
# --no-index: without it git answers from the index, so a force-tracked file is
# never reported as ignored whatever the pattern says.
_bp_inputs_ignored() {
  local ign_rc=0 ign_err
  ign_err=$(bp_request_transport_env git -C "$1" check-ignore --no-index -q -- "$2" 2>&1) || ign_rc=$?
  case "$ign_rc" in
    0) echo "bp_inputs: '$2' is gitignored in this project; ignored files are never filed" >&2
       return 1 ;;
    1) return 0 ;;
    *) # Unanswered is not "not ignored" (BUG-003: a guard that cannot run
       # is not a guard that passed). git's own reason, not a guess at it.
       echo "bp_inputs: cannot tell whether '$2' is gitignored: ${ign_err:-git check-ignore exited $ign_rc}" >&2
       return 1 ;;
  esac
}

# --- bp_inputs_refuse_ignored ROOT MANAGED_LIST_FILE VALIDATED ---------------
# The ignore check for a validation that deferred it: every accepted
# `<canonical>:<mode>` line whose path is not managed. cmd_a2bp runs it once the
# base is fetched, because the managed set is the base's archive, and a fetch is
# a read: nothing has been pushed. Fails if any path is refused.
bp_inputs_refuse_ignored() {
  local root="$1" managed="$2" line rc=0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    bp_inputs_is_managed "${line%%:*}" "$managed" && continue
    _bp_inputs_ignored "$root" "${line%%:*}" || rc=1
  done <<< "$3"
  return "$rc"
}

# --- _bp_inputs_secret_scan ROOT ACCEPTED ------------------------------------
# gitleaks, the pre-push gate's secret scanner, over every accepted input's
# bytes, managed or not. It runs here, before the fetch, because a reviewer
# rejecting the PR cannot un-disclose a secret the push already carried.
#
# The project's bytes, not the staged ones: staging only restores
# stash2flow on lines the fetched base already holds, so a secret that
# appears only in the staged form is already in the blueprint.
#
# A MISSING SCANNER REFUSES (BUG-127), and this is deliberately STRICTER than
# the pre-push gate it otherwise mirrors. The gate's skip is defensible because
# nothing leaves the machine. `a2bp` pushes a branch to the blueprint's remote,
# so the same skip publishes unscanned bytes, and the CI secret-scan of the pull
# request runs AFTER the upload: it can refuse the merge, it cannot un-disclose.
# Alexey took gitleaks off PATH and both private-key probes reached the fetch.
#
# A scan that ran and could not finish is NOT a skip either: it blocks (BUG-003).
#
# `--exit-code 7` SEPARATES "found" FROM "could not run" (BUG-127). gitleaks
# reports findings with whatever status that flag names, so 1 stops meaning
# "secret" — and 1 is what a gitleaks too old for `dir` returns while printing
# `unknown command dir`. That was reported to the operator as a found secret,
# with rotation advice, for a file that had none. A tool that cries wolf is one
# whose real findings stop being believed. 7 is arbitrary but must stay clear of
# gitleaks' own statuses: 0 clean, 1 usage and other failures, 2+ tool failure.
_bp_inputs_secret_scan() {
  local root="$1" accepted="$2" line canon out gl_rc rc=0
  if ! command -v gitleaks >/dev/null 2>&1; then
    echo "bp_inputs: gitleaks is not installed, so nothing has scanned the bytes this request would publish." >&2
    echo "  a2bp is stricter than the pre-push gate here, and deliberately so: the gate's skip" >&2
    echo "  leaves unscanned bytes on this machine, while a2bp pushes a branch to the" >&2
    echo "  blueprint's remote. CI scans the pull request afterwards, which can refuse the" >&2
    echo "  merge but cannot un-disclose what the push already carried." >&2
    echo "  Install it: bash scripts/install-toolchain.sh" >&2
    return 1
  fi
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    canon=${line%:*}
    gl_rc=0
    out=$(gitleaks dir --no-banner --no-color --redact --exit-code 7 --verbose -- "$root/$canon" 2>&1) || gl_rc=$?
    case "$gl_rc" in
      0) : ;;
      7) echo "bp_inputs: gitleaks found a secret in '$canon'; secrets are never filed. Rotate it if it was ever pushed anywhere." >&2
         printf '%s\n' "$out" | sed 's/^/    /' >&2
         rc=1 ;;
      *) echo "bp_inputs: gitleaks could not complete on '$canon' (exit $gl_rc) — the secret scan did NOT run." >&2
         echo "  This is a scanner failure: not a clean scan, and not a finding either. An exit of 1" >&2
         echo "  usually means this gitleaks predates 'gitleaks dir' (install: bash scripts/install-toolchain.sh)." >&2
         printf '%s\n' "$out" | tail -5 | sed 's/^/    /' >&2
         rc=1 ;;
    esac
  done <<< "$accepted"
  return "$rc"
}

# --- bp_inputs_validate ROOT MANAGED_LIST_FILE PATH... -----------------------
# Prints one `<canonical-path>:<mode>` line per accepted input, sorted byte-wise
# and de-duplicated. Any refusal fails the whole call: a request is filed as one
# unit, so proceeding with a subset would file something the operator did not
# ask for. An empty MANAGED_LIST_FILE defers the ignore check (see there).
bp_inputs_validate() {
  local root="$1" managed="$2"; shift 2
  local raw canon mode rc=0
  local accepted=""

  if [ "$#" -eq 0 ]; then
    echo "bp_inputs: no files given" >&2
    return 1
  fi

  for raw in "$@"; do
    canon=$(bp_inputs_canonicalise "$raw") || { rc=1; continue; }

    # Every rule below runs on the CANONICAL form, so `./.git/config` and
    # `docs/../.env` cannot slip past a check that only matches the literal
    # spelling.

    # Repository metadata is never a proposal: `.git/config` carries remotes
    # and sometimes credentials. Case-insensitive, because on a case-folding
    # filesystem `.GIT/config` is the same file.
    case "/$(printf '%s' "$canon" | tr 'A-Z' 'a-z')/" in
      */.git/*)
        echo "bp_inputs: '$canon' is inside a .git directory; repository metadata is never filed" >&2
        rc=1; continue ;;
    esac

    # The project's own configuration. CLAUDE.md: project-specific edits go in
    # project_config_*.md and are never back-propagated. At the blueprint root
    # these paths are the BLUEPRINT's own config (BUG-009), so a request would
    # propose replacing it with this project's. Case-folded: on a case-folding
    # checkout PROJECT_CONFIG_DOD.MD is that same file. Root only, so
    # templates/project_config_*.md (the generic seed) stays proposable.
    case "$(printf '%s' "$canon" | tr 'A-Z' 'a-z')" in
      project_config_*.md)
        echo "bp_inputs: '$canon' is this project's own configuration (project_config_*.md)." >&2
        echo "  It is never back-propagated. A change to what new projects are seeded" >&2
        echo "  with is a change to templates/$canon in the blueprint." >&2
        rc=1; continue ;;
    esac

    # A symlinked DIRECTORY on the way is the same hole as a symlinked file
    # (checked below): the bytes come from wherever it points. Walked for every
    # input, managed or not, before anything asks git about the path.
    local walked="" rest="$canon" part linked=""
    while case "$rest" in */*) true ;; *) false ;; esac; do
      part=${rest%%/*}; rest=${rest#*/}
      walked=${walked:+$walked/}$part
      if [ -L "$root/$walked" ]; then linked="$walked"; break; fi
    done
    if [ -n "$linked" ]; then
      echo "bp_inputs: '$canon' is under '$linked', which is a symlink; refusing to file bytes from wherever it points" >&2
      rc=1; continue
    fi

    # The ignore check, for unmanaged paths. An EMPTY managed-list argument
    # defers it to bp_inputs_refuse_ignored: cmd_a2bp knows the managed set only
    # after fetching the base, and everything else here must run before that.
    if [ -n "$managed" ] && ! bp_inputs_is_managed "$canon" "$managed"; then
      _bp_inputs_ignored "$root" "$canon" || { rc=1; continue; }
    fi

    # Secrets, by name. The content scan below is the real check; this catches
    # the files whose name alone says what they are, including when no scanner
    # is installed. Case-folded, for the same reason as `.git` above.
    case "$(printf '%s' "${canon##*/}" | tr 'A-Z' 'a-z')" in
      .env|.env.*|*.pem|*.key|id_rsa*|id_ed25519*|*.p12|*.pfx)
        echo "bp_inputs: '$canon' is named like a secret (.env, .pem, .key, id_rsa, id_ed25519, .p12, .pfx); secrets are never filed" >&2
        rc=1; continue ;;
    esac

    # -L before -f: `[ -f ]` follows symlinks, so a symlink to a regular file
    # passes it. Filing through one would send bytes from a location the
    # operator did not name, and the PR would show the path they did.
    if [ -L "$root/$canon" ]; then
      echo "bp_inputs: '$canon' is a symlink; refusing to file bytes from wherever it points" >&2
      rc=1; continue
    fi
    if [ ! -e "$root/$canon" ]; then
      echo "bp_inputs: '$canon' does not exist in this project" >&2
      rc=1; continue
    fi
    if [ -d "$root/$canon" ]; then
      echo "bp_inputs: '$canon' is a directory" >&2
      rc=1; continue
    fi
    if [ ! -f "$root/$canon" ]; then
      echo "bp_inputs: '$canon' is not a regular file" >&2
      rc=1; continue
    fi
    if [ ! -r "$root/$canon" ]; then
      echo "bp_inputs: '$canon' is not readable" >&2
      rc=1; continue
    fi

    mode=$(bp_inputs_mode "$root/$canon")
    accepted="${accepted}${canon}:${mode}"$'\n'
  done

  [ "$rc" -eq 0 ] || return 1
  _bp_inputs_secret_scan "$root" "$accepted" || return 1

  # Sorted and de-duplicated here, once. The request key is a pure function of
  # the spec list, so ordering is a correctness property: the same request typed
  # in a different argument order must produce the same branch, or the two would
  # be filed as unrelated requests.
  printf '%s' "$accepted" | LC_ALL=C sort -u
}

# --- bp_inputs_drop_unchanged BARE BASE SPEC... ------------------------------
# Drops inputs already identical to the base, printing what it dropped, and
# fails when nothing is left.
#
# An empty PR costs a reviewer the same attention as a real one, and reviewer
# attention is the scarce resource this whole design exists to protect — so
# "nothing to request" is a refusal, not a no-op success.
bp_inputs_drop_unchanged() {
  local bare="$1" base="$2"; shift 2
  local spec path mode cfile kept="" dropped=0

  for spec in "$@"; do
    path=${spec%%:*}
    mode=${spec#*:}; mode=${mode%%:*}
    cfile=${spec#*:*:}

    local base_mode base_entry
    base_entry=$(bp_request_hermetic git -C "$bare" ls-tree "$base" -- "$path" 2>/dev/null)
    if [ -n "$base_entry" ]; then
      base_mode=$(printf '%s' "$base_entry" | awk '{print $1}')
      if [ "$base_mode" = "$mode" ] && \
         bp_request_hermetic git -C "$bare" show "$base:$path" 2>/dev/null | cmp -s - "$cfile"; then
        echo "  dropped (identical to the blueprint): $path" >&2
        dropped=$((dropped+1))
        continue
      fi
    fi
    kept="${kept}${spec}"$'\n'
  done

  if [ -z "$kept" ]; then
    echo "Nothing to request: every file given is already identical to the blueprint." >&2
    return 2
  fi
  [ "$dropped" -gt 0 ] && echo "  $dropped file(s) dropped; the rest proceed." >&2
  printf '%s' "$kept"
}
