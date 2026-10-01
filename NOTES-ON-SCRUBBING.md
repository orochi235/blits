# Scrubbing a stateful mix: what is left

**Status: partly built.** Rewritten 2026-10-01 down to its unbuilt half. Fixed-interval stepping
(`stepMs`), closed-form motion (`spring`, `glide`), copies of state, the history horizon and
reading back (`mix.project`, `MixOptions.history`) are built, and the schema page's Score section
describes them. Delete this file once the items below are built or turned down, moving any decision
into `docs/schema.html` first.

**For:** whoever works on reading back next. **Answers:** what reading at another time still gets
wrong, and the measurement that started this.

## Decided against: moving the mix itself back

The original proposal had a mix-level `seek(timestamp)` that rebuilt the live voice set from a cue
log. It conflicts with "two clocks, one addressable" (the handoff, 2026-09-27): mix time is a reading
the host reports, never a position anything sets. A scrub is a read instead, `mix.project(t)`, and
the log it would have used is the per-voice control log `history` keeps. Not to be re-proposed.

## Left to build

1. **Recording a patch's host input.** `history: { inputs: true }` records an input signal on a
   voice's weight, built 2026-10-01. A patch that `reads` host fields still reads them live, so a read
   back through one is `held`; recording would mean snapshotting the fields it names per frame.
2. **`handle.seek` on a stateful voice.** Seek moves the voice clock and leaves state where it was,
   so a stepped patch carries state from the old position to the new one. Measured against
   `ec5c6f6`: the spring below, played to 300 ms at 60 fps and then `seek(0)`, reads
   `x = 111.165` on the next frame, where a fresh voice reads about 0. With history the mix could
   restore the copy nearest the new position, the same way a read back does; without it, the
   proposal was to reset state and say so on the handle. Not decided.

## The measurement

`step` handed the frame's gap gives a different answer at a different frame rate, which is why
`stepMs` exists. A spring from 0 toward 100, written as semi-implicit Euler in `step` (stiffness
180, damping 12), read at 300 ms against `ec5c6f6`:

| Frame rate | `x` at 300 ms |
|---:|---:|
| 144 fps | 116.916 |
| 120 fps | 116.384 |
|  60 fps | 114.089 |
|  30 fps | 108.951 |

`test/frame.test.ts` keeps the same integrator. To reproduce, compile `src/` to a scratch directory
(`npx tsc -p tsconfig.json --outDir <dir> --tsBuildInfoFile <dir>/.tsbi`) and run from there:

```js
import { kit, mix, sum, patch } from './index.js';
const spring = patch(0, (_ph, _s, st) => ({ x: st.state.x }), {
  writes: ['x'],
  state: () => ({ x: 0, v: 0 }),
  step: (s, dt) => { const h = dt / 1000; s.v += (180 * (100 - s.x) - 12 * s.v) * h; s.x += s.v * h; },
});
function at(frameMs, until) {
  const m = mix(kit({ x: sum() })); m.cue({ patch: spring, start: 0 });
  const subj = {}; let x;
  for (let t = 0; t <= until + 1e-9; t += frameMs) { m.sync(t); x = m.probe(subj).x; }
  return x;
}
for (const ms of [1000 / 144, 1000 / 120, 1000 / 60, 1000 / 30])
  console.log(`${(1000 / ms).toFixed(0).padStart(3)} fps  x at 300 ms = ${at(ms, 300).toFixed(3).padStart(8)}`);
const m = mix(kit({ x: sum() })); const h = m.cue({ patch: spring, start: 0 }); const s = {};
for (let t = 0; t <= 300; t += 1000 / 60) { m.sync(t); m.probe(s); }
h.seek(0); m.sync(320);
console.log(`after seek(0): x = ${m.probe(s).x.toFixed(3)}`);
```
