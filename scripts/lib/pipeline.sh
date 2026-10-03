# shellcheck shell=sh
# scripts/lib/pipeline.sh — render a sequence of gate stages as a pipeline.
#
# FEATURE-002. The pre-push gate ran ~18 stages as loose `→ doing X...` echoes
# with one ✅ at the end. Two problems, and only one of them is cosmetic:
#
#   1. You could not see what had run, what it cost, or where it stopped.
#   2. **A gate that did not run printed nothing — which looks exactly like a
#      gate that passed.** On 2026-08-02 something wiped `core.hooksPath` and a
#      push went out completely ungated, indistinguishable from a gated one
#      (BUG-004, new evidence). A distinctive banner inverts that: no banner
#      means no gate, and a human sees it immediately.
#
# POSIX sh on purpose — `.githooks/pre-push` is `#!/bin/sh`, which is dash on
# Ubuntu. No arrays, no bashisms; per-stage state accumulates in a temp file.
#
# ---------------------------------------------------------------------------
# THE INVARIANT: FAIL CLOSED.
#
# This file decides whether a push is allowed. Every failure mode must block:
# a stage exiting non-zero, a stage killed by a signal, a missing tool, and a
# bug in this renderer itself. `pipe_stage` therefore EXITS on failure rather
# than returning a status the caller might drop — a forgotten `||` in one of 18
# call sites would otherwise fail open silently, which is the exact class of
# defect this repo keeps paying for. `pipe_stage_soft` exists for the rare
# genuinely-optional stage and is deliberately noisier to write.
# ---------------------------------------------------------------------------
#
# There is deliberately NO per-stage background process for a ticking timer.
# BUG-001 reached ~17,400 unreaped processes on this host from exactly that
# shape of "just one small helper per item". The running line is static and the
# duration prints on completion; that is worth the loss of a spinner.
#
# Usage:
#   . scripts/lib/pipeline.sh
#   pipe_init "pre-push gate" "blueprint · 2 commits · 257ac1d"
#   pipe_stage "secret scan · gitleaks" run_gitleaks
#   pipe_skip  "IaC synth" "no infrastructure/ directory"
#   pipe_finish            # prints the summary; returns 0 pass / 1 fail
#
# For a batch runner that executes many suites in ONE process, results are
# injected instead of run — see §"injected results" for the API and, more
# importantly, for what it does and does not guarantee:
#
#   pipe_batch_begin "vitest" alpha beta      # declare, BEFORE running
#   pipe_stage_report "alpha" 1240 0          # ...per already-executed suite
#   pipe_batch_end "$runner_rc"               # reconcile; fails closed

# The shared feed appender, so gate results land in logs/agent-activity.log
# alongside every other agent's work rather than only in the terminal that
# happened to run the push. Optional by design — see _pipe_feed.
# shellcheck source=scripts/lib/feed.sh
#
# BUG-066: the default hangs off $BP_CODE_ROOT, which .githooks/pre-push
# resolves before sourcing this file. A bare `scripts/lib` is cwd-relative and
# stops resolving the moment the code tree moves under scaffolding/.
_PIPE_LIB="${_PIPE_LIBDIR:-${BP_CODE_ROOT:-.}/scripts/lib}"
if [ -r "$_PIPE_LIB/feed.sh" ]; then
  # BUG-077: feed.sh resolves the feed from $BP_STATE_ROOT rather than asking
  # git — git exports GIT_DIR into every hook and the gate runs suites from one.
  # Resolved here because the gate is the one feed producer that is not a
  # top-level script with its own physical-location block: `pwd` is git's hook
  # contract, which is the same claim scripts/lib/dod-gate.mts makes.
  if [ -z "${BP_STATE_ROOT:-}" ] && [ -r "$_PIPE_LIB/state-dir.sh" ]; then
    . "$_PIPE_LIB/state-dir.sh"
    : "${BP_CODE_ROOT:=$(pwd)}"
    BP_STATE_ROOT="$(bp_state_root)" || BP_STATE_ROOT=""
  fi
  . "$_PIPE_LIB/feed.sh"
fi

# --- state ------------------------------------------------------------------
_PIPE_DIR=""
_PIPE_TITLE=""
_PIPE_T0=""
_PIPE_N=0

# A literal newline, as a variable. POSIX sh has no arrays, so the injected-
# result API keeps its label sets as newline-delimited strings and matches them
# with `case` — `*"$_PIPE_NL$label$_PIPE_NL"*`. Writing the newline inline in
# every pattern works but is unreadable and easy to mangle in a later edit.
_PIPE_NL='
'

# `date +%s%N` is GNU; macOS/BSD date has no %N and prints a literal "N".
# Probe once, then commit to the form that works — the same discipline the feed
# applies to `stat` (A-06), where a bad fallback produced a plausible-looking
# blob instead of a number.
if [ "$(date +%s%N 2>/dev/null | tail -c 4)" != "%N" ] && \
   [ "$(date +%N 2>/dev/null)" != "N" ]; then
  _pipe_now(){ echo $(( $(date +%s%N) / 1000000 )); }   # milliseconds
else
  _pipe_now(){ echo $(( $(date +%s) * 1000 )); }        # seconds, ms-scaled
fi

_pipe_dur(){ # ms -> "1.2s"
  _d=$1
  echo "$(( _d / 1000 )).$(( (_d % 1000) / 100 ))s"
}

# Colour and cursor control only on a real terminal. Piped output (CI logs, a
# `| tee`, an agent capturing the push) must stay plain — an escape-sequence
# soup in a CI log is worse than no rendering at all.
if [ -t 1 ]; then
  _PIPE_TTY=1
  # The ESC byte is generated, not typed: a raw 0x1b in source is invisible and
  # was silently stripped once already (BUG-083).
  _PIPE_ESC=$(printf '\033')
  _C_DIM="${_PIPE_ESC}[2m"; _C_OK="${_PIPE_ESC}[32m"; _C_BAD="${_PIPE_ESC}[31m"; _C_WARN="${_PIPE_ESC}[33m"; _C_OFF="${_PIPE_ESC}[0m"
  _PIPE_CLR="${_PIPE_ESC}[K"
else
  _PIPE_TTY=0
  _C_DIM=''; _C_OK=''; _C_BAD=''; _C_WARN=''; _C_OFF=''
  _PIPE_CLR=''
fi

# --- lifecycle --------------------------------------------------------------
pipe_init(){
  _PIPE_TITLE="${1:-pipeline}"
  _PIPE_SUB="${2:-}"
  _PIPE_T0="$(_pipe_now)"
  _PIPE_N=0; _PIPE_OK=0; _PIPE_BAD=0; _PIPE_SKIP=0
  _PIPE_SLOW_MS=0; _PIPE_SLOW_LABEL=""
  # Injected-result state (see §"injected results" below). Reset per run so a
  # second pipe_init in one process cannot inherit a half-open batch.
  _PIPE_BATCH=""; _PIPE_BATCH_T0=0; _PIPE_BATCH_N=0; _PIPE_BATCH_BAD=0
  _PIPE_BATCH_EXPECT="$_PIPE_NL"; _PIPE_BATCH_SEEN="$_PIPE_NL"

  # Buffering needs a scratch dir. If we cannot get one — /tmp full, mounted
  # noexec, coreutils not on PATH — the gate must still RUN and still fail
  # closed. It degrades to streaming each stage's output instead of refusing to
  # start, because "the gate could not create a temp dir" is a terrible reason
  # to block a push, and an even worse reason to allow one.
  _PIPE_DIR=""
  _PIPE_BUF=0
  if _d="$(mktemp -d 2>/dev/null)" && [ -d "$_d" ]; then
    _PIPE_DIR="$_d"; _PIPE_BUF=1
    trap '_pipe_cleanup' EXIT INT TERM
  fi

  printf '\n%s╭─ %s %s%s\n' "$_C_DIM" "$_PIPE_TITLE" "${_PIPE_SUB:+· $_PIPE_SUB }" "$_C_OFF"
  [ "$_PIPE_BUF" = "0" ] && printf '%s│  (no scratch dir — stage output streams unbuffered)%s\n' \
    "$_C_WARN" "$_C_OFF"
  _pipe_feed "── $_PIPE_TITLE ${_PIPE_SUB:+· $_PIPE_SUB} ──"
  return 0
}

_pipe_cleanup(){ [ -n "${_PIPE_DIR:-}" ] && rm -rf "$_PIPE_DIR" 2>/dev/null; return 0; }

# Counters live in shell variables, not a file. The summary must be correct even
# when there is no scratch dir, and a tally that depends on the filesystem is a
# tally that can silently read zero.
# _pipe_record STATUS
_pipe_record(){
  case "$1" in
    ok)   _PIPE_OK=$((   _PIPE_OK   + 1 )) ;;
    bad)  _PIPE_BAD=$((  _PIPE_BAD  + 1 )) ;;
    skip) _PIPE_SKIP=$(( _PIPE_SKIP + 1 )) ;;
  esac
  _PIPE_N=$(( _PIPE_N + 1 ))
}

_pipe_line(){ # STATUS LABEL RIGHT
  case "$1" in
    ok)   printf '%s│%s %s✓%s %-46s %s%s%s\n' "$_C_DIM" "$_C_OFF" "$_C_OK"  "$_C_OFF" "$2" "$_C_DIM" "$3" "$_C_OFF" ;;
    bad)  printf '%s│%s %s✗%s %-46s %s%s%s\n' "$_C_DIM" "$_C_OFF" "$_C_BAD" "$_C_OFF" "$2" "$_C_BAD" "$3" "$_C_OFF" ;;
    skip) printf '%s│%s %s–%s %-46s %s%s%s\n' "$_C_DIM" "$_C_OFF" "$_C_WARN" "$_C_OFF" "$2" "$_C_DIM" "$3" "$_C_OFF" ;;
  esac
  # …and the same result to the activity feed, PLAIN. The terminal render is
  # ephemeral — it scrolls away, and it is gone entirely for anyone who was not
  # watching that shell. The feed is the durable record of what the gate did,
  # and it is what an agent reads back when asked "did that push get gated?".
  # Never with colour: logs/agent-activity.log is tailed and grepped, and escape
  # sequences in it are the same mistake as escapes in a CI log.
  case "$1" in
    ok)   _pipe_feed "✓ $2  $3" ;;
    bad)  _pipe_feed "✗ $2  $3" ;;
    skip) _pipe_feed "– $2  $3" ;;
  esac
}

# Guarded so pipeline.sh still works if feed.sh is absent — a missing log must
# never be the reason a gate cannot render, let alone cannot run.
# The tag is a VARIABLE so a group of stages can announce itself distinctly in
# the feed. The DoD stages use [DoD-Gate], because the founder watches the feed
# to tell a run that did the work from one that skipped it — and "which steps
# ran" is only answerable if the steps are distinguishable from each other, not
# merely present.
_pipe_feed(){
  command -v feed_append >/dev/null 2>&1 || return 0
  feed_append "[${AGENT_FEED_TAG:-GATE}] $1"
}

# --- the stage runner -------------------------------------------------------
# Buffers the stage's output and shows it ONLY on failure, so a passing gate is
# a clean list and a failing one still gives you everything the tool said.
# pipe_note TEXT — annotate the CURRENT stage so the fact survives buffering.
#
# Buffering hides a passing stage's output, which is what makes the summary a
# summary. But some things a passing stage says are worth keeping: "semgrep
# retried at --jobs 1", "scanned --all, no ref info on stdin". Those are not
# failures and must not look like ones, yet losing them means the gate quietly
# did something different from what you think it did. A note rides along on the
# result line instead. Written to a file, not stdout, because stdout is the
# buffer we are deliberately escaping.
pipe_note(){
  if [ "$_PIPE_BUF" = "1" ]; then printf '%s' "$1" >>"$_PIPE_DIR/note.$_PIPE_N"
  else printf '     note: %s\n' "$1"
  fi
}

_pipe_run(){
  _label="$1"; shift
  [ "$_PIPE_BUF" = "1" ] && { _out="$_PIPE_DIR/out.$_PIPE_N"; : >"$_PIPE_DIR/note.$_PIPE_N"; }

  # The "currently running" indicator. On a TTY it is overwritten in place by
  # the result line; otherwise it is simply not printed, because a non-TTY
  # consumer would just see every stage twice.
  [ "$_PIPE_TTY" = "1" ] && printf '%s│%s %s⠿%s %s…' \
    "$_C_DIM" "$_C_OFF" "$_C_DIM" "$_C_OFF" "$_label"

  _t0="$(_pipe_now)"
  if [ "$_PIPE_BUF" = "1" ]; then
    "$@" >"$_out" 2>&1
  else
    "$@"
  fi
  _rc=$?
  _ms=$(( $(_pipe_now) - _t0 ))

  [ "$_PIPE_TTY" = "1" ] && printf '\r%s' "$_PIPE_CLR"

  _note=""
  [ "$_PIPE_BUF" = "1" ] && _note="$(cat "$_PIPE_DIR/note.$_PIPE_N" 2>/dev/null || true)"

  # Track the slowest stage. With no hard time ceiling (founder decision,
  # BUG-005) the gate has to stay HONEST about its cost instead of enforcing it:
  # naming the single biggest contributor is what turns "the gate feels slow"
  # into a specific, arguable target. The old rule silently spent the budget by
  # demoting coverage to CI; this reports it and demotes nothing.
  if [ "$_ms" -gt "${_PIPE_SLOW_MS:-0}" ]; then
    _PIPE_SLOW_MS="$_ms"; _PIPE_SLOW_LABEL="$_label"
  fi

  if [ "$_rc" -eq 0 ]; then
    _pipe_line ok "$_label" "$(_pipe_dur "$_ms")${_note:+ · $_note}"
    _pipe_record ok
  else
    _pipe_line bad "$_label" "$(_pipe_dur "$_ms") · exit $_rc"
    _pipe_record bad
  fi
  return "$_rc"
}

# pipe_stage LABEL COMMAND [ARGS...] — FAILS CLOSED. A non-zero stage prints the
# captured output, prints the summary, and exits 1. It does not return.
pipe_stage(){
  _lbl="$1"
  if _pipe_run "$@"; then
    return 0
  fi
  # Unbuffered mode already streamed the output; replaying it would duplicate it.
  if [ "$_PIPE_BUF" = "1" ]; then
    printf '\n%s─── output · %s ───%s\n' "$_C_BAD" "$_lbl" "$_C_OFF"
    cat "$_PIPE_DIR/out.$(( _PIPE_N - 1 ))" 2>/dev/null
    printf '%s───%s\n' "$_C_BAD" "$_C_OFF"
  fi
  pipe_finish
  exit 1
}

# pipe_stage_soft LABEL COMMAND [ARGS...] — records a failure and RETURNS it.
# Only for a stage whose failure genuinely must not block; the caller then owns
# the decision, in writing.
pipe_stage_soft(){ _pipe_run "$@"; }

pipe_skip(){
  _pipe_line skip "$1" "skipped · $2"
  _pipe_record skip
}

# --- injected results: one runner process, many stages -----------------------
#
# WHY THIS EXISTS. Every function above measures a stage by running it. A batch
# runner — one `vitest run` covering dozens of suites, one `pytest`, one gradle
# invocation — cannot be expressed that way without giving up the thing that
# makes it worth using. The two honest-reporting properties this gate depends on
# both collapse into a single line:
#
#   * the render stops naming the suites, so "37 suites ran" and "1 suite ran"
#     look identical — the BUG-005 shape, where absence is invisible; and
#   * slowest-stage tracking degrades to `slowest: vitest 200s`, which names
#     nothing anyone can optimise.
#
# So the runner reports each already-executed result back, and it renders,
# tallies, tracks and warns exactly like a stage this file ran itself.
#
# ---------------------------------------------------------------------------
# WHAT STOPS THIS BEING A WAY TO FAKE A GREEN STAGE.
#
# Be exact about the boundary: **this file does not execute a reported stage, so
# it cannot verify that one ran.** Anything claiming otherwise would be a
# guarantee we do not provide. What the API does instead is make *accidental*
# silent loss — a suite dropped from a config, a runner that died early, a
# reporter that emitted nothing — impossible to render as green:
#
#   1. A report is only accepted inside an open batch. `pipe_stage_report` on
#      its own, anywhere in a gate, is a hard failure — it cannot be sprinkled
#      next to real stages to conjure a passing line.
#   2. The batch DECLARES its expected labels up front, before the runner runs.
#      A label that was not declared is refused; a declared label that never
#      reported fails the batch by name. This is the control that catches "the
#      suite quietly stopped being collected".
#   3. A label reported twice is refused — the count cannot be padded to satisfy
#      a non-vacuity guard (`bootstrap-gate` #3 requires ≥25 stages).
#   4. The runner's OWN exit status must agree with what it reported. Non-zero
#      with every stage green means it died outside a suite; zero while a stage
#      failed means it is lying about itself. Both fail.
#   5. A malformed report — empty label, non-numeric duration or rc — is
#      recorded as a FAILED stage, never skipped and never passed. A broken
#      reporter blocks the push instead of quietly emitting fewer lines.
#   6. `pipe_stage_report` always returns 0 and the failure lives in the
#      pipeline's own tally, which no caller can un-record. There is deliberately
#      no status for a caller to drop — the inverse of `pipe_stage`, which exits
#      *because* a dropped `||` would fail open.
#
# RESIDUAL RISK, stated plainly rather than papered over:
#
#   * **If the declared set is derived from the runner's own output, every check
#     above reduces to trusting the runner.** The declaration has to come from a
#     source the runner cannot edit at run time — in this repo that is the
#     FILESYSTEM, via `scripts/lib/suites.sh`, the same source the manifest suite
#     reconciles against. (It was `tests/SUITES.md` until TASK-020 deleted that
#     table. `find` is the same property from a better source: it consults no
#     config, no include glob and no reporter belonging to the runner.)
#     Declaring nothing (`pipe_batch_begin LABEL` with no labels) leaves only
#     checks 1, 3, 4, 5, 6: enough to catch a crashed or self-contradicting
#     runner, NOT enough to catch a suite silently dropped from its config.
#     That hole is the caller's to close, and it is why the expected set is a
#     parameter rather than an option.
#   * Nothing here defends against deliberate fabrication. A caller that wants a
#     green line can print one. The threat model is a gate that stops covering
#     something without anyone noticing, not an author lying on purpose.
# ---------------------------------------------------------------------------
#
# Usage:
#   pipe_batch_begin "vitest" $(bp_suites_with_spec "$ROOT")
#   # ...run the batch, parse its machine-readable report, then per suite:
#   pipe_stage_report "signal-dispatch" 37500 0
#   pipe_batch_end "$runner_rc"      # fails closed; does not return on failure

# _pipe_fatal LABEL DETAIL — a misuse of the injection API is itself a failed
# stage. It renders, it tallies, it prints the summary and it exits 1, because a
# gate whose reporting contract was violated has not proved anything.
_pipe_fatal(){
  _pipe_line bad "$1" "injection guard · $2"
  _pipe_record bad
  printf '\n%s─── injection guard · %s ───%s\n' "$_C_BAD" "$1" "$_C_OFF"
  printf '%s\n' "$2"
  printf '%sSee scripts/lib/pipeline.sh §"injected results".%s\n' "$_C_BAD" "$_C_OFF"
  pipe_finish
  exit 1
}

# _pipe_declared LIST LABEL — is LABEL in the newline-delimited LIST?
_pipe_declared(){
  case "$1" in
    *"$_PIPE_NL$2$_PIPE_NL"*) return 0 ;;
  esac
  return 1
}

# pipe_batch_begin LABEL [EXPECTED_LABEL...]
pipe_batch_begin(){
  [ -n "${_PIPE_BATCH:-}" ] && \
    _pipe_fatal "${1:-batch}" "batch '$_PIPE_BATCH' is still open — batches do not nest"
  _PIPE_BATCH="${1:-batch}"
  [ "$#" -gt 0 ] && shift
  _PIPE_BATCH_T0="$(_pipe_now)"
  _PIPE_BATCH_N=0
  _PIPE_BATCH_BAD=0
  _PIPE_BATCH_SEEN="$_PIPE_NL"
  _PIPE_BATCH_EXPECT="$_PIPE_NL"
  for _e in "$@"; do
    [ -n "$_e" ] || continue
    _PIPE_BATCH_EXPECT="$_PIPE_BATCH_EXPECT$_e$_PIPE_NL"
  done
  return 0
}

# pipe_stage_report LABEL DURATION_MS RC [NOTE] — inject one already-executed
# result. Renders identically to a stage this file ran, feeds the same tally,
# the same slowest-stage tracking and the same SLO. ALWAYS RETURNS 0; see
# control 6 above.
pipe_stage_report(){
  _rlbl="${1:-}"; _rms="${2:-}"; _rrc="${3:-}"; _rnote="${4:-}"

  [ -n "${_PIPE_BATCH:-}" ] || \
    _pipe_fatal "${_rlbl:-pipe_stage_report}" \
      "reported outside a batch — call pipe_batch_begin first"

  [ -n "$_rlbl" ] || _pipe_fatal "pipe_stage_report" "empty LABEL"
  case "$_rms" in
    ''|*[!0-9]*) _pipe_fatal "$_rlbl" "DURATION_MS '$_rms' is not a non-negative integer" ;;
  esac
  case "$_rrc" in
    ''|*[!0-9]*) _pipe_fatal "$_rlbl" "RC '$_rrc' is not a non-negative integer" ;;
  esac
  # Bounded so the value stays a meaningful exit status rather than wrapping.
  [ "$_rrc" -gt 255 ] && _pipe_fatal "$_rlbl" "RC $_rrc is out of range (0-255)"

  _pipe_declared "$_PIPE_BATCH_SEEN" "$_rlbl" && \
    _pipe_fatal "$_rlbl" "reported twice in batch '$_PIPE_BATCH' — the stage count cannot be padded"

  if [ "$_PIPE_BATCH_EXPECT" != "$_PIPE_NL" ]; then
    _pipe_declared "$_PIPE_BATCH_EXPECT" "$_rlbl" || \
      _pipe_fatal "$_rlbl" "not in the declared set for batch '$_PIPE_BATCH' — declaration and runner disagree"
  fi

  _PIPE_BATCH_SEEN="$_PIPE_BATCH_SEEN$_rlbl$_PIPE_NL"
  _PIPE_BATCH_N=$(( _PIPE_BATCH_N + 1 ))

  # Same slowest-stage tracking as _pipe_run. This is the point of injecting per
  # suite at all: `slowest: signal-dispatch 37.5s` is optimisable, `slowest:
  # vitest 200s` is not.
  if [ "$_rms" -gt "${_PIPE_SLOW_MS:-0}" ]; then
    _PIPE_SLOW_MS="$_rms"; _PIPE_SLOW_LABEL="$_rlbl"
  fi

  if [ "$_rrc" -eq 0 ]; then
    _pipe_line ok "$_rlbl" "$(_pipe_dur "$_rms")${_rnote:+ · $_rnote}"
    _pipe_record ok
  else
    _pipe_line bad "$_rlbl" "$(_pipe_dur "$_rms") · exit $_rrc${_rnote:+ · $_rnote}"
    _pipe_record bad
    _PIPE_BATCH_BAD=$(( _PIPE_BATCH_BAD + 1 ))
  fi
  return 0
}

# pipe_batch_end RUNNER_RC — reconcile the batch. FAILS CLOSED: on any
# discrepancy it prints the summary and exits 1, exactly like pipe_stage.
pipe_batch_end(){
  _brc="${1:-}"
  [ -n "${_PIPE_BATCH:-}" ] || _pipe_fatal "pipe_batch_end" "no batch is open"

  _blbl="$_PIPE_BATCH"
  _bn="$_PIPE_BATCH_N"
  _bbad="$_PIPE_BATCH_BAD"
  _bms=$(( $(_pipe_now) - _PIPE_BATCH_T0 ))
  # Close the batch BEFORE any exit path, so a guard failure cannot leave the
  # API accepting reports while the summary is being printed.
  _PIPE_BATCH=""

  case "$_brc" in
    ''|*[!0-9]*) _pipe_fatal "$_blbl · runner" "RUNNER_RC '$_brc' is not a non-negative integer" ;;
  esac

  # Declared but never reported — the suite that quietly stopped running.
  # `set -f` because field-splitting an unquoted expansion also globs, and a
  # label containing `*` would otherwise be silently rewritten by the filesystem.
  _missing=""
  _oldifs="$IFS"
  set -f
  IFS="$_PIPE_NL"
  set -- $_PIPE_BATCH_EXPECT
  IFS="$_oldifs"
  set +f
  _bexp="$#"
  for _e in "$@"; do
    _pipe_declared "$_PIPE_BATCH_SEEN" "$_e" || _missing="$_missing $_e"
  done
  [ -n "$_missing" ] && \
    _pipe_fatal "$_blbl · unreported" "declared but never reported:$_missing ($_bn reported in $(_pipe_dur "$_bms"))"

  [ "$_bn" -eq 0 ] && \
    _pipe_fatal "$_blbl · runner" "reported no stages at all in $(_pipe_dur "$_bms") — a runner that covered nothing must not read as a pass"

  # The runner's own verdict must agree with what it reported. Either direction
  # of disagreement is a real failure, and neither is visible in the stage lines.
  [ "$_brc" -ne 0 ] && [ "$_bbad" -eq 0 ] && \
    _pipe_fatal "$_blbl · runner" "exited $_brc while every reported stage passed — it failed outside any suite"
  [ "$_brc" -eq 0 ] && [ "$_bbad" -gt 0 ] && \
    _pipe_fatal "$_blbl · runner" "exited 0 while $_bbad reported stage(s) failed — the runner contradicts its own report"

  if [ "$_bbad" -gt 0 ]; then
    printf '\n%s─── %s · %s of %s reported stage(s) failed ───%s\n' \
      "$_C_BAD" "$_blbl" "$_bbad" "$_bn" "$_C_OFF"
    pipe_finish
    exit 1
  fi

  # Feed-only, deliberately: the terminal already shows one line per suite, but
  # "37 of 37 declared suites reported" is the durable evidence someone greps
  # for when asking whether the gate actually covered what it claims.
  if [ "$_bexp" -gt 0 ]; then
    _pipe_feed "batch $_blbl: $_bn reported, $_bexp/$_bexp declared · runner exit 0 · $(_pipe_dur "$_bms") wall"
  else
    _pipe_feed "batch $_blbl: $_bn reported, NO declared set (undetectable drop — see pipeline.sh) · runner exit 0 · $(_pipe_dur "$_bms") wall"
  fi
  return 0
}

# --- summary ----------------------------------------------------------------
pipe_finish(){
  _total=$(( $(_pipe_now) - _PIPE_T0 ))
  _ok="${_PIPE_OK:-0}"; _bad="${_PIPE_BAD:-0}"; _skip="${_PIPE_SKIP:-0}"

  if [ "$_bad" -gt 0 ]; then
    printf '%s╰─ FAILED%s · %s passed · %s failed · %s skipped · %s\n\n' \
      "$_C_BAD" "$_C_OFF" "$_ok" "$_bad" "$_skip" "$(_pipe_dur "$_total")"
    _pipe_feed "FAILED · $_ok passed · $_bad failed · $_skip skipped · $(_pipe_dur "$_total") — PUSH BLOCKED"
    _pipe_cleanup; trap - EXIT INT TERM
    return 1
  fi

  _slow=""
  [ -n "${_PIPE_SLOW_LABEL:-}" ] && \
    _slow=" · slowest: $_PIPE_SLOW_LABEL $(_pipe_dur "${_PIPE_SLOW_MS:-0}")"
  printf '%s╰─ PASSED%s · %s stages · %s skipped · %s%s%s%s\n\n' \
    "$_C_OK" "$_C_OFF" "$_ok" "$_skip" "$(_pipe_dur "$_total")" "$_C_DIM" "$_slow" "$_C_OFF"
  _pipe_feed "PASSED · $_ok stages · $_skip skipped · $(_pipe_dur "$_total")$_slow"

  # --- performance SLO: WARNS, never demotes (BUG-005 / Codex F1) -----------
  #
  # The old 30 s rule blocked, and blocking is exactly what made it dangerous:
  # the cheapest way to satisfy it was to move a suite out of the gate, so a
  # performance limit silently became a coverage limit. This one has no power to
  # change what runs. It says "this got slow, go optimise the named stage" — the
  # response that actually worked, when signal-dispatch went 125.4 s → 75.0 s
  # with every assertion intact.
  #
  # Deliberately never affects the exit status. Overridable per project.
  #
  # THRESHOLDS MUST SIT ABOVE THE ACCEPTED BASELINE (Codex R2-F2). The first
  # values were 120 s / 45 s against a measured baseline of 142.3 s total and a
  # 75 s slowest stage — so every ordinary successful gate warned. A warning that
  # fires at introduction cannot distinguish a regression from normal operation,
  # and gets trained out; it would have become noise within a week and then
  # meant nothing when something genuinely regressed.
  #
  # Set ~25% above the measured baseline, and RATCHET DOWN when optimisation
  # lands — the same discipline as the lint --max-warnings ratchet. These are a
  # regression signal, not an aspiration.
  #   baseline 2026-08-02: gate 142.3 s, slowest stage signal-dispatch ~75 s.
  _slo_total="${AGENT_GATE_SLO_TOTAL_MS:-180000}"   # 180 s whole gate  (~26% headroom)
  _slo_stage="${AGENT_GATE_SLO_STAGE_MS:-95000}"    #  95 s single stage (~27% headroom)
  if [ "$_total" -gt "$_slo_total" ] 2>/dev/null; then
    printf '%s   ⚠ gate SLO: %s total exceeds %s. Not a failure and nothing is\n' \
      "$_C_WARN" "$(_pipe_dur "$_total")" "$(_pipe_dur "$_slo_total")"
    printf '     demoted — optimise %s, or raise AGENT_GATE_SLO_TOTAL_MS deliberately.%s\n\n' \
      "${_PIPE_SLOW_LABEL:-the slowest stage}" "$_C_OFF"
    _pipe_feed "SLO: total $(_pipe_dur "$_total") over $(_pipe_dur "$_slo_total") — optimise ${_PIPE_SLOW_LABEL:-slowest}, do NOT demote"
  elif [ "${_PIPE_SLOW_MS:-0}" -gt "$_slo_stage" ] 2>/dev/null; then
    printf '%s   ⚠ gate SLO: %s took %s (over %s). Optimise it — do not move it out.%s\n\n' \
      "$_C_WARN" "$_PIPE_SLOW_LABEL" "$(_pipe_dur "$_PIPE_SLOW_MS")" \
      "$(_pipe_dur "$_slo_stage")" "$_C_OFF"
    _pipe_feed "SLO: $_PIPE_SLOW_LABEL $(_pipe_dur "$_PIPE_SLOW_MS") over $(_pipe_dur "$_slo_stage") — optimise, do NOT demote"
  fi
  _pipe_cleanup; trap - EXIT INT TERM
  return 0
}
