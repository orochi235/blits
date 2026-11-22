#!/usr/bin/env bash
# The tree before lanes.ts was split (807c41bc), the split (32f59d96), and the split with a probe's
# lane methods kept in the class body (af819883, the same tree as 3b1038c6): `probed`, `tweens^`
# and `weasel^` at FRAMES=3000, each in a process of its own, the order rotated each round.
set -euo pipefail
npm ci --silent >/dev/null 2>&1 || true
rounds="${1:-10}"
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F), $rounds rounds"
FRAMES=3000 bench/lineage.sh "$rounds" 807c41bc 32f59d96 af819883 -- probed 'tweens^' 'weasel^'
