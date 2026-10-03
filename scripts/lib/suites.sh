#!/bin/sh
# scripts/lib/suites.sh — the ONE derivation of "what the suites are".
#
# WHY THIS FILE EXISTS, and it is a correction rather than a design.
#
# scripts/run-ts-suites.sh grew its own copy of the suite lookup, under a comment
# reading "two parsers of one table drift, and this file exists to be the thing
# that cannot". Vitali (QA-1) pointed out the obvious: the awk was a verbatim
# copy of tests/manifest's, so the file WAS the second parser, and the comment
# asserting otherwise was the overclaim this repo keeps catching in its own
# controls. The shape the repo already chose for this is
# scripts/lib/commit-subject.sh and scripts/lib/roster.sh: one definition, every
# caller sources it.
#
# That correction stands. What changed under TASK-018 is WHAT is derived, and
# from where.
#
# ---------------------------------------------------------------------------
# THE SUITES ARE THE FILESYSTEM. THE TIER IS THE EXPORT BOUNDARY.
#
# This file used to parse `tests/SUITES.md` — a table naming every suite, its
# tier, its parallelism class and two paragraphs of rationale. That table is
# deleted (TASK-020). TASK-018-RULES R1: "No SUITES.md, no tier table, no
# catalogue of tests. A second description of a test is a copy that drifts" —
# and it had already drifted twice in one afternoon while being built.
#
# Both facts the table carried are derived here instead, each from the artefact
# that already IS that fact:
#
#   the suite set   the *.sh and *.spec.ts files under tests/. Not a
#                   description of the tests — the tests.
#   the tier        `.gitattributes`. A tier is a claim about what SHIPS, and
#                   export-ignore is where shipping is decided. Two descriptions
#                   of one fact is exactly what R1 deletes.
#
# WHAT THIS COSTS, stated because scripts/lib/pipeline.sh names it as the
# residual risk of the batch API: the expected set fed to `pipe_batch_begin`
# must come from "a source the runner cannot edit at run time", or every guard
# built on it reduces to trusting the runner. The filesystem is such a source.
# `find` does not consult vitest's include glob, its config or its reporter, so
# narrowing any of them still leaves a declared suite that never reports — which
# fails the batch by name. Deliberate fabrication remains out of the threat
# model, there as here.
#
# POSIX sh, no Node, no jq. tests/manifest asserts it invokes no toolchain (#9),
# and a shared derivation that pulled one in would break that property for every
# caller at once rather than one.

# bp_suite_runners ROOT — every runner file under tests/, as:
#     suite<TAB>path-relative-to-ROOT
#
# A RUNNER is a `*.spec.ts` or a `*.spec.tsx`. Discovery is by EXTENSION, never
# by the `<suite>.spec.ts` naming convention: recognising only `test.sh` is how
# renaming a runner once made a whole suite invisible to its own control
# (Codex R2-F1a). The lesson outlived the extension it was learned on.
#
# TASK-047 — THE `*.sh` BRANCH IS GONE, and so is the hold this comment used to
# describe. `tests/ts-bridge/test.sh` was the last shell runner; the founder
# retired it (TASK-023), and it left with its `.githooks/pre-push-project` stage
# and its CI job in the same push as this line. `tests/helpers/proc-cwd.sh` is
# the only `.sh` left under `tests/`, and it is a helper a spec invokes rather
# than a test of its own — the helpers exemption below already excludes it, so
# no longer looking for `.sh` here loses nothing.
#
# `.spec.tsx` IS DISCOVERED TOO, and it is not an exception (coordinator ruling,
# 2026-09-16): a JSX component test cannot be written as `.ts`, and a runner this
# function does not find is never declared to the batch — so an assertion about
# "every runner" would pass over it in silence rather than fail. tests/dod-gate
# #17 holds all three sides as ONE set: counted as evidence by `dod-gate.mts`,
# discovered here, executed by `tests/vitest.config.ts`.
#
# A runner sitting directly in `tests/` belongs to no suite, and emits an EMPTY
# suite field rather than being dropped — a discovery that silently ignores what
# it does not recognise is how a file ends up executing nowhere.
#
# tests/helpers/ and tests/__helpers__/ are NOT suites (docs/DoD.md §3): they
# are sourced, never run, and carry no assertions.
# Deliberately literal, never a prefix match. tests/manifest #1b is the
# compensating control that stops the exemption becoming a place to hide code.
bp_suite_runners() {
  _bsr_root="${1:-.}"
  find "$_bsr_root/tests" -type f \( -name '*.spec.ts' -o -name '*.spec.tsx' \) 2>/dev/null \
    | sed -e "s#^$_bsr_root/##" \
    | sort \
    | awk -F/ '
        { s = (NF >= 3 ? $2 : "")
          if (s == "helpers" || s == "__helpers__") next
          print s "\t" $0 }'
}

# bp_suite_names ROOT — the suite names, one per line.
bp_suite_names() {
  bp_suite_runners "${1:-.}" | cut -f1 | grep -v '^$' | sort -u
}

# bp_blueprint_only ROOT — the suites `.gitattributes` holds back from the
# archive, one per line.
#
# A DIRECTORY-LEVEL `tests/<suite>/  export-ignore` line, and nothing else. Not
# "no file of this suite happens to be in the archive". During TASK-018 phase 1
# `tests/**/*.spec.ts` WAS export-ignore'd wholesale, so a suite migrated to
# TypeScript shipped nothing and would have derived as blueprint-tier — a
# shipping suite silently reclassified into one that never ships, which is
# BUG-005 wearing a legal tier. Phase 2 deleted that line, so today the trap
# needs a different accident to spring it (an unmigrated suite, a spec excluded
# by some future glob) and the rule is unchanged: the directory line is a
# deliberate, reviewable act; the absence of shipped files is a side effect.
# Only the first is a declaration.
#
# tests/manifest #2b is what keeps the declaration honest, by comparing it
# against a real `git archive`: a line that does not take effect fails, and so
# does a suite with no line whose files do not arrive.
bp_blueprint_only() {
  grep -E '^tests/[A-Za-z0-9._-]+/[[:space:]]+export-ignore' "${1:-.}/.gitattributes" 2>/dev/null \
    | sed -e 's#^tests/##' -e 's#/[[:space:]].*##'
}

# bp_suite_rows ROOT — every suite and its tier, as:
#     suite<TAB>tier          tier is `blueprint` or `both`
#
# `blueprint` — drives machinery that exists only in a blueprint
#               (new-project.sh, templates/, .blueprint-root), so it must not
#               ship. Downstream it is not skipped, it is simply not there:
#               the set is derived from disk, so a suite a project never
#               received cannot appear in that project's own derivation. The
#               mismatch between "what ships" and "what is declared to ship"
#               is unrepresentable rather than merely detected (R2).
# `both`      — ships, and blocks in the gate and in CI.
bp_suite_rows() {
  _bsrow_root="${1:-.}"
  _bsrow_bp=" $(bp_blueprint_only "$_bsrow_root" | tr '\n' ' ')"
  bp_suite_names "$_bsrow_root" | while IFS= read -r _bsrow_s; do
    case "$_bsrow_bp" in
      *" $_bsrow_s "*) printf '%s\tblueprint\n' "$_bsrow_s" ;;
      *)               printf '%s\tboth\n'      "$_bsrow_s" ;;
    esac
  done
}

# bp_suites_with_spec ROOT — the suites that own a *.spec.ts or *.spec.tsx.
#
# This is what the vitest bridge declares to the pipeline before vitest runs.
# See the header: it is read from the FILESYSTEM, never from vitest's own
# output, so a suite dropped from the include glob is a declared suite that
# never reports rather than a suite that quietly stopped existing.
bp_suites_with_spec() {
  bp_suite_runners "${1:-.}" \
    | awk -F'\t' '$1 != "" && $2 ~ /\.spec\.tsx?$/ { print $1 }' \
    | sort -u
  # BUG-055: the one caller runs under `set -e`, where a non-zero status is
  # fatal however good the list on stdout is. There is deliberately no status
  # here for a caller to trip over.
  return 0
}

# bp_release_suites ROOT — the RELEASE-tier suites, one per line (TASK-054).
#
# A suite is release-tier when EVERY spec it owns is a `*.release.spec.ts` or
# `*.release.spec.tsx`. The tier is the file name, like `.integration.`; there is
# no table. The pre-push gate excludes that glob and CI runs everything, and
# tests/manifest checks both halves. A suite with one ordinary spec left is not
# release-tier, so the gate still runs and reports it.
bp_release_suites() {
  bp_suite_runners "${1:-.}" \
    | awk -F'\t' '$1 != "" { all[$1] = 1; if ($2 !~ /\.release\.spec\.tsx?$/) plain[$1] = 1 }
        END { for (s in all) if (!(s in plain)) print s }' \
    | sort
  return 0
}

# bp_marker_balance FILE PREFIX — prints "<begins> <ends>" for one marker
# vocabulary. The precondition marker_aware_merge (scripts/blueprint.mts) requires
# before it will merge rather than clobber: unequal counts make it return 1, and
# pull falls back to a whole-file copy that destroys the project's own content
# outside the markers. Exposed here because the counting rule belongs beside the
# markers it counts, and because a prose mention of a marker is invisible until
# something counts it.
#
# PROSE MUST NEVER CONTAIN A MARKER TOKEN. A sentence explaining "put your rows
# after BLUEPRINT:END" is counted. tests/SUITES.md had a BEGIN/END count of 1/3
# for exactly that reason, so its marker merge had NEVER run and every derived
# project's own suite table was replaced on every pull — the thing the markers
# exist to prevent, defeated by a sentence describing them. tests/manifest #7b
# asserts the balance for the files that still carry markers.
bp_marker_balance() {
  _bmb_b=$(grep -c "${2}:BEGIN" "$1" 2>/dev/null || true)
  _bmb_e=$(grep -c "${2}:END" "$1" 2>/dev/null || true)
  printf '%s %s\n' "${_bmb_b:-0}" "${_bmb_e:-0}"
}
