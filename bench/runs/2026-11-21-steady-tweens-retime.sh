#!/usr/bin/env bash
# Re-times main (a7702546) against the commit that folds a bare tween's sum inline and weighs a lane
# flat after every fade in (1a261955, with its mid-fill flat clearing), FRAMES=5000, each row in a
# process of its own, order alternating each round: in-flight rows at LONG=1e9, then tweens^ landed
# at LONG=1.
set -euo pipefail
npm ci --silent >/dev/null 2>&1 || true
rounds="${1:-7}"
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F), onto --quiet --max-cores 2, FRAMES=5000: AB_EACH=1 AB_BENCH=bench/frame.mjs (main's own bench has no LONG) bench/ab.sh a7702546 1a261955 $rounds, LONG=1e9 tweens^ weasel^ churn^ turnover^, then LONG=1 tweens^"
FRAMES=5000 LONG=1000000000 AB_EACH=1 AB_BENCH=bench/frame.mjs bench/ab.sh a7702546 1a261955 "$rounds" 'tweens^' 'weasel^' 'churn^' 'turnover^'
echo "# landed: LONG=1"
FRAMES=5000 LONG=1 AB_EACH=1 AB_BENCH=bench/frame.mjs bench/ab.sh a7702546 1a261955 "$rounds" 'tweens^' | sed 's/^== round \([0-9/]*\) \(.*\)$/== round \1 \2-landed/'
