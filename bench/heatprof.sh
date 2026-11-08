#!/usr/bin/env bash
# CPU-profile one bench/heatmap.mjs setting (default the demo, lanes on) and print self time by
# function. INLINE=off keeps V8 from inlining, so a function's helpers show as their own rows.
# LINES="<function>..." also prints the lines of `dist/` with the most self time in each.
#   bench/heatprof.sh [setting]   e.g. spring/input/ink/off
# The profile is written to a temporary directory and removed on exit.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
setting="${1:-spring/input/ink/on}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
(cd "$root" && npx tsc -b)
flags=(--cpu-prof --cpu-prof-dir="$tmp" --cpu-prof-interval="${PROF_INTERVAL:-100}")
if [[ "${INLINE:-on}" == off ]]; then flags+=(--no-turbo-inlining); fi
node "${flags[@]}" "$root/bench/heatmap.mjs" "$setting"
node "$root/bench/profsum.mjs" "$tmp"/*.cpuprofile "${TOP:-30}"
if [[ -n "${LINES:-}" ]]; then
  # shellcheck disable=SC2086
  TOP="${LINE_TOP:-12}" node "$root/bench/lines.mjs" "$tmp" $LINES
fi
