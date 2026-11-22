#!/usr/bin/env bash
# The heatmap demo's own setting, input signal weights, lanes on and off, after a pull's fill
# commits motion changes (2026-11-21). 5 rounds, rotated (bench/heatsplit.sh).
set -euo pipefail
dir=bench/runs/2026-11-21-heatmap-input-after
mkdir -p "$dir"
npm ci --silent >/dev/null 2>&1
out=$dir/split.txt
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F), onto --quiet --max-cores 1, $(git rev-parse --short HEAD) plus the fill commit, uncommitted: bench/heatsplit.sh 5" >"$out"
bench/heatsplit.sh 5 "$dir/split.jsonl" 0:spring/input/ink/on 0:spring/input/ink/off | tee -a "$out"
