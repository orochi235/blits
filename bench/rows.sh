#!/usr/bin/env bash
# One build, each row in its own process, rounds reversing the row order: to compare rows, such as
# a row with lanes on and off (`fns` and `fns-:10000:1`), with no second build. Each line reads
# `round <r>` and then the row as bench/frame.mjs prints it.
set -uo pipefail
npm ci --silent >/dev/null 2>&1 || true
npx tsc -b
rounds="$1"; shift
rows=("$@")
for ((r = 1; r <= rounds; r++)); do
  order=("${rows[@]}")
  if ((r % 2 == 0)); then order=(); for ((i = ${#rows[@]} - 1; i >= 0; i--)); do order+=("${rows[$i]}"); done; fi
  for row in "${order[@]}"; do
    printf 'round %d ' "$r"
    node bench/frame.mjs "$row" | grep -E '^ *[0-9]+/'
  done
done
