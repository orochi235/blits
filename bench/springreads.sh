#!/bin/sh
# Times weasel's animator shape: one spring voice per subject read by `pull` (`springs^`), with a
# handle `read` per voice each frame as the animator reports its springs (READS=read), and with
# `landed` asked instead (READS=landed). Modes interleave within each round.
#   bench/springreads.sh <rounds> [out]
set -e
rounds=${1:-5}
out=${2:-bench/runs/$(date +%Y-%m-%d)-spring-reads.txt}
npx tsc -b --force
echo "# $(hostname -s) FRAMES=5000 bench/springreads.sh $rounds" > "$out"
r=1
while [ "$r" -le "$rounds" ]; do
  for reads in none read landed; do
    for row in 'springs^:1000:1' 'springs^:10000:1'; do
      line=$(READS=$reads FRAMES=5000 node bench/frame.mjs "$row" | grep 'springs^')
      echo "round $r reads=$reads $line" | tee -a "$out"
    done
  done
  r=$((r + 1))
done
