#!/usr/bin/env bash
# CPU-profile one stress demo with lanes on and then off, and print each profile's self time by
# function (bench/profsum.mjs).
#   bench/stressprof.sh <name> [stress flags...]
# heatmap plays a twin with lanes the other way to check them against, so its two profiles hold
# both paths: profile it with AB_BENCH=bench/heatmap.mjs bench/cpuprof.sh instead.
# CALLERS="<name>..." also splits those functions' self time by caller (bench/profcallers.mjs).
# Profiles go to a temporary directory, removed on exit.
set -euo pipefail
name="$1"; shift
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "onto: plan 2"
done=0
for lanes in on off; do
  extra=()
  if [[ "$lanes" == off ]]; then extra=(--lanes off); fi
  echo "== $name lanes $lanes $*"
  rm -rf "$tmp/prof"
  NODE_OPTIONS="--cpu-prof --cpu-prof-dir=$tmp/prof --cpu-prof-interval ${PROF_INTERVAL:-100}" \
    npm run -s stress -- "$name" "$@" "${extra[@]}" | tail -4
  prof="$(ls -S "$tmp"/prof/*.cpuprofile | head -1)"
  node bench/profsum.mjs "$prof"
  if [[ -n "${CALLERS:-}" ]]; then
    # shellcheck disable=SC2086
    node bench/profcallers.mjs "$prof" $CALLERS
  fi
  done=$((done + 1))
  echo "onto: progress $done/2"
done
