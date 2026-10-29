#!/usr/bin/env bash
# Builds this tree, profiles each bench row, and prints the lines with the most self time inside the
# named functions (bench/lines.mjs), for a fleet node where the profile itself cannot come back.
#   bench/proflines.sh "<row> [<row>...]" <function>...
# FRAMES defaults to 5000, PROF_INTERVAL (µs) to 50, TOP (lines a function) to 30.
set -euo pipefail
rows="$1"; shift
npm ci --silent >/dev/null 2>&1 || true
npx tsc -b
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
for row in $rows; do
  rm -rf "$dir"/*
  FRAMES="${FRAMES:-5000}" node --cpu-prof --cpu-prof-interval "${PROF_INTERVAL:-50}" \
    --cpu-prof-dir="$dir" bench/frame.mjs "$row"
  TOP="${TOP:-30}" node bench/lines.mjs "$dir" "$@"
done
