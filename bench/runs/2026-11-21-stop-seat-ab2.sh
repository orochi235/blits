#!/usr/bin/env bash
# A stop at 1k/10k/40k subjects (bench/restart.mjs) on main b2e157dc against 60d4ec5b alone (crowd
# voices placed by voice, so a stop reads its seat off the voice), each in a process of its own,
# the order swapped each round.
set -euo pipefail
npm ci --silent >/dev/null 2>&1 || true
rounds="${1:-12}"
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F), $rounds rounds"
LINEAGE_BENCH=restart.mjs bench/lineage.sh "$rounds" b2e157dc 60d4ec5b -- '1000 10000 40000'
