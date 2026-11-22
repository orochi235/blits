#!/usr/bin/env bash
# Crowd voices placed by voice (60d4ec5b) against main b2e157dc: bench/same.sh over 2,000 scenes,
# plain, SAME_SEEK=1, and SAME_LANES=off (main run off lanes).
set -euo pipefail
npm ci --silent >/dev/null 2>&1 || true
k=0
for mode in plain seek lanesoff; do
  k=$((k + 1))
  echo "== $k/3 $mode"
  case $mode in
    plain) bench/same.sh b2e157dc 2000 ;;
    seek) SAME_SEEK=1 bench/same.sh b2e157dc 2000 ;;
    lanesoff) SAME_LANES=off bench/same.sh b2e157dc 2000 ;;
  esac
  echo "onto: progress $k/3"
done
