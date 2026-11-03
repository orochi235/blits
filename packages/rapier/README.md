# @msb235/blits-rapier

Holds a [Rapier](https://rapier.rs) rigid-body world in a [blits](https://github.com/orochi235/blits)
mix. Voices push bodies around, each body's simulated pose is a voice that blends with authored
motion, and a seek, a loop or a debugger's scrub replays the world exactly. 2D and 3D share one API;
the Rapier module you pass decides which.

```
npm install @msb235/blits @msb235/blits-rapier @dimforge/rapier3d-compat   # or rapier2d-compat
```

```ts
import RAPIER from '@dimforge/rapier3d-compat';
import { kit, patch } from '@msb235/blits';
import { channels3, type Pose3, physics } from '@msb235/blits-rapier';
import { createHistory } from '@weasel-js/history';

await RAPIER.init();
const sim = physics(kit<Pose3>(channels3), {
  rapier: RAPIER,
  history: { ms: 10_000, every: 250, tape: createHistory },   // only to seek
});
sim.body(RAPIER.RigidBodyDesc.fixed(), RAPIER.ColliderDesc.cuboid(10, 0.1, 10));
const box = sim.body(
  RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 4, 0),
  RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5),
);

const gust = patch<object, Pose3>(1500, (phase) => ({ force: [Math.sin(phase * Math.PI) * 8, 0, 0] }), {
  writes: ['force'],
});
box.drive({ patch: gust });

// each frame
sim.sync(now);                                   // in place of sim.mix.sync
const { position, rotation } = sim.mix.probe(box);
```

## Bodies

- **`sim.body(desc, ...colliders)`** adds a body from Rapier's own descriptions, built with the
  module you passed. Nothing else about Rapier is wrapped. The body joins the world on the step
  after the mix's current time, or on the first frame when the mix has not synced yet.
- **A body is the mix's subject for its pose**, `position` and `rotation`: `sim.mix.probe(body)`
  reads it. Its **`controls`** is a second subject, whose `force` and `torque` push the body. They
  are read before the world steps and the pose after, which is why they are two subjects.
- **`body.drive(spec)`** cues a voice on the controls; its weight scales the push.
  **`body.cue(spec)`** cues one on the pose. Neither spec names `subjects`.
- **`body.simulated`** is the `Handle` of the voice that shows the body where the world puts it, in
  the role `sim.role`, at the weight `physics` was given (default 1). A voice cued in that role is
  an alternative to the simulation, and the two crossfade by weight. To hand bodies to authored
  poses and back, give `physics` a `weight` signal and the authored voices its complement, such as
  `share(k, 0, 2)` and `share(k, 1, 2)` of one `level`. While a body's simulated voice is at weight 0
  and a voice in the role holds it, the world puts the body where it is shown, moving as fast as
  the shown pose moves, so handing it back starts the simulation from there. A voice outside the
  role adds on top of wherever physics has it.
- **`body.impulse(v)`** applies an impulse once, on the step after the mix's current time.
  **`body.drop()`** takes the body out of the world then. Both are logged at that time, so a seek
  back before it undoes them and playing forward through it does them again.
- **`sim.world()`** is the Rapier world as the last `sync` left it, for reading: raycasts, contact
  queries, debugging draws. A change made to it directly is lost at the next seek.

## Channels

| Channel | 2D (`channels2`) | 3D (`channels3`) | On |
|---|---|---|---|
| `position` | `vec(2, sum())` | `vec(3, sum())` | the body |
| `rotation` | `angle()`, radians | `quat()`, `[x, y, z, w]` | the body |
| `force` | `vec(2, sum())` | `vec(3, sum())` | its controls |
| `torque` | `sum()` | `vec(3, sum())` | its controls |

Spread them into a kit with your own channels. Forces and torques are in Rapier's units, newtons
and newton-meters for a body whose mass you set in kilograms.

## The clock and seeking

`physics` makes the mix, with `stepMs` 1000 / 60 unless you set it; the world takes one Rapier step
per interval, so it runs at the same rate whatever the frame rate. Pass `history` and a `tape` to
seek. The world lives in the mix as the state of a stateful patch, so blits' history keeps a copy
every `every` ms and a seek replays from the nearest one. A copy is Rapier's snapshot, kept as
bytes and rebuilt into a world only when a replay needs it, so history costs memory in proportion
to the world's size and `ms / every`. Each frame's pushes are logged beside it for the replay and
pruned with history.

`history.store` works: the world pages out as plain data, its snapshot in base64. Give the mix a
`name`, as every mix on a transport with a store needs; `physics` keys its own subjects, so it takes
no `keyOf`. The log of each frame's pushes is not paged and, with a store, is never pruned, so it
grows by one small record a frame for as long as the mix plays.

Replay matches the first pass exactly on one machine. To match across machines, pass Rapier's
deterministic build.

## Not yet

- Kinematic bodies moved by a voice. They need a channel with no rest, which blits' `vec` of
  `sum()` is not.
- Soft bodies, cloth and ropes.
