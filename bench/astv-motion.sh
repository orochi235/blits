#!/usr/bin/env bash
# Times cases of astv's motion bench (packages/engine/playback/motion.bench.ts) on several blits
# builds, turn about, each case in a process of its own, the build order rotating each round.
# Run from this blits tree with astv's tree at <astv>; each build's dist is swapped over astv's
# installed one, which is put back on exit.
#
#   bench/astv-motion.sh <astv> <out dir> <rounds> "<case>[|<case>...]" <build>...
#
# A build is `<semver>` (its published dist, from npm), `.` (this tree as it stands) or a commit
# this clone has, built from `git archive`. A case is a substring `--only` matches. Each run's
# JSON lands in <out dir>/<case>.<build>.<round>.json, and one line a run prints as it ends.
# MOTION_FLAGS passes more flags to the bench, such as `--frames 7200`. PROF=<µs> also writes each
# run's V8 CPU profile, sampled that often, beside its JSON, for bench/profsum.mjs.
set -euo pipefail
astv=$(cd "$1" && pwd); out=$(mkdir -p "$2" && cd "$2" && pwd); rounds=$3
IFS="|" read -r -a cases <<<"$4"; shift 4
root=$(git rev-parse --show-toplevel)
source "$root/bench/rev.sh"
tmp=$(mktemp -d)
here="$astv/node_modules/@msb235/blits/dist"
cp -R "$here" "$tmp/installed"
trap 'rm -rf "$here" && cp -R "$tmp/installed" "$here"; rm -rf "$tmp"' EXIT

builds=("$@")
for b in "${builds[@]}"; do
  dir="$tmp/b-$b"; mkdir -p "$dir"
  if [[ "$b" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    (cd "$dir" && npm pack "@msb235/blits@$b" --silent >/dev/null && tar -xzf ./*.tgz && mv package/dist dist)
    echo "built $b (npm)"
    continue
  fi
  if [[ "$b" == . ]]; then
    (cd "$root" && git ls-files -co --exclude-standard -z | xargs -0 tar -cf -) | tar -x -C "$dir"
    label="the tree"
  else
    sha=$(commit_of "$b"); git -C "$root" archive "$sha" | tar -x -C "$dir"; label="$b ($sha)"
  fi
  rm -rf "$dir/dist"; ln -s "$root/node_modules" "$dir/node_modules"
  (cd "$dir" && npx tsc -b)
  echo "built $label"
done

n=${#builds[@]}
total=$((rounds * n * ${#cases[@]})); i=0
for ((r = 1; r <= rounds; r++)); do
  for ((k = 0; k < n; k++)); do
    b=${builds[$(((k + r - 1) % n))]}
    rm -rf "$here"; cp -R "$tmp/b-$b/dist" "$here"
    for c in "${cases[@]}"; do
      i=$((i + 1))
      f="$out/${c// /_}.${b//\//_}.$r.json"
      prof=()
      [[ -n "${PROF:-}" ]] && prof=(--cpu-prof --cpu-prof-interval "$PROF" --cpu-prof-dir "$out" --cpu-prof-name "$(basename "$f" .json).cpuprofile")
      line=$(cd "$astv" && node ${prof[@]+"${prof[@]}"} --import tsx packages/engine/playback/motion.bench.ts --only "$c" --out "$f" ${MOTION_FLAGS:-} | tail -1)
      echo "$i/$total round $r build $b  $line"
    done
  done
done
