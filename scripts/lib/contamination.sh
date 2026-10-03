#!/bin/bash
# scripts/lib/contamination.sh — guards the project → blueprint boundary.
#
# WHY THIS EXISTS (A-07)
#
# `blueprint pull` substitutes {{PROJECT_NAME}} into a project's copy of a
# managed file. `blueprint a2bp` copies that file back. For years it did so
# with a bare `cp`, which means the substituted text — one specific project's
# name, its host paths, its state dirs — was written into the file that every
# OTHER project then pulls. That is not a theoretical hazard; it is the
# mechanism behind two of this repo's worst defects:
#
#   BUG-002  the generic activity feed hardcoded one project's own state dir,
#            `~/.linkedin-watcher-agent`,  a2bp-allow: incident record, not a live path
#            so the [CODEX]/[GEMINI] lines silently never appeared in any
#            derived project.
#   A-09     dispatchers wrote a literal, never-substituted
#            `~/.{{PROJECT_NAME}}/`,  a2bp-allow: incident record, not a live path
#            shared by every checkout — a redcare Codex verdict surfaced live
#            in this repo's feed. Eight four-eyes rounds to close.
#
# Both arrived through a2bp. Guarding the pipe stops the next one at source.
#
# Two primitives, deliberately separate:
#
#   contamination_stage  — restores placeholders where a positional diff makes
#       them attributable, then VERIFIES the result by round-tripping. It is
#       not an inverse of substitute_placeholders and does not claim to be:
#       four review rounds established that neither an inverse nor any
#       content-derived alignment can recover edit history. What makes it safe
#       is the round-trip check, not the attribution. See its header.
#   contamination_scan   — HEURISTIC, and the ONLY thing standing between the
#       project and the blueprint. It scans every staged line; there is no
#       alignment-derived exemption, because an exemption is the one place a
#       misattribution could actually leak (R4-F2). Being heuristic it must be
#       overridable, and every override must be visible — see "BLOCKING vs
#       NOTICE" below.
#
# THE CONTRACT — stated narrowly, because the first version of this comment
# claimed "a2bp never introduces project-specific bytes" and that is simply
# false (Codex R5-F2). A justified `a2bp-allow` suppresses every check on its
# line, emails are NOTICE-only, and the scanner knows a handful of heuristic
# classes rather than all contamination. An absolute claim contradicted by
# intentional product behaviour is worse than a narrow one, because it stops
# people looking.
#
# (This paragraph used to say `--force` copies every BLOCK finding by design,
# and that "test #5 itself demonstrates a host path landing under --force".
# `--force` was removed when a2bp stopped landing bytes; it is now refused, and
# test #5 asserts the refusal. A header describing a removed feature is the same
# defect class as an assertion that cannot fail — both are read as current.)
#
# What is actually enforced:
#
#   1. ON THE DEFAULT PATH, a recognized BLOCK class cannot land. Every staged
#      line is scanned — no alignment-derived exemption exists, which is what
#      closed the R4-F2 relocation leak.
#   2. THE ONE OVERRIDE IS LOUD AND AUDITABLE. `a2bp-allow` requires a written
#      justification on the line and a bare marker does not suppress; it stays
#      in the file, so a reviewer sees it in the diff.
#   3. STAGING NEVER CHANGES MEANING UNDER SUBSTITUTION. Forward-substituting
#      the staged result reproduces the project's file byte-for-byte, asserted
#      via the one shared primitive that production substitution also uses
#      (R5-F1). This one holds unconditionally, and nothing waives it.
#
# (3) is what makes a misattributed alignment harmless: the worst it can do is
# write {{PROJECT_NAME}} where a literal project name stood, which is the
# correct generic content for a blueprint file. None of the three depends on
# knowing which occurrence came from which placeholder — the question that
# cannot be answered from content at all.
#
# NOT claimed: that contamination is impossible. The scanner is heuristic and
# the overrides are deliberate. What is claimed is that the default path is
# closed for the classes it recognizes, and that stepping outside it leaves a
# trail.
#
# Sourced by scripts/blueprint.mts, which is the only caller: contamination_scan is
# invoked once, from cmd_a2bp's staging loop. This header used to say the lib
# was kept separate "so the gate and new-project.sh can reuse the same
# patterns"; neither ever did. It stays a file rather than inline code because
# scripts/blueprint.mts is already ~1500 lines and this is a self-contained,
# separately testable unit — not because a second consumer exists. Claiming a
# reuse that is not there invites the next author to add a THIRD copy of these
# patterns believing they are joining a shared mechanism.
#
# shellcheck shell=bash

# --- Per-line suppression -------------------------------------------------
# A line carrying `a2bp-allow: <justification>` is skipped by every check.
# This is the precise tool for a known-benign hit — notably a comment that
# quotes a historical contamination on purpose (scripts/agent-activity.sh
# documents BUG-002's old path by name). It is now the ONLY way through a
# finding: `--force` is gone, and the PR reviewer is the override.
#
# CLAUDE.md §Security already sets the standard for suppressions: they carry
# a justification naming why they are safe. Same rule here, enforced — a bare
# marker with no text after it does NOT suppress.
#
# ENFORCED IN contamination_scan, by the `grep -nE 'a2bp-allow:[[:space:]]*
# [^[:space:]]'` that builds its `$suppressed` line-number set. There used to be
# a `_contamination_suppressed()` helper here that ran the same rule as a case
# pattern, with ZERO callers — it had been superseded and never deleted. It was
# not merely dead, it was actively misleading: an auditor checking whether test
# #14 could fail mutated THIS helper first, saw the suite stay green, and
# concluded the assertion was dead. The assertion is fine; the mechanism it
# guards was 300 lines further down. Two implementations of one rule, one of
# them unreachable, is worse than either alone.

# --- Well-known dot-directories -------------------------------------------
# Tool and shell dirs that are generic to every machine. Anything ELSE under
# ~/. or $HOME/. is a per-project state dir, which is precisely the BUG-002 /
# A-09 shape: it must be derived at runtime via scripts/lib/state-dir.sh, not
# written literally into a generic file.
#
# Note `{{PROJECT_NAME}}` is deliberately NOT allowlisted. After reverse-
# substitution a project's own `~/.acme-flow` becomes `~/.{{PROJECT_NAME}}` —  a2bp-allow: worked example in a comment
# which is A-09 exactly, the literal shared dir every checkout collided on.
# The placeholder makes it look intentional; it is still the defect.
_CONTAMINATION_KNOWN_DOTDIRS="aws bash_history bashrc cache claude codex config
copilot cursor docker gemini git gitconfig gitignore gnupg kube local npm nvm
profile semgrep ssh vscode zshrc"

_contamination_is_known_dotdir() {
  local name="$1" known
  for known in $_CONTAMINATION_KNOWN_DOTDIRS; do
    [ "$name" = "$known" ] && return 0
  done
  return 1
}

# --- Placeholder / infrastructure email domains ---------------------------
# Emails are the one check that stays a NOTICE rather than a block (see
# below). These are the ones not even worth mentioning.
_contamination_is_placeholder_email() {
  case "$1" in
    *@example.com|*@example.org|*@example.net|*@*.example) return 0 ;;
    git@github.com|*@local|noreply@*) return 0 ;;
  esac
  return 1
}

# --- contamination_stage PROJ BP NAME STAGED_OUT --------------------------
# Writes to STAGED_OUT the bytes that should land in the blueprint.
# Returns non-zero if staging cannot be done safely.
#
# FOUR review rounds are compressed here, so the next person does not re-derive
# them. Each attempt tried harder to infer which text came from a placeholder,
# and each was defeated by the same fact: substitution destroys exactly that
# information, and no amount of content matching recovers it.
#
#   R1: a global `s/${proj_name}/{{PROJECT_NAME}}/g` was called "the exact
#       inverse of substitute_placeholders". There is no such inverse. Forward
#       replaces an unambiguous token that never occurs in prose; backward
#       would replace a bare word that does. For a project directory
#       legitimately named `blueprint`, "The blueprint documentation explains
#       blueprint sync." silently became "The {{PROJECT_NAME}} documentation
#       explains {{PROJECT_NAME}} sync.", and the guard copied the corrupted
#       file through with no finding at all.
#
#   R2: the fix keyed a map on line CONTENT — substituted_form → blueprint
#       line. That still discards occurrence identity. If the blueprint holds
#       both `{{PROJECT_NAME}}` and a literal `acme-flow` line, the first one
#       owns the key and EVERY matching project line gets rewritten, including
#       a legitimate literal that never came from a placeholder. Same
#       information loss as R1, at line granularity instead of substring.
#
#   R3: trusting `diff`'s alignment. An LCS match is a byte alignment, not an
#       edit history: insert a literal equal to a substituted placeholder and
#       edit the original, and the insert is attributed to the placeholder.
#
#   R4: requiring clean contiguous neighbours. Any finite context window can
#       be relocated or duplicated as a unit, so the same misattribution
#       survives by moving the edit outside the window.
#
# So this stopped trying to win that argument. Alignment is still used — it
# gets the common case right and keeps the upstream diff minimal — but NOTHING
# SAFETY-CRITICAL RESTS ON IT:
#
#   * The scan no longer takes an exemption list. Every staged line is
#     checked, so a misattribution cannot wave contamination through. That was
#     the only path by which a wrong alignment could actually leak (R4-F2).
#   * Staging is round-trip VERIFIED: forward-substituting the staged output
#     must reproduce the project file byte-for-byte, or staging fails closed.
#     That holds regardless of how diff aligned anything, and it bounds the
#     blast radius of a misattribution to "a placeholder where a literal
#     project name stood" — the correct generic content for a blueprint file,
#     and never a leak.
#
# No blueprint copy (a brand-new managed file) → nothing to align against →
# verbatim passthrough, and the scan judges every line. Fail closed.
#
# Nothing here compiles the project name as a regex: the forward substitution
# is bash parameter expansion and the comparison is done by `diff`.
#
# The caller owns the _should_substitute exemption (files that IMPLEMENT the
# substitution carry the tokens as code — restoring placeholders in
# scripts/blueprint.mts would corrupt scripts/blueprint.mts).
contamination_stage() {
  local pf="$1" bpf="$2" proj_name="$3" staged_out="$4"

  if [ ! -f "$bpf" ]; then
    cat "$pf" > "$staged_out"
    return 0
  fi

  # Does the project file end with a newline? The staged copy must match it
  # byte-for-byte; a line-oriented rewrite would otherwise append one the
  # operator never wrote.
  local final_nl=1
  if [ -s "$pf" ] && [ "$(tail -c1 "$pf" | wc -l)" -eq 0 ]; then
    final_nl=0
  fi

  local -a bp_lines proj_lines
  mapfile -t bp_lines < "$bpf"
  mapfile -t proj_lines < "$pf"

  # What `pull` would have produced from the blueprint's copy. The blueprint's
  # own final-newline state is preserved by the primitive, which matters here:
  # `diff` treats a complete and an incomplete last line as different, so
  # unconditionally terminating bp_sub would leave the last line of an
  # incomplete file permanently unalignable, and never restored (R3-F2).
  #
  # bp_substitute_stream is THE forward substitution (scripts/lib/placeholders.sh)
  # and preserves a missing final newline itself, so what we diff against is
  # byte-for-byte what `pull` would have handed the project — not a local
  # re-implementation that disagrees on names containing `&` or `\` (R5-F1).
  local bp_sub
  bp_sub=$(mktemp)
  bp_substitute_stream "$bpf" "$proj_name" > "$bp_sub"

  # Positional alignment. The three --*-line-format options emit one record
  # per line in file order: '=' common, '-' only upstream, '+' only in the
  # project. Walking that stream with two counters yields, for every project
  # line, the upstream line it corresponds to (or none).
  #
  # `%l` + an explicit `%c'\012'`, never `%L` (R3-F2). `%L` preserves whether
  # the input line had a trailing newline, so a file whose final line is
  # incomplete emits an UNTERMINATED final record — `while read` never sees
  # it, the counters silently desynchronise, and the last line is left
  # unaligned. The record protocol must not inherit the input's line endings.
  local diff_out diff_rc
  diff_out=$(mktemp)
  # `|| diff_rc=$?` rather than a bare call: diff exits 1 whenever the files
  # differ, which is the NORMAL case here, and callers run under `set -e`. A
  # bare invocation kills the script before the status can even be inspected.
  diff_rc=0
  diff --unchanged-line-format="=%l%c'\012'" \
       --old-line-format="-%l%c'\012'" \
       --new-line-format="+%l%c'\012'" \
       "$bp_sub" "$pf" > "$diff_out" 2>/dev/null || diff_rc=$?
  rm -f "$bp_sub"

  # diff exits 0 (identical) or 1 (differences). Anything else is trouble —
  # an unsupported option, an I/O error, a missing binary. Previously that was
  # swallowed into an empty alignment, which reads as "nothing is attributable"
  # and, under --force, would copy wholly unrestored project bytes upstream
  # (R3-F3). The --*-line-format switches are GNU extensions; fail closed
  # rather than pretend the capability is there.
  if [ "$diff_rc" -gt 1 ]; then
    rm -f "$diff_out"
    return 2
  fi

  declare -A _align
  local rec tag bp_i=0 pj_i=0
  while IFS= read -r rec; do
    tag=${rec:0:1}
    case "$tag" in
      '=') bp_i=$((bp_i+1)); pj_i=$((pj_i+1)); _align[$pj_i]=$bp_i ;;
      '-') bp_i=$((bp_i+1)) ;;
      '+') pj_i=$((pj_i+1)) ;;
    esac
  done < "$diff_out"
  rm -f "$diff_out"

  # --- Ambiguity guard: only restore inside CLEAN CONTEXT (R3-F1) ---
  # `diff` computes a sequence alignment from bytes; it has no edit history.
  # Where equal lines are inserted or deleted next to an edit, its choice of
  # which occurrence matches which is a tie-break, not evidence. Codex's
  # reproduction: insert a literal `acme-flow` and edit the line that used to
  # hold the placeholder, and the alignment attributes the INSERTED literal to
  # the upstream placeholder — silently rewriting it to {{PROJECT_NAME}} and
  # exempting it from the scan.
  #
  local n_proj=${#proj_lines[@]}

  # Emit the staged copy plus the proven-provenance line list.
  local i n out
  n=$n_proj
  : > "$staged_out"
  for (( i=1; i<=n; i++ )); do
    if [ -n "${_align[$i]+x}" ]; then
      out=${bp_lines[$(( ${_align[$i]} - 1 ))]}
    else
      out=${proj_lines[$(( i - 1 ))]}
    fi
    if [ "$i" -eq "$n" ] && [ "$final_nl" -eq 0 ]; then
      printf '%s' "$out" >> "$staged_out"
    else
      printf '%s\n' "$out" >> "$staged_out"
    fi
  done

  # --- Round-trip verification: the safety property, asserted ---
  # Staging must preserve the file's MEANING UNDER SUBSTITUTION. Forward-
  # substitute both the staged output and the project's own file; they must be
  # byte-identical. That is what makes a misattributed alignment harmless: the
  # restore is proven unable to drop, reorder or invent content, so the most it
  # can do is write a placeholder where the project had the literal name.
  #
  # Both sides are substituted, not just the staged one. A project file may
  # legitimately already contain `{{PROJECT_NAME}}` — it is precisely what the
  # operator is told to write when the scan blocks an edited line — and
  # comparing staged-substituted against the RAW project file would then fail
  # on a correct, unmodified round-trip.
  #
  # This is a real check, not a comment: if diff aligns something in a way that
  # would change the file, staging fails and cmd_a2bp refuses the copy.
  # Verified with THE substitution primitive, not a local copy of it. That is
  # the whole of R5-F1: a round-trip check that verifies a *different* forward
  # operation than production uses proves nothing. `foo\bar` passed the old
  # bash-based check while `pull`'s sed rendered it `foobar`.
  local verify_staged verify_proj
  verify_staged=$(mktemp)
  verify_proj=$(mktemp)
  bp_substitute_stream "$staged_out" "$proj_name" > "$verify_staged"
  bp_substitute_stream "$pf"         "$proj_name" > "$verify_proj"

  if ! cmp -s "$verify_staged" "$verify_proj"; then
    rm -f "$verify_staged" "$verify_proj"
    return 3
  fi
  rm -f "$verify_staged" "$verify_proj"
}

# --- contamination_scan FILE PROJECT_NAME ---------------------------------
# Prints one finding per line as:  <lineno>|<BLOCK|NOTICE>|<reason>|<text>
# Returns 1 if any BLOCKing finding was printed, 0 otherwise.
#
# BLOCKING vs NOTICE — the split is calibrated, not guessed. Every pattern
# below was run across all 47 blueprint-managed files before being assigned:
#
#   host path        BLOCK   — 0 false positives measured. Same regex the
#                              pre-push .claude/settings.json guard already
#                              uses (A-01), so a2bp and the gate agree.
#   foreign dot dir  BLOCK   — 2 hits, 1 real doc-drift find, 1 historical
#                              comment (now carrying an a2bp-allow marker).
#   residual name    BLOCK   — ~0 by construction: reverse-substitution has
#                              already removed the exact forms, so a residual
#                              is a differently-cased variant it could not see.
#   email            NOTICE  — 11 hits, and the ambiguous one is legitimate
#                              (the founder's address in the pitch deck). A
#                              check that blocks on a legitimate line trains
#                              the operator to reach for --force by reflex,
#                              which costs more than the check is worth.
#
# IMPLEMENTATION NOTE — one grep pass per pattern, never per line. The first
# cut of this function shelled out to grep 3-4 times per LINE; across the 47
# managed files it did not finish in two minutes. Whole-file passes make the
# same scan effectively instant, which is what lets a2bp stay interactive and
# lets the gate afford to run this at all.
#
# ARGUMENTS: CONTENT_FILE PROJECT_NAME [LOGICAL_PATH] [BASELINE_FILE]
#
#   CONTENT_FILE   the bytes to scan — in a2bp this is the STAGED temp copy.
#   LOGICAL_PATH   the managed path those bytes will land at. Kept separate
#                  because the staged copy is an extensionless mktemp name,
#                  and the prose/script split below keys off the extension.
#                  Passing the temp path made the Markdown exception dead in
#                  production while the unit tests — which called this helper
#                  directly with a real .md path — stayed green (Codex F2).
#                  Defaults to CONTENT_FILE.
#   ALIGN_FILE     ACCEPTED AND IGNORED. It once carried contamination_stage's
#                  proven-provenance line list, to exempt lines identical to the
#                  blueprint's copy. A-07 R4-F2 removed the exemption: it was the
#                  one path by which a misattributed line could wave
#                  contamination through, so EVERY staged line is scanned.
#                  The parameter and its old description survived the removal and
#                  read as though the exemption still existed — which is how a
#                  test came to assert a false-block that cannot happen (#7).
#                  Kept only so existing 4-argument callers do not break.
#
#                  The cost is real and deliberate: a project whose name is a
#                  common word blocks on its own generic prose and needs an
#                  explicit `a2bp-allow`. That is the price of not having a
#                  laundering path.
contamination_scan() {
  local f="$1" proj_name="$2"
  local logical="${3:-$1}"
  : "${4:-}"   # ALIGN_FILE — see above; deliberately unused
  local blocked=0
  local name_rx suppressed
  # `acme-flow` also appears as AcmeFlow / acme_flow / ACMEflow. Match any
  # separator (or none) between segments, case-insensitively. The name is
  # escaped first: a directory may legally contain regex metacharacters, and
  # an unescaped `.` would match any character.
  name_rx=$(printf '%s' "$proj_name" \
            | sed -e 's/[][\.^$*+?(){}|\\/]/\\&/g' -e 's/[-_]/[-_]?/g')

  # Line numbers carrying a justified a2bp-allow marker, as "|N|N|" for a
  # cheap substring test below. The delimiters matter: without them line 1
  # would suppress line 11.
  suppressed="|$(grep -nE 'a2bp-allow:[[:space:]]*[^[:space:]]' "$f" 2>/dev/null \
                 | cut -d: -f1 | tr '\n' '|')"
  _skip() { case "$suppressed" in *"|$1|"*) return 0 ;; esac; return 1; }

  # Markdown documents the CONVENTION; shell scripts execute a PATH. That
  # distinction decides whether `~/.{{PROJECT_NAME}}` is correct or is the  a2bp-allow: worked example in a comment
  # A-09 defect — see the dot-dir pass below.
  local is_prose=0
  case "$logical" in *.md) is_prose=1 ;; esac

  local ln text hit name
  # Full lines by number — the `grep -o` passes below yield only the matched
  # token, not its line, and a finding has to quote the line to be actionable.
  # (This comment used to say "so the baseline exemption can be applied
  # uniformly"; there is no baseline exemption — see ALIGN_FILE above.)
  local -a _lines
  mapfile -t _lines < "$f" 2>/dev/null || _lines=()

  # --- BLOCK: absolute host home path ---
  while IFS= read -r hit; do
    [ -z "$hit" ] && continue
    ln=${hit%%:*}; text=${hit#*:}
    _skip "$ln" && continue
    printf '%s|BLOCK|host home path (belongs in a gitignored local config)|%s\n' "$ln" "$text"
    blocked=1
  done < <(grep -nE '/(Users|home)/[A-Za-z0-9_.-]+/' "$f" 2>/dev/null || true)

  # --- BLOCK: literal per-project state dir ---
  while IFS= read -r hit; do
    [ -z "$hit" ] && continue
    ln=${hit%%:*}; text=${hit#*:}
    _skip "$ln" && continue
    name=${text#*/.}
    name=${name%%/*}
    _contamination_is_known_dotdir "$name" && continue
    # `~/.{{PROJECT_NAME}}` is the placeholder, i.e. already genericised. In  a2bp-allow: worked example in a comment
    # prose that is the correct way to document a per-project dir, and
    # AGENTS.md/OBSERVABILITY.md legitimately do so — agent_state_dir derives
    # `~/.<repo-basename>`, which in a derived project IS the project name.
    # In a SCRIPT the same string is a literal unsubstituted path, and that is
    # A-09 exactly: every checkout collided on one shared directory.
    if [ "$is_prose" -eq 1 ]; then
      case "$name" in \{\{PROJECT_NAME*) continue ;; esac
    fi
    printf '%s|BLOCK|literal per-project state dir (derive it via scripts/lib/state-dir.sh)|%s\n' \
      "$ln" "$text"
    blocked=1
  done < <(grep -noE '(\$HOME|~)/\.[A-Za-z0-9_{][A-Za-z0-9_.{}-]*' "$f" 2>/dev/null || true)

  # --- BLOCK: project name that survived reverse-substitution ---
  # With provenance-based reversal this is the load-bearing check, not a
  # backstop: any line the operator EDITED keeps its literal project name, and
  # this is what stops it reaching the blueprint. The operator resolves it by
  # writing {{PROJECT_NAME}} explicitly.
  while IFS= read -r hit; do
    [ -z "$hit" ] && continue
    ln=${hit%%:*}; text=${hit#*:}
    _skip "$ln" && continue
    printf '%s|BLOCK|project name survived reverse-substitution — write {{PROJECT_NAME}} explicitly if it belongs|%s\n' "$ln" "$text"
    blocked=1
  done < <(grep -nEi "(^|[^A-Za-z0-9])${name_rx}([^A-Za-z0-9]|$)" "$f" 2>/dev/null || true)

  # --- NOTICE: real-looking email address ---
  while IFS= read -r hit; do
    [ -z "$hit" ] && continue
    ln=${hit%%:*}; text=${hit#*:}
    _skip "$ln" && continue
    _contamination_is_placeholder_email "$text" && continue
    printf '%s|NOTICE|operator/personal email %s — generic files should not name an individual|%s\n' \
      "$ln" "$text" "$text"
  done < <(grep -noE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$f" 2>/dev/null || true)

  return $blocked
}
