# Scrubbing a stateful mix: what is left

**Status: two items unbuilt, one of them undecided.** Fixed-interval stepping (`stepMs`),
closed-form motion (`spring`, `glide`), copies of state, the history horizon, recorded input,
reading back (`mix.project`, `MixOptions.history`) and moving the mix (`mix.seek` with
`history.tape`, 2026-10-07) are built, and the schema page's Score section describes them and the
decisions behind them. Delete this file once both items below are built or turned down, moving any
decision into `docs/schema.html` first.

**For:** whoever works on reading back next. **Answers:** what seeking still gets wrong, and the
measurement that started this.

## Left to build

1. **`handle.seek` on a stateful voice.** Seek moves the voice clock and leaves state where it was,
   so a stepped patch carries state from the old position to the new one. Measured against
   `ec5c6f6`: the spring below, played to 300 ms at 60 fps and then `seek(0)`, reads
   `x = 111.165` on the next frame, where a fresh voice reads about 0. With history the mix could
   restore the copy nearest the new position, the same way a read back does; without it, the
   proposal was to reset state and say so on the handle. Not decided. `restore` in `src/seek.ts`
   already puts one record back from the copy nearest a mix time, which the history half would reuse.
2. **A read ahead after a seek back plays what is cued, not what the tape recorded.** The decision
   (2026-10-07, Decision 10 in the draft this file held) was that `project` ahead of the mix applies
   the tape's recorded calls to its throwaway mix. It cannot as built: each recorded call is a
   closure over the live mix and its voices (`record` in `src/tape.ts`), and a projection is a copy.
   Building it means recording each call as data, a kind and its arguments naming voices by id, and
   applying it to whichever mix is given; motion retargets would then need the projection to stop
   reading the live patch's stretches, which the live mix also writes.

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
