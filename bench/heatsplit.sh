#!/usr/bin/env bash
# One build of bench/heatmap.mjs under several BLITS_EXP switches, rotating their order each round.
# The switches live in a scratch diff over src, such as runs/2026-11-21-heatmap-signal-split.diff:
# apply it, run this on a node, revert. Each run's frames go to <out.jsonl>, tagged exp and round.
#   bench/heatsplit.sh <rounds> <out.jsonl> <exp:setting>...
set -euo pipefail
rounds="$1"; out="$2"; shift 2
root="$(git rev-parse --show-toplevel)"
(cd "$root" && npx tsc -b)
: >"$out"
runs=("$@"); n=${#runs[@]}; total=$((rounds * n)); k=0
for ((r = 0; r < rounds; r++)); do
  for ((i = 0; i < n; i++)); do
    run="${runs[$(((i + r) % n))]}"; exp="${run%%:*}"; setting="${run#*:}"
    tmp="$(mktemp)"
    line="$(BLITS_EXP="$exp" OUT="$tmp" node "$root/bench/heatmap.mjs" "$setting" | grep 'read p50')"
    sed "s/^{/{\"exp\":$exp,\"round\":$((r + 1)),/" "$tmp" >>"$out"; rm -f "$tmp"
    k=$((k + 1)); echo "$k/$total round $((r + 1)) exp $exp $line"
    echo "onto: progress $k/$total"
  done
done
