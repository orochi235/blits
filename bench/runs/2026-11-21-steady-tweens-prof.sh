#!/usr/bin/env bash
# Times and CPU-profiles tweens^ and weasel^ on this tree, 3 runs each alternating, FRAMES=5000
# (LONG=<ms> sets the tweens' length; the default 10 s lands them by frame 600):
# self time by function (bench/profsum.mjs), lines of the hot functions (bench/lines.mjs).
set -euo pipefail
npm ci --silent >/dev/null 2>&1 || true
npx tsc -b
dir=bench/runs/2026-11-21-steady-tweens-prof${SUFFIX:-}
mkdir -p "$dir"
echo "# LONG=${LONG:-10000} $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F) rev $(git rev-parse --short HEAD) FRAMES=5000 interval 50us"
for r in 1 2 3; do
  for row in 'tweens^' 'weasel^'; do
    name="${row%^}-$r"
    echo "== run $r/3 $row"
    rm -rf "$dir/tmp"
    FRAMES=5000 node --cpu-prof --cpu-prof-dir="$dir/tmp" --cpu-prof-interval 50 bench/frame.mjs "$row"
    mv "$dir"/tmp/*.cpuprofile "$dir/$name.cpuprofile"
    node bench/profsum.mjs "$dir/$name.cpuprofile" 25
    mkdir -p "$dir/tmp" && cp "$dir/$name.cpuprofile" "$dir/tmp/"
    TOP=20 node bench/lines.mjs "$dir/tmp" bareRows pullRun runMotion record rests
    rm -rf "$dir/tmp"
  done
done
