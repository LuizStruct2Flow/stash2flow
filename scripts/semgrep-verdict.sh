#!/bin/sh
# scripts/semgrep-verdict.sh — BUG-126. THE one statement of which semgrep
# diagnostics a scan may carry and still be called clean.
#
# TWO CALLERS, ONE RULE:
#   - .githooks/pre-push SOURCES this file and calls sgv_unaccepted.
#   - .github/workflows/security.yml EXECUTES it: `sh scripts/semgrep-verdict.sh FILE`.
# They used to carry separate copies of the policy, kept in step only by a test.
#
# WHY IT IS A FILE RATHER THAN INLINE IN THE WORKFLOW. semgrep's own
# `gha-curl-pipe-shell` rule re-parses every `run:` block as Bash for a
# metavariable-pattern, and that snippet parser cannot read a program this size:
# it rejected glob alternation in a case pattern, a quoted glob pattern, `$'\t'`
# and a command substitution wrapping a loop, and still failed once all four were
# rewritten. So the workflow this repository SHIPS became unparseable, and every
# derived project's first gate refused its own checkout as an incomplete scan —
# correctly, which is how it was found (bootstrap-gate #2). A shell file is read
# by the shell; semgrep's own failure to parse it falls under the accepted class
# below, where shellcheck is the compensating control.
#
# USAGE:  sgv_unaccepted SEMGREP_JSON
#   prints "  <type>  <path>" for every diagnostic the policy does not accept
#   exit 0  every diagnostic accepted (or there were none)
#   exit 1  at least one unaccepted diagnostic, printed
#   exit 2  the error list could not be DECODED — which is never "no errors"
#
# THE POLICY, reviewed 2026-09-16. Exactly one class is accepted: a
# "Syntax error" or "PartialParsing" on a SHELL script — *.sh, *.bash, or a
# shebang naming sh, bash or dash. semgrep's bash parser rejects valid scripts
# (18 shellcheck-clean files in the blueprint alone), so blocking on those would
# block every push; shell is linted by shellcheck (sh_lint) instead. Everything
# else blocks: any other error type, any other language, a diagnostic with no
# path, and an error list this file cannot decode.

# `.errors` → "<type>\t<path>" lines in $2. Every entry must be an object, its
# type a string or a [name, …] pair or absent, its path a string or absent.
# Anything else is a shape this policy was never taught to read, and jq fails:
# the caller turns that into "could not decode", never into "no errors"
# (Alex's review, 2026-09-16, finding 1 — an unreadable diagnostic is not an
# absent one).
sgv_decode() {
  jq -r '
    .errors[]
    | if type != "object" then error("entry") else . end
    | [ (.type
         | if type == "array" then (.[0] | if type == "string" then . else error("type") end)
           elif type == "string" then .
           elif . == null then "unknown"
           else error("type") end),
        (.path | if . == null then "" elif type == "string" then . else error("path") end) ]
    | @tsv' "$1" >"$2" 2>/dev/null
}

# Is $1 a shell script? The extension, else the interpreter its shebang NAMES —
# PARSED, not searched for. A search matched `#!/usr/bin/env -S node --require
# /tmp/bash` on the require argument and accepted a node file as shell (finding
# 2). env's own options are stepped over (-S cmd, -Scmd, --split-string=cmd,
# -u NAME) along with NAME=VALUE assignments; only sh, bash and dash count.
sgv_is_shell() {
  case "$1" in *.sh | *.bash) return 0 ;; esac
  [ -f "$1" ] || return 1
  IFS= read -r _sgv_line <"$1" 2>/dev/null || return 1
  case "$_sgv_line" in '#!'*) ;; *) return 1 ;; esac
  _sgv_line="${_sgv_line#\#!}"
  # shellcheck disable=SC2086  # a shebang is split on whitespace, by definition
  set -- $_sgv_line
  [ "$#" -gt 0 ] || return 1
  _sgv_cmd="$1"; shift
  if [ "${_sgv_cmd##*/}" = env ]; then
    _sgv_cmd=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -S | --split-string) _sgv_cmd="${2:-}"; break ;;
        --split-string=*) _sgv_cmd="${1#--split-string=}"; break ;;
        -S*) _sgv_cmd="${1#-S}"; break ;;
        -u | --unset) shift 2 2>/dev/null || return 1 ;;
        -*) shift ;;
        *=*) shift ;;
        *) _sgv_cmd="$1"; break ;;
      esac
    done
    # -S / --split-string can carry the whole command in one word.
    # shellcheck disable=SC2086
    set -- $_sgv_cmd
    _sgv_cmd="${1:-}"
  fi
  case "${_sgv_cmd##*/}" in sh | bash | dash) return 0 ;; esac
  return 1
}

# The verdict. See USAGE above for the exit codes.
sgv_unaccepted() {
  _sgv_tsv="$(mktemp)" || return 2
  if ! sgv_decode "$1" "$_sgv_tsv"; then
    rm -f "$_sgv_tsv"
    return 2
  fi
  _sgv_bad=0
  # A redirect, not a pipe: the loop must run in THIS shell or _sgv_bad is set
  # in a subshell and every verdict comes back "accepted".
  while IFS="$(printf '\t')" read -r _sgv_t _sgv_p; do
    case "$_sgv_t" in
      "Syntax error" | PartialParsing)
        if [ -n "$_sgv_p" ] && sgv_is_shell "$_sgv_p"; then continue; fi ;;
    esac
    printf '  %s  %s\n' "$_sgv_t" "${_sgv_p:-<no path>}"
    _sgv_bad=1
  done <"$_sgv_tsv"
  rm -f "$_sgv_tsv"
  [ "$_sgv_bad" -eq 0 ]
}

sgv_main() {
  if [ "$#" -ne 1 ]; then
    echo "usage: semgrep-verdict.sh SEMGREP_JSON" >&2
    return 2
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "semgrep-verdict.sh: jq is required to read semgrep's output" >&2
    return 2
  fi
  sgv_unaccepted "$1"
}

# Executed, not sourced: a sourcing caller's $0 is its own name, never this one.
case "${0##*/}" in
  semgrep-verdict.sh) sgv_main "$@" ;;
esac
