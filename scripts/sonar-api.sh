#!/usr/bin/env bash
# scripts/sonar-api.sh — call a SonarQube REST endpoint with auth.
#
# Usage:
#   scripts/sonar-api.sh /api/measures/component?component=KEY&metricKeys=bugs
#
# Sources SONAR_HOST_URL + SONAR_TOKEN from .env (gitignored) and curls
# the endpoint with HTTP Basic auth. Output is raw JSON — pipe through
# `jq` for filtering. Same env contract as scripts/sonar.sh; this
# wrapper just spares Claude/users from chaining the var-load + curl
# every time.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 /api/<path>?<query>" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC2046
  eval "$(grep -E '^SONAR_[A-Z_]+=' .env || true)"
  set +a
fi

if [[ -z "${SONAR_TOKEN:-}" ]]; then
  echo "❌ SONAR_TOKEN not set. Add it to .env." >&2
  exit 1
fi
if [[ -z "${SONAR_HOST_URL:-}" ]]; then
  echo "❌ SONAR_HOST_URL not set. Add it to .env." >&2
  exit 1
fi

curl -sS -u "${SONAR_TOKEN}:" "${SONAR_HOST_URL}$1"
