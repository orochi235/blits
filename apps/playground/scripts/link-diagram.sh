#!/usr/bin/env bash
# Packs weasel-diagram from its worktree and installs the tarball, so the playground runs against
# unreleased diagram code with its own @weasel-js/core. Removed once weasel 1.9.0 is out.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
root="$here/../.."
wt="${WEASEL_WT:-$HOME/src/weasel/.worktrees/diagram-from-data}"
mkdir -p "$here/.weasel"
rm -f "$here/.weasel"/weasel-js-diagram-*.tgz
(cd "$wt" && npm run build -w @weasel-js/diagram >/dev/null)
name="$(cd "$wt" && npm pack -w @weasel-js/diagram --pack-destination "$here/.weasel" --silent | tail -1)"
cd "$root"
# Same name and version, new contents: drop the old install and its pinned hash so npm unpacks this pack.
rm -rf node_modules/@weasel-js/diagram
node -e '
  const fs = require("fs");
  const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
  for (const k of ["node_modules/@weasel-js/diagram", "apps/playground/.weasel/'"$name"'"]) {
    if (lock.packages[k]) delete lock.packages[k].integrity;
  }
  fs.writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
'
npm install --workspace @blits/playground "file:apps/playground/.weasel/$name"
