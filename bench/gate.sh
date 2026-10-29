#!/usr/bin/env bash
# What a speed change passes before it is timed, run on a fleet node: lint, typecheck, the named
# test files, and bench/same.sh against a revision with lanes on and with SAME_LANES=off.
#   bench/gate.sh <rev> [test files...]
set -euo pipefail
rev="$1"; shift
npm ci --silent >/dev/null 2>&1 || true
echo "== lint"; npm run --silent lint
echo "== typecheck"; npm run --silent typecheck
if (($#)); then echo "== vitest $*"; npx vitest run "$@"; fi
echo "== same $rev"; bench/same.sh "$rev"
echo "== same $rev SAME_LANES=off"; SAME_LANES=off bench/same.sh "$rev"
