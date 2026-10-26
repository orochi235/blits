# Sourced by ab.sh and same.sh: `commit_of <rev>` prints the full sha a revision names in this
# clone, refusing one it cannot name truly. A tree synced to a fleet node is the node's base commit
# with every later change as uncommitted files, so there `HEAD` is that base, not the commit synced.
commit_of() {
  local rev="$1" root sha
  root="$(git rev-parse --show-toplevel)"
  if [[ "$rev" =~ ^(HEAD|@) && -n "$(git -C "$root" status --porcelain --untracked-files=no)" ]]; then
    echo "refusing '$rev': the tree has uncommitted changes, so HEAD ($(git -C "$root" rev-parse --short HEAD)) is not the tree; name a sha, or use . for the tree" >&2
    return 1
  fi
  if ! sha="$(git -C "$root" rev-parse --verify --quiet "$rev^{commit}")"; then
    echo "refusing '$rev': no such commit here; one only another clone has never reaches a node" >&2
    return 1
  fi
  echo "$sha"
}
