#!/bin/sh
# scripts/run-ts-suites.sh — run the TypeScript suites as ONE vitest process,
# and render them as one pipeline stage per suite.
#
# WHY THIS EXISTS. TASK-018 has two requirements that pull against each other:
#
#   - Parallelism is the point. Forty-two separate `vitest run` invocations means
#     forty-two Node startups and discards it entirely.
#   - The gate must still list every suite. `bootstrap-gate` #3 requires a
#     derived project's gate to pass >= 25 stages as an explicit non-vacuity
#     guard, and the SLO's slowest-stage line has to name something actionable —
#     `slowest: vitest 200s` names nothing (PLAN-TASK-018 §7.3).
#
# So one process runs, and its per-file results are injected as individual
# stages through pipeline.sh's batch API.
#
# THE DECLARATION COMES FROM THE FILESYSTEM, NOT FROM VITEST.
#
# This is the load-bearing detail, and Philipp stated the residual risk plainly
# when building the API: if the expected set were derived from the runner's own
# output, every guard would reduce to trusting the runner. A suite silently
# dropped from vitest's include glob would then vanish with the gate still
# green — BUG-005 exactly, and the same door TASK-018 §7.1 closed in the
# manifest.
#
# It used to come from tests/SUITES.md. TASK-020 deleted that table (R1: a
# second description of a test is a copy that drifts), and the expected set is
# now the `*.spec.ts` files on disk, via `scripts/lib/suites.sh`. That is not a
# weaker source, it is the same property from a better one: `find` consults no
# vitest config, no include glob and no reporter, so the runner cannot edit what
# it is being checked against. The filesystem owns the list, vitest reports
# against it, and a declared suite that does not report FAILS BY NAME.
#
# Usage (from .githooks/pre-push-project, with pipeline.sh already sourced):
#   . scripts/run-ts-suites.sh
#   ts_suites_stage
#
# Exit: 0 when every declared suite reported success, non-zero otherwise. The
# caller does not need to inspect it — failures land in the pipeline tally.

# ts_suites_present — is there anything to run at all?
#
# A project mid-migration, or one that has not installed the toolchain, must get
# a truthful skip rather than a failure. Mirrors tests/manifest's own no-Node
# property: the shell half of this repo keeps working with zero TS present.
ts_suites_present(){
  # TASK-020: the harness manifest lives UNDER tests/, which is a managed
  # directory no derived project owns a copy of — so the toolchain travels by
  # both propagation paths or by neither, and it can never clobber a project's
  # own root package.json.
  [ -f "${1:-.}/tests/vitest.config.ts" ] || return 1
  [ -n "$(find "${1:-.}/tests" -type f -name '*.spec.ts' -print -quit 2>/dev/null)" ]
}

# ts_declared_suites ROOT — the suite names that own a *.spec.ts.
#
# Delegates to scripts/lib/suites.sh. This function used to carry its own copy
# of the suite lookup, under a comment claiming "two parsers of one table drift,
# and this file exists to be the thing that cannot" — while being the second
# parser. Vitali (QA-1) caught it, and it was already drifting. The rule did not
# change when the source did: a second `find` here would be a second answer to
# "what are the suites", which is the whole hazard.
ts_declared_suites(){
  _tsd_root="${1:-.}"
  if [ -r "$_tsd_root/scripts/lib/suites.sh" ]; then
    # shellcheck source=scripts/lib/suites.sh
    . "$_tsd_root/scripts/lib/suites.sh"
    bp_suites_with_spec "$_tsd_root"
  fi
}

# ts_release_suites ROOT — the release-tier suites (TASK-054), from the same
# library.
ts_release_suites(){
  _tsr_root="${1:-.}"
  if [ -r "$_tsr_root/scripts/lib/suites.sh" ]; then
    # shellcheck source=scripts/lib/suites.sh
    . "$_tsr_root/scripts/lib/suites.sh"
    bp_release_suites "$_tsr_root"
  fi
}

# ts_scrubbed CMD... — run CMD in a subshell with the population the TypeScript
# harness refuses removed: every GIT_*, AGENT_* and BP_* name, and BLUEPRINT_ROOT.
#
# BUG-117 — THIS IS THE ONE SCRUB, and both execution modes go through it: the
# gate's stage below, and the ts-tests step in .github/workflows/security.yml,
# which sources this file. That step used to run `npx vitest run` directly, so it
# inherited the runner's environment — GitHub-hosted runners export
# AGENT_TOOLSDIRECTORY — and the harness refused 697 of 770 tests on CI while the
# gate stayed green. A second copy of the unset population in the workflow would
# have been a second scrub to drift; tests/ts-bridge #3 executes the workflow's
# own step to prove it reaches this one.
#
# By PREFIX rather than by list, for the reason the stage's comment gives: the
# harness forbids every undeclared GIT_* / AGENT_* name (isForbiddenAmbient), and
# restating that here would be a copy that drifts. BLUEPRINT_ROOT is the one
# declared hazard outside the prefixes; tests/ts-bridge #1c imports
# UNPREFIXED_FORBIDDEN to pin that the two agree.
ts_scrubbed(){
  # TASK-083 — every dispatched agent's launcher now sets TMPDIR to a path
  # under the repo it runs in (so mktemp/os.tmpdir() land in .scratch/ instead
  # of the shared /tmp). tests/harness/workspace.ts refuses to create ANY
  # scenario workspace while a project marker (.git and friends, BUG-110) sits
  # above TMPDIR — correctly, that refusal is what stops a stray marker from
  # silently becoming every fixture's "project root" — so an explicit,
  # git-tree TMPDIR made every TS suite fail before it could run at all.
  #
  # This is the one place to fix it: ts_scrubbed is already the sole choke
  # point both `npm test`/`test:watch` and CI's ts-tests step go through
  # (BUG-117), so redirecting here reaches every caller without a second copy
  # of the check, and it changes nothing about workspace.ts's own refusal
  # (BUG-110 stays exactly as strict for anyone who calls it directly).
  #
  # ONLY TMPDIR changes, and ONLY FOR THIS INVOCATION: every other tool the
  # agent runs still sees the repo-local TMPDIR TASK-083 set. No launcher and
  # no ambient state is touched.
  if [ -n "${TMPDIR:-}" ] && _ts_tmpdir_has_marker_above "$TMPDIR"; then
    _ts_old_tmpdir=$TMPDIR
    _ts_new_tmpdir=''
    # /dev/shm is Linux tmpfs, not the shared /tmp BUG-121 fled — cleaned up
    # below on every exit path, so nothing accumulates there either. It is
    # absent on macOS (this script ships to every project), where the redirect
    # goes to a fresh 0700 directory under the user's cache home instead
    # (TASK-087). Unsetting TMPDIR was no redirect at all: a command that
    # builds "$TMPDIR/x" got "/x".
    if [ -d /dev/shm ] && [ -w /dev/shm ]; then
      _ts_new_tmpdir=$(mktemp -d /dev/shm/bp-ts-suites.XXXXXX 2>/dev/null) || _ts_new_tmpdir=''
    fi
    if [ -z "$_ts_new_tmpdir" ]; then
      _ts_cache=$(_ts_private_tmp_parent) || _ts_cache=''
      if [ -n "$_ts_cache" ]; then
        _ts_new_tmpdir=$(mktemp -d "$_ts_cache/bp-ts-suites.XXXXXX" 2>/dev/null) || _ts_new_tmpdir=''
      fi
    fi
    # TMPDIR is set (or unset) only inside the child subshells below, never in
    # this function's own shell: ts_scrubbed is sourced, so assigning it here
    # changed the caller's TMPDIR for good, and once the redirected directory
    # was removed every later call passed on a TMPDIR naming nothing.
    if [ -n "$_ts_new_tmpdir" ]; then
      chmod 700 "$_ts_new_tmpdir"
      _ts_new_tmpdir_desc=$_ts_new_tmpdir
    else
      _ts_new_tmpdir_desc='(unset — falling back to the harness private base)'
    fi
    # NEVER SILENT: whichever branch fired, this run's TMPDIR differs from
    # what the launcher set, and that is worth a line every time, not only
    # when something goes wrong.
    printf 'run-ts-suites: TMPDIR=%s sits inside a git tree, which the TS harness refuses (BUG-110); using TMPDIR=%s for this run instead (TASK-083 sets TMPDIR to a repo path for every dispatched agent).\n' \
      "$_ts_old_tmpdir" "$_ts_new_tmpdir_desc" >&2
    # A child runs here, not `exec`: `exec` would replace THIS shell, so the
    # `rm -rf` below would never run and the redirected dir would leak on
    # every invocation. Signals too — INT/TERM/HUP would otherwise kill this
    # shell before cleanup, same leak, so they are trapped and cleaned up
    # before being re-raised.
    #
    # THE TRAPS LIVE IN A SUBSHELL, NEVER IN THIS FUNCTION'S OWN SHELL.
    # ts_scrubbed is sourced, so this function runs in the CALLER's shell —
    # `trap ... SIGNAL` set here would overwrite whatever trap that caller had
    # already installed for its own reasons, and the later `trap - INT TERM
    # HUP` would then discard it for good. Every caller today happens to be a
    # fresh shell with no trap of its own, which is exactly why this went
    # unnoticed: a sourced library must not assume that. Wrapping the whole
    # thing in `( … )` gives the traps their own, disposable shell — the
    # caller's trap table is untouched no matter what this does.
    if [ -n "$_ts_new_tmpdir" ]; then
      (
        TMPDIR=$_ts_new_tmpdir
        export TMPDIR
        trap '_ts_tmpdir_sig_cleanup INT' INT
        trap '_ts_tmpdir_sig_cleanup TERM' TERM
        trap '_ts_tmpdir_sig_cleanup HUP' HUP
        _ts_rc=0
        ( _ts_scrub_env; exec "$@" ) || _ts_rc=$?
        trap - INT TERM HUP
        rm -rf "$_ts_new_tmpdir"
        exit "$_ts_rc"
      )
      return $?
    fi
    ( unset TMPDIR; _ts_scrub_env; exec "$@" )
    return $?
  fi
  ( _ts_scrub_env; exec "$@" )
}

# _ts_private_tmp_parent — print where a redirected TMPDIR is created when
# there is no /dev/shm (TASK-087), or print nothing and return 1.
#
# ${XDG_CACHE_HOME:-$HOME/.cache} (a2bp-allow: the user's cache home, per-user, not per-project state),
# the parent tests/harness/workspace.ts gives
# its own private base: per-user, where /tmp is shared (BUG-121). Created 0700
# if missing. Refused when it is not absolute or a project marker sits above it
# (a home that is itself a checkout would hand back the very TMPDIR this
# redirect replaces), checked on the path as named and again on the physical
# one. Call it in a command substitution: it changes directory.
_ts_private_tmp_parent(){
  _tpp_dir=${XDG_CACHE_HOME:-${HOME:+$HOME/.cache}}  # a2bp-allow: the user's cache home, per-user, not per-project state
  case $_tpp_dir in
    (/*) ;;
    (*) return 1 ;;
  esac
  if _ts_tmpdir_has_marker_above "$_tpp_dir"; then return 1; fi
  ( umask 077 && mkdir -p "$_tpp_dir" ) 2>/dev/null || return 1
  _tpp_dir=$(cd "$_tpp_dir" 2>/dev/null && pwd -P) || return 1
  if _ts_tmpdir_has_marker_above "$_tpp_dir"; then return 1; fi
  [ -w "$_tpp_dir" ] || return 1
  printf '%s\n' "$_tpp_dir"
}

# _ts_tmpdir_sig_cleanup SIGNAL — remove this invocation's redirected TMPDIR,
# restore the signal's default disposition, then re-raise it via `$$`. `$$` is
# fixed at the top-level shell's pid for the lifetime of the process, even
# from inside the subshell this runs in (measured: dash does not rebind it per
# fork) — which is exactly the process a caller is watching, so re-raising
# against it is what makes the caller's own process actually die BY THE
# SIGNAL (not merely exit with a 128+n code), the way an interrupted run is
# expected to.

_ts_tmpdir_sig_cleanup(){
  trap - INT TERM HUP
  rm -rf "$_ts_new_tmpdir"
  kill "-$1" "$$"
}

# _ts_tmpdir_has_marker_above DIR — true if DIR or any ancestor carries a
# project marker. The same set tests/harness/workspace.ts's
# refuseProjectMarkerAbove walks (BUG-110): a second, drifting copy of that
# list would be exactly the hazard TASK-020/R1 removed elsewhere in this file.
_ts_tmpdir_has_marker_above(){
  _tthma_dir=$1
  while :; do
    for _tthma_marker in .git .blueprint-root .blueprint-source; do
      [ -e "$_tthma_dir/$_tthma_marker" ] && return 0
    done
    _tthma_parent=$(dirname "$_tthma_dir")
    [ "$_tthma_parent" = "$_tthma_dir" ] && return 1
    _tthma_dir=$_tthma_parent
  done
}

# _ts_scrub_env — the scrub itself, for a subshell that runs more than one
# command under it: sh_lint lists files with git and then starts ShellCheck, and
# both must see the scrubbed environment. It unsets in the CURRENT shell, so call
# it inside a subshell.
_ts_scrub_env(){
  for _v in $(env | sed -nE 's/^((GIT|AGENT|BP)_[A-Za-z0-9_]*)=.*/\1/p'); do
    unset "$_v"
  done
  unset BLUEPRINT_ROOT
}

# --- TASK-033: ShellCheck ----------------------------------------------------
#
# The shipped scripts carried `# shellcheck` directives as if they were linted,
# and nothing installed ShellCheck or ran it. Measured on 2026-09-15 with
# ShellCheck 0.10.0: 25 warnings across the 45 scripts this derives, 0 errors.
# They were fixed or disabled with a reason before this stage existed.
#
# THE SEVERITY IS WARNING. A warning is ShellCheck saying a script probably
# misbehaves: an unused or misspelt variable, a brace or `done` parsed as
# something else, a masked return value. Info and style are advice about idiom
# (266 of those in the same scripts). A stage that fails on advice is one people
# learn to route around, and ERROR alone would have passed all 25 real findings.
# Never lower it to make the stage pass; fix the finding, or disable it inline
# with a reason.
#
# ShellCheck is required on every machine that pushes (founder decision,
# 2026-09-15). scripts/install-toolchain.sh installs it on macOS and Linux.

# sh_lint_files [ROOT] — the scripts to lint, one repo-relative path per line.
#
# DERIVED, never listed: every file git TRACKS under scripts/ or .githooks/ that
# is shell by extension (.sh) or by shebang (sh, bash, dash). Tracked, because an
# untracked file ships nowhere. Those two directories, because they are the
# shipped scripts; tests/ holds fixtures and ShellCheck cannot lint heredocs
# inside TypeScript anyway. Returns 1 only when git cannot list the tree, so a
# broken listing cannot read as "nothing to lint".
#
# The shebang test is an `if`, not `grep && printf`. The hook runs under `set -e`,
# and a loop whose LAST file is not shell would otherwise end with grep's 1 and
# kill the listing before `return 0`. The stage then reported "cannot list" for
# a healthy tree. tests/ts-bridge #6d found it with a text file sorting last;
# this repo was passing only because its last tracked script is a .sh.
sh_lint_files(){
  _slf_root="${1:-.}"
  _slf_tracked="$(git -C "$_slf_root" -c core.quotePath=false ls-files -- scripts .githooks)" || return 1
  printf '%s\n' "$_slf_tracked" | while IFS= read -r _slf; do
    case "$_slf" in
      '') ;;
      *.sh) printf '%s\n' "$_slf" ;;
      *)
        if head -n 1 "$_slf_root/$_slf" 2>/dev/null | grep -Eq '^#!.*[/ ](sh|bash|dash)([[:space:]]|$)'; then
          printf '%s\n' "$_slf"
        fi
        ;;
    esac
  done
  return 0
}

# sh_lint [ROOT] — THE ONE LINT COMMAND. The gate's stage below and the shell
# lint step in .github/workflows/security.yml both call it, and tests/ts-bridge
# #6d and #7 execute both. Listing and linting run under one scrub, so an
# exported GIT_DIR cannot point `git ls-files` at another repository.
sh_lint(){
  (
    _ts_scrub_env
    cd "${1:-.}" || exit 1
    if ! _sl_list="$(sh_lint_files .)"; then
      echo "cannot list the tracked files under scripts/ and .githooks/ (not a git work tree?)"
      exit 1
    fi
    if [ -z "$_sl_list" ]; then
      echo "no tracked shell scripts under scripts/ or .githooks/, so there is nothing to lint"
      exit 0
    fi
    set --
    while IFS= read -r _sl_f; do
      set -- "$@" "$_sl_f"
    done <<EOF
$_sl_list
EOF
    exec shellcheck --severity=warning -- "$@"
  )
}

# sh_lint_stage [ROOT] — the gate's shell lint stage. It BLOCKS when ShellCheck
# is missing, and prints how to install it: a skip would be a green gate over a
# lint that never ran, the rule the typecheck stage applies to a missing compiler.
sh_lint_stage(){
  _sl_root="${1:-$(pwd)}"
  if ! command -v shellcheck >/dev/null 2>&1; then
    echo "❌ ShellCheck is not installed, so the shell scripts cannot be linted."
    echo "   Install it, then push again:"
    echo ""
    echo "       bash scripts/install-toolchain.sh"
    echo ""
    echo "   (macOS: it runs brew install shellcheck. Linux: it installs a pinned release into ~/.local/bin.)"
    pipe_stage "shellcheck · TASK-033" false
    return 1
  fi
  pipe_stage "shellcheck · TASK-033" sh_lint "$_sl_root"
  ts_shell_inventory_stage "$_sl_root"
}

# --- TASK-067: the shell inventory gate --------------------------------------
#
# "A shell file" = what sh_lint_files lists, reused rather than redefined.
# Hooked in HERE — sh_lint_stage is already called by every project's gate
# through this exempt file — rather than by adding a call to
# .githooks/pre-push-project, which is itself a legacy shell file this rule
# would then force a migration of just to wire in its own enforcement. CI gets
# its own step calling ts_shell_inventory (the raw command, matching how its
# neighbouring "Blueprint shell lint" and "Blueprint TypeScript typecheck"
# steps call sh_lint / ts_typecheck rather than the *_stage wrappers, since
# pipeline.sh's pipe_stage/pipe_skip are not sourced there) — see
# .github/workflows/security.yml's "Blueprint shell inventory" step.
#
# BLUEPRINT-ONLY BY THE CHECK ITSELF, not by the call site: downstream,
# managed scripts are placeholder-substituted, so every legacy blob sha would
# differ from what this repo recorded, and scripts/shell-inventory.json /
# scripts/shell-inventory-check.mts are export-ignore'd besides. A project
# with no .blueprint-root just SKIPS, which is a real answer here (its own
# shell is its own decision), not a gap this repo needs to cover.
ts_shell_inventory_stage(){
  _si_root="${1:-$(pwd)}"
  if [ ! -f "$_si_root/.blueprint-root" ]; then
    pipe_skip "shell-inventory · TASK-067" "blueprint-only: no .blueprint-root here"
    return 0
  fi
  if [ ! -f "$_si_root/scripts/shell-inventory-check.mts" ] || [ ! -f "$_si_root/scripts/shell-inventory.json" ]; then
    pipe_skip "shell-inventory · TASK-067" "scripts/shell-inventory-check.mts or scripts/shell-inventory.json absent"
    return 0
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "❌ The shell inventory check needs node (>=22.18, native type stripping) on PATH."
    pipe_stage "shell-inventory · TASK-067" false
    return 1
  fi
  pipe_stage "shell-inventory · TASK-067" ts_shell_inventory "$_si_root" "$(command -v node)"
}

# ts_shell_inventory_base [ROOT] — the BASE ref the checker compares
# scripts/shell-inventory.json against, so the pushed range itself can never
# author the ground truth it is judged by (Elias, Codex, four-eyes review of
# 7a060d1/8b5a68b).
#
# Resolved HERE, in shell, BEFORE ts_scrubbed's environment scrub — same
# reasoning as ts_typecheck resolving tsc's path early: the scrub removes
# every BP_*/GIT_*/AGENT_* name, and BP_SHELL_INVENTORY_BASE (CI's hook for
# `github.event.before`) is exactly such a name.
#
#   1. BP_SHELL_INVENTORY_BASE, if set and not the all-zero "new ref" sha —
#      CI sets this from `github.event.before` (see security.yml's
#      "Blueprint shell inventory" step). The all-zero case (a brand-new
#      branch on a push event, or an empty value on a pull_request event,
#      where GitHub sets no `before` at all) is handled explicitly by falling
#      through rather than trusting it.
#   2. `@{u}` — the current branch's upstream. In the ordinary case (push to
#      the branch you track) this IS the push's remote sha.
#   3. `origin/main` — a local branch with no upstream yet.
#
# Prints the resolved ref on stdout; prints nothing and returns 1 if none of
# the three resolves, which the caller must treat as FAIL CLOSED (refuse to
# run the check at all, never fall back to judging the tree against itself).
ts_shell_inventory_base(){
  _sib_root="${1:-.}"
  _sib_zero="0000000000000000000000000000000000000000"
  if [ -n "${BP_SHELL_INVENTORY_BASE:-}" ] && [ "$BP_SHELL_INVENTORY_BASE" != "$_sib_zero" ]; then
    if git -C "$_sib_root" rev-parse --verify --quiet "${BP_SHELL_INVENTORY_BASE}^{commit}" >/dev/null 2>&1; then
      printf '%s\n' "$BP_SHELL_INVENTORY_BASE"
      return 0
    fi
    echo "shell-inventory: BP_SHELL_INVENTORY_BASE=$BP_SHELL_INVENTORY_BASE does not resolve to a commit here — falling back" >&2
  elif [ -n "${BP_SHELL_INVENTORY_BASE:-}" ]; then
    echo "shell-inventory: BP_SHELL_INVENTORY_BASE is the all-zero ref (a brand-new ref) — falling back" >&2
  fi
  _sib_up="$(git -C "$_sib_root" rev-parse --verify --quiet '@{u}' 2>/dev/null)"
  if [ -n "$_sib_up" ]; then
    printf '%s\n' "$_sib_up"
    return 0
  fi
  _sib_om="$(git -C "$_sib_root" rev-parse --verify --quiet origin/main 2>/dev/null)"
  if [ -n "$_sib_om" ]; then
    echo "shell-inventory: no upstream and no explicit base — using origin/main" >&2
    printf '%s\n' "$_sib_om"
    return 0
  fi
  echo "shell-inventory: cannot resolve a base ref (no BP_SHELL_INVENTORY_BASE, no @{u}, no origin/main)" >&2
  return 1
}

# ts_shell_inventory ROOT NODE — the command itself. NODE is resolved by the
# caller, before ts_scrubbed's environment scrub, matching ts_typecheck's own
# reasoning for resolving tsc's path early.
ts_shell_inventory(){
  _sinv_root="${1:-.}"
  _sinv_node="$2"
  _sinv_base="$(ts_shell_inventory_base "$_sinv_root")" || {
    echo "❌ shell inventory: no base ref — refusing to judge scripts/shell-inventory.json against itself (see above)"
    return 1
  }
  sh_lint_files "$_sinv_root" | ts_scrubbed "$_sinv_node" "$_sinv_root/scripts/shell-inventory-check.mts" "$_sinv_root" "$_sinv_base"
}

# ts_typecheck [ROOT] — TASK-031. `tsc --noEmit -p ROOT/tests` with the PINNED
# compiler, started through ts_scrubbed.
#
# THIS IS THE ONE TYPECHECK COMMAND. The gate's stage below calls it, and so does
# the typecheck step in .github/workflows/security.yml, which sources this file:
# BUG-117's lesson applied before the two modes could diverge, not after.
# tests/ts-bridge #4d and #5 execute both to prove it.
#
# WHY IT EXISTS: vitest strips types without checking them, so a green suite set
# says nothing about types. Two tsc errors sat on main until BUG-119, and
# tests/tsconfig.json's exactOptionalPropertyTypes was enforced by nobody.
#
# The binary PATH, not `npx tsc`: npx answers a missing local compiler by
# fetching one, which is an unpinned package installed mid-push (see the vitest
# stage's tests/node_modules guard). The path is resolved BEFORE the scrub, so
# the scrub cannot remove anything the path depends on.
#
# TASK-067 — A SECOND PROJECT, `-p scripts`, runs after `tests` with the SAME
# pinned compiler, when scripts/tsconfig.json exists. No new toolchain: the
# review synthesis borrows @types/node from tests/node_modules rather than
# giving scripts/ its own package.json (see scripts/tsconfig.json's own
# comment for why). A project with no scripts/tsconfig.json yet (every project
# before this commit lands) runs the first project only, unchanged.
ts_typecheck(){
  _tt_root="${1:-.}"
  ts_scrubbed "$_tt_root/tests/node_modules/.bin/tsc" --noEmit -p "$_tt_root/tests" || return 1
  # `-p scripts` needs at least one *.mts for `tsc`'s "include" glob to match —
  # an empty match is TS18003, a hard error, not a clean pass over nothing.
  # scripts/tsconfig.json SHIPS to every project (it is not export-ignore'd),
  # so a fresh bootstrap has the config with zero .mts files until its first
  # migration — tests/bootstrap-gate #2/#3 caught this exact gap the first
  # time scripts/shell-inventory-check.mts (blueprint-only, export-ignore'd)
  # was the only .mts in the tree and made the blueprint's own run look fine.
  if [ -f "$_tt_root/scripts/tsconfig.json" ] && [ -n "$(find "$_tt_root/scripts" -name '*.mts' -print -quit 2>/dev/null)" ]; then
    ts_scripts_no_bare_imports "$_tt_root" || return 1
    ts_scrubbed "$_tt_root/tests/node_modules/.bin/tsc" --noEmit -p "$_tt_root/scripts" || return 1
  fi
  return 0
}

# ts_scripts_no_bare_imports [ROOT] — TASK-067's runtime-floor rule, checked
# ahead of tsc rather than by it: `.mts` under scripts/ runs on plain node
# before `npm ci`, so it may import only `node:` builtins or a relative file,
# never a package from node_modules — that dependency does not exist yet at
# the point these scripts run (install-toolchain.sh, no-chain-guard.sh).
# tsc has no built-in rule for "no bare specifiers"; this is a grep because the
# alternative is a package (an eslint plugin) that scripts/ is exactly the
# tree forbidden from depending on.
ts_scripts_no_bare_imports(){
  _bi_root="${1:-.}"
  # A command SUBSTITUTION, not a bare pipe into `while`: the loop still runs
  # in a subshell, but only its stdout is read back, so nothing depends on a
  # variable surviving the subshell boundary (the SC2044 fix below would
  # otherwise be silently undone by exactly that mistake).
  #
  # The `case` patterns open with `(`: macOS bash 3.2 finds the end of a
  # `$( … )` by counting parentheses, so a bare `pattern)` closes it early
  # (TASK-087). POSIX allows the leading `(`; `sh -n` does not catch the bare form.
  _bi_bad="$(
    find "$_bi_root/scripts" -name '*.mts' -print 2>/dev/null | while IFS= read -r _bi_f; do
      grep -ohE "from[[:space:]]+['\"][^'\"]+['\"]|^import[[:space:]]+['\"][^'\"]+['\"]" "$_bi_f" \
        | sed -E "s/^(from|import)[[:space:]]+['\"]//; s/['\"]\$//" \
        | while IFS= read -r _bi_s; do
            case "$_bi_s" in
              (node:*|./*|../*) ;;
              (*) printf '%s: "%s"\n' "$_bi_f" "$_bi_s" ;;
            esac
          done
    done
  )"
  if [ -n "$_bi_bad" ]; then
    echo "❌ scripts/**/*.mts may import only node: builtins or a relative file:"
    printf '%s\n' "$_bi_bad" | sed 's/^/   /'
    return 1
  fi
  return 0
}

# ts_typecheck_stage [ROOT] — the gate's typecheck stage. It runs BEFORE the
# vitest batch: it takes seconds, not minutes, and a type error is a reason to
# stop before paying for the suites.
ts_typecheck_stage(){
  _tc_root="${1:-$(pwd)}"

  # SKIP, with a reason, where there is no harness to check. The CI step's
  # hashFiles guard keys on the same file, so the two modes skip together.
  if [ ! -f "$_tc_root/tests/package.json" ]; then
    pipe_skip "typecheck · TASK-031" "no tests/package.json — no TypeScript harness in this project"
    return 0
  fi

  # BLOCK, do not skip, when the harness is there and its compiler is not: the
  # same argument, and the same remedy, as the vitest stage's guard below.
  if [ ! -x "$_tc_root/tests/node_modules/.bin/tsc" ]; then
    echo "❌ The TypeScript typecheck cannot run: tests/node_modules/.bin/tsc is absent."
    echo "   Install the pinned tree once, then push again:"
    echo ""
    echo "       (cd tests && npm ci)"
    echo ""
    pipe_stage "typecheck · TASK-031" false
    return 1
  fi

  pipe_stage "typecheck · TASK-031" ts_typecheck "$_tc_root"
}

# ts_docs_stage [ROOT] — TASK-053. The one test stage a text-only push runs:
# the suites that judge documents (doc-links, lifecycle-docs, bug-numbers), in
# one vitest process. A suite this project does not have is left out, and with
# none of them present the stage skips with that reason.
ts_docs_stage(){
  _td_root="${1:-$(pwd)}"
  set --
  for _td_s in doc-links lifecycle-docs bug-numbers; do
    if [ -f "$_td_root/tests/$_td_s/$_td_s.spec.ts" ]; then
      set -- "$@" "$_td_s/$_td_s.spec.ts"
    fi
  done
  if [ "$#" -eq 0 ]; then
    pipe_skip "docs · TASK-053" "no document suites under tests/"
    return 0
  fi
  if [ ! -d "$_td_root/tests/node_modules" ]; then
    echo "❌ The document suites cannot run: tests/node_modules is absent. Run: (cd tests && npm ci)"
    pipe_stage "docs · TASK-053" false
    return 1
  fi
  _td_run(){ ( cd "$_td_root/tests" || exit 1; ts_scrubbed npx vitest run "$@" ); }
  pipe_stage "docs · TASK-053" _td_run "$@"
}

# ts_suites_stage [ROOT] — the whole thing.
ts_suites_stage(){
  _ts_root="${1:-$(pwd)}"

  if ! ts_suites_present "$_ts_root"; then
    pipe_skip "vitest · TASK-018" "no *.spec.ts on disk yet"
    return 0
  fi

  if ! command -v npx >/dev/null 2>&1; then
    # BLOCK, do not skip. scripts/install-toolchain.sh makes node/npm a blocking
    # capability precisely so a machine without them cannot get a green gate
    # over suites it never ran — the TASK-017 defect. Skipping here would
    # reintroduce it one layer up.
    pipe_stage "vitest · TASK-018" false
    return 1
  fi

  # TASK-018 PHASE 2 — THE SPECS SHIP NOW, so this stage is reached in projects
  # that have never run `npm ci`, and `npx` treats a missing local vitest as an
  # invitation to FETCH ONE.
  #
  # Measured, not assumed (.scratch/probe-npx.sh): in a tree holding
  # package.json, package-lock.json and a spec but no node_modules,
  # `npx vitest run` requests https://registry.npmjs.org/vitest. Offline that is
  # `ENOTCACHED`; ONLINE it silently downloads an unpinned resolution of the very
  # package the lockfile exists to pin, and runs the push gate against something
  # nobody reviewed and osv-scanner never scanned. A gate that installs its own
  # tooling mid-push is worse than one that stops.
  #
  # BLOCK, do not skip — the same argument as the npx check above. Skipping is
  # how a project gets a green gate over suites it never ran (TASK-017, BUG-066),
  # and here it would be green over EVERY TypeScript suite at once.
  if [ ! -d "$_ts_root/tests/node_modules" ]; then
    echo "❌ The TypeScript suites cannot run: tests/node_modules is absent."
    echo "   Install the pinned tree once, then push again:"
    echo ""
    echo "       (cd tests && npm ci)"
    echo ""
    echo "   'npm ci' and not 'npm install': the lockfile is the tree osv-scanner"
    echo "   scans and CI resolves, so anything else runs the gate against a"
    echo "   different set of packages than the one that was reviewed."
    pipe_stage "vitest · TASK-018" false
    return 1
  fi

  # THE LIST IS THE CONTRACT, NOT THE STATUS — and `|| true` is load-bearing.
  #
  # scripts/lib/suites.sh says of bp_suites_with_spec: "a final suite without a
  # spec made this return 1 with a perfectly good list on stdout. Harmless to
  # the one caller that reads it through `$( )`." That reasons about the VALUE
  # and forgets the caller runs under `set -e`, where a non-zero status is fatal
  # no matter how good the list is. The gate died on this line: entered the
  # stage, passed the npx check, and vanished — no stage, no skip, no summary,
  # push refused with nothing printed. Emptiness is judged below, where it can
  # be reported.
  _ts_declrc=0
  _ts_expect="$(ts_declared_suites "$_ts_root")" || _ts_declrc=$?
  if [ -z "$_ts_expect" ]; then
    pipe_skip "vitest · TASK-018" "no suite under tests/ owns a *.spec.ts"
    return 0
  fi

  # TASK-054 — THE RELEASE TIER. A suite whose specs are all `*.release.spec.ts`
  # runs in CI only; CI and the `released` branch gate what reaches derived
  # projects. The gate drops them from the expected set and names each one, so
  # the skip is visible here and in the file name, never silent. tests/manifest
  # #4 and #5 check that the gate runs every other suite and CI runs all of them.
  _ts_release="$(ts_release_suites "$_ts_root")"
  for _s in $_ts_release; do
    pipe_skip "$_s" "release tier (*.release.spec.ts): runs in CI only, which gates the released branch"
  done
  _ts_expect="$(printf '%s\n' "$_ts_expect" | grep -vxF "$_ts_release" || true)"
  if [ -z "$_ts_expect" ]; then
    pipe_skip "vitest · TASK-018" "every suite is release tier, so CI runs them all"
    return 0
  fi

  _ts_json="$(mktemp)"
  _ts_out="$(mktemp)"
  # No positional path filter, deliberately: tests/manifest #4 proves the gate
  # runs vitest BLANKET, because a path-filtered run is how a suite silently
  # stops being executed. Narrowing this breaks that assertion by design.
  #
  # BUG-055 — KEEP THE STATUS AND THE OUTPUT.
  #
  # This was `( … ) >/dev/null 2>&1` followed by `_ts_rc=$?`, under a hook that
  # runs `set -e`. That makes the assignment UNREACHABLE on the only path where
  # it matters: a failing runner would kill the hook before its status could be
  # read. `pipe_batch_end` below exists to reconcile that status and could never
  # receive it, and the per-suite note said "see the vitest output above" while
  # the output went to /dev/null.
  #
  # This was not what broke the push — that was the declared-suites status
  # above — but it is why finding it took eight attempts: every failure in this
  # stage rendered as an absence, and an absence names nothing.
  #
  # ENV SCRUB: HARDENING, NOT THE FIX. Stated plainly because the first draft of
  # this comment claimed otherwise. git does NOT export GIT_DIR to a pre-push
  # hook (measured: it exports GIT_EDITOR, GIT_EXEC_PATH, GIT_PREFIX and
  # nothing else), so the harness's assertProcessEnvClean was never firing here.
  # The scrub stays because any caller that DOES hold a git or agent variable —
  # a nested gate, a dispatcher, a future hook — would otherwise hit that guard
  # and fail in the same unreadable way, and because every shell suite has
  # scrubbed since BUG-014. It is a defence with a real threat and no cost, not
  # a diagnosis.
  #
  # By PREFIX rather than by list: the harness scrubs every declared hazard and
  # every undeclared GIT_*/AGENT_* name (isForbiddenAmbient, tests/harness/env.ts),
  # and restating that here would be a second copy that drifts. This file already
  # made that mistake once — `ts_declared_suites` carried a duplicate of the
  # manifest parse under a comment claiming it could not drift. The one declared
  # hazard OUTSIDE the prefixes, BLUEPRINT_ROOT (TASK-025), is unset by name after
  # the loop; tests/ts-bridge #1c imports UNPREFIXED_FORBIDDEN to pin that the two
  # agree.
  # `cd` into tests/, not into the repo root: that is where the harness manifest
  # and node_modules live (TASK-020), so it is vitest's root and npx's lookup
  # start. The include glob in tests/vitest.config.ts is root-relative to match.
  if (
    cd "$_ts_root/tests" || exit 1
    # BP_ joined the prefix list with BUG-066: .githooks/pre-push exports
    # BP_CODE_ROOT, so without it every spec's fixture children inherit the real
    # checkout's roots and a `${BP_CODE_ROOT:-.}` default silently reads the
    # real tree. Same argument the block above makes about GIT_ and AGENT_.
    # The scrub itself is ts_scrubbed, above — shared with CI (BUG-117).
    # TWO reporters, deliberately. `json` feeds pipe_stage_report below;
    # `default` is the only thing that tells a human WHICH assertion failed.
    # With json alone the captured output is a path to a file this function
    # deletes seconds later — BUG-055 fixed the silence and left the
    # uselessness, which cost three ~200s re-runs to notice.
    # `--exclude` is ADDITIVE to the config's excludes, and it names the release
    # glob and nothing else: tests/manifest reads any other exclude as a narrowed
    # run.
    ts_scrubbed npx vitest run --exclude='**/*.release.spec.*' --reporter=default --reporter=json --outputFile="$_ts_json"
  ) >"$_ts_out" 2>&1
  then
    _ts_rc=0
  else
    _ts_rc=$?
  fi

  # A failing run must SAY so. Truncated because a full vitest failure dump is
  # long and the gate is already dense; the temp file path is not printed
  # because it is removed below, and a path to a deleted file is worse than no
  # path at all.
  if [ "$_ts_rc" -ne 0 ]; then
    # The FAILURE lines, not the last lines. A nested-gate failure prints its
    # FAIL lines and then dozens of passing cases, so `tail` shows the passing
    # tail and the operator reads "see the FAIL lines above" with none in view.
    # That was the third iteration of one mistake: BUG-055 fixed the silence,
    # the next fix printed a path to a deleted file, the next printed the wrong
    # forty lines. Verify what is printed is USABLE, not merely present.
    #
    # `|| true` is HARDENING, not a fix — there is no defect here today. Under
    # the caller's `set -e` alone, this pipeline reports `head`'s status (0), so
    # neither a zero-match `grep` (rc=1) nor a SIGPIPE'd one (141) can abort
    # anything. It matters because this file is a sourced LIBRARY and does not
    # own its caller's shell options: a future caller that adds `pipefail` — a
    # normal thing for a gate to do — would kill the hook here, taking the
    # remaining stages and the summary with it, and present as "the gate stopped
    # reporting" rather than as anything pointing at this line. This file has
    # twice been burned by reasoning about what its caller DOES instead of what
    # it COULD do (BUG-055, both halves). One token closes that class.
    echo "  ── vitest failed (rc=$_ts_rc) ──"
    grep -nE 'FAIL|AssertionError|✗|×|Error:|not ok' "$_ts_out" | head -40 || true
    echo "  ── last 15 lines ──"
    tail -15 "$_ts_out"
    echo "  ── end vitest output ──"
  fi

  # BUG-068 — SURFACE THE CANARY'S NOTES EVEN WHEN THE RUN PASSED.
  #
  # The real-state canary reports a baton change it judged legitimate (a
  # concurrent agent flipping the mic through signal-set.sh) rather than failing
  # on it. That verdict is a PASS, and on a passing run everything vitest
  # printed goes into $_ts_out and is deleted two lines down — so without this
  # the report would exist only inside the test, which is precisely the silent
  # pass the canary was changed to avoid. `CANARY-NOTE:` is the marker
  # tests/harness/canary.ts emits; the two must move together.
  #
  # TASK-044 — `SKIP-NOTE:` is the same contract for a SKIPPED case
  # (tests/helpers/project-config.ts). vitest's JSON records no skip reason, so
  # without this a case skipped because the project runs another CI would render
  # as a plain pass.
  #
  # TWO greps, and the SKIP notices are UNCAPPED. They shared one `head -20` with
  # the canary notes, so twenty canary notes spent the whole budget and every
  # later skip reason vanished with nothing saying so (Alex, TASK-044 finding 5) —
  # the silence this marker exists to prevent, reintroduced by the cap that was
  # meant to keep the gate readable. A skip is a COVERAGE statement and every one
  # of them prints; a canary note is a repetition of one fact about the baton and
  # keeps its cap.
  grep -F 'SKIP-NOTE:' "$_ts_out" | sed 's/^/  – /' || true
  grep -F 'CANARY-NOTE:' "$_ts_out" | sed 's/^/  ⚠ /' | head -20 || true

  rm -f "$_ts_out"

  # shellcheck disable=SC2086
  pipe_batch_begin "vitest" $_ts_expect

  # One report per DECLARED suite. Read out of vitest's JSON by suite directory
  # rather than by file, so a suite holding several specs still renders as one
  # stage and still matches its manifest row.
  for _s in $_ts_expect; do
    _ms=0
    _rc=1
    _note=""
    if [ -s "$_ts_json" ]; then
      # jq is already a hard dependency of the gate (the semgrep stage blocks
      # without it), so using it here adds nothing new to install.
      # `| floor` is REQUIRED, not tidiness. vitest reports endTime as a float
      # (…884339.4248), so the subtraction yields a float, pipe_stage_report
      # rejects a non-integer, and the guard below would silently substitute 0 —
      # every stage rendering 0.0s while the SLO's slowest-stage line named
      # nothing. Caught by running the bridge rather than by reading it.
      _ms="$(jq -r --arg s "$_s" '
              [ .testResults[]? | select(.name | test("/tests/" + $s + "/")) ]
              | if length == 0 then empty
                else ( map((.endTime // 0) - (.startTime // 0)) | add | floor ) end
            ' "$_ts_json" 2>/dev/null)"
      _rc="$(jq -r --arg s "$_s" '
              [ .testResults[]? | select(.name | test("/tests/" + $s + "/")) ]
              | if length == 0 then 1
                elif any(.status == "failed") then 1
                else 0 end
            ' "$_ts_json" 2>/dev/null)"
    fi
    case "$_ms" in ''|*[!0-9]*) _ms=0 ;; esac
    case "$_rc" in ''|*[!0-9]*) _rc=1 ;; esac
    [ "$_rc" -ne 0 ] && _note="see the vitest output above"
    pipe_stage_report "$_s" "$_ms" "$_rc" "$_note"
  done

  rm -f "$_ts_json"

  # The runner's own status is reconciled against the reports: a non-zero exit
  # with every suite green means vitest died OUTSIDE a suite (a config error, an
  # import failure, a crashed worker), which must not render as a pass.
  pipe_batch_end "$_ts_rc"
}
