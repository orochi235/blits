#!/usr/bin/env bash
# Print V8's inlining, optimization and deoptimization lines naming given functions, for one bench
# row at each of several revisions, so a change in what TurboFan inlines shows as a diff.
#   bench/inltrace.sh <row> <names-regex> <rev>...
# A revision of `.` is the working tree. Each is built from `git archive` into a temporary
# directory, removed on exit. FRAMES defaults to 2000. Only matching lines are kept.
set -euo pipefail
row="$1"; names="$2"; shift 2
root="$(git rev-parse --show-toplevel)"
source "$root/bench/rev.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "onto: plan $#"
done=0
for rev in "$@"; do
  dir="$tmp/$done"
  mkdir -p "$dir"
  if [[ "$rev" == . ]]; then
    (cd "$root" && git ls-files -co --exclude-standard -z | xargs -0 tar -cf -) | tar -x -C "$dir"
    label="the working tree"
  else
    sha="$(commit_of "$rev")"
    git -C "$root" archive "$sha" | tar -x -C "$dir"
    label="$rev ($sha)"
  fi
  ln -s "$root/node_modules" "$dir/node_modules"
  (cd "$dir" && npx tsc -b)
  echo "== $label $row"
  (cd "$dir" && FRAMES="${FRAMES:-2000}" node --trace-turbo-inlining --trace-opt --trace-deopt \
    bench/frame.mjs "$row" 2>&1) | grep -E "$names|ms/frame" | sed -E 's/0x[0-9a-f]+/0x/g' || true
  done=$((done + 1))
  echo "onto: progress $done/$#"
done
