#!/usr/bin/env bash
# Profiles bench rows and prints the functions with the most self time, worst first.
#   bench/prof.sh <rows...>    FRAMES (default 3000) and TOP (default 20) adjust it
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
(cd "$root" && FRAMES="${FRAMES:-3000}" node --cpu-prof --cpu-prof-dir="$dir" bench/frame.mjs "$@")
node "$root/bench/top.mjs" "$dir" "${TOP:-20}"
