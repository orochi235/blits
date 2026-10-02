# `@msb235/blits-quarks`

**Status: designed 2026-10-02, nothing built.** Delete this file once the package ships and its
README describes it.

**For:** whoever builds the package. **Answers:** what the driver binding a blits mix to
three.quarks particle systems does, what it leaves to the host, and how it ships beside the engine.

## What it is

A host-side driver, published separately so the engine stays light. A host builds its own
three.quarks systems and renderer; the driver reads each subject's pose from a blits mix every frame
and turns it into particles: how many to emit, where, and with what start values. Nothing else about
quarks is wrapped. magicsmoke's spark code (`src/stage.ts`, `src/sparks/emitters.ts` at `c822948`)
is the pattern it generalizes.

## The model

**Subjects are emission points.** Many subjects may share one quarks system, as magicsmoke shares
one system per kind of spark so no shader compiles mid-effect. Each subject's pose is its own;
the driver never folds poses across subjects. blits has already reconciled the voices on each
subject.

**Start values are applied per subject, at birth.** quarks samples a particle's start values when
it spawns. So for each subject with particles to emit, the driver writes that subject's values into
the shared system, emits at the subject's position, and moves on. Afterwards it restores the authored
values, so particles the system emits on its own (its `emissionOverTime`, its bursts) are unaffected.

## Surface

```ts
import { kit, max, mix } from '@msb235/blits';
import { channels, drive } from '@msb235/blits-quarks';

const K = kit({ ...channels, heat: max() });   // the driver's channels, plus the host's own
const m = mix<Fault, Pose>(K);
const quarks = drive(m, { bursts: 'sparks' }); // optional: drain events tagged 'sparks'
quarks.attach(fault, fizzSystem, { at: () => fault.at });

m.sync(now);
quarks.write(dt);                              // dt in ms, as everywhere in blits
batch.update(dt / 1000);                       // the host's own renderer
```

| Channel | Arithmetic | Meaning |
|---|---|---|
| `rate` | `sum()` | Particles per second the driver emits at the subject |
| `speed`, `size`, `life` | `mul()` | Scale the system's authored `startSpeed`, `startSize`, `startLife` for this subject's particles |
| `tint` | `vec(4, mul())` | Scale the authored `startColor` per component |
| `offset` | `vec(3, sum())` | Added to the subject's position |

- `drive(mix, { bursts? })` returns the driver. `attach(subject, system, { at })` binds a subject to a
  system and a position, given as `{ x, y, z }`, `[x, y, z]` or a function returning either.
  `detach(subject)` unbinds it.
- **Only channels present in the mix's kit are applied.** A host that leaves out `tint` keeps color
  to itself.
- **Authored values are captured** the first time a system is attached, so scaling never compounds.
- **Generators:** `ConstantValue` and `IntervalValue` (both ends scaled) for `speed`/`size`/`life`;
  `ConstantColor` for `tint`. Any other generator on a field whose channel is in the kit is refused at
  `attach`, naming the field.
- **`write(dt)`**, per attached subject: probe into a reused pose; add `rate × dt / 1000` to the
  subject's carry and take its whole part; add the `count` of every drained burst event for that
  subject; if the total is above zero, apply the pose, emit at `at + offset`, restore.
- **Bursts** are events `{ count: number }` a patch `send`s under the tag given to `drive`. An event
  for a subject that is not attached is ignored. `send` is the host's tool for anything else a
  discharge drives (flashes, audio); the driver only takes the tag it was given.

Out of scope: per-system settings (forces, behaviors, emitter shape), anything quarks does to a
particle after birth, building systems or renderers, and wrappers for quarks' other generators.

## Packaging

| | |
|---|---|
| Location | `packages/quarks` in the blits repo; root `workspaces: ["site", "packages/*"]` |
| Name and version | `@msb235/blits-quarks`, from 0.1.0, its own `CHANGELOG.md` |
| Dependencies | `@msb235/blits` at an exact version; `three.quarks` and `three` as peers |
| Release | `.github/workflows/release.yml` also runs on a `quarks-v*` tag and then publishes only this package, with the same checks: the tag matches its version, its changelog has the section |
| Manual step | Before the first release, Mike registers trusted publishing for the new name: `npm trust github @msb235/blits-quarks --file release.yml --repo orochi235/blits --allow-publish` |

## Tests

Against real three.quarks in Node if `ParticleSystem.emit` runs without WebGL; otherwise against a
minimal fake system with the same fields. The plan checks which before writing tests.

- Each particle is born with its own subject's values: two subjects on one system, different poses.
- The authored values are back after `write`, and scaling never compounds over many frames.
- The carry gives exact counts over many frames for a fractional rate.
- A burst emits at its subject's position, with its subject's values, beside that subject's rate.
- A channel left out of the kit leaves its field alone.
- An unscalable generator is refused at `attach`.

## After it ships

magicsmoke moves its fizz and tuning onto the driver, in its own repo: fizz becomes `rate` on a
voice per fault, weighted by the fault's level; the tuning sliders become a voice writing
`speed`/`size`/`life`. Its discharges stay in `stage.ts`, which also drives flashes, arcs and audio
from them.
