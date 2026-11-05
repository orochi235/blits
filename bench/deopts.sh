#!/usr/bin/env bash
# Counts V8's deoptimizations over one bench row: by function, then by reason, most first.
#   bench/deopts.sh <row>
# AB_BENCH names the bench file, bench/frame.mjs by default; FRAMES defaults to 2000.
set -euo pipefail
row="$1"
bench="${AB_BENCH:-bench/frame.mjs}"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
npx tsc -b
FRAMES="${FRAMES:-2000}" node --trace-deopt "$bench" "$row" >"$tmp" 2>&1 || true
echo "== by function"
grep -o 'deoptimizing [^ ]* <JSFunction [^ >]*' "$tmp" | awk '{print $4}' | sort | uniq -c | sort -rn | head -30
echo "== by reason"
grep -o 'reason: [^)>]*' "$tmp" | sort | uniq -c | sort -rn | head -20
