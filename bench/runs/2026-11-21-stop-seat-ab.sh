#!/usr/bin/env bash
# A stop at 1k/10k/40k subjects (bench/restart.mjs) and steady frames (bench/frame.mjs at
# FRAMES=5000) on main b2e157dc, f439e5be (a dropped subject's chain looked up once, backed out:
# 2026-11-21-stop-one-lookup.diff) and 9305a16f (crowd voices placed by voice on top of it, kept as
# 60d4ec5b), each in a process of its own, the builds in a rotated order each round. Both commits
# exist only in the clone that ran it.
set -euo pipefail
npm ci --silent >/dev/null 2>&1 || true
rounds="${1:-10}"
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F), $rounds rounds"
LINEAGE_BENCH=restart.mjs bench/lineage.sh "$rounds" b2e157dc f439e5be 9305a16f -- '1000 10000 40000'
FRAMES=5000 bench/lineage.sh "$((rounds * 2 / 3))" b2e157dc f439e5be 9305a16f -- 'tweens^' 'weasel^' 'churn^' 'turnover^'
