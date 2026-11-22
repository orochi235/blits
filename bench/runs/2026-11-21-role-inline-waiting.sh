#!/usr/bin/env bash
# main against this tree (roles inlined past members yet to start, done or idle), this tree's bench on both.
set -euo pipefail
npm ci --silent >/dev/null 2>&1
out=bench/runs/2026-11-21-role-tmp/out.txt
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F), onto --max-cores 1 (shared node), FRAMES=3000: AB_EACH=1 AB_BENCH=bench/frame.mjs bench/ab.sh 4eb821a3 . 9 role rolewait blend fn:10000:3" > $out
FRAMES=3000 AB_EACH=1 AB_BENCH=bench/frame.mjs bash bench/ab.sh 4eb821a3 . 9 role rolewait blend fn:10000:3 2>&1 | grep -v deprecated | tee -a $out
