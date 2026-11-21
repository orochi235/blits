Sparks age on gap × `m.rate`, not mix time, so a panel pause or hold leaves them moving (A+B) — fixed 6e38a496, README line that described the old aging fixed 4812b7a8

Auto-launch timed on `performance.now()`, keeps launching while paused (A+B) — fixed 74c58fb4

Mix has no `history`, so it can't seek without the in-page panel (A+B) — fixed 7645f884 (typecheck follow-up 22c8492b)

Double click on "Start the show" starts two shows (A+B) — fixed 81267d59

Overlapping bangs and crackles share one panner, so a later shell re-pans an earlier one's tail (A+B) — fixed 64e00b66

Sky box loses 16:9 on a narrow viewport while the camera stays 16:9 (A) — fixed 386d5866. There is no repo test for it, because it is CSS. I measured it in headless Chromium at 375 × 700: 343.0 × 400.0 before the fix, 343.0 × 192.9 after. 1200 × 800 and 1200 × 300 are unchanged.

Extra: `vitest.config.ts` had no `@msb235/blits-tone` alias, so no test could import `main.ts`. The alias was added in 81267d59. That is test infrastructure, not a defect, so it is not counted.

Question: in `src/frame.ts`, a frame's spark aging is capped at 250 ms. A seek forward in the panel therefore ages the sparks in the sky by at most 250 ms, not the full jump. Is that cap wanted?

Question: after a seek back, auto-launch waits until mix time passes the next launch it had already scheduled, while the tape replays the earlier launches. So it cues nothing new into the replayed stretch, and nothing cuts the tape ahead. This was my call.

No CHANGELOG lines: `@blits/fireworks` is private and has no CHANGELOG.

Checks:
- `npx vitest run apps/fireworks/test/frame.test.ts` — pass (3 passed)
- `npx vitest run apps/fireworks/test/show.test.ts` — pass (1 passed)
- `npx vitest run apps/fireworks/test/main.test.ts` — pass (1 passed)
- `npx vitest run apps/fireworks/test/sound.test.ts` — pass (2 passed)
- `npm run typecheck` — pass (exit 0)
- `npm run typecheck -w @blits/fireworks` — fail before 22c8492b (`src/show.ts(81,37): error TS2339`), pass after (exit 0)
- `npm run lint` — pass (exit 0)
- Tree clean, no stash.

tally: 6 of 6 fixed, 0 extra fixed