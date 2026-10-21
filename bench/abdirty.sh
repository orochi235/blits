#!/usr/bin/env bash
# A/B of the uncommitted diff in src/, needing no commit on origin, which ab.sh does for its first revision.
#   bench/abdirty.sh <rounds> <rows...>   side `head` is the tree without the diff, `dirty` with it
set -euo pipefail
npm ci --silent >/dev/null 2>&1 || true
root="$(pwd)"; tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
rounds="$1"; shift
for side in head dirty; do
  mkdir -p "$tmp/$side"
  git ls-files -co --exclude-standard -z | xargs -0 tar -cf - | tar -x -C "$tmp/$side"
  ln -s "$root/node_modules" "$tmp/$side/node_modules"
done
git diff HEAD -- src | (cd "$tmp/head" && git apply -R)
for side in head dirty; do (cd "$tmp/$side" && npx tsc -b) && echo "built $side"; done
for ((r = 1; r <= rounds; r++)); do
  if ((r % 2)); then order=(head dirty); else order=(dirty head); fi
  for side in "${order[@]}"; do
    for row in "$@"; do
      echo "== round $r/$rounds $side"
      (cd "$tmp/$side" && node bench/frame.mjs "$row")
    done
  done
done
