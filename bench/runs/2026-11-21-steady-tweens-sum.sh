#!/usr/bin/env bash
# main's src (`head`) against this tree's (`sum`: foldNumber's sum written out in bareRows and
# runMotion), and the tree with BLITS_SW=4 (`flat`: a lane whose every fade in is over weighs flat).
#   build: bench/runs/2026-11-21-steady-tweens-sum.sh build     (in a --kind build job, many cores)
#   run:   bench/runs/2026-11-21-steady-tweens-sum.sh run <rounds>
# The `flat` side needs the switches: apply 2026-11-21-steady-tweens-switches.diff to the tree
# first (see steady-tweens-switches.sh). The kept change, measured with no switches, is
# 2026-11-21-steady-tweens-retime.sh.
# Each side and row in a process of its own, FRAMES=5000, order reversed every other round. Rows
# with LONG=1e9 keep their tweens in flight; `tweens^ landed` is tweens^ with LONG=1.
set -euo pipefail
# The built sides live outside the tree, which the next job's sync sets aside; the run removes them.
root="$(pwd)"; sides="$HOME/.cache/blits-steady-sides"
if [[ "$1" == build ]]; then
  npm ci --silent >/dev/null 2>&1 || true
  rm -rf "$sides"; mkdir -p "$sides/head" "$sides/dirty"
  for side in head dirty; do
    git ls-files -co --exclude-standard -z | xargs -0 tar -cf - | tar -x -C "$sides/$side"
    ln -s "$root/node_modules" "$sides/$side/node_modules"
  done
  git diff HEAD -- src | (cd "$sides/head" && patch -s -R -p1)
  rm -f "$sides/head/src/sw.ts"
  for side in head dirty; do (cd "$sides/$side" && npx tsc -b) && echo "built $side"; done
  exit 0
fi
rounds="$2"
trap 'rm -rf "$sides"' EXIT
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F) base $(git rev-parse --short HEAD), $rounds rounds, FRAMES=5000"
specs=('tweens^:1000000000' 'weasel^:1000000000' 'tweens^:1' 'churn^:1000000000' 'turnover^:1000000000')
total=$((rounds * 3 * ${#specs[@]})); k=0
for ((r = 1; r <= rounds; r++)); do
  order=(head sum flat); if ((r % 2 == 0)); then order=(flat sum head); fi
  for side in "${order[@]}"; do
    dir="$sides/dirty"; sw=0
    [[ "$side" == head ]] && dir="$sides/head"
    [[ "$side" == flat ]] && sw=4
    for spec in "${specs[@]}"; do
      row="${spec%%:*}"; long="${spec#*:}"; k=$((k + 1))
      label="$side"; [[ "$long" == 1 ]] && label="$side-landed"
      echo "== round $r/$rounds $label ($k/$total)"
      (cd "$dir" && BLITS_SW=$sw LONG=$long FRAMES=5000 node bench/frame.mjs "$row")
    done
  done
done
