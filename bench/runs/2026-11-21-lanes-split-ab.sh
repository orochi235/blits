#!/usr/bin/env bash
# lanes.ts split into modules (32f59d96) against the tree before it (807c41bc): frame rows through
# a probe (`probed`) and through `pull` (`tweens^`, `weasel^`), FRAMES=3000, each row in a process of
# its own, the order swapped each round.
set -euo pipefail
npm ci --silent >/dev/null 2>&1 || true
rounds="${1:-8}"
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F), $rounds rounds"
FRAMES=3000 AB_EACH=1 AB_BENCH=bench/frame.mjs bench/ab.sh 807c41bc 32f59d96 "$rounds" 'tweens^' 'weasel^' probed
