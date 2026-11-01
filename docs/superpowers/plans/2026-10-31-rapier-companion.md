# blits-rapier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: unbuilt (2026-10-31).** Deleted once the package lands.

**Goal:** `@msb235/blits-rapier`, per `docs/superpowers/specs/2026-10-31-rapier-companion-design.md`.

**Architecture:** One hidden world subject carries a stateful patch whose state is a Rapier world
held as snapshot bytes and restored lazily, so blits' history keeps and replays it. Bodies are
subjects; each has a `controls` subject read into a recorded host field before the world steps,
and a simulated voice in a shared role that reads the live world after.

**Tech Stack:** TypeScript, blits (repo source), `@dimforge/rapier2d-compat` /
`@dimforge/rapier3d-compat` 0.21.0 as peers, vitest, `@weasel-js/history` as the tests' tape.

Decided since the spec (2026-10-31):
- A history copy holds snapshot bytes; a world is rebuilt from them on first use. Measured: a
  world kept per copy grew RSS by about 1 MB per simulated second before GC caught up.
- The world patch's `at` captures the live state; `sim.sync` reads it straight after its own probe
  of the world, so a debugger's projection, which steps copies, cannot swap it.
- Impulses are not a channel (a voice holding one would apply it every frame): `body.impulse(v)`
  logs one at mix time, replayed like a body's add and drop.
- Kinematic targets wait for a later version; they need a rest-less vector channel.

## Files

| File | Owns |
|---|---|
| `packages/rapier/src/rapier.ts` | Structural types for the Rapier module, world and body; the 2D/3D adapter |
| `packages/rapier/src/channels.ts` | `channels2`, `channels3`, and their pose types |
| `packages/rapier/src/world.ts` | The world state, lazy restore, `clone`, and the time-keyed log |
| `packages/rapier/src/physics.ts` | `physics()`: the mix, the world patch, bodies, `sync` |
| `packages/rapier/src/index.ts` | Exports |
| `packages/rapier/test/*.test.ts` | Replay, blending, controls, log, 2D and 3D |

### Task 1: adapter and channels

- [ ] `rapier.ts`: `RapierModule`, `RapierWorld`, `RapierBody` (the members used: `World`,
  `World.restoreSnapshot`, `timestep`, `step`, `takeSnapshot`, `createRigidBody`,
  `createCollider`, `getRigidBody`, `removeRigidBody`, `free`, `translation`, `rotation`,
  `addForce`, `addTorque`, `resetForces`, `resetTorques`, `applyImpulse`). `dimsOf(rapier)`
  returns `{ n: 2 | 3, position(body), rotation(body), force(body, v), torque(body, v),
  impulse(body, v), gravity(v) }`, picking 3D where the module has `Vector3`.
- [ ] `channels.ts`: `channels2 = { position: vec(2, sum()), rotation: angle(), force: vec(2,
  sum()), torque: sum() }`; `channels3` with `vec(3, …)`, `quat()`, `vec(3, sum())` torque.
- [ ] Test (`adapter.test.ts`): each module yields its `n`; a body's pose reads back in the
  channel's shape (`[x, y]` and an angle; `[x, y, z]` and `[x, y, z, w]`).

### Task 2: the world state and log

- [ ] `world.ts`: `State = { bytes, world, handles: Map<number, number>, t }`; `worldOf(state,
  rapier)` restores from `bytes` when `world` is null; `copy(state)` takes a snapshot into a new
  state with `world: null`. `Entry = { at, key, kind: 'add' | 'drop' | 'impulse', … }` kept
  sorted by `at`; `applyLog(state, log, from, to, dims)` applies entries in `(from, to]`, or every
  entry at or before `to` on a state never stepped.
- [ ] Test (`world.test.ts`): a copy restores the same poses; an entry applies once across two
  steps; a body added at 2 s is absent from a state restored at 1 s until it steps past 2 s.

### Task 3: physics() and replay

- [ ] `physics.ts`: makes the mix (`host` holds `rapier: Record<key, number[]>`), cues the world
  patch (`reads: ['rapier']`, `state`, `step`, `clone`, `at` capturing `setting.state`) on a
  hidden subject, returns `{ mix, role, body, sync, world }`. `sync(now)`: sync, probe every
  `controls` into `host.rapier`, probe the world, keep the state its `at` saw.
- [ ] `body(desc, ...colliders)`: logs an add at mix time (or before the first sync), makes the
  body subject, its `controls` subject, and the simulated voice (role `sim.role`, writes
  `position` and `rotation`, from the live world; nothing while the body is absent).
  `cue`, `drive`, `impulse`, `drop`.
- [ ] Port the spike to `replay.test.ts` through `physics()`, in 2D and 3D: seek back 3 s, then
  equal poses to an uninterrupted run, with a force voice and an impulse in play. Delete
  `spike.test.ts`.

### Task 4: blending and controls tests

- [ ] `blend.test.ts`: simulated at weight 1 shows the world's pose; an authored voice in
  `sim.role` at equal weight lands between; a voice outside the role adds on top.
- [ ] `controls.test.ts`: a force voice accelerates a body against gravity; a torque spins it;
  its weight scales the push; `impulse` moves a body once.

### Task 5: wiring and docs

- [ ] Root `typecheck` gains `tsc -b packages/rapier && tsc -p packages/rapier/tsconfig.test.json`;
  `CHANGELOG.md`, `README.md` for the package; `~/src/PROJECTS.md` line via chezmoi source.
- [ ] Site: a guide `site/src/pages/guides/physics.mdx` with a live 2D canvas example in
  `site/src/live/guides/physics.ts`; nav entry; site alias and dependency.
- [ ] Gate: lint, the package tests, fleet typecheck and site smoke. Commit per task; delete this
  plan and the spec, moving anything durable into the README.
