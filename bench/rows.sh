#!/usr/bin/env bash
# One build, each row in its own process, rounds reversing the row order: to compare rows, such as
# a row with lanes on and off (`fns` and `fns-:10000:1`), with no second build. Each line reads
# `round <r>` and then the row as bench/frame.mjs prints it. A row given as `NAME=value@row` runs
# with that variable set, and its line reads `round <r> NAME=value`.
set -uo pipefail
npm ci --silent >/dev/null 2>&1 || true
npx tsc -b
rounds="$1"; shift
rows=("$@")
echo "onto: plan $((rounds * ${#rows[@]}))"
done=0
for ((r = 1; r <= rounds; r++)); do
  order=("${rows[@]}")
  if ((r % 2 == 0)); then order=(); for ((i = ${#rows[@]} - 1; i >= 0; i--)); do order+=("${rows[$i]}"); done; fi
  for row in "${order[@]}"; do
    env=(); name="$row"
    if [[ "$row" == *@* ]]; then env=("${row%%@*}"); name="${row#*@}"; fi
    printf 'round %d %s ' "$r" "${env[*]:-}"
    env "${env[@]}" node bench/frame.mjs "$name" | grep -E '^ *[0-9]+/'
    done=$((done + 1)); echo "onto: progress $done/$((rounds * ${#rows[@]}))"
  done
done
