#!/usr/bin/env bash
# Profile one bench row at two revisions and print each one's hottest functions, then the hottest
# lines of the functions that lead the second revision's list, at both.
#   bench/profab.sh <rev-a> <rev-b> <row>
# Each revision is built from `git archive` into a temporary directory, removed on exit, and runs
# its own bench/frame.mjs. FRAMES defaults to 5000, TOP (40) is how many functions to print, and
# INTO (8) how many of them get their lines printed.
set -euo pipefail
a="$1"; b="$2"; row="$3"
root="$(git rev-parse --show-toplevel)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "onto: plan 2"
done=0
for rev in "$a" "$b"; do
  dir="$tmp/$rev"
  mkdir -p "$dir" "$tmp/prof-$rev"
  git -C "$root" archive "$rev" | tar -x -C "$dir"
  ln -s "$root/node_modules" "$dir/node_modules"
  (cd "$dir" && npx tsc -b)
  (cd "$dir" && FRAMES="${FRAMES:-5000}" node --cpu-prof --cpu-prof-dir="$tmp/prof-$rev" bench/frame.mjs "$row")
  echo "== $rev ($(git -C "$root" rev-parse --short "$rev")) $row, self time"
  node "$root/bench/top.mjs" "$tmp/prof-$rev" "${TOP:-40}" | tee "$tmp/top-$rev"
  done=$((done + 1))
  echo "onto: progress $done/2"
done

names=()
while read -r _ name _; do
  [[ "$name" == \(* ]] || names+=("$name")
done < <(head -n "${INTO:-8}" "$tmp/top-$b")
for rev in "$a" "$b"; do
  echo "== $rev $row, lines"
  node "$root/bench/lines.mjs" "$tmp/prof-$rev" "${names[@]}"
done
