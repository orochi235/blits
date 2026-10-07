# Flow Diagram: Release Step

**Status, 2026-10-07: Tasks 1–10 are built and merged to `main` (unpushed); only this release step is
left, deferred until Mike asks for it.** The built work is described in `apps/playground/README.md`
("The flow") and the spec beside this plan, `docs/superpowers/specs/2026-10-07-flow-diagram-design.md`.

Until this lands, `main` must not be pushed: `apps/playground/package.json` installs
`@weasel-js/diagram` from a gitignored local pack, so `npm ci` fails on CI and on the onto fleet
(`onto test` setup exits 254 on it).

## Before weasel 1.9.0 is released

Open items on weasel's `diagram-from-data` branch, raised by the final review and sent to the weasel
session; check which are done before releasing:

- Re-clicking the selected node should fire `onSelect` (`useMirroredSelection` only reports a pick
  that differs from the prop), so the playground's Voice tab opens on a re-click as it does from the
  score.
- The `diagram-data` demo hint says "Drag to pan", but `DiagramView` binds no drag-pan.
- The core changeset for `fitViewToBounds`'s `anchor` says `patch`; it adds an option.
- `diagramScene` doesn't guard duplicate node ids or duplicate `(from, to, label)` edges.
- Barycenter tests lack a back-edge case, a case of more than two ranks, and re-layout idempotence.

### Task 11: Release and unlink (deferred until Mike asks for it)

**Not part of this run.** Mike deferred this task indefinitely on 2026-10-07 and will ask for it. Until
then the playground runs on the local pack from Task 7, and `HANDOFF.md` says so.

Also do this when 1.9.0 is pinned: pass `anchor="start"` from `FlowDiagram` to `DiagramView`. It
landed in weasel `1b228637c`, but it needs the branch's `@weasel-js/core`, which the local pack does
not carry, so a crowded flow opens centered until then. Before release, weasel's `check:bumps` needs
Mike's bump-approved marker on `.changeset/diagram-from-data.md`.

**Files:**
- Modify: `apps/playground/package.json`, `site/package.json`, `package.json`, `package-lock.json`
- Delete: `apps/playground/scripts/link-diagram.sh`, `apps/playground/.weasel/`
- Delete: `docs/superpowers/specs/2026-10-07-flow-diagram-design.md`, `docs/superpowers/plans/2026-10-07-flow-diagram.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Stop and ask**

Tell Mike that weasel's `diagram-from-data` branch is ready to merge and release as 1.9.0, with links to the commits and the demo screenshot. Ask whether to merge it into weasel `main` and publish. Do nothing in this task until he says yes. Until then, add a HANDOFF.md entry saying that the playground runs on a local pack of weasel-diagram, and that Task 11 is what's left.

- [ ] **Step 2: After his yes, merge and release in weasel**

Follow weasel's own release flow (its `RELEASING.md` or CLAUDE.md, whichever exists; read it first). Expected: `npm view @weasel-js/diagram version` prints `1.9.0`.

Then remove the worktree: `git -C ~/src/weasel worktree remove .worktrees/diagram-from-data && git -C ~/src/weasel branch -d diagram-from-data`.

- [ ] **Step 3: Pin 1.9.0 everywhere in blits**

```bash
cd ~/src/blits
sed -i '' 's/"\(@weasel-js\/[a-z0-9-]*\)": "1\.8\.1"/"\1": "1.9.0"/' site/package.json apps/playground/package.json
sed -i '' 's/"@weasel-js\/history": "^1\.8\.1"/"@weasel-js\/history": "^1.9.0"/' package.json
```

In `apps/playground/package.json`, set `"@weasel-js/diagram": "1.9.0"`, replacing the `file:` spec. Then `rm -rf apps/playground/.weasel apps/playground/scripts/link-diagram.sh`, remove `.weasel/` from `apps/playground/.gitignore`, and run `npm install`.
Expected: `grep -rn 'file:' package-lock.json | grep weasel` prints nothing.

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run typecheck && npm run playground:check && npm run site:build`
Expected: all pass.

- [ ] **Step 5: Retire the spec and the plan**

The README's "The flow" section is now the durable record of view A. Copy the spec's roadmap (views B, C, D and the mixer desk) into `HANDOFF.md` as the next work, then delete the spec and this plan.

- [ ] **Step 6: Commit, then start the full suite on the fleet**

```bash
git add -A package.json package-lock.json site/package.json apps/playground HANDOFF.md docs/superpowers
git commit -m "pin weasel 1.9.0 and drop the local diagram pack, and retire the flow diagram's spec and plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Then run `onto test` in the background (the `onto-test` skill) and read its exit code when it finishes.
