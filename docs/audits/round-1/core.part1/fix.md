- fling's release sample defeats `stop`, so a pointer held still still flings (A): fixed 24edb8f4
- fade `over` never validated, so NaN fades forever and a negative one cuts off at full weight (A): fixed 54a0f194. This also covers `rise`, `mute` and a cue's `fade: { in, out }`. The strict call is a `RangeError`, the same as a rate ramp. Question: should a negative `over` also throw, rather than mean 0?
- `near`/`restsAt`/`bound` ignore typed-array values (A): fixed 4e45f041
- dry read of a bounded voice weighs the signal outside the bound (A): fixed 9e0e98ed. It can only happen for a `from: 'current'` keys voice in a role: any other voice returns early outside the bound, or keeps no delta there.
- `steps`/`bezier` easings not validated (A+B): fixed f46b6ada. A `RangeError` now refuses a count that is not a whole number of 1 or more, an x outside 0..1, and a y that is not finite.
- `steps` easing takes any count (B): duplicate of the `steps`/`bezier` finding above (fixed f46b6ada)
- `expireGone` spreads kept voices into `splice` and throws past the argument limit (A): fixed 950c4e69. It now compacts the list in place. Reproduced with 300k kept voices.
- `within`'s error suggests an `around` call with an option it ignores (B): fixed 715047f3. The same wrong call in `docs/decisions.md` is corrected too.
- fn voice first called from a lane never has its keys checked against `writes` (B): fixed 190832fd

Extra, found in the sweep:
- `src/gpu/hosted.ts` also calls `patch.at` without `checkWrites`. It is outside this area, so it is not fixed: filed in `docs/TODO.md` (f8b76355).

Checks:
- `npx vitest run test/fling.test.ts`: pass (17)
- `npx vitest run test/fade-edges.test.ts`: pass (13)
- `npx vitest run test/rest.test.ts`: pass (13)
- `npx vitest run test/bound.test.ts`: pass (89)
- `npx vitest run test/easing-data.test.ts`: pass (7)
- `npx vitest run test/gone.test.ts`: pass (2)
- `npx vitest run test/lanes-edges.test.ts`: pass (3)
- Neighboring files (around, fadeat, rise, blending, lanes, trace-fades): pass (272)
- `npm run typecheck`: pass
- `npm run lint`: pass. The first run had 2 format errors in tests I'd written; b6067cf4 fixed them.

Every test was seen failing before its fix. Every fix has a line under Unreleased in `CHANGELOG.md`. The tree is clean.

tally: 9 of 9 fixed, 0 extra fixed