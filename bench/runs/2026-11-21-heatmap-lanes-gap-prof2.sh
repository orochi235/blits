#!/usr/bin/env bash
# After 4a7299d8: self time inside `pull` alone (bench/profsum.mjs UNDER=pull), for the heatmap's spring, ink holds
# and both, const weights, lanes on and off, 2 runs each alternating, FRAMES=1500. Only the
# summaries are kept; the .cpuprofile files are removed on exit.
set -euo pipefail
root="$(pwd)"
dir=bench/runs/2026-11-21-heatmap-lanes-gap-prof2
mkdir -p "$dir"
npm ci --silent >/dev/null 2>&1
npx tsc -b
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
out=$dir/summary.txt
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F), onto --quiet --max-cores 1, $(git rev-parse --short HEAD), FRAMES=1500, --cpu-prof-interval 100" >"$out"
k=0
for r in 1 2; do
  for s in spring/const/ink none/const/ink; do
    for lanes in on off; do
      k=$((k + 1))
      name="$(echo "$s" | tr '/' '-' | tr -d '-')-$lanes-$r"
      rm -rf "$tmp/prof"
      echo "== run $r/2 $s/$lanes" | tee -a "$out"
      FRAMES=1500 node --cpu-prof --cpu-prof-dir="$tmp/prof" --cpu-prof-interval 100 \
        bench/heatmap.mjs "$s/$lanes" 2>&1 | grep 'read p50' | tee -a "$out"
      cp "$tmp"/prof/*.cpuprofile "$tmp/$name.cpuprofile"
      UNDER=pull node "$root/bench/profsum.mjs" "$tmp/$name.cpuprofile" 30 | sed 's/^/self /' | tee -a "$out"
      UNDER=pull INCL=1 node "$root/bench/profsum.mjs" "$tmp/$name.cpuprofile" 30 | sed 's/^/incl /' | tee -a "$out"
      echo "onto: progress $k/8"
    done
  done
done
