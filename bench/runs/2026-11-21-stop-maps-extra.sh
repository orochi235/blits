#!/usr/bin/env bash
# The ceiling on folding subject-keyed maps together: a stop's cost with 0, 1 and 2 extra maps of
# the bench's own keyed by subject (bench/stopextra.mjs), each variant in a process of its own,
# the order reversed every other round. Built by a separate job (BUILT=1) or here.
set -euo pipefail
[[ -n "${BUILT:-}" ]] || npm ci --silent >/dev/null 2>&1 || true
[[ -n "${BUILT:-}" ]] || npx tsc -b
rounds="${1:-8}"
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F) rev $(git rev-parse --short HEAD), $rounds rounds"
total=$((rounds * 3)); k=0
for ((r = 1; r <= rounds; r++)); do
  order=(0 1 2); ((r % 2 == 0)) && order=(2 1 0)
  for e in "${order[@]}"; do
    k=$((k + 1))
    echo "== round $r/$rounds extra $e"
    EXTRA=$e node bench/stopextra.mjs 1000 10000 40000
    echo "onto: progress $k/$total"
  done
done
