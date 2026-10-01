# Scrubbing a stateful mix

**Status: a proposal. Nothing in it is built.** Written 2026-09-30 against `ec5c6f6`, from the
weasel side. Delete it once it is built or turned down, and move any decision it settles into
`docs/schema.html` first.

**For:** whoever works on blits next. **Answers:** how a mix could be read at any time, not only at
the next one, given that its patches keep state. The handoff already names the obstruction ("The
mix keeps no history"): accumulated state, and voices that leave with no record. This note proposes
a fix for each, plus one change to normal playback that comes first because it breaks today
without any scrubbing.

## First: stepped state depends on the frame rate

`step` advances by "the whole gap since it last advanced", so a patch integrating with that gap
gets a different answer at a different frame rate. Measured against `ec5c6f6`: a spring from 0
toward 100, written the obvious way (semi-implicit Euler in `step`, stiffness 180, damping 12),
read at 300 ms:

| Frame rate | `x` at 300 ms |
|---:|---:|
| 144 fps | 116.916 |
| 120 fps | 116.384 |
|  60 fps | 114.089 |
|  30 fps | 108.951 |

So the same cue plays differently on a 120 Hz display than on a 60 Hz one, and no replay can be
exact. `maxDt` bounds the damage from one long gap but doesn't change this. `slew` escapes only
because its step is linear in `dt`.

**Built 2026-09-30 as an option**, `MixOptions.stepMs`, off by default so klieg's port stays an
extraction: intervals count from when a subject's delay ran out, `maxDt` caps how many one sample
runs, and the frame's gap stays on `Setting.dt` outside `step`. What follows was the proposal.

**Proposed:** the mix steps state at a fixed interval, and `step` never sees the frame's gap.
Each subject keeps an accumulator. On each sample the mix runs `step` once per whole interval
(`1000 / 120` ms, say, set per mix) and carries the remainder to the next sample. `dt` passed to
`step` is then always the interval, and `maxDt` becomes a limit on how many intervals one sample
may run. The frame's real gap can stay on `Setting.dt` for code that wants it, but `step` should
not.

Cost: a 60 fps frame at a 120 Hz interval runs `step` twice per subject. The benchmark should say
what that is worth before the interval is picked.

## Three kinds of stateful source

What a seek can recover depends on the source, so each patch declares which kind it is:

| Kind | Examples | How a seek recovers it |
|---|---|---|
| `pure` | Every stateless patch; spring, decay and slew toward a fixed target | Evaluate at the new time directly |
| `replay` | A random walk, flocking, any custom `step` | Restore the nearest earlier snapshot and step forward |
| `live` | A patch or signal reading host input: `level()`, the pointer, audio | Only from a recording of the input; otherwise it can't be recovered |

Proposed surface: `Patch.seek?: 'pure' | 'replay' | 'live'`. Absent means `pure` for a patch with
no `state` and `replay` for one with it. A signal is `live` when it has `input` set, which already
exists. A voice takes the least recoverable kind among its patch and its weight signal.

### `pure`: closed forms, piecewise

A damped spring released from a known position and velocity toward a fixed target has an exact
solution in each of its three regimes (under-, critically and over-damped). Decay is
`v₀·e^(−kt)`. Slew toward a constant is linear and then flat. None of these needs a `step`.

What breaks a closed form is a change of target mid-flight. Record one segment per retarget,
`{ at, position, velocity, target }`, and a read at any time becomes a binary search over the
segments plus one evaluation. The segment boundary carries velocity explicitly, which also fixes
the kink `NOTES-FROM-WEASEL.md` describes for `from: 'current'`. A retarget can start the new
segment from the old one's position *and* velocity.

Suggested: ship `spring`, `decay` and `slew` as `pure` patches built this way, so the common
stateful cases never need replay. The segment list grows with retargets, not frames. Bound it by
dropping segments older than the earliest time still reachable by seek (see "Membership").

### `replay`: snapshots at the fixed interval

Needs two things blits doesn't have:

- **State that can be copied.** Either a declared `snapshot(state)` / `restore(snapshot)` pair on
  the patch, or a rule that `state` and everything under `Setting.keep` is plain data that
  `structuredClone` can copy. The rule is simpler to use; the pair is what a patch holding a typed
  array or a class instance needs.
- **Determinism.** Fixed-interval stepping (above), and no unseeded randomness. Anything random
  draws from a seed kept in the state, never `Math.random()`.

Then the mix snapshots each `replay` voice's per-subject state every *N* ms of voice time. A seek
restores the nearest snapshot at or before the target and steps forward to it. So a seek costs at
most *N* ms of stepping, and memory is one snapshot per *N* ms kept, bounded as below.

### `live`: record the input

A value the host writes can't be recomputed from time. While playing, record what each `input`
signal returned per sample: time and value, only when the value changes. Reading the recording
back makes the signal behave like a keyframe track, and the voice becomes `replay`. Recording is
opt-in per mix. It costs memory for every change, and most live uses never seek.

Without a recording, seeking a `live` voice should reset its state and report that on the handle,
rather than leaving state where it was, which is what happens today. Measured against `ec5c6f6`:
the spring above, played to 300 ms at 60 fps and then `seek(0)`, reads `x = 111.165` on the next
frame, where a fresh voice reads about 0.

## Membership: a cue log

The handle-level `seek` above moves one voice. Moving the whole mix to an earlier time also needs
the voices that existed then, including ones that have since faded out and been removed. Proposed:
the mix keeps a log of what changed which voices were present, and how:

- `cue` with its full spec;
- `fade`, `mute`, and writes to a handle's `weight`, `rate` and `seek`;
- the time each took effect.

A mix-level `seek(timestamp)` then rebuilds the set of voices live at that time from the log.
Each voice is restored by its kind: evaluated, replayed from a snapshot, or read from a recorded
input.

This log is a score: a list of timed cues. It is also most of what sequencing would need
("What weasel has that blits doesn't" in `NOTES-FROM-WEASEL.md`), so a timeline and the mix's own
history could be one structure, played forward in one case and recorded in the other.

**Bounding it.** The log, the snapshots, the pure segments and the input recordings all grow while
the mix plays. They need one shared horizon: a mix option such as `history: { ms }` (how far back
a seek may reach) or `history: false` (no seeking back, the current behavior). Everything older
than the horizon is dropped each sync. A mix with no horizon set keeps nothing, so a host that
never seeks pays nothing.

## Order to build it

1. **Fixed-interval stepping.** It fixes normal playback on its own, and everything below depends
   on it.
2. **`Patch.seek` kinds**, with `seek` resetting and reporting a voice it can't recover.
3. **`pure` spring, decay and slew**, piecewise with velocity at the boundaries. *Built
   2026-09-30 as `spring` and `glide` (decay as coasting under friction), keeping one stretch per
   subject until the history horizon exists. `slew` stays a signal; not done as a patch.*
4. **Snapshots for `replay`**, and the `history` horizon.
5. **The cue log and mix-level `seek`.**
6. **Input recording.**

Each step ships on its own. Step 1 changes `step`'s contract, so it wants a changelog entry.
Steps 2–4 only add to the API.

## Reproducing the measurements

Compile `src/` to a scratch directory, so the repo's `.tsbuildinfo` is left alone
(`npx tsc -p tsconfig.json --outDir <dir> --tsBuildInfoFile <dir>/.tsbi`), then run this from
that directory:

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
