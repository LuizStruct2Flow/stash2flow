#!/bin/sh
# scripts/check-commit-subjects.sh — check REAL subjects against the item rule.
#
# The companion to `.githooks/commit-msg`. The hook checks one commit as it is
# written, locally. This checks many subjects wherever they can be read — which
# is what CI needs, because the hook is client-side and cannot run on GitHub's
# servers where the squash-merge commit is composed.
#
# USAGE
#
#   scripts/check-commit-subjects.sh --stdin           # one subject per line
#   scripts/check-commit-subjects.sh --range A..B      # every commit in a range
#   scripts/check-commit-subjects.sh --subject "TEXT"  # a single subject
#
# `--subject` is what CI points at the PULL REQUEST TITLE, and that is the
# load-bearing case: a squash merge takes its subject from the title, so the
# title IS the commit message that will land. Checking the branch's commits and
# not the title leaves the actual door open — 5fe89e0 walked through it.
#
# FAILS CLOSED. No input, an unreadable range, or an unknown mode is a
# rejection: "could not check" must never render as "passed" (BUG-018).

set -u

here="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
lib="$here/lib/commit-subject.sh"

if [ ! -r "$lib" ]; then
  echo "check-commit-subjects: cannot read $lib — refusing." >&2
  echo "  A gate that cannot load its rule has checked nothing." >&2
  exit 1
fi
# shellcheck disable=SC1090
. "$lib"

mode="${1:-}"
bad=0
checked=0

check_one() {
  # Blank lines are not subjects and are skipped rather than failed; a trailing
  # newline in a pipe is not a violation.
  [ -n "$1" ] || return 0
  checked=$((checked + 1))
  if commit_subject_ok "$1"; then
    return 0
  fi
  [ "$bad" -eq 0 ] && echo "check-commit-subjects: REJECTED" >&2
  bad=$((bad + 1))
  echo "  got: $1" >&2
}

case "$mode" in
  --stdin)
    while IFS= read -r line; do check_one "$line"; done
    ;;
  --subject)
    if [ "$#" -lt 2 ]; then
      echo "check-commit-subjects: --subject needs a value — refusing." >&2
      exit 1
    fi
    check_one "$2"
    ;;
  --range)
    if [ "$#" -lt 2 ]; then
      echo "check-commit-subjects: --range needs a value — refusing." >&2
      exit 1
    fi
    if ! subjects="$(git log --format='%s' "$2" 2>/dev/null)"; then
      echo "check-commit-subjects: cannot read range '$2' — refusing." >&2
      exit 1
    fi
    # An EMPTY range is not a pass. A range that resolves to nothing usually
    # means a shallow clone or a wrong base, and reporting "0 violations" there
    # is the vacuous green this repo keeps having to delete.
    if [ -z "$subjects" ]; then
      echo "check-commit-subjects: range '$2' contains no commits — refusing." >&2
      echo "  Nothing was checked. Verify the base ref and fetch depth." >&2
      exit 1
    fi
    # Via a temp file rather than a pipe: a `while` on the right of a pipe runs
    # in a SUBSHELL, so every violation it counted would be discarded when the
    # subshell exited, and the check would report clean. Redirection keeps the
    # loop in this shell, and reports EVERY offender instead of only the first.
    tmp="$(mktemp)" || { echo "check-commit-subjects: mktemp failed." >&2; exit 1; }
    printf '%s\n' "$subjects" > "$tmp"
    while IFS= read -r line; do check_one "$line"; done < "$tmp"
    rm -f "$tmp"
    ;;
  *)
    echo "check-commit-subjects: unknown mode '${mode:-<none>}' — refusing." >&2
    echo "  Use --stdin, --range A..B, or --subject 'TEXT'." >&2
    exit 1
    ;;
esac

if [ "$bad" -ne 0 ]; then
  echo "" >&2
  commit_subject_help >&2
  exit 1
fi

if [ "$checked" -eq 0 ]; then
  echo "check-commit-subjects: no subjects were checked — refusing." >&2
  exit 1
fi

echo "check-commit-subjects: $checked subject(s) name their item."
