#!/usr/bin/env bash
# Upper bounds for the two next steps on the heatmap lanes gap, on one build under BLITS_EXP
# (2026-11-21-heatmap-owed-bounds.diff): 1 an owed subject read with no pose, its spring read and
# dropped (not correct, a bound on a cheaper owed read); 2 a fill committing a spring's timed due
# changes itself with no history, so nothing is owed. 5 rounds, rotated (bench/heatsplit.sh).
set -euo pipefail
dir=bench/runs/2026-11-21-heatmap-owed-bounds
mkdir -p "$dir"
npm ci --silent >/dev/null 2>&1
out=$dir/split.txt
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F), onto --quiet --max-cores 1, $(git rev-parse --short HEAD) plus 2026-11-21-heatmap-owed-bounds.diff: bench/heatsplit.sh 5" >"$out"
bench/heatsplit.sh 5 "$dir/split.jsonl" 0:spring/const/ink/on 1:spring/const/ink/on 2:spring/const/ink/on \
  0:spring/const/ink/off 0:spring/-/none/on 2:spring/-/none/on 0:spring/-/none/off | tee -a "$out"
