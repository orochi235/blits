#!/usr/bin/env bash
# Runs rows of bench/reach.mjs and the bench/frame.mjs rows they are read against several times,
# each in a process of its own and rounds interleaved, as bench/again.sh does.
#   FRAMES=5000 bench/reach.sh <rounds> [rows...] > reach.txt && node bench/reachcost.mjs reach.txt
# A row bench/reach.mjs does not name is bench/frame.mjs's. With no rows, every row the summary
# reads. Prints `onto: progress` lines, so a run on the fleet gets a bar.
set -euo pipefail
rounds="$1"; shift
root="$(git rev-parse --show-toplevel)"
(cd "$root" && npx tsc -b)
rows=("$@")
if ((${#rows[@]} == 0)); then
  for read in "" "-" "^"; do
    rows+=("glowbase$read" "glow$read")
    for way in part drop own; do
      for k in 0 2 20 200; do rows+=("$way:$k$read"); done
      rows+=("$way/200$read")
    done
    for k in 0 2 20 200; do rows+=("stale:$k$read"); done
    rows+=("own:0:0$read")
  done
fi
total=$((rounds * ${#rows[@]}))
echo "onto: plan $total"
done=0
for ((r = 1; r <= rounds; r++)); do
  for row in "${rows[@]}"; do
    case "$row" in
      part[:/]* | drop[:/]* | own[:/]* | stale:*) bench=reach.mjs ;;
      *) bench=frame.mjs ;;
    esac
    node "$root/bench/$bench" "$row" | sed "s|^ 1/1 |r$r |"
    done=$((done + 1))
    echo "onto: progress $done/$total"
  done
done
