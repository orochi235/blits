#!/usr/bin/env bash
# Bits of this tree (a pull's fill committing motion changes, 2026-11-21) against the batch tip
# fbe0fd06 and against a7702546, before 4a7299d8: each rebuilt from this tree's src by reversing the
# patches beside this file, then bench/same.mjs over 300 scenes, plain, SAME_SEEK=1, and
# SAME_LANES=off (the base run off lanes).
set -euo pipefail
root="$(pwd)"
npm ci --silent >/dev/null 2>&1
npx tsc -b
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
build() {
  local dir="$work/$1"
  shift
  mkdir -p "$dir"
  cp -R "$root/src" "$root/tsconfig.json" "$root/package.json" "$dir/"
  ln -s "$root/node_modules" "$dir/node_modules"
  for p in "$@"; do (cd "$dir" && patch -s -R -p1 <"$root/$p"); done
  (cd "$dir" && npx tsc -b)
}
build tip bench/runs/2026-11-21-same-fill-commit-tip.diff
build pre bench/runs/2026-11-21-same-fill-commit-tip.diff bench/runs/2026-11-21-same-fill-commit-4a7299d8.diff
k=0
for base in tip pre; do
  for mode in plain seek lanesoff; do
    k=$((k + 1))
    echo "== $k/6 against $base, $mode"
    case $mode in
      plain) node bench/same.mjs "$work/$base/dist" "$root/dist" 300 ;;
      seek) SAME_SEEK=1 node bench/same.mjs "$work/$base/dist" "$root/dist" 300 ;;
      lanesoff) SAME_LANES=off node bench/same.mjs "$work/$base/dist" "$root/dist" 300 ;;
    esac
    echo "onto: progress $k/6"
  done
done
