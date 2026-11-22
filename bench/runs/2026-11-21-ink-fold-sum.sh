#!/usr/bin/env bash
# Three sides, alternating order each round, each row in its own process:
#   oklch  main's src, main's bench (rows on color({ lerp: 'oklch' }))
#   ink    main's src, this tree's bench (rows on ink(), folded through its channel's fold)
#   sum    this tree's src and bench (ink folded on lanes as a widened five-axis sum)
# Then bench/same.mjs: this tree's lanes against its general path, and against main's src.
set -euo pipefail
base=4eb821a3
root="$(pwd)"
dir=bench/runs/2026-11-21-ink-tmp
out=$dir/out.txt
rounds=${ROUNDS:-7}
npm ci --silent >/dev/null 2>&1
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/main"
git archive "$base" | tar -x -C "$tmp/main"
ln -s "$root/node_modules" "$tmp/main/node_modules"
cp bench/frame.mjs "$tmp/main/bench/frame-ink.mjs"
(cd "$tmp/main" && npx tsc -b)
npx tsc -b
echo "# $(hostname -s) $(sysctl -n machdep.cpu.brand_string) $(date +%F), onto --max-cores 1 (shared node), FRAMES=300: $rounds rounds over sides oklch (main $base, bench on color({ lerp: 'oklch' })), ink (main, bench on ink()), sum (this tree: ink folded as a widened sum), rows glowo glowokeys hues glowo^ hues^, each in its own process" > $out
for ((r = 1; r <= rounds; r++)); do
  case $((r % 3)) in
    1) order=(oklch ink sum) ;;
    2) order=(sum oklch ink) ;;
    0) order=(ink sum oklch) ;;
  esac
  for side in "${order[@]}"; do
    case $side in
      oklch) d="$tmp/main"; f=bench/frame.mjs ;;
      ink) d="$tmp/main"; f=bench/frame-ink.mjs ;;
      sum) d="$root"; f=bench/frame.mjs ;;
    esac
    for row in glowo glowokeys hues 'glowo^' 'hues^'; do
      echo "== round $r/$rounds $side" | tee -a $out
      (cd "$d" && node $f "$row") 2>&1 | tee -a $out
    done
  done
done
echo "== same: this tree's lanes against its general path" | tee -a $out
SAME_LANES=off node bench/same.mjs dist dist 1500 2>&1 | grep -v '^[0-9]*/[0-9]*  ' | tee -a $out
echo "== same: main against this tree" | tee -a $out
node bench/same.mjs "$tmp/main/dist" dist 1500 2>&1 | grep -v '^[0-9]*/[0-9]*  ' | tee -a $out
