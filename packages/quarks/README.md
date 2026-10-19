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
m.sync(now);
quarks.write();
batch.update(dt / 1000);
```

## Sources and emitters

- **`quarks.particles(options)`** builds a `ParticleSystem` from quarks' own options, with
  `worldSpace` on unless you say otherwise, and wires it. **`quarks.wire(system)`** wires one you
  built. Either returns a `Source`; its `system` is the quarks object, yours to add to a scene and
  a renderer.
- **`source.at(position)`** adds an emission point on that system and returns its `Emitter`.
  `position` is what `attach` takes below. Every emitter on a source shares its one system, so one
  shader serves them all. An emitter is the mix's subject for that point: `m.probe(spot)` reads it.
- **`emitter.cue(spec)`** cues a voice on that emitter alone and returns blits' `Handle`. The spec
  names no `subjects`; one that does throws.
- **`emitter.burst(n)`** emits `n` particles, floored, at the next `write`. A burst at or below 0,
  or not finite, adds nothing. It is not on the tape, so a seek does not replay it; a burst that
  has to survive a seek is an event a patch `send`s, as below.
- **`emitter.drop()`** ends the voices cued on it, unbinds it, and drops its subject from the mix.
  A `cue` after it throws. Dropping a source's last emitter puts its authored values back.
  **`source.drop()`** drops every emitter on it. Neither takes the system out of your scene.
- **`source.copy()`** clones the system and wires the clone as a source with no emitters. The
  clone compiles its own shader; for another point that shares one, call `at` again.

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


- **`drive(mix, { kit, bursts? })`** returns the driver. `kit` is the mix's kit, which tells the
  driver which of its channels are present; `bursts` is the tag it drains, and without one it
  drains nothing.
- **`attach(subject, system, { at })`** binds a subject to a system and a position: `{ x, y, z }`,
  `[x, y, z]`, or a function returning either, asked each frame the subject emits. The first
  subject attached to a system captures its authored start values, so scaling never compounds.
  Attaching a subject twice throws.
- **`detach(subject)`** unbinds it. Detaching a system's last subject puts its authored values back
  and forgets them, so a later `attach` captures whatever you have set since.
- **`write()`**, after `mix.sync`: probes each attached subject, adds `rate` times the mix time
  since the last write to its carry and emits the whole particles, adds the floored `count` of each burst drained for it,
  and emits them all at `at + offset` with that subject's values. A rate or count at or below 0,
  or not finite, adds nothing, and a burst for a subject not attached is ignored. Particles leave
  at the subject's position but with the emitter's world rotation and scale, as of its last
  `matrixWorld` update, so a rotated emitter shape still points where you turned it.
- **If emitting a subject throws** (its `at`, or a behavior's `initialize`), that subject's
  particles for the frame are dropped, every other subject still emits, including its drained
  bursts, your authored values are put back, and then `write` rethrows the first error.

`send` is also yours for anything else a discharge drives, such as flashes or audio: drain your own
tags; the driver takes only the one you gave it.

## Limits

- `startSpeed`, `startSize` and `startLife` must be a `ConstantValue` or `IntervalValue`, and
  `startColor` a `ConstantColor`, when their channel is in the kit; anything else is refused at
  `attach`, naming the field.
- A system must have `worldSpace: true`.
- One generator object may not serve two of `startSpeed`, `startSize` and `startLife`, since
  scaling one would scale the other; `attach` refuses it, naming both fields.
- The start values are captured at the first `attach` of a system. Replacing a generator, or
  editing one, while the system is attached is not seen: the driver keeps writing to the captured
  generator and puts the captured values back each frame. Detach every subject on the system,
  change it, and attach again.
- `write` emits everything a frame owes at once, so a long frame bursts its whole gap's worth of
  particles. The first write owes nothing, and neither does time `mix.rebase()` took out or a seek
  ahead. A long gap you sync straight through is emitted in full: call `mix.rebase()` first for a
  gap you do not want played.
- What quarks does to a particle after birth (forces, behaviors, color over life) stays quarks'.
