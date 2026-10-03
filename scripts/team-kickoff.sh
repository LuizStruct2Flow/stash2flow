#!/usr/bin/env bash
# Team kick-off ceremony: round-robin the mic through every roster persona. Each
# claims the mic (Holder=<persona>, State=ACTIVE per ACTIVE-on-claim), presents
# itself, then hands to the next (OVER_TO_<NEXT>). Paced so the activity feed
# captures each. Ends back at the Orchestrator / OVER_TO_USER. Drives the real
# AGENT_SIGNAL.md baton.
#
# Usage:
#   bash scripts/team-kickoff.sh             # the real ceremony
#   bash scripts/team-kickoff.sh --dry-run   # print the sequence, touch nothing
#
# BUG-010 — why this reads the roster instead of listing the team.
#
# This script's documented job (CLAUDE.md) is "confirm the roster after editing
# it", and it was the one script that could not see the roster: all 15 personas
# were a literal array. So editing AGENT_ROSTER.md changed nothing here, and the
# ceremony wrote the SHIPPED EXAMPLE's names into the live baton — actively
# undoing the rename it was supposed to confirm. The roster is per-engineer and
# gitignored precisely because no two fleets share names, and this file is in
# the managed set, so those literals shipped to every derived project. Same class
# as BUG-002 and BUG-009.
#
# Now: the roster is the source of truth, ROLE is the key, and the introductions
# below are keyed by role. A rename is one cell. The intros are also generic on
# purpose — they used to name one project's domain ("the editor", "the v2
# pipeline", "CDK", "DSGVO"), which is the same contamination in prose form.
set -uo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/state-dir.sh
BP_CODE_ROOT="$repo_root"
. "$repo_root/scripts/lib/state-dir.sh"
BP_STATE_ROOT="$(bp_state_root)" || exit 9
# BUG-019: the LIVE baton is untracked state, resolved through the one shared
# helper. Reading the tracked AGENT_SIGNAL.md here would read protocol prose,
# and — worse, before the split — a file git rewrites under a live dispatch.
sig="$(agent_signal_file)"

# shellcheck source=scripts/lib/roster.sh
. "$repo_root/scripts/lib/roster.sh"

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

# Pacing, so the activity feed has time to capture each move. Overridable so the
# regression test does not have to sleep through the ceremony (BUG-005: the gate
# has a hard 30 s ceiling and no slack to give).
CLAIM_PAUSE="${AGENT_KICKOFF_CLAIM_PAUSE:-3}"
HANDOFF_PAUSE="${AGENT_KICKOFF_HANDOFF_PAUSE:-2}"

# --- introductions, keyed by ROLE ------------------------------------------
# A role with a numeric suffix (Front-End-1, QA-2) shares its base role's line,
# so adding a third back-end needs no edit here. An unknown role still gets a
# usable introduction rather than an empty one — the roster is the team's to
# define, and this script must not constrain which roles may exist.
intro_for_role(){
  local role="$1" base
  base="$(printf '%s' "$role" | sed 's/-[0-9]\+$//')"
  case "$(printf '%s' "$base" | tr '[:upper:]' '[:lower:]')" in
    orchestrator)      echo "Orchestrator. I coordinate the team: dispatch, handoffs, integration. Opening the floor, passing the mic round the table." ;;
    po)                echo "PO. I own the backlog, the priorities, and what 'done' means for the customer." ;;
    ba)                echo "BA. I turn fuzzy impulses into clear requirements and acceptance criteria." ;;
    architect)         echo "Architect. I own the system shape, detail the designs, and keep them consistent." ;;
    ux)                echo "UX. I own the flows, the editorial style, and that the output delights." ;;
    front-end)         echo "Front-End. I build the user-facing surfaces: components, state, and polish." ;;
    back-end)          echo "Back-End. I own the domain logic, the data, and the APIs." ;;
    qa)                echo "QA. Reproducers first, regression tests, the two-commit gate, acceptance." ;;
    security)          echo "Security. Secrets, SAST, SCA, the posture stack, and the threat model." ;;
    infrastructure|infra) echo "Infra. IaC, the pipeline, observability, drift, cost, rollback." ;;
    *)                 echo "$role. I cover this team's $role work." ;;
  esac
}

# Set Holder/State/Task in one shot (values passed as argv, so no quoting hazards).
step(){
  if [ "$DRY_RUN" = "1" ]; then
    printf '%-28s %-16s %s\n' "$1" "$2" "$3"
    return 0
  fi
  python3 - "$sig" "$1" "$2" "$3" <<'PY'
import sys,re
f,h,s,t=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4]
x=open(f).read()
for field,val in (("Holder",h),("State",s),("Task",t)):
    x=re.sub(r'(\| '+field+r' \| ).*?( \|)', lambda m: m.group(1)+val+m.group(2), x, count=1)
open(f,'w').write(x)
PY
}

pause(){ [ "$DRY_RUN" = "1" ] || sleep "$1"; }

# --- read the team ----------------------------------------------------------
roles=(); names=()
while IFS="$(printf '\t')" read -r role name _; do
  [ -n "$name" ] || continue
  roles+=("$role"); names+=("$name")
done < <(bp_roster_rows "$BP_STATE_ROOT")

n=${#names[@]}
if [ "$n" -eq 0 ]; then
  echo "[team-kickoff] no members found in $(bp_roster_file "$BP_STATE_ROOT" 2>/dev/null || echo '<no roster>')" >&2
  echo "[team-kickoff] copy AGENT_ROSTER.example.md to AGENT_ROSTER.md and edit it." >&2
  exit 1
fi

orchestrator="$(bp_roster_name_for_role "$BP_STATE_ROOT" Orchestrator)"
[ -n "$orchestrator" ] || orchestrator="${names[0]}"

for i in $(seq 0 $((n-1))); do
  name="${names[$i]}"
  step "$name" ACTIVE "KICK-OFF: $(intro_for_role "${roles[$i]}")"
  pause "$CLAIM_PAUSE"
  if [ "$i" -lt $((n-1)) ]; then
    next="${names[$((i+1))]}"
    NEXT=$(printf '%s' "$next" | tr '[:lower:]' '[:upper:]')
    step "$name" "OVER_TO_$NEXT" "Thanks. Handing the mic to $next."
    pause "$HANDOFF_PAUSE"
  fi
done

step "$orchestrator" OVER_TO_USER "Team kick-off complete: all $n personas presented and the mic travelled the full table. $orchestrator (Orchestrator) holding; mic to founder."
echo "[team-kickoff] done — $n personas from $(bp_roster_file "$BP_STATE_ROOT" 2>/dev/null)"
