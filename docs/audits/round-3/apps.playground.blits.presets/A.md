Note: the frozen commit named in the brief (0d1aa23a…) is not in this clone (`git cat-file` reports a bad object); I read the working tree at HEAD 836ce269, where the preset files have no uncommitted changes.

## logo preset feeds the hue schedule a different sign geometry from the rail it says it reproduces
- where: apps/playground/src/blits/presets/logo.ts:17 (ROWS), :57 (`hues` voice `at`)
- scenario: the rail calls `hueAt(phase * CYCLE, dot.x, dot.y, cols, rows)` with the bree board's whole size (site/src/live/logo.ts:54, :103), which includes `BELOW = 13` blank rows under the word (site/src/live/sign.ts:12, :21). The preset passes `ROWS = TOP + WORD.rows + 2` (13 rows) instead. `hueAt`'s crossings read `y / rows` and `rows / cols` (brand/hues.js: the bottom-up sweep, the radial sweep, and the diagonal one), so the time each lit dot changes hue, and the shape of the sweep across the word, differ from the rail's. The header comment says this is "the site's rail logo as voices", and the comment at line 13 says the sign stands "as the rail stands it". Expected: either pass the rail's cols/rows to `hueAt` (or build the stage to match), or stop claiming it matches the rail.
- evidence: read (compared the two call sites and sign.ts; not run)
- severity: low

## logo preset says hovering runs the rainbow, but in the playground only the `hover` slider drives it
- where: apps/playground/src/blits/presets/logo.ts:6 (doc comment), :25 (`hover` level), :68 (`rainbow` weight)
- scenario: the rainbow's weight is `slew(level('hover'))`. The playground sets levels only from the level sliders (`player.setLevel` at apps/playground/src/app/App.tsx:258), and pointer movement only moves `around` circles (`player.point`, pointer.ts). Hovering or pointing at the stage moves the halo but never raises `hover`, so the rainbow never runs on hover, unlike the rail ("Pointing at it … runs a rainbow", site/src/live/logo.ts:68). Expected: either the doc says the `hover` slider stands in for hovering, or the pointer drives the level.
- evidence: read
- severity: low

## the `logo` preset is missing from the playground README's preset table
- where: apps/playground/src/blits/presets/index.ts:31 (the `logo` entry); the table is apps/playground/README.md:461-475
- scenario: `PRESETS` lists 14 presets ending with `logo`, and presets.test.ts pins that list. The README's "Presets" table, which claims one row per file in `src/blits/presets/`, stops at `backward` and has no `logo` row. A reader of the docs does not learn the preset exists or what it shows.
- evidence: read
- severity: low

## Files read
apps/playground/src/blits/presets/anchors.ts
apps/playground/src/blits/presets/backward.ts
apps/playground/src/blits/presets/blend.ts
apps/playground/src/blits/presets/bounded-glow.ts
apps/playground/src/blits/presets/crossfade.ts
apps/playground/src/blits/presets/fold-rules.ts
apps/playground/src/blits/presets/freeze-handover.ts
apps/playground/src/blits/presets/index.ts
apps/playground/src/blits/presets/logo.ts
apps/playground/src/blits/presets/marks-hits.ts
apps/playground/src/blits/presets/owner-fade.ts
apps/playground/src/blits/presets/pointer-glow.ts
apps/playground/src/blits/presets/span-fit.ts
apps/playground/src/blits/presets/spring-retarget.ts
apps/playground/src/blits/presets/stagger-wave.ts

<!-- done: 3 findings, files read: 15 -->
