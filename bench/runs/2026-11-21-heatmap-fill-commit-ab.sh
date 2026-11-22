#!/usr/bin/env bash
# A fill committing the timed due changes of a motion subject the pull under way reads for certain,
# with no history, against owing it to the general path (BLITS_EXP=1 turns it off), one build,
# 2026-11-21-heatmap-fill-commit-ab.diff. 5 rounds, rotated (bench/heatsplit.sh).
set -euo pipefail
dir=bench/runs/2026-11-21-heatmap-fill-commit-ab
mkdir -p "$dir"
npm ci --silent >/dev/null 2>&1
out=$dir/split.txt
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F), onto --quiet --max-cores 1, $(git rev-parse --short HEAD) plus 2026-11-21-heatmap-fill-commit-ab.diff: bench/heatsplit.sh 5" >"$out"
bench/heatsplit.sh 5 "$dir/split.jsonl" 1:spring/const/ink/on 0:spring/const/ink/on 0:spring/const/ink/off \
  1:spring/-/none/on 0:spring/-/none/on 0:spring/-/none/off 0:none/const/ink/on 0:none/const/ink/off | tee -a "$out"
