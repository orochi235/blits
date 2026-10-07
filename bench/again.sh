#!/usr/bin/env bash
# Run rows of this tree's bench/frame.mjs several times, each in a process of its own and rounds
# interleaved, so no row's numbers depend on the rows before it.
#   bench/again.sh <rounds> <rows...>
# Prints `onto: progress` lines, so a run on the fleet gets a bar.
set -euo pipefail
rounds="$1"; shift
root="$(git rev-parse --show-toplevel)"
(cd "$root" && npx tsc -b)
total=$((rounds * $#))
echo "onto: plan $total"
done=0
for ((r = 1; r <= rounds; r++)); do
  for row in "$@"; do
    node "$root/bench/frame.mjs" "$row" | sed "s|^ 1/1 |r$r |"
    done=$((done + 1))
    echo "onto: progress $done/$total"
  done
done
