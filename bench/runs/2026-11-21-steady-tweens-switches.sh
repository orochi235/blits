#!/usr/bin/env bash
# To rerun: on 1a261955 apply 2026-11-21-steady-tweens-switches.diff (`patch -p1 <` it), which
# puts back src/sw.ts and the switches; 1a261955's mid-fill flat clearing stays in, which the
# original run (on a7702546 plus the uncommitted switches) lacked.
# One build with experiment switches (BLITS_SW bits, src/sw.ts): 1 sums folded
# inline in bareRows/runMotion, 2 Trail.record compares its list before storing, 4 a lane whose
# every fade in is over weighs flat. Each variant and row in a process of its own, the order
# reversed every other round, FRAMES=5000 (a short process runs on 1.5 cores, over onto's 1): rows
# tweens^ and weasel^ with LONG=1e9 (in flight throughout), and tweens^ with LONG=1 (landed from the
# first frame).
set -euo pipefail
[[ -n "${BUILT:-}" ]] || npm ci --silent >/dev/null 2>&1 || true
[[ -n "${BUILT:-}" ]] || npx tsc -b
rounds="${1:-8}"
variants=(0 1 2 4 7)
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F) rev $(git rev-parse --short HEAD) + switches, $rounds rounds"
total=$((rounds * ${#variants[@]} * 3)); k=0
for ((r = 1; r <= rounds; r++)); do
  order=("${variants[@]}")
  if ((r % 2 == 0)); then order=(7 4 2 1 0); fi
  for v in "${order[@]}"; do
    for spec in 'tweens^:1000000000' 'weasel^:1000000000' 'tweens^:1'; do
      row="${spec%%:*}"; long="${spec#*:}"
      k=$((k + 1))
      label="sw$v"; [[ "$long" == 1 ]] && label="sw$v-landed"
      echo "== round $r/$rounds $label ($k/$total)"
      BLITS_SW=$v LONG=$long FRAMES=5000 node bench/frame.mjs "$row"
    done
  done
done
