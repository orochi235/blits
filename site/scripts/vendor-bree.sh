#!/bin/sh
# Copies bree's source into vendor/bree until bree is published. Run from anywhere: scripts/vendor-bree.sh [path to bree]
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
bree=${1:-"$here/../../bree"}
dest="$here/vendor/bree"
rm -rf "$dest"
mkdir -p "$dest"
cp -R "$bree/src/." "$dest/"
cp "$bree/LICENSE" "$dest/LICENSE"
commit=$(git -C "$bree" rev-parse --short HEAD)
dirty=$(git -C "$bree" status --porcelain -- src | head -1)
printf 'bree %s%s, vendored by scripts/vendor-bree.sh\n' "$commit" "${dirty:+ with uncommitted changes}" > "$dest/VERSION"
cat "$dest/VERSION"
