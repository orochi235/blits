#!/usr/bin/env bash
# bench/recaddr.mjs at each of several revisions: the first record of each lane in full (each field
# with its representation), then one address line per record.
#   bench/recaddr.sh <frames> <records> <rev>...
set -euo pipefail
frames="$1"; records="$2"; shift 2
root="$(git rev-parse --show-toplevel)"
source "$root/bench/rev.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for rev in "$@"; do
  dir="$tmp/$rev"
  mkdir -p "$dir"
  if [[ "$rev" == . ]]; then
    (cd "$root" && git ls-files -co --exclude-standard -z | xargs -0 tar -cf -) | tar -x -C "$dir"
  else
    git -C "$root" archive "$(commit_of "$rev")" | tar -x -C "$dir"
  fi
  ln -s "$root/node_modules" "$dir/node_modules"
  cp "$root/bench/recaddr.mjs" "$dir/bench/recaddr.mjs"
  (cd "$dir" && npx tsc -b)
  echo "######## $rev"
  (cd "$dir" && node --allow-natives-syntax bench/recaddr.mjs "$frames" "$records") |
    awk '/^LANE/{print; full=1; next} /^DebugPrint:/{if (full==2) full=0; else if (full==1) full=2; print; next} full==2{print}'
done
