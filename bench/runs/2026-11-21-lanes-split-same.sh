#!/usr/bin/env bash
# lanes.ts split into modules against the tree before it (807c41bc): bench/same.sh over 1,000
# scenes, plain, SAME_SEEK=1, and SAME_LANES=off.
set -euo pipefail
npm ci --silent >/dev/null 2>&1 || true
k=0
for mode in plain seek lanesoff; do
  k=$((k + 1))
  echo "== $k/3 $mode"
  case $mode in
    plain) bench/same.sh 807c41bc 1000 ;;
    seek) SAME_SEEK=1 bench/same.sh 807c41bc 1000 ;;
    lanesoff) SAME_LANES=off bench/same.sh 807c41bc 1000 ;;
  esac
  echo "onto: progress $k/3"
done
