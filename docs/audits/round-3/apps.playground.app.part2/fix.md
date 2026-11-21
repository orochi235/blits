Patch error invisible for a spanned motion voice (A+B): fixed 165748a1

Score's own compile listed on the debug panel, unnamed (A+B): fixed 3a3a1aa4

Weight error on a blended voice drops it with its row hidden (A): fixed a1e2d717. A blend member's weight is no longer compiled, since the blend's signal replaces it.

Keys playhead re-derived from start and rate (A+B): fixed 39ed8353. It now reads the voice handle's `elapsed`, which also covers B's mix-rate drift.

`fade in` shows unset as 0 and can't be unset (A): fixed 8d4e0627

`freshVoice` ignores group names (A): fixed fae16c87

Shared link pasted into an open tab is ignored, and its hash then overrules edits on reload (A): fixed fc99eb85

Transport speed is frame-loop math, not the mix's `rate` (A): question. The playground's README documents this split on purpose ("The transport's rate slows the playground's clock, while the mix's slows the voices as the score's clock runs on"). Should score-time speed move onto blits' `rate`, which would mean reworking how the Player seeks by score frame? I left it unchanged.

Shared link overwrites the kept composition with no undo (B): fixed fc99eb85. A link now opens as an undoable edit.

Under StrictMode, useScore leaks a listed mix per edit and unlists the live one (B): fixed 3a3a1aa4. It shares the fix for the unnamed-mix finding: the score's compile is closed at once with `listed: false`.

Shared link that fails to load is dropped with no message and removed from the address (B): fixed fc99eb85. I made the strict call here; is it the right one? A refused link now stays in the address bar, and the voice column says "the shared link holds no composition the playground can load".

`1e999` in a motion option saves as `null` and breaks reload (B): fixed 4129d7ee

Extra defects: none.

No CHANGELOG lines: every change is in `@blits/playground`, which is private (not published).

Checks:
- `npx vitest run apps/playground/test/freshVoice.test.ts`: pass (2)
- `npx vitest run apps/playground/test/compile.test.ts`: pass (26)
- `npx vitest run apps/playground/test/blend.test.ts`: pass (12)
- `npx vitest run apps/playground/test/groups-compile.test.ts`: pass (12)
- `npx vitest run apps/playground/test/phase.test.ts`: pass (6)
- `npx vitest run apps/playground/test/sharedFields.test.ts`: pass (2)
- `npx vitest run apps/playground/test/openLink.test.ts`: pass (3)
- `npx vitest run apps/playground/test/patchOptions.test.ts`: pass (2)
- `npm run typecheck`: pass (exit 0)
- `npm run lint`: pass (exit 0, 1 info, in `bench/levels-hash.mjs`, which I didn't touch)

tally: 11 of 12 fixed, 0 extra fixed