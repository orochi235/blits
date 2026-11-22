#!/usr/bin/env bash
# Builds sides of bench/cue-wide.mjs in one job and runs them interleaved in another on the same node.
#   build: bench/cuewide.sh build <side>...      (a --kind build job)
#   run:   bench/cuewide.sh run <rounds> <side>... -- <cue-wide args>   (a --kind bench job, --max-cores 2)
#   prof:  bench/cuewide.sh prof <side> -- <cue-wide args>   CPU profiles into bench/runs/<CUEWIDE_PROF>-<side>/
# A side is `base` (HEAD, which on a node is the commit synced from), `tree` (the synced working
# tree), or a diff under bench/runs/ applied to HEAD, named without its `.diff`. Each round runs
# every side in a process of its own, the order reversed every other round; run and prof take the
# synced tree's bench/cue-wide.mjs, so the bench can change without a rebuild. NODE_FLAGS passes flags to node, such as --no-turbo-inlining for a profile.
set -euo pipefail
root="$(pwd)"; sides="$HOME/.cache/blits-cuewide-sides"
mode="$1"; shift
if [[ "$mode" == build ]]; then
  npm ci --silent >/dev/null 2>&1 || true
  rm -rf "$sides"
  for side in "$@"; do
    mkdir -p "$sides/$side"
    if [[ "$side" == tree ]]; then
      git ls-files -co --exclude-standard -z | xargs -0 tar -cf - | tar -x -C "$sides/$side"
    else
      git archive HEAD | tar -x -C "$sides/$side"
    fi
    cp bench/cue-wide.mjs "$sides/$side/bench/cue-wide.mjs"
    ln -s "$root/node_modules" "$sides/$side/node_modules"
    if [[ "$side" != base && "$side" != tree ]]; then
      (cd "$sides/$side" && git apply "$root/bench/runs/$side.diff")
    fi
    (cd "$sides/$side" && npx tsc -b) && echo "built $side"
  done
  exit 0
fi
if [[ "$mode" == prof ]]; then
  side="$1"; shift; shift
  dir="$root/bench/runs/${CUEWIDE_PROF:?}-$side"
  cp bench/cue-wide.mjs "$sides/$side/bench/cue-wide.mjs"
  (cd "$sides/$side" && PROF="$dir" node ${NODE_FLAGS:-} bench/cue-wide.mjs "$@")
  exit 0
fi
rounds="$1"; shift
all=()
while [[ "$1" != -- ]]; do all+=("$1"); shift; done
shift
for side in "${all[@]}"; do cp bench/cue-wide.mjs "$sides/$side/bench/cue-wide.mjs"; done
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F) HEAD $(git rev-parse --short HEAD), $rounds rounds, sides ${all[*]}, cue-wide $*"
for ((r = 1; r <= rounds; r++)); do
  order=("${all[@]}")
  if ((r % 2 == 0)); then order=(); for ((i = ${#all[@]} - 1; i >= 0; i--)); do order+=("${all[$i]}"); done; fi
  for side in "${order[@]}"; do
    echo "== round $r/$rounds $side"
    (cd "$sides/$side" && node ${NODE_FLAGS:-} bench/cue-wide.mjs "$@")
  done
done
