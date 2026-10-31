#!/usr/bin/env bash
# CPU-profile one bench row at each of several revisions, alternating, and print each profile's self
# time by function (bench/profsum.mjs), so a slowdown shows as the functions it lands in.
#   bench/cpuprof.sh <row> <runs> <rev>...
# A revision of `.` is the working tree. Each is built from `git archive` into a temporary
# directory, removed on exit with its profiles. FRAMES defaults to 5000; PROF_INTERVAL (µs) to 100.
# AB_BENCH names one bench file every revision runs, as in ab.sh, for a row older ones lack.
set -euo pipefail
row="$1"; runs="$2"; shift 2
root="$(git rev-parse --show-toplevel)"
source "$root/bench/rev.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

revs=("$@")
for i in "${!revs[@]}"; do
  rev="${revs[$i]}"
  dir="$tmp/$i"
  mkdir -p "$dir"
  if [[ "$rev" == . ]]; then
    (cd "$root" && git ls-files -co --exclude-standard -z | xargs -0 tar -cf -) | tar -x -C "$dir"
  else
    git -C "$root" archive "$(commit_of "$rev")" | tar -x -C "$dir"
  fi
  if [[ -n "${AB_BENCH:-}" ]]; then cp "$root/$AB_BENCH" "$dir/bench/frame.mjs"; fi
  ln -s "$root/node_modules" "$dir/node_modules"
  (cd "$dir" && npx tsc -b)
done

echo "onto: plan $((runs * ${#revs[@]}))"
done=0
for ((r = 1; r <= runs; r++)); do
  for i in "${!revs[@]}"; do
    # Alternate which revision runs first each round.
    if ((r % 2 == 0)); then i=$(( ${#revs[@]} - 1 - i )); fi
    dir="$tmp/$i"
    echo "== run $r/$runs ${revs[$i]} $row"
    rm -rf "$dir/prof"
    (cd "$dir" && FRAMES="${FRAMES:-5000}" node --cpu-prof --cpu-prof-dir=prof \
      --cpu-prof-interval "${PROF_INTERVAL:-100}" bench/frame.mjs "$row")
    node "$root/bench/profsum.mjs" "$dir"/prof/*.cpuprofile
    done=$((done + 1))
    echo "onto: progress $done/$((runs * ${#revs[@]}))"
  done
done
