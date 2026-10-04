#!/usr/bin/env bash
# Builds a revision from `git archive` into a temporary directory, removed on exit, and checks that
# it reads the same bits as this tree's own build on random scenes.
#   bench/same.sh <rev> [scenes] [first-seed]
set -euo pipefail
rev="$1"; shift
root="$(git rev-parse --show-toplevel)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git -C "$root" archive "$rev" | tar -x -C "$tmp"
ln -s "$root/node_modules" "$tmp/node_modules"
(cd "$tmp" && npx tsc -b)
(cd "$root" && npx tsc -b)
echo "comparing $rev ($(git -C "$root" rev-parse --short "$rev")) with this tree"
node "$root/bench/same.mjs" "$tmp/dist" "$root/dist" "$@"
