# @msb235/blits-quarks

Drives [three.quarks](https://github.com/Alchemist0823/three.quarks) particle systems from a
[blits](https://github.com/orochi235/blits) mix. You build the systems and the renderer; each frame
the driver reads each subject's pose and turns it into particles: how many to emit, where, and with
what start values. Nothing else about quarks is wrapped.

```
npm install @msb235/blits @msb235/blits-quarks three three.quarks
```

```ts
import { kit, max, mix } from '@msb235/blits';
import { channels, drive } from '@msb235/blits-quarks';

const K = kit({ ...channels, heat: max() });   // the driver's channels, plus your own
const m = mix(K);
const quarks = drive(m, { kit: K, bursts: 'sparks' });
quarks.attach(fault, fizzSystem, { at: () => fault.at });

// each frame
m.sync(now);
quarks.write(dt);           // dt in ms
batch.update(dt / 1000);    // your own BatchedRenderer
```

## Subjects are emission points

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

## API

- **`drive(mix, { kit, bursts? })`** returns the driver. `kit` is the mix's kit, which tells the
  driver which of its channels are present; `bursts` is the tag it drains, and without one it
  drains nothing.
- **`attach(subject, system, { at })`** binds a subject to a system and a position: `{ x, y, z }`,
  `[x, y, z]`, or a function returning either, asked each frame the subject emits. The first
  subject attached to a system captures its authored start values, so scaling never compounds.
  Attaching a subject twice throws.
- **`detach(subject)`** unbinds it. Detaching a system's last subject puts its authored values back
  and forgets them, so a later `attach` captures whatever you have set since.
- **`write(dt)`**, `dt` in ms, after `mix.sync`: probes each attached subject, adds `rate × dt` to
  its carry and emits the whole particles, adds the floored `count` of each burst drained for it,
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
- `write` emits everything `rate × dt` owes at once, so a long `dt`, such as the first frame
  after a hidden tab, bursts a whole gap's worth of particles. The driver does not clamp it: when
  you call `mix.rebase()` after a gap, leave the gap out of the `dt` you hand `write` too, or clamp
  `dt` yourself.
- What quarks does to a particle after birth (forces, behaviors, color over life) stays quarks'.
