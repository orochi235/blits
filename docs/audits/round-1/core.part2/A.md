# Findings: core.part2 (round 1)

Note: the brief names commit 14f899f038bda0564b8f0836ef7cfe95f16ae600, which is not in this clone
(`git cat-file` fails). The tree read is HEAD 836ce269bfa75c45884e2eae86a3f96d7246af44.

## copyHeldInto leaves a reused spare's probeRow/probeEpoch where copyHeld resets them to -1
- where: src/history.ts:166 (copyHeldInto), vs src/history.ts:144 (copyHeld)
- scenario: a snap's record put back by a seek becomes a chain head and is given a trail row (trail.ts:197 sets probeRow/probeEpoch); a later seek back cuts it into `voice.spares`, and `snapOf` reuses it through `copyHeldInto`, which neither copies nor resets `probeRow`/`probeEpoch` (and `unread` does not touch them). If that copy is later put back as a head in the same trail epoch, trail.ts:188 treats the stale row as its own and reads/writes poses in a row another head may own. `copyHeld` writes -1 for both, so the two copies the doc says are held "field by field" answer differently.
- evidence: read (no run; the chain to a shared row is inferred)
- severity: low

## Without history, the first mix on a transport prunes an announced mark before later mixes' anchors read it
- where: src/move.ts:59 (moveTo), with src/place.ts:474 (timeOf) and src/mixer.ts:432 (`announced` is the transport's list)
- scenario: a `transport()` with no `history`, two members A then B. B cues a voice anchored `{ start: { after: { score: 's', name: 'go' } } }`; between frames the host calls `t.announce('go', { score: 's' })` (no `at`, so `a.at` is the last sync's host time). At the next `t.sync`, `move(A)` places A's anchors, then filters `transport.announced` to `mixAt(a.at) >= now`, dropping the mark; `move(B)` then runs `place(B)`, whose `timeOf` reads `mix.announced`, finds nothing, and B's voice stays pending forever. The same mark announced while B is the first member starts the voice: whether an anchor on an announced mark fires depends on which mix joined the transport first. The prune should run once per transport after every member has placed (or skip marks some member's anchors have not yet read). The existing test (test/transport.test.ts:149) only announces a future `at: 500`, which the prune keeps.
- evidence: read (traced `transport.syncAt` → `move` per member → `place` / prune order; not run)
- severity: medium

## Files read
src/grow.ts
src/handle.ts
src/held.ts
src/history.ts
src/hosts.ts
src/index.ts
src/keyfill.ts
src/keyrows.ts
src/lane.ts
src/lanes.ts
src/lch.ts
src/lean.ts
src/leaps.ts
src/leavings.ts
src/lives.ts
src/marks.ts
src/meet.ts
src/mixer.ts
src/motion.ts
src/motions.ts
src/move.ts
src/moved.ts
src/named.ts
src/nearly.ts
src/now.ts
src/numbers.ts
src/oklab.ts
src/onseek.ts
src/origin.ts
src/owed.ts
src/owner.ts
src/pace.ts
src/pack.ts
src/paging.ts
src/patch.ts
src/place.ts
src/placed.ts
src/places.ts
src/plot.ts
src/project.ts
src/pull.ts
src/qualify.ts
src/reading.ts
src/record.ts
src/relink.ts
src/renumber.ts
src/restored.ts

<!-- done: 2 findings, files read: 47 -->
