#!/usr/bin/env bash
# The other foldNumber call sites, four sides built from a tree at 7e16d34f (later commits hold the
# diffs already, so run it there): `base` as it stands; `axes` with
# bench/runs/2026-11-21-fold-axes.diff (a `foldAxes` helper asking the op once a channel, at the
# array sites in keyfill, keyrows, gather and runMotion's general sample); `flat` with
# 2026-11-21-fold-flat.diff (foldNumber's arithmetic written out in its own body); `both`.
#   build: bench/runs/2026-11-21-fold-sites.sh build        (a --kind build job)
#   run:   bench/runs/2026-11-21-fold-sites.sh run <rounds> (a --kind bench job, --max-cores 2)
# Each side and row in a process of its own, the side order reversed every other round. Light rows
# at FRAMES=5000 (tweens^ and weasel^ at LONG=1e9, in flight), heavy ones at FRAMES=1500.
set -euo pipefail
root="$(pwd)"; sides="$HOME/.cache/blits-fold-sides"
all=(base axes flat both)
if [[ "$1" == build ]]; then
  npm ci --silent >/dev/null 2>&1 || true
  rm -rf "$sides"
  for side in "${all[@]}"; do
    mkdir -p "$sides/$side"
    git ls-files -co --exclude-standard -z | xargs -0 tar -cf - | tar -x -C "$sides/$side"
    ln -s "$root/node_modules" "$sides/$side/node_modules"
  done
  (cd "$sides/axes" && patch -s -p1 < "$root/bench/runs/2026-11-21-fold-axes.diff")
  (cd "$sides/flat" && patch -s -p1 < "$root/bench/runs/2026-11-21-fold-flat.diff")
  (cd "$sides/both" && patch -s -p1 < "$root/bench/runs/2026-11-21-fold-axes.diff" \
    && patch -s -p1 < "$root/bench/runs/2026-11-21-fold-flat.diff")
  for side in "${all[@]}"; do (cd "$sides/$side" && npx tsc -b) && echo "built $side"; done
  exit 0
fi
rounds="$2"
trap 'rm -rf "$sides"' EXIT
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F) base $(git rev-parse --short HEAD), $rounds rounds, onto --quiet --max-cores 2"
specs=('tweens^:5000' 'weasel^:5000' 'springs^:5000' 'keyses^:5000' 'frozen^:5000'
  'keys^:10000:3:1500' 'fn^:1500' 'role:1500' 'keys-:1500')
total=$((rounds * ${#all[@]} * ${#specs[@]})); k=0
for ((r = 1; r <= rounds; r++)); do
  order=("${all[@]}"); if ((r % 2 == 0)); then order=(both flat axes base); fi
  for side in "${order[@]}"; do
    for spec in "${specs[@]}"; do
      row="${spec%:*}"; frames="${spec##*:}"; k=$((k + 1))
      echo "== round $r/$rounds $side ($k/$total)"
      (cd "$sides/$side" && LONG=1000000000 FRAMES=$frames node bench/frame.mjs "$row")
    done
  done
done
