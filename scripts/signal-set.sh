#!/usr/bin/env bash
# scripts/signal-set.sh — publish the whole baton in ONE atomic write.
#
# WHY THIS EXISTS
#
# `AGENT_SIGNAL.md` is read by a poller and written by agents. Writing it as
# two edits — `Task`, then `State` — means the poller can sample a state that
# never existed as an instruction: the NEW State beside the PREVIOUS round's
# Task. It then dispatches, in earnest, against finished work. That happened
# twice in one session, the second time hours after its author had written the
# "flip the mic last" rule into AGENTS.md.
#
# The watcher gained a settle window, which shrinks the race. Four-eyes was
# right that it does not close it: a writer that pauses longer than the settle
# value still publishes a torn state, and no timeout is a publication boundary.
# The fix belongs on the WRITE side — make a handoff one indivisible
# publication, so there is no torn state to sample in the first place.
#
# Usage:
#   scripts/signal-set.sh --holder Jesko --state OVER_TO_CODEX --task-file t.md
#   scripts/signal-set.sh --holder Sylvia --state ACTIVE --task 'short text'
#
# The file is composed in full and moved into place with `mv`, which is atomic
# within a filesystem. A reader either sees the whole previous baton or the
# whole new one — never a mixture.
set -euo pipefail

# BUG-019 — resolve the live baton from THIS SCRIPT's tree, never from cwd.
#
# This used to default to a bare relative `AGENT_SIGNAL.md`, which resolves
# against wherever the caller happens to stand. That is not a theoretical
# hazard: the first draft of tests/baton-durability/ called this script from the
# repo root to publish into a FIXTURE, and instead published into the REAL
# baton — the live watcher then dispatched the real Codex against a task reading
# "baton durability fixture", in the real working tree, with workspace-write.
#
# Same defect class as BUG-020's root anchoring, and as the bug this change
# fixes: a path resolved from the CALLER's position rather than from the thing
# that owns it. The physical-root block below is byte-identical to the one in
# every other consumer (tests/state-dir/ #7 enforces that).
_bp_self="${BASH_SOURCE[0]}"
_bp_hops=0
while [ -L "$_bp_self" ] && [ "$_bp_hops" -lt 40 ]; do
  _bp_dir="$(cd -P "$(dirname "$_bp_self")" && pwd)"
  _bp_self="$(readlink "$_bp_self")"
  case "$_bp_self" in /*) ;; *) _bp_self="$_bp_dir/$_bp_self" ;; esac
  _bp_hops=$((_bp_hops + 1))
done
if [ -L "$_bp_self" ]; then
  echo "FATAL: symlink chain for $_bp_self exceeds 40 hops — cycle?" >&2
  exit 1
fi
_bp_root="$(cd -P "$(dirname "$_bp_self")/.." && pwd)"
BP_CODE_ROOT="$_bp_root"

. "$_bp_root/scripts/lib/state-dir.sh"
# BUG-140 — roster.sh is OPTIONAL infrastructure for this script, not required
# infrastructure like state-dir.sh above: a fixture that copies only
# signal-set.sh (to test the baton mechanics, not the roster check) must still
# be able to publish. Same degrade as the no-AGENT_ROSTER.md case below, one
# level up — the LIB itself missing, not just the roster file it reads.
_bp_have_roster_lib=""
if [ -r "$_bp_root/scripts/lib/roster.sh" ]; then
  . "$_bp_root/scripts/lib/roster.sh"
  _bp_have_roster_lib=1
fi
BP_STATE_ROOT="$(bp_state_root)" || exit 9
SIGNAL="$(agent_signal_file)"
# JOURNAL is derived AFTER argument parsing, from the baton actually in use.
# Deriving it here missed `--file`, which is parsed below: tests/signal-set/
# points the baton at a fixture with `--file` and its eleven rows still landed
# in the REAL journal. Honouring $AGENT_SIGNAL_FILE but not `--file` is a guard
# with a hole in exactly the shape of the second input path — the same defect
# this script's own --task/--task-file normalisation had.
HOLDER=""
STATE=""
TASK=""
TASK_FILE=""

die() { echo "signal-set: $*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --holder)    HOLDER="${2:-}"; shift 2 ;;
    --state)     STATE="${2:-}"; shift 2 ;;
    --task)      TASK="${2:-}"; shift 2 ;;
    --task-file) TASK_FILE="${2:-}"; shift 2 ;;
    --file)      SIGNAL="${2:-}"; shift 2 ;;
    -h|--help)   sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           die "unknown argument: $1" ;;
  esac
done

[ -n "$HOLDER" ] || die "--holder is required"
# BUG-140 — Holder must be a roster persona, or `--holder NoSuchPersona`
# publishes a baton nothing can claim. AGENT_SIGNAL.md says Holder is a persona
# name from AGENT_ROSTER.md.
#
# AGENT_ROSTER_FILE overrides where the roster is read from, same shape as
# AGENT_SIGNAL_FILE/--file for the baton itself: `bp_roster_file` already
# accepts a literal file path as its "src" argument, so this reuses that rather
# than adding a second resolver. Unset, the check reads BP_STATE_ROOT, which for
# a script run from its own physical location (BUG-019) is the real checkout.
#
# Absent roster (a fresh clone before `cp AGENT_ROSTER.example.md
# AGENT_ROSTER.md`, or a derived project that has not copied one yet) SKIPS the
# check rather than blocking every publish before bootstrap — the same degrade
# `bp_roster_file` itself already uses (it warns, it does not fail, when only
# the shipped example exists). The skip is announced, not silent — a silent
# skip is the exact failure mode this baton-validation batch (BUG-139/BUG-140)
# is about: a check that looks like it ran and did not.
#
# `Nobody` is the one non-persona value this script itself seeds (the fresh-baton
# template above): "the mic is free," not a typo'd persona. It is accepted
# alongside a roster match, never in place of the roster lookup.
if [ "$HOLDER" = "Nobody" ]; then
  :
elif [ -z "$_bp_have_roster_lib" ]; then
  echo "signal-set: scripts/lib/roster.sh not found — skipped the roster check for --holder '$HOLDER'" >&2
else
  _bp_roster_src="${AGENT_ROSTER_FILE:-$BP_STATE_ROOT}"
  if _bp_roster_f="$(bp_roster_file "$_bp_roster_src" 2>/dev/null)"; then
    bp_roster_backing_for_name "$_bp_roster_src" "$HOLDER" >/dev/null 2>&1 \
      || die "--holder '$HOLDER' is not a persona in $_bp_roster_f — AGENT_SIGNAL.md says Holder is a roster persona name, or 'Nobody' when nobody holds the mic"
  else
    echo "signal-set: no AGENT_ROSTER.md found — skipped the roster check for --holder '$HOLDER'" >&2
  fi
fi
[ -n "$STATE" ]  || die "--state is required"
# The live baton is untracked per-checkout state (BUG-019), so a fresh clone has
# none and this is its first writer. Seed it rather than refusing: "no signal
# file" was a sensible error when the file was tracked and its absence meant
# something was wrong; now absence just means nobody has taken the mic yet.
JOURNAL="$(dirname "$SIGNAL")/signal-history.log"

mkdir -p "$(dirname "$SIGNAL")"

# The seed is a TEMPLATE FED TO THE REWRITE, never written to the final path.
#
# The first version wrote the default IDLE baton straight to $SIGNAL and let the
# atomic rewrite replace it a moment later. Codex was right that this
# contradicts the whole point of the file: for that instant a reader sees an
# empty, partial, or default baton at the canonical path. The default being IDLE
# makes an accidental dispatch unlikely, but "unlikely" is not the guarantee
# this script exists to provide — one atomic publication is.
#
# So an absent baton is seeded into a temp file used only as awk's INPUT. The
# only thing that ever appears at $SIGNAL is the finished, requested baton, via
# a single rename.
_bp_seed_src=""
if [ ! -f "$SIGNAL" ]; then
  _bp_seed_src="$(mktemp "${SIGNAL}.seed.XXXXXX")"
  trap 'rm -f "$_bp_seed_src"' EXIT INT TERM
  cat > "$_bp_seed_src" <<'SEED'
<!-- LIVE coordination baton — untracked, per-checkout (BUG-019).
     Written only by scripts/signal-set.sh. The protocol itself is documented in
     the tracked AGENT_SIGNAL.md; this file is state, not documentation. -->

| Field | Value |
|---|---|
| Holder | Nobody |
| State | IDLE |
| Task | (none) |
| Last update | (never) |
SEED
fi

if [ -n "$TASK_FILE" ]; then
  [ -f "$TASK_FILE" ] || die "no such --task-file: $TASK_FILE"
  TASK="$(cat "$TASK_FILE")"
fi
[ -n "$TASK" ] || die "--task or --task-file is required"

# Normalise AFTER both input paths converge. Doing it only in the --task-file
# branch left `--task $'a\nb'` producing a broken multi-line table row — one
# input path validated, the other not, which is how a guard grows a hole.
#
# The policy, stated exactly, because the previous comment overclaimed it:
#
#   CR and LF        → a single space. They genuinely break the table row.
#   INTERIOR spaces  → preserved byte-for-byte, including runs. An earlier
#                      version ran `sed 's/  */ /g'` and silently rewrote
#                      indentation inside snippets, aligned columns, and quoted
#                      arguments whose repeated spaces are deliberate.
#   INTERIOR tabs    → preserved as tabs. Markdown renders them in a cell.
#   BOUNDARY         → TRIMMED, both ends: every byte `sed` matches as POSIX
#                      `[[:space:]]` **under LC_ALL=C**, which is space, tab,
#                      newline, carriage return, vertical tab and form feed —
#                      stating only "spaces and tabs" was narrower than the
#                      code, which is the same overclaim this comment has now
#                      made twice.
#
#                      The locale is PINNED rather than inherited (BUG-043).
#                      `[[:space:]]` is locale-dependent by definition, and in
#                      a UTF-8 locale on BSD/macOS it also matches U+00A0, so
#                      the same command trimmed differently on the founder's
#                      Mac than on Linux and broke the "NOT SUPPORTED" promise
#                      below. A baton every agent parses must not depend on the
#                      LANG of whoever published it.
#                      Deliberate: `--task-file` almost always ends in a
#                      newline, which becomes a trailing space, and leading
#                      indentation of a one-line cell carries no meaning. If
#                      you need boundary whitespace to survive, put it in the
#                      body of the instruction, not at its edges.
#
#   NOT SUPPORTED    → Unicode whitespace (U+00A0 NBSP and friends) is NOT
#                      recognised, so it survives at the boundary. Logged as
#                      unsupported rather than engineered: this is a shell
#                      table publisher, and exhaustive Unicode normalisation
#                      would be a lot of machinery for a case that has never
#                      occurred. Say so rather than let the next reader assume
#                      the trim is total.
TASK="$(printf '%s' "$TASK" | tr '\n\r' '  ' | LC_ALL=C sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"

# A literal `|` would end the table cell early and truncate the instruction.
# ESCAPE it rather than refuse: `\|` renders as a pipe inside a markdown table,
# and refusing means a prompt cannot discuss shell pipelines, alternation, or
# the escaping rule itself. Found by dogfooding — the very first dispatch
# written with this tool was rejected for asking whether refusing was correct.
TASK="$(printf '%s' "$TASK" | sed 's/|/\\|/g')"

TODAY="$(date '+%Y-%m-%d')"
TMP="$(mktemp "${SIGNAL}.XXXXXX")"
trap 'rm -f "$TMP" "$_bp_seed_src"' EXIT INT TERM

# awk reads the existing baton, or the seed template when there is none. Either
# way the finished file is produced in $TMP and published by one rename.
SRC="${_bp_seed_src:-$SIGNAL}"

# Rewrite the four baton rows; everything else in the file is passed through
# untouched, so the surrounding prose stays project-owned.
# Values come through ENVIRON, never `awk -v`. `-v` runs escape-sequence
# processing over the value, so the `\|` escaping applied above was silently
# undone and a raw pipe reached the table cell — truncating the instruction at
# exactly the point it was explaining pipes. ENVIRON passes bytes through
# untouched. (Found the hard way: the first dispatch published with this tool
# was truncated by its own escaping.)
SIGNAL_HOLDER="$HOLDER" SIGNAL_STATE="$STATE" SIGNAL_TASK="$TASK" SIGNAL_TODAY="$TODAY" \
awk '
  BEGIN {
    holder = ENVIRON["SIGNAL_HOLDER"]
    state  = ENVIRON["SIGNAL_STATE"]
    task   = ENVIRON["SIGNAL_TASK"]
    today  = ENVIRON["SIGNAL_TODAY"]
  }
  /^\| Holder \|/      { print "| Holder | " holder " |"; next }
  /^\| State \|/       { print "| State | " state " |"; next }
  /^\| Task \|/        { print "| Task | " task " |"; next }
  /^\| Last update \|/ { print "| Last update | " today " |"; next }
  { print }
' "$SRC" > "$TMP"

for _row in "| Holder |" "| State |" "| Task |"; do
  grep -qF "$_row" "$TMP" || die "row '$_row' missing after rewrite — refusing to publish a malformed baton"
done

chmod --reference="$SIGNAL" "$TMP" 2>/dev/null || true
mv "$TMP" "$SIGNAL"
trap - EXIT INT TERM

# Journal the flip. This replaces `git log -p AGENT_SIGNAL.md` as the hand-off
# history, and is better on one axis: it records flips that were never committed,
# which git could not show.
#
# TWO WRITERS APPEND HERE, and pretending otherwise is how the last two bugs
# happened. This one writes the flips; `session-resume.sh --mark` writes the
# window markers around them. That is A-09's hazard by construction, so the
# rules that keep it safe are worth stating rather than assuming:
#
#   * both APPEND ONLY. Neither rewrites, truncates or rotates the file.
#   * each writes its record in ONE `printf`, so a small O_APPEND write cannot
#     be interleaved by the other. `--mark` rolls close-and-open together for
#     exactly this reason — as two appends, a flip could land between them and
#     belong to no replay window.
#   * neither swallows a failed append (below, and BUG-023).
#
# BUG-023 — IT IS NO LONGER A BACKSTOP, AND THE FAILURE IS NO LONGER SWALLOWED.
#
# This line used to end `2>/dev/null || true`, and the comment above it called
# the journal "read by nothing that makes a decision". Both were correct: a
# logging failure had no business failing a mic flip.
#
# FEATURE-003 made this file the REPLAY'S SOURCE — `session-resume.sh` reads it
# to decide what happened since the last handoff — and did not update the writer.
# So a flip could publish, lose its event, and the next session would replay a
# short history with nothing to warn it. Durable is not complete: a file nothing
# truncates still has holes if its writer treats them as acceptable.
#
# EXIT 8 — "published, but not journalled". A distinct status, because the baton
# IS published by this point (publication is one atomic rename, already done) and
# a caller that read a plain failure and retried would publish twice.
echo "signal-set: published Holder=$HOLDER State=$STATE (atomic) → $SIGNAL"

if ! printf '[%s] Holder=%s State=%s Task=%s\n' \
     "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$HOLDER" "$STATE" "$TASK" >> "$JOURNAL" 2>/dev/null; then
  echo "signal-set: the baton IS published — do NOT retry, that would publish twice." >&2
  echo "signal-set: but the journal append FAILED → $JOURNAL" >&2
  echo "  This flip is missing from the hand-off history, so the next session's" >&2
  echo "  'session-resume.sh' will replay one event fewer and cannot know it." >&2
  echo "  Fix the journal (permissions, disk, filesystem) before the next handoff." >&2
  exit 8
fi
