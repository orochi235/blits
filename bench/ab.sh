#!/usr/bin/env bash
# Compare two revisions' frame cost, alternating which runs first each round.
#   bench/ab.sh <rev-a> <rev-b> <rounds> [rows...]
# Each revision is built from `git archive` into a temporary directory, removed on exit, and runs
# its own bench/frame.mjs, so a row must exist in both, unless AB_BENCH names one file both run.
# Prints each run's rows as they finish.
set -euo pipefail
a="$1"; b="$2"; rounds="$3"; shift 3
root="$(git rev-parse --show-toplevel)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for rev in "$a" "$b"; do
  dir="$tmp/$rev"
  mkdir -p "$dir"
  git -C "$root" archive "$rev" | tar -x -C "$dir"
  ln -s "$root/node_modules" "$dir/node_modules"
  if [[ -n "${AB_BENCH:-}" ]]; then cp "$root/$AB_BENCH" "$dir/bench/frame.mjs"; fi
  (cd "$dir" && npx tsc -b)
  echo "built $rev ($(git -C "$root" rev-parse --short "$rev"))"
done

for ((r = 1; r <= rounds; r++)); do
  if ((r % 2)); then order=("$a" "$b"); else order=("$b" "$a"); fi
  for rev in "${order[@]}"; do
    echo "== round $r/$rounds $rev"
    (cd "$tmp/$rev" && node bench/frame.mjs "$@")
  done
done
