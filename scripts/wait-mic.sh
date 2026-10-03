#!/bin/sh
# scripts/wait-mic.sh — block until the mic moves, print it, EXIT.
#
# FEATURE-005. Arm it as a BACKGROUND task and let it notify you:
#
#   sh scripts/wait-mic.sh logs/state/signal.md      (Bash, run_in_background)
#
# WHY THIS EXISTS. The mic used to be watched by an always-on `Monitor`, and a
# dead one is indistinguishable from a quiet one. Two died in a single session
# and the founder noticed before the agent did. A-40 then established that `ps`
# cannot see those processes at all, so there is no liveness check to fall back
# on — silence is simply not evidence of anything.
#
# A waiter that EXITS turns three separate things into events the harness
# reports: the baton moved, the waiter crashed, the harness stopped it. A
# long-lived watcher only ever gives you the first. It also cannot be rate-limited
# into silence, because it emits once — 30 flips in one day is what muted the
# Monitor.
#
# WHAT THIS DOES NOT DO — narrow claim, and Alexey (Architect) required it stated
# rather than implied. It does NOT eliminate blindness. It must be RE-ARMED after
# every event, and forgetting to is silent. What would close that is a
# supervisor, and this repo has none. The gap is NARROWED, not closed: the exit
# notification and the need to re-arm arrive together, which is better than a
# death nobody is told about, and less than a guarantee.
#
# WHY POLLING AND NOT A KERNEL WAIT. The first design used inotify through Python
# ctypes — ~40 lines, and it needed a DIRECTORY watch because signal-set.sh
# publishes by atomic rename, so a watch on the inode goes deaf after one publish.
# The founder then required the system be OS-agnostic or Linux-based, which made
# it indefensible: inotify is Linux-only, `inotifywait` is not installed, and the
# only install path the blueprint then documented was a macOS-only Brewfile — a
# Linux-only dependency shipped through a macOS-only package manager. (That
# Brewfile is gone as of TASK-017, for the same reason this watcher is.)
# The property that mattered was never "do not poll", it was
# "exit is an event". A 1s sleep buys that on any POSIX box, and the rename
# subtlety disappears because content is compared rather than inodes watched.
#
# Exit: 0 the mic moved (its new value is on stdout) · 2 usage · 128+N killed by
# signal N, which is how it ends when it is NOT the mic that moved — `timeout`
# gives 124, the harness stopping the task gives a TERM. That path is not an
# error case to be tidied away, it is one of the three events this script exists
# to make visible ("the harness stopped it"), and the suite asserts 124 on every
# negative for exactly that reason.
#
# There is no other exit. `set -u` is on and `set -e` is NOT, deliberately: a
# `sleep` that fails on a bad `AGENT_WAIT_MIC_POLL` must not take the waiter down
# silently, so the loop spins and the wasted CPU is the symptom. Failing closed
# here would mean blindness, which is the one outcome this feature removes.
set -u

SIGNAL="${1:-}"
if [ -z "$SIGNAL" ]; then
  echo "usage: wait-mic.sh <path-to-signal.md>" >&2
  exit 2
fi

# Holder and State ONLY, and their VALUES — not the rendered rows.
#
# The first version compared `grep` output, so any reformatting of those lines
# read as a mic move: re-align the table, pad a column, and the agent re-arms on
# a handoff that never happened. Jesko reproduced it (S1). That is the BUG-010
# lesson exactly — a parser that matched literal single spaces failed on a
# padded table, and a miss was indistinguishable from "no roster".
#
# `Task` is excluded on purpose: it is payload, it changes on flips that do not
# move the mic, and waking on it re-arms for nothing.
#
# A READING IS ALL-OR-NOTHING: exactly one Holder row and one State row, both
# non-empty; or nothing at all.
#
# AMBIGUITY THAT CAN BE RESOLVED IS RESOLVED, NEVER REJECTED. A row's value is
# everything between the second delimiter and the last one, so a `|` inside it is
# REJOINED rather than treated as an extra column. Andreas found the real defect —
# comparing only the prefix of a split row makes two DIFFERENT values read as
# identical — but rejecting the row is the wrong cure, and Christian showed it
# introduces the very miss it was added to prevent. `signal-set.sh` escapes `|`
# in `Task` only, so `--holder 'A|B'` publishes cleanly through the only supported
# writer; refusing to read that row then blinds `State` as well, because the
# reading is all-or-nothing. `A|B`/IDLE → `A|B`/ACTIVE is a real handoff that
# reject swallows and rejoin fires on. (Reject does not even rescue the case it
# was written for: `A` → `A|B` is missed either way, since the prefix `A` is what
# reject refuses to read at all.)
#
# So: recover what the writer wrote, verbatim, and judge nothing about it. Decline
# only when the bytes cannot be recovered unambiguously — no `Holder` row, two of
# them, an empty value, a row with no closing delimiter.
#
# READABILITY, NOT VALIDITY — and that distinction is a review finding against
# the version this replaces. It also whitelisted `State` against the protocol's
# IDLE / ACTIVE / OVER_TO_*, which matches `AGENT_SIGNAL.md` exactly but makes
# this the wrong place to enforce it: `signal-set.sh` will publish ANY state, so
# a baton reading `State | DONE` is reachable, well-formed, and would leave this
# waiter silently waiting through a real handoff. Failing closed here means
# blindness, which is the one outcome this feature exists to remove. The check
# belongs on the WRITER, where it fails loudly at the point of the mistake —
# raised as its own item rather than smuggled in here.
#
# The first fix handled an absent FILE and stopped there. Jesko found the same
# defect one level in (R2): a baton that is present but not readable AS A MIC —
# a missing Holder row, two of them, a value that is only whitespace — produced a
# partial reading like `Holder= State=IDLE`, which compares unequal to a real one
# and fires. Same phantom handoff, arriving through the parser rather than
# through the file.
#
# So the rule is applied consistently instead of case by case: anything this
# cannot read as a complete mic is "cannot see the mic", and the waiter keeps
# waiting. `\r` is trimmed too, so a CRLF baton is read rather than seen as
# perpetually changing.
mic() {
  awk -F'|' '
    /^\| *Holder *\|/ { if (NF < 4) bad = 1; h = $3; for (i = 4; i < NF; i++) h = h "|" $i; nh++ }
    /^\| *State *\|/  { if (NF < 4) bad = 1; s = $3; for (i = 4; i < NF; i++) s = s "|" $i; ns++ }
    END {
      gsub(/^[ \t\r]+|[ \t\r]+$/, "", h)
      gsub(/^[ \t\r]+|[ \t\r]+$/, "", s)
      if (!bad && nh == 1 && ns == 1 && h != "" && s != "") printf "Holder=%s State=%s", h, s
    }
  ' "$SIGNAL" 2>/dev/null
}

# Poll cadence. 1s is latency, not correctness — nothing here depends on the
# interval, only on comparing two readings — so the suite runs it fast rather
# than spending 24s of gate on sleeps that assert nothing by being long.
#
# Precedent: `AGENT_SIGNAL_SETTLE` in the dispatcher. The difference worth noting
# is that settle is a real timing parameter and was deliberately kept at integer
# seconds so tests could not change production timing for convenience; this one
# changes nothing but how often a comparison happens.
POLL="${AGENT_WAIT_MIC_POLL:-1}"

# An EMPTY read from mic() is "cannot see the mic", never "the mic moved" — which
# is why the loop below tests `-n "$cur"` before it tests for a difference.
#
# Deleting the baton used to exit 0 and print an empty MIC — a phantom handoff,
# which is worse than the blindness this replaces: silence is merely uninformed,
# but a false handoff makes the agent act. A baton that is absent, unreadable or
# malformed is simply not a handoff, so keep waiting.
#
# The converse IS a real event and fires: an empty `prev` becoming a real value
# is a fresh checkout seeding its baton, and that is the mic moving.
prev="$(mic)"
while :; do
  cur="$(mic)"
  if [ -n "$cur" ] && [ "$cur" != "$prev" ]; then
    break
  fi
  sleep "$POLL"
done

printf 'MIC: %s\n' "$cur"
