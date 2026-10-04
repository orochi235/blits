#!/usr/bin/env bash
# Profiles bench rows, or another bench script, and prints the functions with the most self time.
#   bench/prof.sh <rows...>              rows of bench/frame.mjs; FRAMES defaults to 3000
#   bench/prof.sh bench/start.mjs <args> any script under bench/
# TOP (default 20) is how many functions to print.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
script=bench/frame.mjs
if [[ "${1:-}" == *.mjs ]]; then script="$1"; shift; fi
(cd "$root" && FRAMES="${FRAMES:-3000}" node --cpu-prof --cpu-prof-dir="$dir" "$script" "$@")
node "$root/bench/top.mjs" "$dir" "${TOP:-20}"
