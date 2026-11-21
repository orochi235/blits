crossfade's `warm` weight loses its input mark (B): fixed 771a940b. `share` and `input` are now in the expression scope, and `warm` is `share(level("mix"), 0, 2)`.

blend's `tone` signal loses its input mark (B): fixed 771a940b, same commit, as the same mistake. `tone` is now `input(…, [slide])`. A new test checks that every preset's weight and blend built on a level compiles to an input.

logo hues use a different sign geometry from the rail (A): fixed a6a56c20. `hueAt` now gets the rail sign's full height, including the 13 rows below the word.

logo's halo is always on, unlike the rail's (B): fixed f71b5d45. The halo now sits under an owner `near` weighted `slew(level('hover'))`, as on the site.

logo says hovering runs the rainbow, but only the `hover` slider does (A): fixed b5e74f16. The doc comment now says the `hover` level stands in for pointing at the logo. This is a comment-only change, so it has no test. Question: should the stage's pointer drive `hover` instead? I didn't make that change, because it means changing how the player handles the pointer, outside this area.

logo missing from the README preset table (A): fixed 15f004d5. I added the row, plus a test that the table lists every preset, in order.

No extra defects. The playground is `private`, so I added no CHANGELOG lines. I did document `share` and `input` in the playground README's expression-scope paragraph.

Checks:
- `npx vitest run test/presets.test.ts`: pass (37 passed)
- `npx vitest run test/expr.test.ts`: pass (9 passed)
- `npm run typecheck`: pass
- `npm run lint`: pass (no errors; 1 info, in `bench/levels-hash.mjs`, a file I didn't touch)
- tree clean

tally: 5 of 6 fixed, 0 extra fixed