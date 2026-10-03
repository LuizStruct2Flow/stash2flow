#!/usr/bin/env bash
# scripts/sonar.sh — run SonarQube scanner with secrets sourced from .env.
#
# Usage: npm run sonar
#
# Reads SONAR_TOKEN + SONAR_HOST_URL from .env (gitignored) and exports
# them as env vars; sonar-scanner picks them up natively
# (sonar.token / sonar.host.url). Project config lives in
# sonar-project.properties.
#
# Requires sonar-scanner on PATH. It is deliberately NOT in
# scripts/install-toolchain.sh: that file installs what the pre-push GATE
# probes for, and Sonar is a post-commit audit a project opts into. Install via:
#   macOS   brew install sonar-scanner
#   Linux   unpack the CLI from sonarqube.org into ~/.local/bin
#   or add it to scripts/install-toolchain-project.sh if your project wants it
#   installed with the rest of the toolchain.
#
# Pass --no-coverage to skip regenerating coverage/lcov.info when the pre-push
# gate just ran. SonarQube has no shell analyser, so this also imports
# ShellCheck findings over the files the gate lints (SC2317 left out); files
# under a dot-directory such as .githooks/ are never indexed and stay with the
# gate's ShellCheck stage.
#
# Triage workflow (agent-driven; the founder rarely opens the UI):
#   1. Scan: npm run sonar. The first run creates the project if the token may.
#   2. Triage in severity order — BUG, then BLOCKER/CRITICAL, MAJOR, MINOR smells:
#        bash scripts/sonar-api.sh "/api/issues/search?componentKeys=<projectKey>&types=BUG&ps=20"
#        bash scripts/sonar-api.sh "/api/issues/search?componentKeys=<projectKey>&types=CODE_SMELL&severities=BLOCKER,CRITICAL&ps=20"
#   3. Fix each finding, or defer it with the rule, the count and the reason in
#      the commit message. A silent deferral is a smell of its own.
#   4. Re-scan and check the Quality Gate:
#        bash scripts/sonar-api.sh "/api/qualitygates/project_status?projectKey=<projectKey>"
#      OK is the bar; ERROR blocks the handoff.
#   5. Re-scan after each fix commit: the gate judges new-code violations on
#      their own, so touching a line can re-flag it.
# Coverage comes from the same lcov report the project's runner writes, so
# SonarQube shows coverage across time while the gate enforces it per push.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -f .env ]]; then
  # Export only SONAR_* keys from .env so we don't leak other secrets
  # (ANTHROPIC_API_KEY, LINKEDIN_LI_AT, etc.) into a child process that
  # doesn't need them.
  #
  # NOTE: we use `eval "$(grep ...)"` instead of `source <(grep ...)`
  # because macOS still ships bash 3.2, and process-substitution into
  # `source` has a scope bug there — the variables get set but never
  # propagate back to the parent shell. eval is bash-3.2-safe and
  # the grep filter still constrains what gets evaluated to SONAR_* lines.
  set -a
  eval "$(grep -E '^SONAR_[A-Z_]+=' .env || true)"
  set +a
fi

if [[ -z "${SONAR_TOKEN:-}" ]]; then
  echo "❌ SONAR_TOKEN is not set. Add it to .env (see .env.example)." >&2
  exit 1
fi
if [[ -z "${SONAR_HOST_URL:-}" ]]; then
  echo "❌ SONAR_HOST_URL is not set. Add it to .env (see .env.example)." >&2
  exit 1
fi

if ! command -v sonar-scanner >/dev/null 2>&1; then
  echo "❌ sonar-scanner not found on PATH. macOS: brew install sonar-scanner." >&2
  echo "   Linux: unpack the CLI from sonarqube.org into ~/.local/bin." >&2
  exit 1
fi

# Regenerate coverage/lcov.info from a fresh vitest run before scanning,
# so SonarQube always reads the latest numbers. Skip with --no-coverage
# if you already ran the gate locally and just want to re-upload.
if [[ "${1:-}" == "--no-coverage" ]]; then
  shift
else
  echo "→ regenerating coverage (npm run test:coverage)..."
  npm run test:coverage --silent
fi

# Shell: SonarQube has no shell analyser, so ShellCheck's findings on the files
# the gate lints are imported as external issues. SC2317 is left out: functions
# the gate calls by name (pipe_stage) read as unreachable, hundreds of times.
# Files under a dot-directory (.githooks/) are never indexed by the scanner, so
# their findings are dropped by Sonar; the gate's ShellCheck stage still covers them.
if command -v shellcheck >/dev/null 2>&1; then
  # shellcheck source=scripts/run-ts-suites.sh
  . scripts/run-ts-suites.sh
  sh_files=()
  while IFS= read -r f; do
    [[ -n "$f" ]] && sh_files+=("$f")
  done < <(sh_lint_files .)
  if [[ ${#sh_files[@]} -gt 0 ]]; then
    mkdir -p .scannerwork
    # Exit 1 means ShellCheck had findings, which is the normal case.
    shellcheck -f json -e SC2317 -- "${sh_files[@]}" >.scannerwork/shellcheck.json || true
    jq '{
      rules: (group_by(.code) | map(.[0] | {
        id: "SC\(.code)", name: "ShellCheck SC\(.code)",
        description: "https://www.shellcheck.net/wiki/SC\(.code)",
        engineId: "shellcheck", cleanCodeAttribute: "CONVENTIONAL",
        impacts: [if .level == "error" then {softwareQuality: "RELIABILITY", severity: "HIGH"}
                  elif .level == "warning" then {softwareQuality: "RELIABILITY", severity: "MEDIUM"}
                  else {softwareQuality: "MAINTAINABILITY", severity: "LOW"} end]
      })),
      issues: map({ruleId: "SC\(.code)",
        primaryLocation: {message: .message, filePath: .file, textRange: {startLine: .line}}})
    }' .scannerwork/shellcheck.json >.scannerwork/shellcheck-sonar.json
    set -- -Dsonar.externalIssuesReportPaths=.scannerwork/shellcheck-sonar.json "$@"
    echo "→ ShellCheck: ${#sh_files[@]} shell files, findings imported as external issues"
  fi
else
  echo "⚠ shellcheck not found: shell scripts will not be analysed (bash scripts/install-toolchain.sh)" >&2
fi

exec sonar-scanner "$@"
