copyHeldInto leaves a reused record's probeRow/probeEpoch (A): fixed d04c4faa

First mix on a transport without history prunes an announced mark before later mixes place on it (A): fixed de68e400

`in` mark ignores reduced motion (B): fixed ec90164b

`in`/`end` anchors subtract fade lengths that reduced motion doesn't play (B): fixed 74f2963e

`recordInput` overwrites a value at a still mix time but keeps the older frame's `seq` (B): fixed c51b2c5d. Nothing in memory reads inputs by `seq`, so I kept one entry per mix time and stamped it with the frame that read it last.

Past voice clocks stop being recorded after 256, which misplaces later origins (B): fixed 55d16062. It now keeps the latest clocks, halving down like the cap on a child handle's clocks in `spans.ts` `rewriting`. Each clock now carries its absolute index `n`, so a seek back still cuts the list to the right prefix.

Extra, arc marks under reduced motion: the arc `in` mark added `fade.in`, and the cut-short `end` added a fade-out that is never played (sweep, `src/arcs.ts`): fixed 22039939

Checks:
- `npx vitest run test/history.test.ts`: pass (7 passed)
- `npx vitest run test/transport.test.ts`: pass (30 passed)
- `npx vitest run test/score.test.ts`: pass (73 passed)
- `npx vitest run test/arc.test.ts`: pass (21 passed)
- `npx vitest run test/origin.test.ts`: pass (10 passed)
- `npm run typecheck`: pass
- `npm run lint`: pass (1 info, in `bench/levels-hash.mjs`, which this work didn't touch)

tally: 6 of 6 fixed, 1 extra fixed