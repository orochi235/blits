#!/usr/bin/env bash
# Packs weasel-diagram from its worktree and installs the tarball, so the playground runs against
# unreleased diagram code with its own @weasel-js/core. Removed once weasel 1.9.0 is out.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
wt="${WEASEL_WT:-$HOME/src/weasel/.worktrees/diagram-from-data}"
mkdir -p "$here/.weasel"
(cd "$wt" && npm run build -w @weasel-js/diagram >/dev/null && npm pack -w @weasel-js/diagram --pack-destination "$here/.weasel" >/dev/null)
tgz="$(ls "$here/.weasel"/weasel-js-diagram-*.tgz | head -1)"
cd "$here/../.." && npm install --workspace @blits/playground "file:${tgz#$PWD/}"
