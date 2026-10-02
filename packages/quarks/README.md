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

## Limits

- `startSpeed`, `startSize` and `startLife` must be a `ConstantValue` or `IntervalValue`, and
  `startColor` a `ConstantColor`, when their channel is in the kit; anything else is refused at
  `attach`, naming the field.
- A system must have `worldSpace: true`.
- What quarks does to a particle after birth (forces, behaviors, color over life) stays quarks'.
