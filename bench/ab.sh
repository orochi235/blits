#!/usr/bin/env bash
# Compare two revisions' frame cost, alternating which runs first each round.
#   bench/ab.sh <rev-a> <rev-b> <rounds> [rows...]
# Each revision is built from `git archive` into a temporary directory, removed on exit, and runs
# its own bench/frame.mjs, so a row must exist in both, unless AB_BENCH names one file both run.
# A revision of `.` is the working tree as it stands, for a tree synced to a node with its changes
# uncommitted. AB_EACH=1 runs each named row in a process of its own, so no row's numbers depend on
# the rows before it. Prints each run's rows as they finish.
set -euo pipefail
a="$1"; b="$2"; rounds="$3"; shift 3
root="$(git rev-parse --show-toplevel)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
dirOf() { if [[ "$1" == . ]]; then echo "$tmp/worktree"; else echo "$tmp/$1"; fi; }

for rev in "$a" "$b"; do
  dir="$(dirOf "$rev")"
  mkdir -p "$dir"
  if [[ "$rev" == . ]]; then
    (cd "$root" && git ls-files -co --exclude-standard -z | xargs -0 tar -cf -) | tar -x -C "$dir"
    label="the working tree"
  else
    git -C "$root" archive "$rev" | tar -x -C "$dir"
    label="$rev ($(git -C "$root" rev-parse --short "$rev"))"
  fi
  ln -s "$root/node_modules" "$dir/node_modules"
  if [[ -n "${AB_BENCH:-}" ]]; then cp "$root/$AB_BENCH" "$dir/bench/frame.mjs"; fi
  (cd "$dir" && npx tsc -b)
  echo "built $label"
done

for ((r = 1; r <= rounds; r++)); do
  if ((r % 2)); then order=("$a" "$b"); else order=("$b" "$a"); fi
  for rev in "${order[@]}"; do
    if [[ -n "${AB_EACH:-}" ]]; then
      for row in "$@"; do
        echo "== round $r/$rounds $rev"
        (cd "$(dirOf "$rev")" && node bench/frame.mjs "$row")
      done
      continue
    fi
    echo "== round $r/$rounds $rev"
    (cd "$(dirOf "$rev")" && node bench/frame.mjs "$@")
  done
done
