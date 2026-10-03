#!/usr/bin/env bash
# scripts/session-resume.sh — where is this session, and how much of it can I see?
#
# FEATURE-003. The founder's connectivity drops sessions constantly, so a woken
# agent has to reconstruct where the work stands. It used to do that by reading
# `HANDOVER.md`, and that file went stale twice in one day — once inside the same
# working session in which it had been rewritten to be true.
#
# WHY THIS DERIVES INSTEAD OF READING A SNAPSHOT
#
# The obvious design is event sourcing's: author a snapshot, replay the events
# after it. Both flow reviewers rejected the authored half independently, and the
# reasoning is the whole shape of this file:
#
#   > An authored HANDOVER.md snapshot is a SECOND BOOKKEEPING SURFACE and will
#   > go stale for the same reason the present one did. Atomic publication only
#   > guarantees a COHERENT stale snapshot; it does not make its claims true.
#
# So this tool holds NOTHING. Every line it prints is read at run time from the
# thing that owns that fact — git for the tree, the four lifecycle folders for
# what is open, the live baton for the mic, the append-only journal for the
# events. None of it can go stale, because none of it is stored.
#
# WHAT SURVIVES OF THE WRITER IS ONE APPEND
#
# `--mark` records that a handoff HAPPENED at a point in the stream. That is an
# event, and no amount of deriving reconstructs an event nobody wrote down. It is
# also immune to the staleness above, because a marker contains no claims.
#
# THE ONE REQUIREMENT THIS STANDS OR FALLS ON
#
# An INCOMPLETE replay must be LOUD, with a NON-ZERO EXIT and not only prose, so
# a script can branch on it. BUG-018 is the precedent: a guard that printed
# exactly the right advice and returned 0, so its caller read "sync succeeded"
# while nothing had been pulled.
#
# WHAT MAKES THAT CHEAP: THE REPLAY SOURCE IS DURABLE — AND WHY THAT IS NOT FREE.
#
# Events are replayed from `logs/state/signal-history.log`. Nothing truncates or
# rotates it, so "incomplete" reduces to two states, both checked below and both
# loud: there is NO MARKER (a fresh clone, or the journal was lost), or the PROSE
# AND THE JOURNAL DISAGREE about which window is live.
#
# That reduction is EARNED, not inherent, and an earlier version of this comment
# claimed it as inherent — "append-only, so a replay cannot be silently short".
# Append-only does not mean complete: a file nothing truncates still has holes if
# a writer drops a record. It had one, and Codex found it (BUG-023).
#
# TWO writers append here — `signal-set.sh` (the flips) and this script's
# `--mark` (the window markers around them). Three rules hold the reduction up,
# and breaking any one of them silently shortens a replay:
#
#   * append only — no rewrite, no truncation, no rotation;
#   * one `printf` per record, so a small O_APPEND write cannot be interleaved;
#   * a failed append is never swallowed (signal-set exits 8, --mark exits 1).
#
# DO NOT ADD A PROBE INTO THE ACTIVITY FEED. One existed, survived six review
# rounds, and guarded a file this script never reads — while firing on the
# ordinary path, because the daemon truncates that feed on every wake. The full
# post-mortem is in PLAN-FEATURE-003 §8b.
#
# Usage:
#   scripts/session-resume.sh                 # report (read-only)
#   scripts/session-resume.sh --mark          # close the open window, open a new one
#   scripts/session-resume.sh --rollback      # stash uncommitted work, labelled
#   scripts/session-resume.sh --root DIR      # report on another checkout
#
# Exit: 0 report complete and trusted · 9 incomplete or untrusted · 2 usage.
set -u

# BUG-019/BUG-020 — resolve the CODE's location from THIS SCRIPT's tree, never
# from cwd and never from `git rev-parse` (an exported GIT_DIR redirects that to
# whatever repository the caller was pointed at). Byte-identical to the block in
# every other state-dir consumer; tests/state-dir/ #7 pins that duplication,
# which cannot be removed because this is the code that FINDS scripts/lib/.
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
BP_STATE_ROOT="$(bp_state_root)" || exit 9

MODE="report"
# The DATA root defaults to the RESOLVED PROJECT root and is overridable. Code
# and data are resolved separately on purpose: the libs must come from the
# checkout this script belongs to, while the state being reported on may be
# another one (a fixture, or a second worktree).
#
# TASK-021: this used to be `$_bp_root`, i.e. the CODE root. Identical today;
# after the scaffolding/ split it would report on scaffolding/ — an empty
# lifecycle (0 backlog / 0 doing / 0 waiting-acceptance / 0 done) beside a
# correct GIT section, warning only about a missing snapshot marker. Half a
# report that looks whole is the failure this task exists to stop.
DATA_ROOT="$BP_STATE_ROOT"

# A HERE-DOC, not a line range out of the header. This was `sed -n '2,50p' "$0"`,
# and the header outgrew it — `--help` printed no usage at all, just commentary
# cut off mid-sentence. A doc that drifts when the file above it changes is worse
# than no doc, because it still looks like one.
usage(){
  cat <<'EOF'
session-resume.sh — where is this session, and how much of it can I see?

  session-resume.sh                 report (read-only)
  session-resume.sh --mark          close the open window, open a new one
  session-resume.sh --rollback      stash uncommitted work, labelled
  session-resume.sh --root DIR      report on another checkout

Exit: 0 complete and trusted · 9 incomplete or untrusted · 2 usage.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root)     DATA_ROOT="${2:-}"; shift 2 ;;
    --mark)     MODE="mark"; shift ;;
    --rollback) MODE="rollback"; shift ;;
    -h|--help)  usage; exit 0 ;;
    *)          echo "session-resume: unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -d "$DATA_ROOT" ] || { echo "session-resume: no such --root: $DATA_ROOT" >&2; exit 2; }
DATA_ROOT="$(cd -P "$DATA_ROOT" && pwd)"

SIGNAL="$(agent_signal_file_for "$DATA_ROOT")"
JOURNAL="$(dirname "$SIGNAL")/signal-history.log"
HANDOVER="$DATA_ROOT/docs/doing/HANDOVER.md"

# Markers are POSITIONS in an append-only file, never timestamps. The feed writes
# HH:MM:SS with no date, and this host's clock has moved BACKWARDS mid-day —
# entries stamped 19:47 sitting earlier in the file than entries stamped 14:39.
# "Everything after time T" is therefore wrong twice: it cannot span midnight and
# it mis-orders whenever the clock jumps.
OPEN_RE='^\[[^]]*\] <[0-9a-f][0-9a-f]*> '
CLOSE_RE='^\[[^]]*\] </[0-9a-f][0-9a-f]*>'

WARNINGS=0
warn(){ printf '⚠ %s\n' "$1" >&2; WARNINGS=$((WARNINGS + 1)); }

now_utc(){ date -u '+%Y-%m-%dT%H:%M:%SZ'; }

# --- marker reading ----------------------------------------------------------
# The LAST open marker, never the first: a reader that greps for "the marker" and
# takes the first hit replays the whole day and buries the live window.
open_marker_line(){ grep -nE "$OPEN_RE" "$JOURNAL" 2>/dev/null | tail -1; }
marker_id_of(){ printf '%s' "$1" | sed 's/^[0-9]*:\[[^]]*\] <//; s/>.*$//'; }

git_head(){ git -C "$DATA_ROOT" rev-parse --short HEAD 2>/dev/null || printf 'unknown'; }

# ============================================================================
# --mark — the ONE authored write, and it is not prose.
#
# Close the window that is open, then open a new one, then record the new id
# where a reader will look for it. Both journal appends and the HANDOVER id are
# done here so the two records agree by construction; the reader's disagreement
# check exists for the case where one of them was written WITHOUT the other —
# a hand-edit, or an append that failed.
# ============================================================================
if [ "$MODE" = "mark" ]; then
  mkdir -p "$(dirname "$JOURNAL")" 2>/dev/null || true

  # 8 hex characters. Enough to be unambiguous in one project's journal, short
  # enough to read aloud — this is a correlation key, not a security token.
  # No fallback: every POSIX host has /dev/urandom, and inventing an id from
  # $$ + the clock on a host that somehow lacks it is a worse answer than saying so.
  new_id="$(od -An -N4 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')"
  [ -n "$new_id" ] || { echo "FATAL: cannot read /dev/urandom to mint a snapshot id." >&2; exit 1; }

  head_sha="$(git_head)"

  # ONE APPEND, closing the old window and opening the new one together.
  #
  # BUG: this used to be two appends, which made the gap between them a place a
  # concurrent `signal-set.sh` flip could land — after `</old>`, before `<new>`.
  # An event there belongs to NO replay window: past the close of one, before the
  # open of the next. Silent, and it drops exactly what this feature exists to
  # preserve. Found by Codex R8; it is A-09's "two writers to one file" one level
  # up, and this script became the second writer.
  #
  # A lock would work and is not needed: ONE write() to a file opened O_APPEND is
  # indivisible, so no other appender can land inside it.
  #
  # BUG-079 — AND `printf '%s\n' "$roll"` IS NOT ONE WRITE. This line used to be
  # exactly that, with the comment above claiming the property it did not have.
  # `bash`'s printf builtin flushes at every newline, so a two-line roll is TWO
  # write() calls and the gap Codex R8 identified was still open — narrower, but
  # open, and still silent. Measured rather than reasoned about, both ways:
  #
  #   strace: printf '%s\n' "$roll"  →  write(1, "[ts] </aaa>\n", 12)
  #                                     write(1, "[ts] <bbb> head=x\n", 18)
  #   a competing appender at ~170 kHz over 60 marks: 36 events landed between a
  #   close and the next open, in the UNMODIFIED script (.scratch/probe-r8.sh).
  #
  # `echo`, `printf '%s\n%s\n'` and even coreutils `/usr/bin/printf` all split the
  # same way. A heredoc does not — and the SCOPE of that claim matters, because
  # the next person reasons from this comment:
  #
  #   NOT a POSIX guarantee. Nothing requires `cat` to use exactly one `write(2)`,
  #   and `/bin/sh` being dash is beside the point — the write is done by an
  #   EXTERNAL `cat`, not by the shell.
  #
  #   MEASURED HERE, on this platform, at this payload size. `bash` writes the
  #   heredoc body to a temp file before `cat` runs, so `cat` reads the whole body
  #   in one `read()` and emits one `write()`:
  #
  #     strace, cat (uutils coreutils) 0.8.0, 163-byte body:
  #       (bash)  write(4, "<body>", 163)          ← heredoc temp file
  #       (cat)   splice(0,…,1,…) = EINVAL          ← zero-copy attempt, refused
  #               read(3, …, 16384) = 163
  #               write(1, "<body>", 163)          ← ONE write
  #
  #   WHAT WOULD FALSIFY IT, and one of them is already measured: a body larger
  #   than `cat`'s read buffer splits. The same binary, same heredoc, with a 1 MiB
  #   body: 64 x write(1, …, 16384) + 1 x 13798. So the property holds because the
  #   roll is two short lines, and it stops holding the moment this payload grows
  #   past ~16 KiB. A different `cat` (GNU, busybox, toybox, macOS) has its own
  #   buffer and its own splice path, so re-measure rather than assume.
  #
  # `printf … | cat` gets this right only by luck — `cat` may read the first line
  # before the second arrives, and then it is two writes again.
  #
  # Found by TASK-018's equivalence run: the mutant that reverts this fix left
  # BOTH the shell suite and its TypeScript port green, because the shell suite
  # drove the race with a full `bash signal-set.sh` per flip — ~33 Hz against a
  # gap of microseconds. A case that cannot provoke the race it asserts is a green
  # that proves nothing, which is BUG-005's shape.
  prev="$(open_marker_line)"
  if [ -n "$prev" ]; then
    roll="$(printf '[%s] </%s>\n[%s] <%s> head=%s' \
      "$(now_utc)" "$(marker_id_of "$prev")" "$(now_utc)" "$new_id" "$head_sha")"
  else
    roll="$(printf '[%s] <%s> head=%s' "$(now_utc)" "$new_id" "$head_sha")"
  fi
  cat >>"$JOURNAL" <<EOF
$roll
EOF

  # READ THE MARKER BACK BEFORE TOUCHING HANDOVER (Codex R6-1).
  #
  # An unwritable journal used to let `--mark` exit 0 and stamp a NEW id into
  # HANDOVER.md for a window that was never opened. The next read then sees prose
  # claiming an id the journal has never heard of — the very disagreement this
  # tool reports, manufactured by the tool itself.
  #
  # HANDOVER is written only after this passes, so a refusal leaves both records
  # exactly as they were.
  if ! grep -qF "<$new_id> head=$head_sha" "$JOURNAL" 2>/dev/null; then
    echo "FATAL: the marker for <$new_id> could not be read back from $JOURNAL." >&2
    echo "  The journal is unwritable, full, or on a read-only filesystem." >&2
    echo "  HANDOVER.md was NOT updated: an id in the prose for a window the" >&2
    echo "  journal never recorded is exactly the disagreement this tool exists" >&2
    echo "  to report, and it must not be the one manufacturing it." >&2
    exit 1
  fi

  if [ -f "$HANDOVER" ]; then
    tmp="$(mktemp "${HANDOVER}.XXXXXX")"
    if grep -q 'session-marker:' "$HANDOVER"; then
      sed "s/session-marker: [0-9a-fA-F]*/session-marker: $new_id/" "$HANDOVER" >"$tmp"
    else
      { printf '<!-- session-marker: %s -->\n\n' "$new_id"; cat "$HANDOVER"; } >"$tmp"
    fi
    chmod --reference="$HANDOVER" "$tmp" 2>/dev/null || true
    mv "$tmp" "$HANDOVER"
  else
    warn "no $HANDOVER — the snapshot id has nowhere to live, so nothing can disagree with the journal and the staleness check is inert."
  fi

  echo "session-resume: snapshot <$new_id> opened at $head_sha → $JOURNAL"
  [ "$WARNINGS" -eq 0 ] || exit 9
  exit 0
fi

# ============================================================================
# --rollback — STASH, never discard.
#
# When the snapshot cannot be trusted the instinct is to roll back, and the safe
# form of that is `git stash push`, not `checkout --`. Both clear the tree; only
# one is reversible when the judgement was wrong. An untrusted snapshot is LOW
# CONFIDENCE ABOUT THE WORK, which is exactly when destroying it is least
# defensible.
#
# `-u` includes untracked files (a half-written plan is the commonest casualty)
# and deliberately not `-a`: ignored paths are logs/ and .scratch/, which are
# state rather than work.
# ============================================================================
if [ "$MODE" = "rollback" ]; then
  if ! git -C "$DATA_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    echo "session-resume: $DATA_ROOT is not a git checkout — nothing to roll back." >&2
    exit 2
  fi
  if [ -z "$(git -C "$DATA_ROOT" status --porcelain 2>/dev/null)" ]; then
    echo "session-resume: the tree is clean — nothing to stash."
    exit 0
  fi
  marker="$(open_marker_line)"
  label="untrusted snapshot"
  [ -n "$marker" ] && label="snapshot <$(marker_id_of "$marker")>"
  msg="session-resume: $label at $(git_head) — $(now_utc)"
  if git -C "$DATA_ROOT" stash push -u -m "$msg" >/dev/null 2>&1; then
    echo "session-resume: stashed as \"$msg\""
    echo "  recover with: git -C $DATA_ROOT stash pop"
    exit 0
  fi
  echo "session-resume: git stash push failed — the tree is UNCHANGED." >&2
  echo "  Nothing was discarded. Resolve by hand rather than forcing it." >&2
  exit 1
fi

# ============================================================================
# report — everything below is DERIVED at run time.
# ============================================================================
printf 'SESSION RESUME · %s · %s\n\n' "${DATA_ROOT##*/}" "$(now_utc)"

# --- git ---------------------------------------------------------------------
echo "GIT"
if git -C "$DATA_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  # git's own shorthand — `main...origin/main [ahead 1, behind 2]` — instead of
  # fourteen lines re-deriving it into prose. It is the line every developer
  # already reads, no upstream shows as a bare branch name, and a detached HEAD
  # says so itself.
  printf '  branch    %s\n' "$(git -C "$DATA_ROOT" status -sb 2>/dev/null | sed -n '1s/^## //p')"
  printf '  head      %s\n' "$(git -C "$DATA_ROOT" log -1 --format='%h  %s' 2>/dev/null || echo 'no commits')"
  dirty="$(git -C "$DATA_ROOT" status --porcelain 2>/dev/null | grep -c .)"
  if [ "${dirty:-0}" -eq 0 ]; then
    printf '  tree      clean\n'
  else
    printf '  tree      %s uncommitted path(s) — see --rollback (stashes, never discards)\n' "$dirty"
  fi
else
  printf '  (not a git checkout)\n'
fi
echo

# --- lifecycle ---------------------------------------------------------------
# Read from the folders themselves, so a row promoted by anyone — this session,
# another agent, the founder by hand — is visible on the next run without anybody
# telling this tool about it.
lifecycle_ids(){
  grep -hoE '^\|[[:space:]]*\*\*[A-Z]+-[0-9]+\*\*' "$DATA_ROOT/docs/$1"/*.md 2>/dev/null \
    | grep -oE '[A-Z]+-[0-9]+' | sort -u
}

echo "LIFECYCLE"
for state in backlog doing waiting-acceptance "done"; do
  ids="$(lifecycle_ids "$state")"
  count="$(printf '%s' "$ids" | grep -c . || true)"
  list="$(printf '%s' "$ids" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  if [ "${count:-0}" -gt 8 ]; then
    list="$(printf '%s' "$ids" | head -8 | tr '\n' ' ')+$((count - 8)) more"
  fi
  printf '  %-20s %2s  %s\n' "$state" "${count:-0}" "$list"
done
echo

# --- the live baton ----------------------------------------------------------
echo "BATON"
if [ -f "$SIGNAL" ]; then
  for row in Holder State Task 'Last update'; do
    val="$(grep -m1 "^| $row |" "$SIGNAL" 2>/dev/null | sed "s/^| $row | //; s/ |$//")"
    printf '  %-12s%s\n' "$(printf '%s' "$row" | tr '[:upper:] ' '[:lower:]-')" "${val:-(none)}"
  done
else
  printf '  (no live baton at %s — nobody has taken the mic in this checkout)\n' "$SIGNAL"
fi
echo

# --- the snapshot window -----------------------------------------------------
echo "SNAPSHOT"
marker="$(open_marker_line)"
if [ -z "$marker" ]; then
  printf '  none\n\n'
  warn "no snapshot marker found in $JOURNAL. This is a fresh clone, or the journal was lost — NOTHING is being replayed. Read git log and the lifecycle folders above instead of trusting a short replay."
else
  open_id="$(marker_id_of "$marker")"
  open_no="${marker%%:*}"
  printf '  marker    <%s>\n' "$open_id"
  printf '  opened    %s\n' "$(printf '%s' "$marker" | sed 's/^[0-9]*://')"

  # Closed-and-not-reopened: --mark always writes close-then-open, so the last
  # open marker is never closed. If it is, one of the two appends did not happen.
  if awk -v n="$open_no" 'NR>n' "$JOURNAL" 2>/dev/null | grep -qE "$CLOSE_RE"; then
    warn "snapshot <$open_id> is CLOSED and no later one was opened — the close append landed and the open did not. There is no live window."
  fi

  # Header vs journal. Two independent writes that must agree; when they do not,
  # one of them is a claim nobody backed. This is the case that went undetected
  # twice on 2026-08-05.
  if [ ! -f "$HANDOVER" ]; then
    warn "no $HANDOVER, so the journal's marker cannot be corroborated."
  else
    hid="$(grep -m1 -oE 'session-marker: [0-9a-fA-F]+' "$HANDOVER" 2>/dev/null | awk '{print $2}')"
    if [ -z "$hid" ]; then
      warn "HANDOVER.md carries no session marker while the journal's open marker is <$open_id> — the two were written independently. TRUST git and the lifecycle folders above, not the prose."
    elif [ "$hid" != "$open_id" ]; then
      # Two very different situations, and telling them apart is what keeps this
      # warning from being noise. A branch switch routinely brings in a HANDOVER
      # committed under an EARLIER marker — that id is in this journal's history,
      # the prose simply predates the live window, and one command re-syncs it.
      # An id that appears NOWHERE was written by something that never marked,
      # which is the staleness this check exists for.
      if grep -qE "^\[[^]]*\] <$hid> " "$JOURNAL" 2>/dev/null; then
        warn "HANDOVER.md carries the OLDER snapshot id <$hid>; the live window is <$open_id>. The prose predates it — that is what a branch switch looks like. Re-run 'session-resume.sh --mark' to re-sync, and until then trust git and the lifecycle folders above."
      else
        warn "HANDOVER.md says <$hid>, which appears NOWHERE in this journal, while the open marker is <$open_id>. The two were written independently, so one of them is a claim nobody backed. TRUST git and the lifecycle folders above, not the prose."
      fi
    fi
  fi

  events="$(awk -v n="$open_no" 'NR>n' "$JOURNAL" 2>/dev/null | grep -vE "$OPEN_RE|$CLOSE_RE")"
  n_events="$(printf '%s' "$events" | grep -c . || true)"
  printf '  events    %s since the marker\n\n' "${n_events:-0}"

  echo "REPLAY"
  if [ "${n_events:-0}" -eq 0 ]; then
    printf '  (no journal events since the marker)\n'
  else
    printf '%s\n' "$events" | sed 's/^/  /'
  fi
fi

echo
if [ "$WARNINGS" -gt 0 ]; then
  printf 'INCOMPLETE — %s warning(s) above. This report is not a full picture.\n' "$WARNINGS" >&2
  exit 9
fi
exit 0
