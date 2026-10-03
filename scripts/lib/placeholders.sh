#!/bin/bash
# scripts/lib/placeholders.sh — THE forward substitution for {{PROJECT_NAME}}.
#
# WHY THIS IS ONE PRIMITIVE (A-07 R5-F1)
#
# "Meaning under substitution" is only a meaningful phrase if there is exactly
# one substitution semantics. There were three, and they disagreed:
#
#   scripts/blueprint.mts substitute_placeholders    sed -e "s/{{PROJECT_NAME}}/${name}/g"
#   scripts/blueprint.mts substituted_blueprint_copy the same sed
#   contamination.sh  _contamination_subst_file  bash ${line//token/$name}
#
# a2bp's round-trip check — the load-bearing safety property since R4 — used
# the bash form to verify what the sed form would later produce. For a project
# directory legitimately named `foo\bar` those differ, and the check passed
# while production substitution produced different bytes.
#
# Both were wrong, in different ways. Measured on this host:
#
#   name       bash ${//}              sed                  correct
#   foo\bar    foo\bar                 foobar               foo\bar
#   a&b        a{{PROJECT_NAME}}b      a{{PROJECT_NAME}}b   a&b
#   x/y        x/y                     sed: unknown option  x/y
#
# `&` means "the whole match" in a sed replacement, and bash 5.2 gave `&` the
# same meaning in `${var//pat/repl}` — so `pull` itself has been silently
# mangling any project whose name contains `&` or `\`, independent of a2bp.
# Directory names may legally contain both.
#
# So substitution is done by literal split-and-join: the project name is DATA
# and is never handed to anything that could interpret it — not as a regex,
# not as a replacement template. One primitive, used by pull, by drift's
# comparison, and by a2bp's verifier, so the three cannot drift apart again.
#
# shellcheck shell=bash

# bp_placeholder_upper NAME → the {{PROJECT_NAME_UPPER}} form.
bp_placeholder_upper() {
  printf '%s' "$1" | tr 'a-z-' 'A-Z_'
}

# bp_should_substitute REPO_RELATIVE_PATH → 0 if forward substitution may apply.
#
# THE ARGUMENT IS REPO-RELATIVE. Not "$BLUEPRINT_ROOT/$f", not "$PWD/$f" — the
# path a file has INSIDE the repo, which is the only thing its identity depends
# on. An absolute path makes the answer a function of where someone happened to
# clone the blueprint, and the patterns below can then match a component of the
# operator's home directory (BUG-029 R2-S2: a blueprint under any directory
# named `tests/` stopped substituting {{PROJECT_NAME}} anywhere at all).
#
# The pre-existing entries are suffix-anchored, so they were immune to that by
# accident rather than by design. Do not add a leading-component rule without
# checking every call site: `blueprint`'s substituted_blueprint_copy (which
# drift, pull's selection, preview and write all reach through
# bp_prospective_for since BUG-113), new-project.sh's bootstrap walk, and a2bp's
# staging loop.
#
# BUG-028. The files that IMPLEMENT or DOCUMENT the substitution carry the
# placeholder tokens as CODE AND PROSE, not as template slots — this file's own
#   local TL='{{PROJECT_NAME}}' TU='{{PROJECT_NAME_UPPER}}'
# is the primitive itself. Substituting it produces `local TL='acme-flow'` and
# the tool silently stops recognising the token it exists to replace.
#
# `scripts/blueprint.mts` and `scripts/new-project.sh` were already excluded for
# exactly this reason, and the list simply never grew when the logic moved into
# libraries. The consequence was live: on a zero-second-old bootstrap `drift`
# reported `scripts/lib/placeholders.sh` and `scripts/lib/contamination.sh` as
# drifted and offered `blueprint pull` — which would have corrupted them.
#
# It lives HERE, beside the primitive, so bootstrap, pull, drift and a2bp share
# ONE answer. Three near-copies of the substitution itself had already drifted
# apart once (A-07 R5-F1); a per-caller copy of "and which files are exempt"
# fails the same way.
#
# BUG-029 extends the same reasoning to `tests/`, which is now a managed
# DIRECTORY. A suite's placeholder tokens are FIXTURE DATA, never template
# slots: `tests/state-dir`, `tests/pull-behaviour` and `tests/a2bp-contamination`
# all carry a literal `{{PROJECT_NAME}}` because they drive the substitution
# itself. Substituting them replaces the token the suite exists to assert about,
# and the damage is worse than a wrong fixture — pull would rewrite the file on
# arrival, drift would then compare a substituted blueprint copy against a
# project copy that no longer holds the token, and the file would report as
# drifted forever with no pull able to fix it.
#
# This is REQUIRED, not defensive. Those three suites were safe only while
# `tests/` was unmanaged, and nothing about them changed when it stopped being.
bp_should_substitute() {
  case "$1" in
    *scripts/blueprint.mts|*scripts/new-project.sh) return 1 ;;
    *scripts/lib/placeholders.sh|*scripts/lib/contamination.sh) return 1 ;;
    tests/*) return 1 ;;
  esac
  return 0
}

# bp_replace_literal STRING FIND REPLACE → stdout, no trailing newline.
# Every occurrence of FIND is replaced by REPLACE, both treated as literal
# bytes. `${s%%"$find"*}` and `${s#*"$find"}` with FIND quoted are literal
# operations, and REPLACE is only ever concatenated — never re-scanned.
bp_replace_literal() {
  local s="$1" find="$2" repl="$3" out="" pre
  [ -n "$find" ] || { printf '%s' "$s"; return 0; }
  while [ -n "$s" ]; do
    case "$s" in
      *"$find"*)
        pre=${s%%"$find"*}
        out="$out$pre$repl"
        s=${s#*"$find"}
        ;;
      *)
        out="$out$s"
        s=""
        ;;
    esac
  done
  printf '%s' "$out"
}

# bp_substitute_line LINE NAME UPPER → stdout, no trailing newline.
#
# ONE PASS over both tokens (A-07 R6-F1). Replacing UPPER and then feeding the
# result to a lowercase pass is a pipeline, and a pipeline re-scans its own
# output: for a project legitimately named `x{{PROJECT_NAME}}y`, the bytes the
# first pass emitted were re-interpreted by the second —
#
#   input     {{PROJECT_NAME_UPPER}}
#   expected  X{{PROJECT_NAME}}Y
#   two-pass  Xx{{PROJECT_NAME}}yY      ← emitted data became input
#
# which contradicted this library's whole claim that replacement bytes are
# never re-scanned. So the scan finds the EARLIEST of either token, emits its
# replacement into the output, and continues from after the token in the
# remaining INPUT. Emitted bytes are appended and never examined again.
#
# The two tokens can never match at the same index (one needs `}}` where the
# other has `_U`), so "earliest wins" is unambiguous.
bp_substitute_line() {
  local s="$1" nm="$2" up="$3"
  local TL='{{PROJECT_NAME}}' TU='{{PROJECT_NAME_UPPER}}'
  local out="" pre_l="" pre_u="" has_l has_u
  while [ -n "$s" ]; do
    case "$s" in *"$TU"*) pre_u=${s%%"$TU"*}; has_u=1 ;; *) has_u=0 ;; esac
    case "$s" in *"$TL"*) pre_l=${s%%"$TL"*}; has_l=1 ;; *) has_l=0 ;; esac
    if [ "$has_u" -eq 0 ] && [ "$has_l" -eq 0 ]; then
      out="$out$s"
      break
    fi
    if [ "$has_u" -eq 1 ] && { [ "$has_l" -eq 0 ] || [ ${#pre_u} -lt ${#pre_l} ]; }; then
      out="$out$pre_u$up"
      s=${s#*"$TU"}
    else
      out="$out$pre_l$nm"
      s=${s#*"$TL"}
    fi
  done
  printf '%s' "$out"
}

# bp_validate_project_name NAME → 0 if substitutable, 1 otherwise (message on
# stderr).
#
# The supported contract, stated rather than assumed (A-07 R6-F1/R6-F2). The
# substitution, the diff alignment and the contamination scan are all
# LINE-ORIENTED, so a project directory whose name contains a newline cannot
# be represented in any of them. Such a name is legal on the filesystem, so
# it is refused explicitly instead of being silently mangled — command
# substitution used to strip it, which is the same silent truncation this
# whole finding is about.
bp_validate_project_name() {
  case "$1" in
    '')
      echo "error: project name is empty — cannot substitute" >&2
      return 1
      ;;
    *$'\n'*)
      # $'\n', never "$(printf '\n')" — command substitution strips trailing
      # newlines, so that form collapses to the empty string and the pattern
      # `*""*` matches EVERY name. It did, and every substitution refused.
      echo "error: project directory name contains a newline; blueprint sync is line-oriented and cannot represent it" >&2
      return 1
      ;;
  esac
  return 0
}

# bp_contains_nul FILE → 0 if the file contains a NUL byte.
# Streams; never loads the file.
bp_contains_nul() {
  ! tr -d '\0' < "$1" | cmp -s - "$1"
}

# bp_substitute_stream FILE NAME → substituted content on stdout.
# Returns non-zero (without writing) if FILE cannot be handled safely.
#
# BINARY IS REFUSED, NOT MANGLED (A-07 R6-F2). Shell variables cannot hold a
# NUL byte, so any bash-based rewrite silently discards binary content and
# everything after it — `printf 'A\0{{PROJECT_NAME}}\0Z'` came back as a lone
# `A`. The previous `sed` path preserved those bytes, so routing pull and
# drift through here would have let `pull` TRUNCATE an existing managed file.
# Blueprint-managed files are text by construction (markdown, shell, json,
# yml), so the honest fix is to state that and fail closed on the exception —
# silent truncation is never an acceptable unsupported-mode behaviour.
#
# STREAMS LINE BY LINE, no `mapfile`. Reading the whole file into an array and
# rebuilding shell strings made pull/drift's memory proportional to file size
# where `sed` had been O(1); a shared primitive on the pull path should not
# carry that.
#
# A missing final newline is preserved: a line-oriented rewrite must not
# append one the author never wrote.
bp_substitute_stream() {
  local src="$1" nm="$2"

  bp_validate_project_name "$nm" || return 1

  if [ -s "$src" ] && bp_contains_nul "$src"; then
    echo "error: $src contains NUL bytes; blueprint-managed files must be text" >&2
    return 2
  fi

  local up
  up=$(bp_placeholder_upper "$nm")

  local final_nl=1
  if [ -s "$src" ] && [ "$(tail -c1 "$src" | wc -l)" -eq 0 ]; then
    final_nl=0
  fi

  # `|| [ -n "$l" ]` catches a final line with no newline. Emitting the
  # separator BEFORE each subsequent line (rather than after each line) is
  # what lets the last one stay unterminated without a lookahead.
  local l first=1
  while IFS= read -r l || [ -n "$l" ]; do
    [ "$first" -eq 1 ] || printf '\n'
    first=0
    bp_substitute_line "$l" "$nm" "$up"
  done < "$src"
  [ "$first" -eq 1 ] || [ "$final_nl" -eq 0 ] || printf '\n'
}

# bp_copy_mode SRC DST — give DST the permissions SRC has.
#
# BUG-008. `mktemp` creates at 600 and `mv` carries the temp's mode onto the
# destination, so every substitution silently de-executed its file. The three
# managed files that are both executable and placeholder-bearing include
# `.githooks/pre-push` — and git skips a non-executable hook WITHOUT A WORD,
# while `core.hooksPath` still reports the gate as armed.
#
# GNU `--reference` first because it is exact and atomic; `stat` is the fallback
# for BSD/macOS. Probing in that order matters: on GNU, `stat -f` means
# "filesystem status" and would happily print an unrelated block rather than
# fail (the A-06 lesson), so the GNU form must be tried and accepted first.
# FAILS CLOSED (Codex F2). Returns non-zero unless a copy method actually
# succeeded. The first version returned 0 when both probes failed and also
# discarded the fallback chmod's status — so on a host where mode discovery or
# application fails, the caller went on to install the 600 temp file and
# silently disabled the hook again. That is the precise failure BUG-008 is
# about, reintroduced through the error path of its own fix.
#
# "Never fatal" was the wrong instinct here: aborting ONE file replacement
# leaves a working executable in place, while continuing destroys it.
bp_copy_mode() {
  local src="$1" dst="$2" m
  chmod --reference="$src" "$dst" 2>/dev/null && return 0
  m=$(stat -c '%a' "$src" 2>/dev/null) || m=$(stat -f '%Lp' "$src" 2>/dev/null) || return 1
  [ -n "$m" ] || return 1
  chmod "$m" "$dst" 2>/dev/null || return 1
  return 0
}

# bp_substitute_in_place FILE NAME
# The file is only replaced if substitution succeeded — a refused file (binary,
# unrepresentable name) is left exactly as it was rather than half-written.
#
# BUG-008 is fixed HERE, in the primitive, not at the call sites. The previous
# attempt added a chmod to all four callers — and each of them calls this
# function on the very next line, so this mv undid the chmod immediately. Fixing
# a caller cannot help while the primitive it calls destroys the mode.
#
# `mv` is kept rather than switching to `cat >`: mv is atomic, so a crash cannot
# leave a half-written managed file, and `bp_copy_mode` makes the temp carry the
# destination's permissions BEFORE the move rather than repairing them after.
# The temp is created BESIDE THE DESTINATION (Codex F3), not in $TMPDIR. A bare
# `mktemp` normally lands in /tmp, and if that is a different filesystem then
# `mv` degrades to copy-then-unlink and is NOT atomic — a crash mid-move leaves
# a partial managed file, which is exactly what the atomicity claim said could
# not happen. Same directory means the rename is a true atomic replace.
#
# Every failure path removes the temp and leaves the original untouched, so a
# refused or un-chmod-able file keeps its working content and mode.
bp_substitute_in_place() {
  local f="$1" nm="$2" dir tmp rc=0
  dir=$(dirname "$f")
  tmp=$(mktemp "$dir/.bp-subst.XXXXXX") || return 1
  bp_substitute_stream "$f" "$nm" > "$tmp" || rc=$?
  if [ "$rc" -ne 0 ]; then
    rm -f "$tmp"
    return "$rc"
  fi
  if ! bp_copy_mode "$f" "$tmp"; then
    rm -f "$tmp"
    echo "error: could not preserve the mode of $f; refusing to replace it" >&2
    return 1
  fi
  mv "$tmp" "$f" || { rm -f "$tmp"; return 1; }
}
