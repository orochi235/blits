A motion option's expression loses its `input` marking in `specOf` (A) | not a defect (blits reads `.input` only on weights, in `project.ts`, `hosts.ts`, `weigh.ts`, `owner.ts` and `contribution.ts`; `assess` and motion options never look at it, so the wrapper changes nothing)
A blend member's own `marks` are replaced by the lead's (A) | fixed 37951b78
Params show a `start` that an `in` anchor overrides (A) | fixed 90cc6a50
A replaced Player drops the Events tag filter (A) | fixed 478a8036
A replaced Player drops the booker's tag filter (B) | duplicate of A's tag-filter finding, fixed 478a8036
`coursesOf` leaves its mixes open when a sync throws (A) | fixed 6a1e334a
`alignTo` swallows a failed solo seek (A) | fixed 6aabe425; question: I made the strict call, a `console.warn` that names the solo plus a `false` return, and the solo still stays ahead. Should the Player rebuild or mark the solo views stale instead?
`usesAround`'s doc says `around` mixes keep no history (A) | fixed 24109c8a (doc only, so no test can fail on it)
The pointer.ts doc says an `around` composition scrubs by replay (B) | duplicate of A's `usesAround` doc finding, fixed 24109c8a
Timing and score draw anchor edges to voices outside the asker's siblings or score (B) | fixed 618e787d
The score's link drag and the Both tab's wiring write anchors blits never resolves (B) | fixed a695414d. Strict call: such an edit is now refused rather than rewritten as a score query. The old wire test that expected span member `k` to anchor to top-level `a` encoded this bug, so I moved it onto a sibling pair.
A child group listed before its owner loses the owner's weight step in the flow (B) | fixed 48f86996
An emptied fit list reads as blits' default fit (B) | fixed 452830f3. The node now shows `fit none`; the editor already keeps `[]` apart from unset.

Extra fixes in the same commits:
- One `placesStart` check replaces four copies of the "does an anchor override start" test, in `spec.ts`, `cueGroups.ts`, `timing.ts` and `params.ts`.
- One `answers` check now decides sibling resolution for the Timing tab, the score's links, the score's link edit and wiring.
- The Timing tab now applies the score check to groups too, where before it let every group through.

There are no CHANGELOG lines: `@blits/playground` is private and not published.

Checks:
- `npx vitest run` on each touched file:
  - test/blend.test.ts: pass (12)
  - test/params.test.ts: pass (7)
  - test/events.test.ts: pass (19)
  - test/course.test.ts: pass (8)
  - test/follow.test.ts: pass (4)
  - test/wire.test.ts: pass (9)
  - test/timing.test.ts: pass (13)
  - test/score.test.ts: pass (34)
  - test/flow.test.ts: pass (20)
- `npm run typecheck`: pass
- `npm run lint`: pass

tally: 12 of 13 fixed, 0 extra fixed