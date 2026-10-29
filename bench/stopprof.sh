#!/usr/bin/env bash
# CPU-profiles bench/restart.mjs at each size, one process a size, and prints self time inside the
# stop by function (bench/stopprof.mjs). Profiles are kept in bench/out/prof-<N>.
#   bench/stopprof.sh [N...]    default 1000 40000; ROUNDS (default 1000) rounds a size
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
npm ci --silent >/dev/null 2>&1 || true
npx tsc -b
rounds="${ROUNDS:-1000}"
sizes=("$@"); ((${#sizes[@]})) || sizes=(1000 40000)
mkdir -p bench/out
for n in "${sizes[@]}"; do
  d="bench/out/prof-$n"
  rm -rf "$d"
  NOWARM=1 ROUNDS="$rounds" node --cpu-prof --cpu-prof-interval 50 --cpu-prof-dir="$d" bench/restart.mjs "$n"
  node bench/stopprof.mjs "$d" "$(((rounds + 50) * 100))" 45
done
