#!/usr/bin/env bash
# A subject's chain head and `named`'s list in one entry (57a30b0d, backed out; it exists only in
# the clone that ran this, and its diff is 2026-11-21-stop-kept.diff) against the tree before it
# (c89b3407): a stop at 1k/10k/40k (bench/restart.mjs), and probe rows `probed`, `tween-` (general path) and `churn` (a drop a frame)
# beside `tweens^` (pull), FRAMES=3000, each in a process of its own, the order rotated each round.
set -euo pipefail
npm ci --silent >/dev/null 2>&1 || true
a=c89b3407; b=57a30b0d; rounds="${1:-10}"
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F), $rounds rounds, $a against $b"
LINEAGE_BENCH=restart.mjs bench/lineage.sh "$rounds" "$a" "$b" -- '1000 10000 40000'
FRAMES=3000 bench/lineage.sh "$rounds" "$a" "$b" -- probed tween- churn 'tweens^'
