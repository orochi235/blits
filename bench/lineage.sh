#!/usr/bin/env bash
# Runs this tree's bench/frame.mjs against several revisions, each row in a process of its own, the
# revisions in a rotated order each round, so old releases and today read on one scale.
#   bench/lineage.sh <rounds> <rev>... -- <rows...>
# A revision of `.` is the working tree. Each is built from `git archive` into a temporary directory,
# removed on exit. A row an old build cannot run prints its error and the rest go on; an option an
# old build does not know is ignored by it, so read a row only from builds that have what it uses.
# Reduce the output with `node bench/lineage.mjs <output>`.
set -euo pipefail
rounds="$1"; shift
revs=()
while [[ "$1" != -- ]]; do revs+=("$1"); shift; done
shift
root="$(git rev-parse --show-toplevel)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for rev in "${revs[@]}"; do
  dir="$tmp/${rev//\//_}"
  mkdir -p "$dir"
  if [[ "$rev" == . ]]; then
    (cd "$root" && git ls-files -co --exclude-standard -z | xargs -0 tar -cf -) | tar -x -C "$dir"
  else
    git -C "$root" archive "$rev" | tar -x -C "$dir"
  fi
  ln -s "$root/node_modules" "$dir/node_modules"
  cp "$root/bench/frame.mjs" "$dir/bench/frame.mjs"
  (cd "$dir" && npx tsc -b)
  echo "built $rev"
done

n=${#revs[@]}
for ((r = 0; r < rounds; r++)); do
  for ((i = 0; i < n; i++)); do
    rev="${revs[$(((i + r) % n))]}"
    for row in "$@"; do
      echo "== round $((r + 1))/$rounds $rev"
      (cd "$tmp/${rev//\//_}" && node bench/frame.mjs "$row") || echo "!! $rev $row failed"
    done
  done
done
