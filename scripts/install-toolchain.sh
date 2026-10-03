#!/usr/bin/env bash
# scripts/install-toolchain.sh — install the pre-push gate toolchain on any OS.
#
#   bash scripts/install-toolchain.sh            install the security-gate tools
#   bash scripts/install-toolchain.sh --infra    ...plus the IaC set (cdk/terraform/helm)
#   bash scripts/install-toolchain.sh check      report what is present/missing, install nothing
#   bash scripts/install-toolchain.sh --replace-blueprint-command [--project=<dir>]
#                                                replace a hand-written blueprint command
#
# THIS SCRIPT IS THE SINGLE SOURCE OF TRUTH for what the gate needs. It replaced
# the macOS-only `Brewfile` (TASK-017): the per-OS *mechanism* differs, the tool
# *list* does not, and a list that only one OS can act on is not a list of
# requirements — it is a list of requirements for macOS.
#
#   macOS : `brew install` per missing tool.
#   Linux : pinned release binaries into ~/.local/bin (no sudo); semgrep via
#           pipx (or pip --user).
#
# Why this file exists at all, in the blueprint's own terms: the pre-push gate
# `pipe_skip`s a scanner that is not installed, so an unprepared machine gets a
# GREEN gate that checked less. The Brewfile made that the default outcome on
# every non-macOS box, because the only documented install path could not run
# there. That is the repo's signature failure — a gate that skips looks exactly
# like a gate that passed (BUG-004, A-22, BUG-005, BUG-035).
#
# VERSIONS ARE PINNED, deliberately. The obvious implementation resolves
# "latest" from the GitHub API and pipes the result into `install`, which makes
# every developer's toolchain a moving target and every install an unreviewed
# fetch of whatever a third party published minutes ago. `.github/workflows/`
# SHA-pins its actions and pins OSV_SCANNER_VERSION; this file holds the same
# posture. Bumping a pin is a reviewable diff — that is the point.
#
# WHAT THIS DOES NOT DO, stated because the omission is invisible: on Linux it
# does NOT verify a checksum for the binaries it downloads. Transport is HTTPS
# with a pinned version, so you get the artefact that tag points at — but if the
# tag is moved or the release is replaced upstream, nothing here notices. On
# macOS Homebrew verifies its own downloads and we do not reimplement that.
# Closing this needs a pinned SHA256 per tool per architecture, bumped with the
# version pin. It is a real gap, not a judgement that it does not matter; do not
# write anywhere that this script verifies integrity, because it does not.
#
# Projects add their own tools in scripts/install-toolchain-project.sh — sourced
# at the end if present, same pattern as .githooks/pre-push-project. Per-tool
# failures are collected and reported at the end rather than aborting the run:
# one missing tool must not block the others.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Where the operator ran this from, recorded before anything could `cd`.
# --replace-blueprint-command validates the new command HERE (or in --project),
# never in $ROOT: $ROOT always has its own CLI, so a run there proves nothing
# about the project the command will serve (PLAN-TASK-025 §R5 #5).
CALLER_DIR="$PWD"
BIN_DIR="${HOME}/.local/bin"

# --- Pinned versions ---------------------------------------------------------
# Bump deliberately, in a reviewable commit. `check` does not enforce these —
# an already-present tool at another version is accepted, because developers
# legitimately share one machine across projects.
GITLEAKS_VERSION="8.28.0"
OSV_SCANNER_VERSION="2.2.2"
HELM_VERSION="3.19.0"
SHELLCHECK_VERSION="0.10.0"

# REQUIREMENTS, not pins — a distinction worth keeping straight. The versions
# above say "install exactly this"; these say "anything this accepts can run the
# test harness".
#
# Node's requirement is NOT restated here: it is READ from `engines.node` in the
# harness manifest, tests/package.json, which is where npm enforces it at install
# time (TASK-020 moved that manifest off the repo root). A copy here drifted — it
# said 18 while the manifest said `^20.19.0 || >=22.12.0`, a SECURITY floor (see
# its _engineNote), so `check` passed Node 20.0 and the harness then could not
# install (TASK-027, a2bp request PR #67). npm 8+ is the floor for a
# lockfileVersion 2/3 `npm ci`, and nothing else declares it, so it stays a
# constant.
#
# TASK-067 raised the manifest's floor to `>=22.18.0`, the first official Node
# release with type stripping ON BY DEFAULT — scripts/**/*.mts needs that to
# run at all, with no flag and no runtime dependency. The numeric range alone
# cannot tell a distro/vendored build (type stripping compiled out) from an
# official one at the SAME version: see require_node's capability probe below.
HARNESS_MANIFEST="$ROOT/tests/package.json"
NPM_MIN_MAJOR="8"

# Tools the pre-push gate actually probes for (`command -v` in .githooks/pre-push,
# and in scripts/run-ts-suites.sh for shellcheck). Keep this in step with those
# files — a tool listed here that the gate never uses is install-time cost for
# nothing, and one the gate uses that is missing here is a silent pipe_skip.
# ShellCheck does not skip: its stage BLOCKS when it is missing (TASK-033).
SECURITY_TOOLS="gitleaks semgrep osv-scanner jq shellcheck"
# `aws` is not probed by the gate, but every AWS recipe in docs/INFRASTRUCTURE.md
# needs it, and `check --infra` must report the same set that `--infra` installs
# — a check narrower than the install is how a machine reports itself ready and
# is not.
INFRA_TOOLS="cdk terraform helm aws"

MODE="install"
WITH_INFRA=no
BP_PROJECT_DIR=""
for arg in "$@"; do
  case "$arg" in
    check)   MODE="check" ;;
    --infra) WITH_INFRA=yes ;;
    --replace-blueprint-command) MODE="replace-command" ;;
    # One `=` token, because this loop reads one argument at a time.
    --project=*) BP_PROJECT_DIR="${arg#--project=}" ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "usage: $0 [check] [--infra] | --replace-blueprint-command [--project=<dir>]" >&2; exit 2 ;;
  esac
done
if [ -n "$BP_PROJECT_DIR" ] && [ "$MODE" != "replace-command" ]; then
  echo "usage: --project=<dir> is accepted only with --replace-blueprint-command" >&2
  exit 2
fi

note() { echo "  $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

FAILED=""
fail_tool() { FAILED="$FAILED $1"; echo "  ✗ $1: $2" >&2; }

# Clear the shell's command-location cache. bash remembers where it found a
# command, so a tool installed DURING this run is still looked up at its old
# path — or reported absent — until the cache is dropped. Observed for real:
# `brew install diffutils` succeeded, symlinked /usr/local/bin/diff, and the
# capability check immediately after still saw Apple's /usr/bin/diff and
# declared the install failed. An installer that cannot see its own work
# reports a false failure, which is the same class as BUG-037.
rehash() { hash -r 2>/dev/null || true; }

verify() {
  _t="$1"
  rehash
  if have "$_t"; then
    note "✓ $_t installed ($("$_t" --version 2>&1 | head -1))"
  else
    fail_tool "$_t" "not on PATH after install"
  fi
}

# A timeout provider is REQUIRED by the secret scan, not a nicety: gitleaks
# scans a new ref over its whole history, which is unbounded, and the gate
# BLOCKS rather than run it uncapped (A-03 R4-F2). macOS has no `timeout` in
# the base system — coreutils installs it as `gtimeout`.
have_timeout() { have timeout || have gtimeout; }

# GNU diffutils, checked by CAPABILITY rather than by presence. `have diff` is
# TRUE on macOS and tells you nothing: Apple ships a FreeBSD diff that does not
# implement --unchanged-line-format, and `blueprint a2bp` needs exactly those
# line-format flags to build its staged request. Without them a2bp refuses every
# file with "staging failed" — correctly, and loudly, but it means the product's
# back-propagation verb does not work at all on a stock Mac, and the whole
# tests/a2bp-contamination suite fails (19 cases) rather than skipping.
#
# This is the same trap as `have coreutils`: asking whether a package name
# resolves, when the thing you depend on is a behaviour.
have_gnu_diff() {
  diff --unchanged-line-format='' --old-line-format='' --new-line-format='' \
    /dev/null /dev/null >/dev/null 2>&1
}

# flock(1) is what bounds the subagent-bookend deferral in scripts/log-activity.mts
# (BUG-124). Without it that hook cannot enforce its cap, so it does not defer at
# all and every subagent bookend is labelled by agent TYPE rather than by
# persona — which is the symptom BUG-124 was filed for, reappearing on the one
# platform the founder works on.
#
# It is util-linux, NOT coreutils: installing coreutils for `gtimeout` does not
# bring it. And the formula is KEG-ONLY, so `have flock` is false even after a
# successful install. Hence the shared resolver rather than a name check — the
# installer must decide "present" by exactly the rule the hook uses, or it will
# report success for a machine the hook still cannot defer on.
# shellcheck source=scripts/lib/watcher-lock.sh
. "$(dirname "$0")/lib/watcher-lock.sh"
have_flock() { bp_flock_cmd >/dev/null 2>&1; }

# Node and npm are BLOCK-class, not skip-class, and the difference is the whole
# reason this file exists. The gate `pipe_skip`s a scanner it cannot find; if the
# test harness were treated the same way, a machine without a usable Node would
# get a GREEN gate over every suite the harness runs — dozens of them, silently
# absent. That is precisely the defect TASK-017 closed for the security tools,
# reintroduced through a different door. So a missing or too-old Node is
# reported as missing and this script exits non-zero, in `check` and in install.
#
# Checked by CAPABILITY, exactly like have_gnu_diff and for the same reason:
# `have node` is TRUE for a v12 that cannot run vitest at all, so presence
# answers a question nobody asked. Ask the engine whether it satisfies the
# harness manifest's range, by running it.
#
# The WHOLE range, not its major: `^20.19.0 || >=22.12.0` rejects 20.0 and 22.0,
# which a major-only comparison passes. Node parses its own package.json, so this
# needs nothing the harness does not already need — no jq, no semver package
# (node_modules does not exist yet when `check` runs). The evaluator covers the
# comparator forms an `engines.node` range uses (^ ~ >= > <= < = and bare, full
# or partial versions, joined by spaces and ||), with npm's caret rule: a caret
# allows changes that leave the left-most NON-ZERO part alone, so `^0.10.0` stops
# before 0.11.0 and `^0.0.3` before 0.0.4 (the request as filed treated every
# caret as "same major"). Anything else — a hyphen range, a prerelease tag — is
# reported as uninterpretable rather than guessed at.
#
# Exit: 0 satisfied, 3 outside the range, anything else cannot tell (manifest
# missing, unreadable, or an unknown form). It prints ONE line: the range, or the
# reason it could not be evaluated. A missing manifest is never replaced by a
# default floor — a default is the restated copy this replaced.
NODE_RANGE_JS='
try {
  const file = process.argv[1]
  let range
  try {
    range = JSON.parse(require("fs").readFileSync(file, "utf8")).engines.node
  } catch (e) {
    throw new Error("cannot read engines.node from " + file + ": " + e.message)
  }
  if (typeof range !== "string") throw new Error(file + " declares no engines.node")
  const have = process.versions.node.split(".").map(Number)
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  const satisfies = (c) => {
    if (c === "*") return true
    const m = /^(\^|~|>=|<=|>|<|=)?v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(c)
    if (!m) throw new Error("cannot interpret engines.node \"" + range + "\" in " + file)
    const [M, n, p] = [m[2], m[3] || 0, m[4] || 0].map(Number)
    const lo = cmp(have, [M, n, p])
    // Exclusive upper bound of a partial version: "20" is 20.x, "20.1" is 20.1.x.
    const hi = cmp(have, m[3] === undefined ? [M + 1, 0, 0] : m[4] === undefined ? [M, n + 1, 0] : [M, n, p + 1])
    // npm caret: the upper bound bumps the left-most non-zero part, and a part
    // left unwritten counts as the one to bump.
    const caret =
      M > 0 || m[3] === undefined ? [M + 1, 0, 0] : n > 0 || m[4] === undefined ? [M, n + 1, 0] : [M, n, p + 1]
    switch (m[1]) {
      case ">=": return lo >= 0
      case ">": return hi >= 0
      case "<": return lo < 0
      case "<=": return hi < 0
      case "^": return lo >= 0 && cmp(have, caret) < 0
      case "~": return lo >= 0 && cmp(have, m[3] === undefined ? [M + 1, 0, 0] : [M, n + 1, 0]) < 0
      default: return lo >= 0 && hi < 0
    }
  }
  // An empty alternative has no tokens and means any version.
  const alts = range
    .split("||")
    .map((alt) => alt.replace(/(\^|~|>=|<=|>|<|=)\s+/g, "$1").trim().split(/\s+/).filter(Boolean))
  // EVERY comparator is checked for a known form BEFORE any is evaluated.
  // Evaluation short-circuits, so an unknown token after one that already fails
  // was never parsed: `20 - 22` on Node 24 read as "unsupported" rather than
  // "cannot interpret", and a mutant that passed every uninterpretable range
  // left tests/install-toolchain #4 green.
  // `*` is ONE comparator. Skipping an alternative that began with it waived
  // every token after it, so `* >=99.0.0` accepted any Node and `* nonsense`
  // was never refused (tests/install-toolchain #6).
  for (const cs of alts) {
    for (const c of cs) {
      if (c !== "*" && !/^(\^|~|>=|<=|>|<|=)?v?\d+(\.\d+)?(\.\d+)?$/.test(c)) {
        throw new Error("cannot interpret engines.node \"" + range + "\" in " + file)
      }
    }
  }
  const ok = alts.some((cs) => cs.every(satisfies))
  console.log(range)
  process.exit(ok ? 0 : 3)
} catch (e) {
  console.log(e.message)
  process.exit(4)
}'

# node_check — sets NODE_RC (0 satisfied, 3 outside the range, 4 cannot tell,
# 127 not installed) and NODE_WHY (the range, or why it could not be evaluated).
node_check() {
  NODE_WHY=""
  if ! have node; then NODE_RC=127; return; fi
  NODE_WHY="$(node -e "$NODE_RANGE_JS" "$HARNESS_MANIFEST" 2>&1)"
  NODE_RC=$?
  case "$NODE_RC" in 0|3) ;; *) NODE_RC=4 ;; esac
  NODE_WHY="${NODE_WHY%%$'\n'*}"
  [ -n "$NODE_WHY" ] || NODE_WHY="node could not evaluate $HARNESS_MANIFEST"
}

# `npm ci` is what the gate uses to materialise node_modules reproducibly, and
# lockfileVersion 2/3 needs npm 7+. Floor at 8 because that is what ships with
# every Node this script will accept. Again a capability check — running
# `npm --version` proves the binary works, which `command -v npm` does not (a
# dangling nvm shim is on PATH and exits 127).
have_npm() {
  _npm_v="$(npm --version 2>/dev/null)" || return 1
  case "$_npm_v" in ''|*[!0-9.]*) return 1 ;; esac
  [ "${_npm_v%%.*}" -ge "$NPM_MIN_MAJOR" ] 2>/dev/null
}

# Node is deliberately NOT installed here — same posture, and the same reason,
# as cdk and terraform below. Which Node a project runs is a PROJECT decision
# (`engines.node`, `.nvmrc`), and on a developer machine it is almost always
# owned by a version manager (nvm / fnm / asdf / volta). Dropping a second Node
# into /usr/local from here would shadow that one on PATH for some shells and
# not others, which is a worse failure than the one it fixes — and vendoring a
# tarball is out for the reason stated in the header: nothing in this file
# verifies a checksum.
NODE_INSTALL_HINT="install a Node satisfying engines.node in tests/package.json via your version manager (nvm/fnm/asdf/volta) or the installer at nodejs.org — pin it in .nvmrc and engines.node"

# One implementation, called from both OS branches, so macOS and Linux cannot
# drift into requiring different things.
require_node() {
  node_check
  case "$NODE_RC" in
    0)   note "✓ node $(node --version 2>/dev/null) already present" ;;
    3)   fail_tool node "$(node --version 2>&1 | head -1) does not satisfy engines.node \"$NODE_WHY\" — $NODE_INSTALL_HINT" ;;
    127) fail_tool node "not installed — $NODE_INSTALL_HINT" ;;
    *)   fail_tool node "cannot tell whether this Node can run the harness — $NODE_WHY" ;;
  esac

  if have_npm; then
    note "✓ npm $(npm --version 2>/dev/null) already present"
  else
    fail_tool npm "missing or older than ${NPM_MIN_MAJOR} — 'npm ci' cannot materialise the test harness"
  fi

  # TASK-067 — a CAPABILITY probe, run only once the version check above has
  # already passed. Only then, because "the version is in range but it cannot
  # strip types" is a DIFFERENT failure than "the version is out of range",
  # and node_check's NODE_RC already means this Node satisfies engines.node.
  if [ "$NODE_RC" = 0 ] && node_strips_types; then
    note "✓ node strips types by default (scripts/**/*.mts will run)"
  elif [ "$NODE_RC" = 0 ]; then
    fail_tool node "$(node --version 2>/dev/null) satisfies engines.node but does not strip TypeScript types by default — this is almost always a DISTRO or vendored build with that support compiled out (observed on this host's own /usr/bin/node), not a version problem. $NODE_INSTALL_HINT — an OFFICIAL build from nodejs.org or your version manager, not the OS package."
  fi
}

# node_strips_types — TASK-067's capability probe. Runs a one-line TYPED file
# through the resolved `node` with NO flag, and reads whether it ran: the
# version-range check above cannot tell an official build from a distro one at
# the SAME reported version — this repo's own dev machine had `/usr/bin/node`
# report a version inside range while `--experimental-strip-types` failed with
# ERR_NO_TYPESCRIPT ("not compiled with TypeScript support"). NEVER installs
# anything — same posture as require_node's own comment above.
node_strips_types() {
  _nst_dir="$(mktemp -d)" || return 1
  printf 'const _nst: number = 1\nif (_nst !== 1) throw new Error("unreachable")\n' >"$_nst_dir/probe.mts"
  node "$_nst_dir/probe.mts" >/dev/null 2>&1
  _nst_rc=$?
  rm -rf "$_nst_dir"
  return "$_nst_rc"
}

# --- TASK-025: the per-machine `blueprint` command ----------------------------
#
# ~/.local/bin/blueprint used to be hand-written and `exec` a hard-coded checkout
# path, so moving the blueprint (TASK-021 Stage B) would break `blueprint` for
# every project on the machine, and no commit can fix a file outside git. This
# command names no checkout: it runs the CLI of the project in the current
# directory, which reads the blueprint by its address. PLAN-TASK-025 §8.1.
BLUEPRINT_COMMAND_PATH="$BIN_DIR/blueprint"

# The body, VERBATIM. Ownership is byte-exact equality with a body this installer
# released (§R4 #1): the marker line proves nothing, since anyone can copy it.
# The released set is v1 (superseded) and v2 (current). v1 runs only an
# executable ./scripts/blueprint, which TASK-088 deleted in favour of
# scripts/blueprint.mts; an owned v1 is replaced by v2 and `check` counts it
# stale. v2 keeps `node` because the .mts is mode 100644, and falls back to an
# executable scripts/blueprint for projects from before TASK-081.
read -r -d '' BLUEPRINT_COMMAND_V1 <<'BODY'
#!/usr/bin/env bash
# struct2flow-blueprint-command v1: written by scripts/install-toolchain.sh (TASK-025).
# Runs THIS project's own blueprint CLI. The blueprint is read by its address,
# so no checkout path belongs in this file. Edit the installer, not this copy.
for c in ./scripts/blueprint ./scaffolding/scripts/blueprint; do
  [ -x "$c" ] && exec "$c" "$@"
done
echo "blueprint: no scripts/blueprint in $PWD. Run from a project root," >&2
echo "  or fetch the CLI and the libs it needs once with: BLUEPRINT_ROOT=<checkout> bash <checkout>/scripts/blueprint pull scripts/blueprint" >&2
exit 1
BODY

read -r -d '' BLUEPRINT_COMMAND_BODY <<'BODY'
#!/usr/bin/env bash
# struct2flow-blueprint-command v2: written by scripts/install-toolchain.sh (TASK-088).
# Runs THIS project's own blueprint CLI. The blueprint is read by its address,
# so no checkout path belongs in this file. Edit the installer, not this copy.
for c in ./scripts/blueprint.mts ./scaffolding/scripts/blueprint.mts; do
  [ -f "$c" ] && exec node "$c" "$@"
done
for c in ./scripts/blueprint ./scaffolding/scripts/blueprint; do
  [ -x "$c" ] && exec "$c" "$@"
done
echo "blueprint: no scripts/blueprint.mts (or executable scripts/blueprint) in $PWD. Run from a project root," >&2
echo "  or fetch the CLI and the libs it needs once with: BLUEPRINT_ROOT=<checkout> node <checkout>/scripts/blueprint.mts pull scripts/blueprint.mts" >&2
exit 1
BODY

# bc_is PATH BODY — a REGULAR file, never a symlink (the symlink test comes
# first), byte-identical to BODY.
bc_is() {
  [ ! -L "$1" ] && [ -f "$1" ] && printf '%s\n' "$2" | cmp -s - "$1"
}

# bc_owned PATH — this installer's current body.
bc_owned() { bc_is "$1" "$BLUEPRINT_COMMAND_BODY"; }

# bc_v1 PATH — a superseded body this installer released: ours, so replaceable.
bc_v1() { bc_is "$1" "$BLUEPRINT_COMMAND_V1"; }

# bc_foreign PATH — something is there, and it is neither of ours.
bc_foreign() {
  { [ -L "$1" ] || [ -e "$1" ]; } && ! bc_owned "$1" && ! bc_v1 "$1"
}

bc_foreign_warning() {
  note "⚠ $BLUEPRINT_COMMAND_PATH was not written by this installer, so it is left alone."
  note "  If it runs a checkout's scripts/blueprint, TASK-021 Stage B will break it."
  note "  Once every project has the address-reading CLI, replace it with:"
  note "  bash scripts/install-toolchain.sh --replace-blueprint-command"
}

# After writing: the README once told people to put a checkout's scripts/ on
# PATH, which is the same hazard in another shape.
bc_shadow_check() {
  hash -r 2>/dev/null || true
  _bc_first="$(command -v blueprint 2>/dev/null || true)"
  if [ -n "$_bc_first" ] && [ "$_bc_first" != "$BLUEPRINT_COMMAND_PATH" ]; then
    note "⚠ blueprint resolves to $_bc_first first on PATH, not $BLUEPRINT_COMMAND_PATH."
  fi
}

# Install mode. Never replaces a file it did not write — the operator's current
# wrapper is the recovery path until every project is migrated (§7.2 step 8).
install_blueprint_command() {
  if bc_foreign "$BLUEPRINT_COMMAND_PATH"; then
    bc_foreign_warning
  elif bc_owned "$BLUEPRINT_COMMAND_PATH"; then
    note "✓ blueprint command already present"
  else
    _bc_new="$(mktemp "$BIN_DIR/.blueprint.new.XXXXXX" 2>/dev/null)" || _bc_new=""
    if [ -n "$_bc_new" ] && printf '%s\n' "$BLUEPRINT_COMMAND_BODY" > "$_bc_new" \
       && chmod 0755 "$_bc_new" && mv -f "$_bc_new" "$BLUEPRINT_COMMAND_PATH"; then
      note "✓ blueprint command installed ($BLUEPRINT_COMMAND_PATH)"
    else
      [ -n "$_bc_new" ] && rm -f "$_bc_new"
      note "⚠ could not write $BLUEPRINT_COMMAND_PATH"
    fi
  fi
  bc_shadow_check
}

# --- --replace-blueprint-command: the approved replacement of a foreign file --
#
# Typing the flag is the operator's approval. Prepare the body beside the target,
# validate it IN the project it will serve, back the old command up, and only
# then swap with one rename, so `blueprint` is always either the old command or
# the validated new one. Every failure before the swap exits 1 with the target
# untouched and the temp file removed. The shared terminating handler is not
# decoration: without it an INT to the installer alone was absorbed and the swap
# completed (§R4 #2).
if [ "$MODE" = "replace-command" ]; then
  if [ ! -r "$ROOT/scripts/lib/signals.sh" ]; then
    echo "✗ scripts/lib/signals.sh is missing — refusing to replace the command without a signal-safe swap" >&2
    exit 1
  fi
  # shellcheck source=scripts/lib/signals.sh
  . "$ROOT/scripts/lib/signals.sh"
  BC_TMP=""
  bc_cleanup() {
    if [ -n "$BC_TMP" ]; then rm -f "$BC_TMP"; fi
    BC_TMP=""
  }
  _bp_terminating_traps bc_cleanup

  if bc_owned "$BLUEPRINT_COMMAND_PATH"; then
    note "✓ blueprint command already present"
    exit 0
  fi

  # A directory, or a link to one, is refused before anything is prepared.
  # `mv -f temp target` would move the command INTO it, return 0, and this
  # would report "replaced" with no command in place (Alexey, c3-4 review #2).
  # `-d` follows a link, so one test covers both shapes.
  if [ -d "$BLUEPRINT_COMMAND_PATH" ]; then
    echo "✗ $BLUEPRINT_COMMAND_PATH is a directory, or a link to one; move it aside, then run this again" >&2
    exit 1
  fi

  # Which project, and is it one the command can serve? The state §7.2 step 7
  # verifies: .blueprint-source sets blueprint_release_branch and no longer has
  # blueprint_source. The blueprint itself has no .blueprint-source, so running
  # there without --project is refused rather than validated against its own CLI.
  BC_PROJECT="${BP_PROJECT_DIR:-$CALLER_DIR}"
  BC_CONFIG="$BC_PROJECT/.blueprint-source"
  if [ -L "$BC_CONFIG" ] || [ ! -f "$BC_CONFIG" ] \
     || ! grep -q '^[[:space:]]*blueprint_release_branch[[:space:]]*=[[:space:]]*[^[:space:]]' "$BC_CONFIG" \
     || grep -q '^[[:space:]]*blueprint_source[[:space:]]*=' "$BC_CONFIG"; then
    echo "✗ $BC_PROJECT is not a migrated project (§7.2 steps 4–7); run from one, or pass --project=<dir>" >&2
    exit 1
  fi

  if ! mkdir -p "$BIN_DIR"; then
    echo "✗ could not create $BIN_DIR" >&2
    exit 1
  fi

  # 1. Prepare.
  BC_TMP="$(mktemp "$BIN_DIR/.blueprint.new.XXXXXX")" || { BC_TMP=""; echo "✗ could not create a temp file in $BIN_DIR" >&2; exit 1; }
  if ! printf '%s\n' "$BLUEPRINT_COMMAND_BODY" > "$BC_TMP"; then
    echo "✗ could not write the new command" >&2
    exit 1
  fi
  if ! chmod 0755 "$BC_TMP"; then
    echo "✗ could not make the new command executable" >&2
    exit 1
  fi

  # 2. Validate, in the project: executable, shebang resolves, and it reaches
  #    THAT project's CLI.
  if ! ( cd "$BC_PROJECT" && "$BC_TMP" help ) >/dev/null 2>&1; then
    echo "✗ the new command does not run the CLI of $BC_PROJECT (§7.2 step 4 done?) — nothing replaced" >&2
    exit 1
  fi

  # 3. Back up, into a fresh directory, so nothing is written through an existing
  #    path. -P copies a symlink as a link.
  BC_BACKUP=""
  if [ -L "$BLUEPRINT_COMMAND_PATH" ] || [ -e "$BLUEPRINT_COMMAND_PATH" ]; then
    BC_BACKUP="$(mktemp -d "$BIN_DIR/.blueprint-replaced.XXXXXX")" || { echo "✗ could not create a backup directory" >&2; exit 1; }
    if ! cp -pP "$BLUEPRINT_COMMAND_PATH" "$BC_BACKUP/blueprint"; then
      echo "✗ could not back up $BLUEPRINT_COMMAND_PATH — nothing replaced" >&2
      exit 1
    fi
  fi

  # 4. Swap: one rename within one directory. A symlink target is replaced as a
  #    link; the file it pointed at is untouched.
  if ! mv -f "$BC_TMP" "$BLUEPRINT_COMMAND_PATH"; then
    echo "✗ could not move the new command into place — nothing replaced" >&2
    exit 1
  fi
  BC_TMP=""

  # 5. Report. The installer never deletes a backup.
  note "✓ blueprint command replaced ($BLUEPRINT_COMMAND_PATH)"
  if [ -n "$BC_BACKUP" ]; then
    note "  previous command kept; restore it with: mv $BC_BACKUP/blueprint $BLUEPRINT_COMMAND_PATH"
  fi
  bc_shadow_check
  exit 0
fi

# --- check mode: identical on every OS ---------------------------------------
if [ "$MODE" = "check" ]; then
  missing=0
  tools="$SECURITY_TOOLS"
  [ "$WITH_INFRA" = "yes" ] && tools="$tools $INFRA_TOOLS"

  for t in $tools; do
    if have "$t"; then
      note "✓ $t  ($(command -v "$t"))"
    else
      note "✗ $t  MISSING"
      missing=$((missing + 1))
    fi
  done

  if have_timeout; then
    note "✓ timeout  ($(command -v timeout 2>/dev/null || command -v gtimeout))"
  else
    note "✗ timeout/gtimeout  MISSING — the secret scan cannot be bounded, and the gate blocks"
    missing=$((missing + 1))
  fi

  if have_gnu_diff; then
    note "✓ GNU diff  ($(command -v diff))"
  else
    note "✗ GNU diff  MISSING — 'diff' here does not support --unchanged-line-format,"
    note "            so 'blueprint a2bp' cannot stage a request and its suite fails"
    missing=$((missing + 1))
  fi

  # Node/npm are reported here because `check` must report the same set the
  # install path requires — a check narrower than the install is how a machine
  # reports itself ready and is not (see the INFRA_TOOLS note above; `aws` is in
  # that list for exactly this reason).
  node_check
  case "$NODE_RC" in
    0)
      if node_strips_types; then
        note "✓ node $(node --version 2>/dev/null)  ($(command -v node)) — strips types by default"
      else
        note "✗ node $(node --version 2>/dev/null)  ($(command -v node)) satisfies engines.node but does NOT strip"
        note "        types by default — almost always a distro/vendored build with that support"
        note "        compiled out, not a version problem. $NODE_INSTALL_HINT — an official build."
        missing=$((missing + 1))
      fi
      ;;
    3)
      note "✗ node  UNSUPPORTED — $(node --version 2>&1 | head -1) does not satisfy engines.node \"$NODE_WHY\""
      note "        $NODE_INSTALL_HINT"
      missing=$((missing + 1))
      ;;
    127)
      note "✗ node  MISSING — the test harness cannot run, and the gate would pass over every suite it owns"
      note "        $NODE_INSTALL_HINT"
      missing=$((missing + 1))
      ;;
    *)
      # Not a pass: with the requirement unreadable, no Node can be declared fit.
      note "✗ node  UNVERIFIED — $NODE_WHY"
      note "        without the harness's declared range, no Node can be declared able to run it"
      missing=$((missing + 1))
      ;;
  esac

  if have_npm; then
    note "✓ npm $(npm --version 2>/dev/null)  ($(command -v npm))"
  else
    note "✗ npm  MISSING or older than ${NPM_MIN_MAJOR} — 'npm ci' cannot materialise the harness"
    note "        it ships with Node; $NODE_INSTALL_HINT"
    missing=$((missing + 1))
  fi

  # Missing or a stale v1 body counts (install replaces both, so check and
  # install agree); a foreign body is only reported, install leaves it alone.
  if bc_foreign "$BLUEPRINT_COMMAND_PATH"; then
    note "⚠ $BLUEPRINT_COMMAND_PATH was not written by this installer, so it is left alone."
  elif bc_owned "$BLUEPRINT_COMMAND_PATH"; then
    note "✓ blueprint command ($BLUEPRINT_COMMAND_PATH)"
  elif bc_v1 "$BLUEPRINT_COMMAND_PATH"; then
    note "✗ blueprint command STALE (v1 cannot run scripts/blueprint.mts; run: bash scripts/install-toolchain.sh)"
    missing=$((missing + 1))
  else
    note "✗ blueprint command MISSING (run: bash scripts/install-toolchain.sh)"
    missing=$((missing + 1))
  fi

  if [ "$missing" -eq 0 ]; then
    echo "All present."
    exit 0
  fi
  echo "$missing tool(s) missing — run: bash scripts/install-toolchain.sh"
  exit 1
fi

# --- Both OSes: $BIN_DIR, and the per-machine blueprint command ---------------
# BEFORE the OS branch, so a missing Homebrew or curl cannot skip the command.
mkdir -p "$BIN_DIR"
case ":$PATH:" in
  *":$BIN_DIR:"*) : ;;
  *)
    echo "⚠ $BIN_DIR is not on PATH — using it for this run."
    echo "  Add it to your shell profile, or the gate will still report these missing."
    PATH="$BIN_DIR:$PATH"
    export PATH
    ;;
esac
install_blueprint_command

# --- macOS: brew install per missing tool ------------------------------------
if [ "$(uname -s)" = "Darwin" ]; then
  if ! have brew; then
    echo "❌ Homebrew not installed — see https://brew.sh, then re-run." >&2
    echo "   (Or install these manually: $SECURITY_TOOLS coreutils)" >&2
    exit 1
  fi

  # command name → brew formula (they differ for three of them)
  brew_install() {
    _cmd="$1"; _formula="$2"
    if have "$_cmd"; then note "✓ $_cmd already present"; return 0; fi
    if brew install "$_formula" >/dev/null; then
      verify "$_cmd"
    else
      fail_tool "$_cmd" "brew install $_formula failed"
    fi
  }

  echo "Installing security-gate tools via Homebrew ..."
  brew_install gitleaks    gitleaks
  brew_install semgrep     semgrep
  brew_install osv-scanner osv-scanner
  brew_install jq          jq
  brew_install shellcheck  shellcheck

  # coreutils is keyed on the COMMAND it provides, not on the formula name:
  # `have coreutils` is always false, so a formula-keyed check reinstalls it
  # on every run.
  if have_timeout; then
    note "✓ timeout/gtimeout already present"
  elif brew install coreutils >/dev/null && rehash && have_timeout; then
    note "✓ gtimeout installed (coreutils)"
  else
    fail_tool coreutils "brew install coreutils failed — the secret scan cannot be bounded"
  fi

  # Keyed on the capability for a third reason: util-linux is keg-only, so brew
  # installs flock WITHOUT putting it on PATH. `have flock` is false after a
  # perfectly good install, and a formula-keyed check would reinstall every run.
  if have_flock; then
    note "✓ flock already present"
  elif brew install util-linux >/dev/null && rehash && have_flock; then
    note "✓ flock installed (util-linux)"
  else
    fail_tool util-linux "brew install util-linux failed — subagent bookends will be labelled by agent type instead of by persona (BUG-124)"
  fi

  # Keyed on the capability, not the formula: Apple's diff is always on PATH.
  if have_gnu_diff; then
    note "✓ GNU diff already present"
  elif brew install diffutils >/dev/null && rehash && have_gnu_diff; then
    note "✓ GNU diff installed (diffutils)"
  else
    fail_tool diffutils "brew install diffutils failed — 'blueprint a2bp' cannot stage a request without GNU line-format flags"
  fi

  require_node

  if [ "$WITH_INFRA" = "yes" ]; then
    echo "Installing IaC tools via Homebrew ..."
    brew_install cdk       aws-cdk
    brew_install terraform terraform
    brew_install helm      helm
    brew_install aws       awscli
  fi

else
# --- Linux: pinned release binaries into ~/.local/bin, no sudo ---------------
  # $BIN_DIR and its PATH warning are set up above the OS branch now.
  case "$(uname -m)" in
    x86_64)        A_AMD=amd64; A_X64=x64;   A_SC=x86_64 ;;
    aarch64|arm64) A_AMD=arm64; A_X64=arm64; A_SC=aarch64 ;;
    *) echo "❌ unsupported architecture: $(uname -m)" >&2; exit 1 ;;
  esac

  have curl || { echo "❌ curl is required (apt/dnf install curl)" >&2; exit 1; }

  # `timeout` is in GNU coreutils, effectively always present on Linux. If it
  # is genuinely absent the distro package is the only sane answer — we do not
  # ship a coreutils binary.
  have_timeout || fail_tool coreutils "no timeout(1) — install GNU coreutils via your package manager"
  # GNU diffutils is the default on Linux, so this normally passes untouched.
  # It is still asserted rather than assumed: a minimal container (busybox,
  # alpine) ships a diff without the line-format flags, and a2bp would then
  # fail there for the same reason it fails on a stock Mac.
  have_gnu_diff || fail_tool diffutils "diff lacks --unchanged-line-format — install GNU diffutils (apt/dnf install diffutils)"
  # util-linux is the default on Linux, so this normally passes untouched. Still
  # asserted rather than assumed, for the same reason as diffutils above: a
  # minimal container ships without it, and the subagent feed would then label
  # every bookend by agent type there.
  have_flock || fail_tool util-linux "no flock(1) — install util-linux (apt/dnf install util-linux)"
  # Same posture on both OSes: required, reported, never vendored. See
  # require_node's comment for why a distro/vendored Node is the wrong answer.
  require_node

  # Fetch the pinned-version URL to a temp file, then install. Never pipe a
  # download into a shell. Checksums are NOT verified yet, as the header states.
  fetch() {
    _url="$1"; _out="$2"
    curl -fsSL --proto '=https' --tlsv1.2 --retry 3 "$_url" -o "$_out"
  }

  install_binary() {
    _tool="$1"; _url="$2"
    _tmp="$(mktemp)" || return 1
    if fetch "$_url" "$_tmp"; then
      install -m 0755 "$_tmp" "$BIN_DIR/$_tool"
      rm -f "$_tmp"
      return 0
    fi
    rm -f "$_tmp"
    return 1
  }

  # `tar -xf`, not `-xzf`: tar detects the compression from the archive's
  # content, so one extractor takes gitleaks' and helm's .tar.gz and
  # ShellCheck's .tar.xz (TASK-033).
  install_tarball() {
    _tool="$1"; _url="$2"; _member="$3"
    _tmp="$(mktemp -d)" || return 1
    if fetch "$_url" "$_tmp/pkg" && tar -xf "$_tmp/pkg" -C "$_tmp" "$_member" 2>/dev/null; then
      install -m 0755 "$_tmp/$_member" "$BIN_DIR/$_tool"
      rm -rf "$_tmp"
      return 0
    fi
    rm -rf "$_tmp"
    return 1
  }

  echo "Installing security-gate tools to $BIN_DIR ..."

  if have jq; then
    note "✓ jq already present"
  else
    fail_tool jq "install via your package manager (apt/dnf install jq) — needed to classify semgrep --json output"
  fi

  if have gitleaks; then
    note "✓ gitleaks already present"
  elif install_tarball gitleaks \
        "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${A_X64}.tar.gz" \
        gitleaks; then
    verify gitleaks
  else
    fail_tool gitleaks "download/extract failed (pinned v${GITLEAKS_VERSION})"
  fi

  if have osv-scanner; then
    note "✓ osv-scanner already present"
  elif install_binary osv-scanner \
        "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_${A_AMD}"; then
    verify osv-scanner
  else
    fail_tool osv-scanner "download failed (pinned v${OSV_SCANNER_VERSION})"
  fi

  if have semgrep; then
    note "✓ semgrep already present"
  elif have pipx; then
    pipx install semgrep >/dev/null && verify semgrep || fail_tool semgrep "pipx install failed"
  elif have python3; then
    python3 -m pip install --user --quiet semgrep && verify semgrep \
      || fail_tool semgrep "pip --user install failed (try pipx)"
  else
    fail_tool semgrep "needs python3 or pipx"
  fi

  # TASK-033: the gate's shell lint stage BLOCKS without ShellCheck. Its release
  # is a static binary, so the pinned download works on any distro without sudo.
  if have shellcheck; then
    note "✓ shellcheck already present"
  elif install_tarball shellcheck \
        "https://github.com/koalaman/shellcheck/releases/download/v${SHELLCHECK_VERSION}/shellcheck-v${SHELLCHECK_VERSION}.linux.${A_SC}.tar.xz" \
        "shellcheck-v${SHELLCHECK_VERSION}/shellcheck"; then
    verify shellcheck
  else
    fail_tool shellcheck "download/extract failed (pinned v${SHELLCHECK_VERSION}; or install it with apt/dnf)"
  fi

  if [ "$WITH_INFRA" = "yes" ]; then
    echo "Installing IaC tools to $BIN_DIR ..."

    if have helm; then
      note "✓ helm already present"
    elif install_tarball helm \
          "https://get.helm.sh/helm-v${HELM_VERSION}-linux-${A_AMD}.tar.gz" \
          "linux-${A_AMD}/helm"; then
      verify helm
    else
      fail_tool helm "download/extract failed (pinned v${HELM_VERSION})"
    fi

    # cdk and terraform are deliberately NOT vendored as binaries here.
    # cdk is an npm package whose version must track the project's CDK library
    # version, and terraform's licence changed in 2023 — a project on OpenTofu
    # would get the wrong tool. Both are project decisions, not blueprint ones.
    have cdk || fail_tool cdk "install with: npm install -g aws-cdk (pin the version your infra/ uses)"
    have terraform || fail_tool terraform "install terraform (or opentofu) via your package manager or tfenv"
    have aws || fail_tool aws "install the AWS CLI v2 bundle from docs.aws.amazon.com, or via pipx install awscli"
  fi
fi

# --- Project-specific extensions (same pattern as .githooks/pre-push-project) -
if [ -f "$ROOT/scripts/install-toolchain-project.sh" ]; then
  echo "Project-specific tools ..."
  # shellcheck source=/dev/null
  . "$ROOT/scripts/install-toolchain-project.sh"
fi

echo
if [ -n "$FAILED" ]; then
  echo "❌ Some tools failed to install:$FAILED"
  echo "   Re-run after fixing, or install those manually."
  echo "   NOTE: the pre-push gate SKIPS a scanner it cannot find — a green gate"
  echo "   on this machine is currently checking less than a complete one."
  echo "   node/npm are the exception: they BLOCK rather than skip, because the"
  echo "   harness they run owns most of the suites and their absence would be"
  echo "   invisible in the render."
  exit 1
fi
echo "✅ Toolchain complete. Verify any time with: bash scripts/install-toolchain.sh check"
