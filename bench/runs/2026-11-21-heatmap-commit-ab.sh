#!/usr/bin/env bash
# A motion commit without the stretch it would page out at once, on one build under BLITS_EXP:
# 0 as main, 1 `insert` writing a later stretch straight in with no horizon and nothing older kept,
# 2 that and `commit` evaluating the stretch in force from the run, one subject lookup a commit.
# The switches are 2026-11-21-heatmap-commit-ab.diff. 5 rounds, rotated (bench/heatsplit.sh).
set -euo pipefail
dir=bench/runs/2026-11-21-heatmap-commit-ab
mkdir -p "$dir"
npm ci --silent >/dev/null 2>&1
out=$dir/split.txt
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F), onto --quiet --max-cores 1, $(git rev-parse --short HEAD) plus 2026-11-21-heatmap-commit-ab.diff: bench/heatsplit.sh 5" >"$out"
runs=()
for s in spring/const/ink/on spring/const/ink/off spring/-/none/on spring/-/none/off; do
  for e in 0 1 2; do runs+=("$e:$s"); done
done
bench/heatsplit.sh 5 "$dir/split.jsonl" "${runs[@]}" | tee -a "$out"
