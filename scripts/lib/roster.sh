#!/usr/bin/env bash
# scripts/lib/roster.sh — the one place AGENT_ROSTER.md is parsed.
#
# BUG-010. The roster is the source of truth for who a session IS, and it is
# per-engineer and gitignored: no two fleets share persona names. So every
# reader must resolve identity from the table, keyed by ROLE, and no reader may
# carry a persona name as a literal.
#
# It went wrong in two independent ways, and both are the reason this file
# exists rather than a second grep next to the first:
#
#   1. Nothing read the roster to decide the session's own persona. The feed had
#      `persona="${AGENT_PERSONA:-<a name>}"`, so a rename was invisible and the
#      only working override was exporting AGENT_PERSONA by hand. team-kickoff
#      carried all 15 personas as a literal array — the one script whose job is
#      "confirm the roster after editing it" could not see the roster at all.
#
#   2. The single roster read that DID exist matched `"| $name |"` with literal
#      single spaces, so a column-padded table never matched. Padding is what
#      every markdown formatter emits. Worse, a miss and "no roster" produced
#      identical output, so it failed in silence — which is how it survived.
#
# Hence the three properties below, which are the contract:
#
#   - ROLE is the key, NAME is data. Renaming a cell changes one cell.
#   - Padding is tolerated everywhere. Fields are trimmed, never matched
#     positionally against a fixed-width shape.
#   - A miss WARNS on stderr. Once per distinct key per process, because a
#     warning on every emitted line is noise, and noise gets muted — which
#     leaves you exactly as blind as having no warning at all.
#
# Sourced by scripts/agent-activity.sh and scripts/team-kickoff.sh. This is the
# same "one mechanism, never two that agree only by coincidence" rule that
# scripts/lib/state-dir.sh enforces for the state directory (A-09).
#
# Usage:
#   . scripts/lib/roster.sh
#   bp_roster_file            <repo-root|file>
#   bp_roster_rows            <repo-root|file>            # role<TAB>name<TAB>backing<TAB>model
#   bp_roster_name_for_role   <repo-root|file> <role>
#   bp_roster_backing_for_name <repo-root|file> <name>
#   bp_roster_name_in_text    <repo-root|file> <free text>   # BUG-027
#   bp_roster_subagent_label  <repo-root|file> <agent-<id>.meta.json>   # BUG-124
#   bp_roster_model_for_name  <repo-root|file> <name>     # TASK-059: backing<TAB>model<TAB>effort

# --- warning memo -----------------------------------------------------------
# Deliberately a space-delimited string rather than an associative array: this
# file is sourced by scripts that must stay portable, and the memo is tiny.
_BP_ROSTER_WARNED="${_BP_ROSTER_WARNED:-}"

bp_roster_warn(){
  local key="$1" msg="$2"
  case " $_BP_ROSTER_WARNED " in *" $key "*) return 0 ;; esac
  _BP_ROSTER_WARNED="$_BP_ROSTER_WARNED $key"
  printf '[roster] %s\n' "$msg" >&2
}

# --- which file is the roster ----------------------------------------------
# The live roster is per-engineer and gitignored; the example is the tracked
# template. Prefer the personal copy, fall back to the example so a fresh clone
# still labels personas instead of printing blanks.
# BUG-075 — THE EXAMPLE ROSTER IS NOT A FALLBACK FOR THE LIVE ONE.
#
# This used to try `$src/AGENT_ROSTER.md`, then `$src/AGENT_ROSTER.example.md`,
# and return 0 either way. That converts "no live roster here" into a confident
# WRONG IDENTITY, silently:
#
#   post-move : Sylvia              <- the shipped example
#   real root : REAL-ORCHESTRATOR   <- the live roster
#   rc        : 0
#
# The live roster is per-engineer and gitignored; the example is TRACKED and
# SHIPS. So after the scaffolding/ split the example is the file sitting beside
# the code, and every persona label, every `--whoami`, and every
# `OVER_TO_<NAME>` handoff would name a template persona nobody is watching.
# That is BUG-010's shape defeating the `--whoami` instruction added to prevent
# BUG-010.
#
# Callers pass the STATE root (never the code root), and a missing live roster
# is now an error a caller must handle. The example is reachable only by naming
# it explicitly as a FILE, which is the first branch and which tests do.
bp_roster_file(){
  local src="${1:-.}"
  [ -f "$src" ] && { printf '%s' "$src"; return 0; }
  [ -f "$src/AGENT_ROSTER.md" ] && { printf '%s' "$src/AGENT_ROSTER.md"; return 0; }
  if [ -f "$src/AGENT_ROSTER.example.md" ]; then
    bp_roster_warn "example-only" \
      "no AGENT_ROSTER.md in '$src' — only the shipped AGENT_ROSTER.example.md. Copy it once: cp AGENT_ROSTER.example.md AGENT_ROSTER.md"
  fi
  return 1
}

# --- the member rows --------------------------------------------------------
# Emits one `role<TAB>name<TAB>backing<TAB>model` per member (model may be empty). ONLY the Members table is
# read: a roster carries other tables, and parsing every pipe-row would let an
# unrelated one shadow a real member — a silently wrong answer, which is the
# exact failure mode this bug was made of.
bp_roster_rows(){
  local file
  file="$(bp_roster_file "${1:-.}")" || {
    bp_roster_warn "nofile" "no AGENT_ROSTER.md or AGENT_ROSTER.example.md under '${1:-.}'"
    return 1
  }
  awk '
    function trim(s){ gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    # Any heading closes the previous section and opens this one only if it is
    # the Members table.
    /^[[:space:]]*#+[[:space:]]/ {
      in_members = ($0 ~ /^[[:space:]]*#+[[:space:]]*Members/) ? 1 : 0
      next
    }
    !in_members            { next }
    $0 !~ /^[[:space:]]*\|/ { next }
    {
      n = split($0, f, "|")
      if (n < 5) next                       # | role | name | backing | => 5 parts
      role = trim(f[2]); name = trim(f[3]); backing = trim(f[4])
      model = (n >= 6) ? trim(f[5]) : ""
      if (role == "" || name == "")  next
      if (tolower(role) == "role")   next   # header row
      if (role ~ /^[-:[:space:]]+$/) next   # separator row
      print role "\t" name "\t" backing "\t" model
    }
  ' "$file"
}

# --- role -> name -----------------------------------------------------------
# The primary resolution. `bp_roster_name_for_role . Orchestrator` is how a
# session learns its own identity.
bp_roster_name_for_role(){
  local src="${1:-.}" want="${2:-}" role name
  [ -n "$want" ] || return 1
  while IFS="$(printf '\t')" read -r role name _; do
    if [ "$(printf '%s' "$role" | tr '[:upper:]' '[:lower:]')" \
       = "$(printf '%s' "$want" | tr '[:upper:]' '[:lower:]')" ]; then
      printf '%s' "$name"; return 0
    fi
  done <<EOF
$(bp_roster_rows "$src")
EOF
  bp_roster_warn "role:${want// /_}" \
    "no '$want' row in $(bp_roster_file "$src" 2>/dev/null || echo '<no roster>') — identity unresolved"
  return 1
}

# --- free text -> the persona it names ---------------------------------------
# BUG-027. A Claude subagent's identity is NOT in its metadata: the agent TYPE
# recorded there is the same string for every persona a fleet runs, so labelling
# from it gives every dispatch one name. What DOES carry the persona is the
# human-written dispatch description, and both readers of that string — the feed,
# from a transcript's sibling meta file, and the hook, from its payload — must
# agree on how to read it. Hence one function here rather than a regex in each:
# two copies of this rule would be two rules (BUG-010, BUG-021).
#
# EARLIEST MENTION WINS, not first roster row. A description routinely names
# more than one persona — "<X> implements <Y>'s prescription" is the ordinary
# shape — and the subject comes first; resolving by table order would label the
# run with whoever happens to sit higher in the table. Wrong, and STABLY wrong,
# which is worse than a visible miss.
#
# Matching is WHOLE-NAME and boundary-checked, never substring, and never via a
# regex built from the name. Rosters commonly carry a short name that is a prefix
# of a longer one, and a bare `index()` resolves the longer to the shorter every
# time; a regex would mean escaping free text an engineer typed into a markdown
# cell. So: `index()` locates the literal name, and the characters either side of
# the hit must be non-alphanumeric (or absent) for it to count.
#
# This REPLACES tokenising the text and comparing each token to the whole name,
# which had the right instinct — no regex — and the wrong shape: a token is one
# word, so a name containing a space or punctuation could never equal one.
# `Mary Jane` and `O'Neil` silently resolved to nothing, and the Name column is
# free text that ships to every derived project, so any fleet with a two-word or
# punctuated persona got the agent type instead (BUG-027 R2-S2, cross-provider review).
#
# Two properties survive the change and are the reason for the tie-break below:
#   - EARLIEST MENTION WINS — smallest position in the text, not roster order.
#   - LONGEST NAME WINS A TIE — `Mary` and `Mary Jane` can now both match at the
#     same position with valid boundaries, which the tokenised form could not
#     produce. The longer name is the specific one.
#
# The text is passed through the environment rather than `awk -v`, which
# interprets backslash escapes in its assignment and would rewrite a description
# containing `\n` or `\t` before it was ever matched.
#
# Case-insensitive; returns nothing (rc 1) when no persona is named, which is an
# ordinary outcome and so deliberately does NOT warn.
bp_roster_name_in_text(){
  local src="${1:-.}" text="${2:-}" hit
  [ -n "$text" ] || return 1
  hit="$(bp_roster_rows "$src" 2>/dev/null | BP_ROSTER_TEXT="$text" awk -F'\t' '
    BEGIN{ hay = tolower(ENVIRON["BP_ROSTER_TEXT"]); hlen = length(hay)
           best = 0; bestlen = 0 }
    {
      name = tolower($2); nlen = length(name)
      if (nlen == 0) next
      at = 0; from = 1
      while (from <= hlen) {
        p = index(substr(hay, from), name)
        if (p == 0) break
        abs = from + p - 1
        before = (abs == 1)          ? "" : substr(hay, abs - 1, 1)
        after  = (abs + nlen > hlen) ? "" : substr(hay, abs + nlen, 1)
        if (before !~ /[[:alnum:]]/ && after !~ /[[:alnum:]]/) { at = abs; break }
        from = abs + 1
      }
      if (at == 0) next
      if (best == 0 || at < best || (at == best && nlen > bestlen)) {
        best = at; bestlen = nlen; found = $2
      }
    }
    END{ if (best > 0) print found }
  ')"
  [ -n "$hit" ] || return 1
  printf '%s' "$hit"
}

# name -> the file/agent-type slug scripts/claude-agents.sh writes it under
# (.claude/agents/<slug>.md, and Claude Code's SubagentStart payload names that
# slug as `agentType` when a persona is dispatched by name, `subagent_type:
# <slug>`). THE one slug rule, reused by claude-agents.sh so the writer and the
# reader of `.claude/agents/*.md` cannot drift apart.
bp_roster_slug(){
  printf '%s' "${1:-}" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z-'
}

# slug -> the roster Name whose slug matches it, case-insensitively (slugging
# already lowercases). rc 1 when no persona's slug matches.
bp_roster_name_for_slug(){
  local src="${1:-.}" want_slug="${2:-}" role name backing rest
  [ -n "$want_slug" ] || return 1
  while IFS="$(printf '\t')" read -r role name backing rest; do
    [ -n "$name" ] || continue
    if [ "$(bp_roster_slug "$name")" = "$want_slug" ]; then
      printf '%s' "$name"; return 0
    fi
  done <<EOF
$(bp_roster_rows "$src")
EOF
  return 1
}

# --- a Claude subagent's meta file -> its feed label (BUG-124) ---------------
# THE one way a subagent is labelled, for the streamed lines (agent-activity.sh)
# and for both hook bookends (log-activity.mts). They used to derive it apart —
# the feed from the meta file, the hook from a `description` field no real hook
# payload carries — so every bookend read `[general-purpose - Claude Code]` while
# the lines between them read the persona.
#
# Claude Code writes `agent-<id>.meta.json` beside the transcript: `description`
# (the dispatch text), `agentType`, and `parentAgentId` on a nested dispatch only.
#   1. the description names a persona  -> "<Name> - <Backing>"
#   2. else a parent can be resolved    -> "<parent who> › <type> - Claude Code"
#   3. else                             -> "<type> - Claude Code"
# (2) is how a helper a persona starts stays attributed to that persona. The
# parent is resolved by the same rules, so an unnamed chain reads
# `general-purpose › claude-code-guide`, which is honest rather than invented.
# rc 1 when the meta is unreadable or says nothing, so a caller keeps its own
# fallback. Needs jq; without it everything is empty and that is rc 1 too.
bp_roster_subagent_label(){
  local who ran
  who="$(_bp_roster_subagent_who "$1" "$2" 0)"
  case $? in
    0) bp_roster_label "$1" "$who" "$(_bp_roster_ran_model "$2")" ;;
    2)
      # $who here is a TYPE, or a parent-chain ending in one — never a roster
      # name, so there is no roster Model cell and so no effort to show: the
      # `- Claude Code` suffix was standing in for "no model known", and stayed
      # even once the transcript recorded one. Neither a meta file nor a hook
      # payload carries this agent's effort; the transcript is the only source
      # that ever will, and it doesn't carry effort — only the model.
      ran="$(_bp_roster_ran_model "$2")"
      if [ -n "$ran" ]; then printf '%s - %s' "$who" "$ran"
      else printf '%s - Claude Code' "$who"
      fi ;;
    *) return 1 ;;
  esac
}

# TASK-059: the model a subagent ACTUALLY ran on, read from its transcript beside
# the meta file. No hook payload and no meta file carries it; the transcript's
# assistant records do, once the first one is written. Empty before that, and the
# label then shows the configured alias.
_bp_roster_ran_model(){
  jq -r 'select(.type == "assistant") | .message.model // empty | select(startswith("<") | not)' \
    "${1%.meta.json}.jsonl" 2>/dev/null | head -1
}

# rc 0: a roster name. rc 2: a type, possibly prefixed by its parent. rc 1: nothing.
_bp_roster_subagent_who(){
  local src="$1" meta="$2" depth="$3" name type parent up
  [ -r "$meta" ] || return 1
  if name="$(bp_roster_name_in_text "$src" "$(jq -r '.description // empty' "$meta" 2>/dev/null)")"; then
    printf '%s' "$name"; return 0
  fi
  type="$(jq -r '.agentType // empty' "$meta" 2>/dev/null)"
  # A dispatch BY PERSONA (`subagent_type: <slug>`, TASK-059's generated
  # .claude/agents/<slug>.md) carries the persona's OWN slug as agentType, not
  # a description that happens to name them — most dispatch descriptions are
  # the task, not the persona. bp_roster_name_in_text alone therefore missed
  # this case and fell all the way to "<type> - Claude Code" with a lowercase,
  # unrostered-looking type. Check the slug before falling further.
  if [ -n "$type" ] && name="$(bp_roster_name_for_slug "$src" "$type" 2>/dev/null)"; then
    printf '%s' "$name"; return 0
  fi
  parent="$(jq -r '.parentAgentId // empty' "$meta" 2>/dev/null)"
  # The depth cap only guards against a meta file that names itself as an ancestor.
  if [ -n "$parent" ] && [ "$depth" -lt 8 ]; then
    up="$(_bp_roster_subagent_who "$src" "$(dirname "$meta")/agent-$parent.meta.json" $((depth + 1)))"
    case $? in 0|2) printf '%s › %s' "$up" "${type:-subagent}"; return 2 ;; esac
  fi
  [ -n "$type" ] || return 1
  printf '%s' "$type"; return 2
}

# --- name -> backing agent --------------------------------------------------
# The label half. The Backing agent column is free text by design (Claude Code,
# Codex, Gemini, Copilot, Qwen, …), so this returns it verbatim.
# bp_roster_label SRC NAME → "<Name> - <Backing>", or "<Name>" if unrostered.
#
# THE one way a persona is rendered into the activity feed. It lived inside
# scripts/agent-activity.sh as a local `persona_label`, which meant anything
# outside that file — notably the Codex launcher, the only place that knows who
# holds the mic for a given dispatch — had to copy it. Two copies of a rule are
# two rules: they pass their own tests and disagree in the log (BUG-021).
#
# Degrades to the bare NAME rather than failing. A feed line with no label is
# worse than an unqualified one; bp_roster_backing_for_name already warns once
# per unresolved name, so the miss is reported without being fatal.
# TASK-059: "<Name> - <model> - <effort>" once the persona has a Model cell. The
# optional third argument is the model a subagent/dispatch actually ran on,
# which wins over the configured alias — first used for a Claude subagent's own
# transcript, TASK-060 reuses it verbatim for a Codex dispatch's own session
# file rather than forking a second label rule. Deliberately NOT gated to a
# particular backing: the requested model can differ from the one that ran
# under any backing that can tell us so, and a caller that never has a "ran"
# value (nearly everyone — two-arg calls) is unaffected, because it stays
# empty and the configured alias wins exactly as before.
# The optional fourth argument likewise overrides the EFFORT actually run
# with — usually unnecessary (a dispatch typically gets the effort it asked
# for), but the session is the source of truth when it differs, same as model.
# A literal "-" for this argument means "no effort applies, and do not fall
# back to the roster requested one" — a caller cannot express that with an
# empty string, since `${4:-}` treats "not passed" and "passed empty" alike,
# and the roster fallback is the default precisely because most callers want
# it. Kimi's launcher is the first caller that must say "unknown" without
# lying: kimi has no per-invocation effort flag, so showing the roster cell
# here would assert an effort that was never applied (TASK-063 cross-provider
# review finding 3 / F-002).
# A roster with no Model cell keeps the old "<Name> - <Backing>"; an INVALID
# cell also does, and warns naming the persona.
bp_roster_label(){
  local src="${1:-.}" name="${2:-}" ran="${3:-}" ran_effort="${4:-}" backing r rc effort
  [ -n "$name" ] || return 1
  r="$(bp_roster_model_for_name "$src" "$name" 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ]; then
    [ -n "$ran" ] || ran="$(printf '%s' "$r" | cut -f2)"
    if [ "$ran_effort" = "-" ]; then
      printf '%s - %s' "$name" "$ran"
      return 0
    fi
    effort="${ran_effort:-$(printf '%s' "$r" | cut -f3)}"
    printf '%s - %s - %s' "$name" "$ran" "$effort"
    return 0
  fi
  [ "$rc" -eq 1 ] && bp_roster_warn "model:$name" "${r#\[roster\] }"
  backing="$(bp_roster_backing_for_name "$src" "$name" 2>/dev/null)"
  printf '%s%s' "$name" "${backing:+ - $backing}"
}

bp_roster_backing_for_name(){
  local src="${1:-.}" want="${2:-}" role name backing
  [ -n "$want" ] || return 1
  while IFS="$(printf '\t')" read -r role name backing _; do
    if [ "$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" \
       = "$(printf '%s' "$want" | tr '[:upper:]' '[:lower:]')" ]; then
      printf '%s' "$backing"; return 0
    fi
  done <<EOF
$(bp_roster_rows "$src")
EOF
  bp_roster_warn "name:${want// /_}" \
    "'$want' is not on $(bp_roster_file "$src" 2>/dev/null || echo '<no roster>') — labelling without a backing agent"
  return 1
}

# --- name -> model and effort (TASK-059) -------------------------------------
# The Model cell is `<tier>:<effort>`. `frontier` is the provider's best model and
# `frontier-N` is N places down that provider's ranked list, so the roster never
# names a model version and a new release needs no edit.
#
#   Codex       — the ranked list is ${CODEX_HOME:-~/.codex}/models_cache.json:
#                 visibility "list", ordered by priority ascending. The effort
#                 must be in that model's supported_reasoning_levels.
#   Claude Code — no local list. The roster carries one line, best first:
#                   Claude models, best first: fable, opus, sonnet, haiku
#                 and Claude Code resolves each family alias to its newest
#                 version. Efforts are the ones a subagent definition accepts.
#   Kimi — the roster carries one line, best first, naming the model aliases:
#                   Kimi models, best first: kimi-code/k3, kimi-code/k3-256k
#                 (order comes from the roster, not the file — Kimi's config
#                 has no priority field). **The alias is PROVIDER-QUALIFIED,
#                 because that is what `kimi -m` accepts**: `-m k3` is refused
#                 with "Model "k3" is not configured in config.toml", and
#                 `-m kimi-code/k3` runs. Measured on kimi 2.0.2 — a bare alias
#                 would have broken every dispatch while looking correct in the
#                 roster. The same string is the config key, so efforts come
#                 from `[models."<alias>"]` -> `support_efforts` in
#                 `${KIMI_CODE_HOME:-$HOME/.kimi-code}/config.toml`. An alias
#                 with no `support_efforts` key there (e.g. a non-thinking
#                 model) has nothing to resolve against and is refused.
#
# Prints `backing<TAB>model<TAB>effort`. Every failure prints an error naming the
# persona on stderr — never a silent default. rc 2 means there is nothing to
# resolve (not on the roster, no Model cell, or the Orchestrator's `session-based`
# cell — the founder picks the session model at start, so there is no tier to
# resolve); rc 1 means the cell is wrong, which includes `session-based` on any
# non-Orchestrator role.
# POSIX on purpose: the Codex wake command sources this lib under `sh`.
BP_CLAUDE_EFFORTS="low medium high xhigh max"

# Space-separated, best first, from the roster's "<Provider> models, best
# first:" line (e.g. provider "Claude" or "Kimi").
bp_roster_model_order(){
  local file provider
  file="$(bp_roster_file "${1:-.}" 2>/dev/null)" || return 1
  provider="$2"
  sed -n "s/^[[:space:]]*${provider} models, best first:[[:space:]]*//p" "$file" | head -1 | tr ',' ' '
}

# One `slug<TAB>level level …` per listed Codex model, best first.
bp_roster_codex_models(){
  local cache="${CODEX_HOME:-$HOME/.codex}/models_cache.json"
  [ -r "$cache" ] || return 1
  jq -r '[.models[] | select(.visibility == "list")] | sort_by(.priority)[]
         | .slug + "\t" + ([.supported_reasoning_levels[]? | (.effort // .)] | join(" "))' \
    "$cache" 2>/dev/null
}

# Space-separated supported efforts for one PROVIDER-QUALIFIED Kimi alias
# (e.g. "kimi-code/k3"), read from `[models."<alias>"]` -> `support_efforts` in
# config.toml. The alias is the config key verbatim, and the same string `kimi
# -m` takes. Empty/failure if the file is unreadable or the alias has no
# support_efforts key (kimi-code/kimi-for-coding-highspeed has none on this host).
bp_roster_kimi_levels(){
  local alias="$1" cfg="${KIMI_CODE_HOME:-$HOME/.kimi-code}/config.toml"
  [ -r "$cfg" ] || return 1
  awk -v want="[models.\"${alias}\"]" '
    /^\[/ { insec = ($0 == want); next }
    insec && /^support_efforts[[:space:]]*=/ {
      line = $0
      sub(/^[^=]*=[[:space:]]*/, "", line)
      gsub(/[][",]/, " ", line)
      print line
      found = 1
    }
    END { exit(found ? 0 : 1) }
  ' "$cfg"
}

bp_roster_model_for_name(){
  local src="${1:-.}" want="${2:-}" role name backing cell found="" tier effort n line model="" levels
  while IFS="$(printf '\t')" read -r role name backing cell; do
    if [ "$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" \
       = "$(printf '%s' "$want" | tr '[:upper:]' '[:lower:]')" ]; then
      found=1; break
    fi
  done <<EOF
$(bp_roster_rows "$src" 2>/dev/null)
EOF
  [ -n "$found" ] || { printf "[roster] %s: not on the roster — no model to resolve\n" "$want" >&2; return 2; }
  [ -n "$cell" ] || { printf "[roster] %s: no Model cell — no model to resolve\n" "$name" >&2; return 2; }
  if [ "$cell" = "session-based" ]; then
    if [ "$role" = "Orchestrator" ]; then
      printf "[roster] %s: Model 'session-based' — no model to resolve\n" "$name" >&2; return 2
    fi
    printf "[roster] %s: Model 'session-based' is only valid for the Orchestrator role\n" "$name" >&2; return 1
  fi
  tier="${cell%%:*}"; effort="${cell#*:}"
  case "$cell" in *:?*) ;; *) printf "[roster] %s: Model '%s' is not <tier>:<effort>\n" "$name" "$cell" >&2; return 1 ;; esac
  case "$tier" in
    frontier) n=0 ;;
    frontier-[1-9]|frontier-[1-9][0-9]) n="${tier#frontier-}" ;;
    *) printf "[roster] %s: tier '%s' is not frontier or frontier-N\n" "$name" "$tier" >&2; return 1 ;;
  esac
  case "$backing" in
    "Claude Code")
      line="$(bp_roster_model_order "$src" "Claude")"
      [ -n "$line" ] || { printf "[roster] %s: the roster has no 'Claude models, best first:' line\n" "$name" >&2; return 1; }
      # shellcheck disable=SC2086
      set -- $line
      if [ "$n" -lt "$#" ]; then shift "$n"; model="$1"; fi
      levels="$BP_CLAUDE_EFFORTS" ;;
    Codex)
      line="$(bp_roster_codex_models)"
      [ -n "$line" ] || { printf "[roster] %s: no Codex model list at %s (needs jq)\n" "$name" "${CODEX_HOME:-$HOME/.codex}/models_cache.json" >&2; return 1; }
      line="$(printf '%s\n' "$line" | sed -n "$((n + 1))p")"
      model="$(printf '%s' "$line" | cut -f1)"
      levels="$(printf '%s' "$line" | cut -f2)" ;;
    Kimi)
      line="$(bp_roster_model_order "$src" "Kimi")"
      [ -n "$line" ] || { printf "[roster] %s: the roster has no 'Kimi models, best first:' line\n" "$name" >&2; return 1; }
      # shellcheck disable=SC2086
      set -- $line
      if [ "$n" -lt "$#" ]; then shift "$n"; model="$1"; fi
      if [ -n "$model" ]; then
        levels="$(bp_roster_kimi_levels "$model")"
        [ -n "$levels" ] || { printf "[roster] %s: no support_efforts for %s in %s\n" "$name" "$model" "${KIMI_CODE_HOME:-$HOME/.kimi-code}/config.toml" >&2; return 1; }
      fi ;;
    *) printf "[roster] %s: no model list for backing agent '%s'\n" "$name" "$backing" >&2; return 1 ;;
  esac
  [ -n "$model" ] || { printf "[roster] %s: tier '%s' is past the end of the %s model list\n" "$name" "$tier" "$backing" >&2; return 1; }
  case " $levels " in
    *" $effort "*) ;;
    *) printf "[roster] %s: effort '%s' is not supported by %s (supported: %s)\n" "$name" "$effort" "$model" "$levels" >&2; return 1 ;;
  esac
  printf '%s\t%s\t%s\n' "$backing" "$model" "$effort"
}
