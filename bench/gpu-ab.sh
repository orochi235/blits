#!/usr/bin/env bash
# Compare a gpu bench between a revision's source and the working tree's, A B B A, each side a page
# of its own; the bench file is the tree's on both sides, so a row exists in both.
#   bench/gpu-ab.sh <rev> <bench.mjs> <out-prefix>     with the bench's env (MIX, ROWS, ...) set
# Writes <out-prefix>-a1.jsonl, -b1, -b2, -a2. The revision is built from `git archive` into a
# temporary directory, removed on exit. A_PATCH=<file> applies a patch (paths a/ and b/, as
# `diff -ru a b` writes them) to that revision first, for a base no commit on origin holds.
set -euo pipefail
rev="$1"; bench="$2"; out="$3"
root="$(git rev-parse --show-toplevel)"
source "$root/bench/rev.sh"
sha="$(commit_of "$rev")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git -C "$root" archive "$sha" | tar -x -C "$tmp"
if [[ -n "${A_PATCH:-}" ]]; then patch -s -p1 -d "$tmp" < "$root/$A_PATCH"; fi
ln -s "$root/node_modules" "$tmp/node_modules"
cp "$root/$bench" "$tmp/$bench"
cp "$root/bench/gpu-harness.mjs" "$tmp/bench/gpu-harness.mjs"
mkdir -p "$(dirname "$root/$out")"
echo "a is $rev ($sha)${A_PATCH:+ with $A_PATCH}, b the working tree"
for side in a1 b1 b2 a2; do
  case "$side" in a*) dir="$tmp" ;; *) dir="$root" ;; esac
  echo "== $side"
  (cd "$dir" && node "$bench" --out "$root/$out-$side")
done
