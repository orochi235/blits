#!/usr/bin/env bash
# CPU profiles of fn:10000:3, role, signal and blend on main (4eb821a3), 3 runs each, alternating,
# self time by function (bench/profsum.mjs) and the raw .cpuprofile files kept.
set -euo pipefail
base=4eb821a3
root="$(pwd)"
dir=bench/runs/2026-11-21-role-prof
mkdir -p "$dir"
npm ci --silent >/dev/null 2>&1
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git archive "$base" | tar -x -C "$tmp"
ln -s "$root/node_modules" "$tmp/node_modules"
(cd "$tmp" && npx tsc -b)
out=$dir/summary.txt
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F), onto --solo, main $base, FRAMES=5000, --cpu-prof-interval 100: rows fn:10000:3 role signal blend, 3 runs each" > $out
for r in 1 2 3; do
  for row in fn:10000:3 role signal blend; do
    name="${row%%:*}-$r"
    echo "== run $r/3 $row" | tee -a $out
    rm -rf "$tmp/prof"
    (cd "$tmp" && FRAMES=5000 node --cpu-prof --cpu-prof-dir=prof --cpu-prof-interval 100 bench/frame.mjs "$row") 2>&1 | tee -a $out
    cp "$tmp"/prof/*.cpuprofile "$dir/$name.cpuprofile"
    node "$root/bench/profsum.mjs" "$dir/$name.cpuprofile" 30 2>&1 | tee -a $out
    INCL=1 node "$root/bench/profsum.mjs" "$dir/$name.cpuprofile" 30 2>&1 | sed "s/^/incl /" | tee -a $out
  done
done
