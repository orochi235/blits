# blits-rapier: design

**Status: unbuilt (2026-10-31).** This spec is scaffolding: once the package lands, its README
holds what is worth keeping and this file is deleted.

A companion package, `@msb235/blits-rapier` in `packages/rapier`, pairing blits with Rapier
rigid-body physics in both directions: voices push bodies, and each body's simulated pose is a
voice that blends with authored motion. Soft bodies are out of scope. Approved in conversation
(2026-10-31): both directions, restore-and-replay on seek, 2D and 3D behind one API, the world
held inside the mix rather than in a driver beside it.

## Shape

```ts
await RAPIER.init();
const sim = physics(K, { rapier: RAPIER, gravity: [0, -9.81, 0], stepMs: 1000 / 60,
                         history: { ms: 10_000, every: 250 } });
const ball = sim.body(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0),
                      RAPIER.ColliderDesc.ball(0.5));
ball.drive({ patch: gust });            // a voice on the body's controls
ball.cue({ patch: settle, weight: w }); // an authored voice on the body's pose
ball.simulated.fade.out(300);           // the simulated voice blends with the rest
sim.sync(now);                          // each frame, in place of mix.sync
sim.mix.probe(ball, pose);
```

- blits is a dependency pinned exactly; Rapier is a peer the caller passes in, initialized.
  Which module is passed picks 2D or 3D, and the deterministic build where replay must match
  across machines.
- `physics` makes the mix, since it owns the mix's `host`.

## Subjects and channels

Each body is two subjects: the body, whose pose is `position` and `rotation`, and
`body.controls`, whose pose is `force`, `impulse`, `torque`, and `target` (a kinematic body's
next pose). `cue` places voices on the body, `drive` on its controls. Controls are read before
the world steps and poses after, so they cannot share a subject's probe.

| Dimensions | position | rotation | force, impulse | torque |
|---|---|---|---|---|
| 2D (`channels2`) | `vec(2, sum())` | `angle()` | `vec(2, sum())` | `sum()` |
| 3D (`channels3`) | `vec(3, sum())` | `quat()` | `vec(3, sum())` | `vec(3, sum())` |

## The world

One hidden subject carries a stateful patch whose state is the Rapier world. `sim.sync(now)`:

1. syncs the mix;
2. probes every `controls` subject into a host field the world patch names in `reads`, so
   history records it as input;
3. probes the world subject, whose `step` runs Rapier once per `stepMs`, applying forces and
   torques each step, impulses on the first step of the frame only, and kinematic targets;
4. leaves each body's `simulated` voice to read its body from the world state when the body is
   probed.

## Seek

The world patch's `clone` is Rapier's snapshot and restore, so blits' history keeps a copy every
`every` ms and a seek replays from the nearest one with the recorded controls. Bodies added or
removed go into a log keyed by mix time that the world's step replays. Not in this version:
paging history to a `store` (a Rapier descriptor is not plain data), and edits made directly to
the Rapier world, which do not survive a seek.

## Order of work

1. **Spike, which gates the rest:** a few bodies run 5 s, seek back to 2 s, and replay; every
   pose must equal an uninterrupted run's exactly. If it cannot, stop and reconsider a driver
   beside the mix.
2. Controls, the simulated voice and blending, 2D and 3D.
3. vitest in Node: replay exactness, blending by weight, each control channel, both dimensions.
4. README; a site guide with a live 2D canvas example.
