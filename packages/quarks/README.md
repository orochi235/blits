# @msb235/blits-quarks

Drives [three.quarks](https://github.com/Alchemist0823/three.quarks) particle systems from a
[blits](https://github.com/orochi235/blits) mix. You build the systems and the renderer; each frame
the driver reads each subject's pose and turns it into particles: how many to emit, where, and with
what start values. Its `particles` and `wire` hand back a system already wired to the mix, with an
emitter per position to cue voices on. Nothing else about quarks is wrapped.

```
npm install @msb235/blits @msb235/blits-quarks three three.quarks
```

```ts
import { kit, max, mix, wave } from '@msb235/blits';
import { channels, drive } from '@msb235/blits-quarks';

const K = kit({ ...channels, heat: max() });   // the driver's channels, plus your own
const m = mix(K);
const quarks = drive(m, { kit: K, bursts: 'sparks' });

const sparks = quarks.particles({ startLife, startSpeed, startSize, startColor, shape, material });
scene.add(sparks.system.emitter);
batch.addSystem(sparks.system);              // your own BatchedRenderer

const spot = sparks.at([0, 1, 0]);           // an emission point, and the mix's subject for it
spot.cue({ patch: wave(800, { depth: { rate: 40 } }) });
spot.burst(30);

// each frame
const from = m.now;
m.sync(now);
quarks.write();
batch.update(Math.max(0, m.now - from) / 1000);   // particles move on mix time
```

## Sources and emitters

- **`quarks.particles(options)`** builds a `ParticleSystem` from quarks' own options, with
  `worldSpace` on unless you say otherwise, and wires it. **`quarks.wire(system)`** wires one you
  built. Either returns a `Source`; its `system` is the quarks object, yours to add to a scene and
  a renderer.
- **`source.at(position, opts?)`** adds an emission point on that system and returns its
  `Emitter`. `position` is what `attach` takes below, and `opts` are its other options. Every emitter on a source shares its one system, so one
  shader serves them all. An emitter is the mix's subject for that point: `m.probe(spot)` reads it.
- **`emitter.cue(spec)`** cues a voice on that emitter alone and returns blits' `Handle`. The spec
  names no `subjects`; one that does throws.
- **`emitter.burst(n)`** emits `n` particles, floored, at the next `write`. A burst at or below 0,
  or not finite, adds nothing. It is not on the tape, so a seek does not replay it; a burst that
  has to survive a seek is an event a patch `send`s, as below.
- **`emitter.drop()`** ends the voices cued on it, unbinds it, and drops its subject from the mix.
  A `cue` after it throws. Dropping a source's last emitter puts its authored values back.
  **`source.drop()`** drops every emitter on it. Neither takes the system out of your scene.
- **`source.copy()`** clones the system (`system.clone()`) and wires the clone as a source with no
  emitters. The clone shares the material, so a `BatchedRenderer` may draw both in one batch, and
  its `emitter` starts untransformed: add it to the scene and place it yourself. For another point
  on the same system, call `at` again.
- **A host's subject type has to admit the handles**, since an emitter is the mix's subject: use
  `mix<unknown, …>`, or a union with `Emitter`. Nothing checks this at compile time.

## Channels

Many subjects may share one system, so no shader compiles mid-effect. Each subject's pose is its
own: before a subject's particles are born the driver writes that subject's start values into the
system, scaled from what you authored; afterwards it puts your values back. quarks reads start
values at birth, so every particle carries its own subject's values, and particles the system emits
on its own are untouched.

| Channel | Arithmetic | Meaning |
|---|---|---|
| `rate` | `sum()` | Particles per second the driver emits at the subject |
| `speed`, `size`, `life` | `mul()` | Scale the authored `startSpeed`, `startSize`, `startLife` |
| `tint` | `vec(4, mul())` | Scales the authored `startColor` per component |
| `offset` | `vec(3, sum())` | Added to the subject's position |

Only the channels in your kit are written; leave one out and that field stays yours. A burst is an
event `{ count }` a patch `send`s under the tag you gave `drive`.

## Lower level

`drive`'s own calls bind a subject you keep to a system, which is all the handles above do.

```ts
import { kit, max, mix } from '@msb235/blits';
import { channels, drive } from '@msb235/blits-quarks';

const K = kit({ ...channels, heat: max() });   // the driver's channels, plus your own
const m = mix(K);
const quarks = drive(m, { kit: K, bursts: 'sparks' });
quarks.attach(fault, fizzSystem, { at: () => fault.at });

// each frame
m.sync(now);
quarks.write();
batch.update(dt / 1000);    // your own BatchedRenderer
```


- **`drive(mix, { kit, bursts?, capture? })`** returns the driver. `kit` is the mix's kit, which
  tells the driver which of its channels are present; `bursts` is the tag it drains, and without
  one it drains nothing. `capture` says when it reads a system's authored start values: at the
  first `attach` (`'attach'`, the default), or at every `write` (`'write'`), so you can edit or
  replace a generator between writes, as a live tuning panel does, and the driver scales from
  what it finds there.
- **`attach(subject, system, { at, rate?, frame? })`** binds a subject to a system and a position:
  `{ x, y, z }`, `[x, y, z]`, or a function returning either, asked each frame the subject emits.
  The first subject attached to a system captures its authored start values, so scaling never
  compounds. Attaching a subject twice throws.
  - `rate`, a number or a function asked every write, is particles per second of your own, added
    to the pose's `rate`. No voice weight scales it, and it emits whether or not a voice plays, so
    emission can follow a level you keep yourself.
  - `frame: 'world'` emits at a pure translation to `at`, ignoring the emitter's world rotation and
    scale; the default, `'emitter'`, keeps them, as below.
- **`detach(subject)`** unbinds it. Detaching a system's last subject puts its authored values back
  and forgets them, so a later `attach` captures whatever you have set since. Under
  `capture: 'write'` it leaves the system as it stands.
- **`burst(subject, n)`** emits `n` particles, floored, at the subject on the next `write`, as
  `emitter.burst` does.
- **`write()`**, after `mix.sync`: probes each attached subject, adds `rate` times the mix time
  since the last write to its carry and emits the whole particles, on the frame exact arithmetic
  would, adds the floored `count` of each burst drained for it,
  and emits them all at `at + offset` with that subject's values. A rate or count at or below 0,
  or not finite, adds nothing, and a burst for a subject not attached is ignored. Particles leave
  at the subject's position but with the emitter's world rotation and scale, as of its last
  `matrixWorld` update, so a rotated emitter shape still points where you turned it.
  It returns `quarks.emitted`, a map from each subject that emitted to how many particles it did,
  bursts included, which the driver reuses: read it before the next `write`.
- **If emitting a subject throws** (its `at`, or a behavior's `initialize`), that subject's
  particles for the frame are dropped, every other subject still emits, including its drained
  bursts, your authored values are put back, and then `write` rethrows the first error.
  `quarks.emitted` still holds what the others emitted.

`send` is also yours for anything else a discharge drives, such as flashes or audio: drain your own
tags; the driver takes only the one you gave it. Two drivers on one mix may share a `bursts` tag:
a burst one drains for the other's subject is emitted at the other's next `write`.

## The clock and seeking

The driver keeps no clock. It reads the mix's after your `sync`, so a mix on a shared `transport`
works unchanged: sync the transport, then `write`. Emission follows the mix's rate, ramps
included, and stops at rate 0, but quarks moves particles by the seconds you pass
`batch.update`: pass the mix time since the last frame, as above, so they slow and pause with it.

A seek leaves the particles already alive where they are. They are output already shown, which
quarks owns and history does not keep. Bursts patches `send` play again with the tape, and those
from `burst` do not. The carry, the part of a particle each subject is owed, goes on from where it
stood, so a stretch played again may emit one particle more or fewer per subject. **Call `write()`
right after a seek**, before the next `sync`: the driver tells a seek from a frame by comparing the
mix time with the host's, so a seek back then loses the frame after it, and a seek ahead made while
you were not syncing, as when scrubbing a paused mix, would otherwise be emitted in full on resume.

## Limits

- `startSpeed`, `startSize` and `startLife` must be a `ConstantValue` or `IntervalValue`, and
  `startColor` a `ConstantColor`, when their channel is in the kit; anything else is refused at
  `attach`, and under `capture: 'write'` at every `write`, naming the field.
- A system must have `worldSpace: true`.
- One generator object may not serve two of `startSpeed`, `startSize` and `startLife`, since
  scaling one would scale the other; `attach` refuses it, naming both fields.
- By default the start values are captured at the first `attach` of a system. Replacing a
  generator, or editing one, while the system is attached is not seen: the driver keeps writing to
  the captured generator and puts the captured values back each frame. Detach every subject on the
  system, change it, and attach again, or drive with `capture: 'write'`.
- `write` emits everything a frame owes at once, so a long frame bursts its whole gap's worth of
  particles, born together. The first write owes nothing, and neither does time `mix.rebase()` took
  out or a seek ahead. A long gap you sync straight through is emitted in full, past the mix's
  `maxDt`, which the mix does not expose: call `mix.rebase()` first for a gap you do not want
  played.
- When a frame both sets the mix's rate and starts a ramp, `write` caps that frame by the rates at
  the two writes, not the rate set, so it can come up short: setting rate 1 on a paused mix and
  ramping to 0 over a second emitted 4 particles where 5 were owed.
- What quarks does to a particle after birth (forces, behaviors, color over life) stays quarks'.
