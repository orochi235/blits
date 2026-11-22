#!/usr/bin/env bash
# The heatmap lanes gap split by voice kind after 4a7299d8: spring alone, ink holds alone and both,
# const weights, lanes on and off, 5 rounds rotated (bench/heatsplit.sh).
set -euo pipefail
dir=bench/runs/2026-11-21-heatmap-lanes-gap-after
mkdir -p "$dir"
npm ci --silent >/dev/null 2>&1
out=$dir/split.txt
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F), onto --quiet --max-cores 1, $(git rev-parse --short HEAD): bench/heatsplit.sh 5, exp 0" >"$out"
bench/heatsplit.sh 5 "$dir/split.jsonl" \
  0:spring/const/ink/on 0:spring/const/ink/off \
  0:none/const/ink/on 0:none/const/ink/off \
  0:spring/-/none/on 0:spring/-/none/off | tee -a "$out"
