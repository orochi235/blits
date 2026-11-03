import type { Dims, RapierModule, RapierWorld } from './rapier.js';

/**
 * A world as the world subject's state. A copy for history holds only `bytes`, Rapier's snapshot,
 * so a copy blits lets go of is plain memory; `worldOf` rebuilds the world on first use.
 */
export interface State {
  bytes: Uint8Array | null;
  world: RapierWorld | null;
  /** Each present body's Rapier handle, by its key. */
  handles: Map<number, number>;
  /** The mix time of the last step, NaN before the first. */
  t: number;
}

/**
 * Something done to the world at a mix time, applied by whichever step reaches it, on every
 * replay. `seq` is the frame the host made the call in.
 */
export type Entry = { at: number; seq: number; key: number } & (
  | { kind: 'add'; desc: unknown; colliders: readonly unknown[] }
  | { kind: 'drop' }
  | { kind: 'impulse'; v: readonly number[] }
);

/** The state's world, rebuilt from its snapshot where it has none yet. */
export function worldOf(state: State, rapier: RapierModule): RapierWorld {
  if (state.world === null) {
    state.world = rapier.World.restoreSnapshot(state.bytes as Uint8Array);
    state.bytes = null;
  }
  return state.world;
}

/** A copy sharing nothing with `state`, holding the world as a snapshot. */
export function copy(state: State): State {
  return {
    bytes: state.world === null ? state.bytes : state.world.takeSnapshot(),
    world: null,
    handles: new Map(state.handles),
    t: state.t,
  };
}

/** The state as plain data, for a history store: the snapshot as base64 and the handles as pairs. */
export function pack(state: State): unknown {
  const bytes = state.world === null ? state.bytes : state.world.takeSnapshot();
  let text = '';
  // In chunks: a spread of a large snapshot overflows the call stack.
  for (let i = 0; i < (bytes?.length ?? 0); i += 0x8000)
    text += String.fromCharCode(...(bytes as Uint8Array).subarray(i, i + 0x8000));
  return {
    bytes: btoa(text),
    handles: [...state.handles],
    t: Number.isNaN(state.t) ? null : state.t,
  };
}

/** A state from what `pack` made, its world left to `worldOf` to rebuild. */
export function unpack(data: unknown): State {
  const d = data as { bytes: string; handles: [number, number][]; t: number | null };
  const text = atob(d.bytes);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return { bytes, world: null, handles: new Map(d.handles), t: d.t ?? Number.NaN };
}

/** Puts `entry` into `log` after every entry at or before its time. */
export function insert(log: Entry[], entry: Entry): void {
  let i = log.length;
  while (i > 0 && (log[i - 1] as Entry).at > entry.at) i--;
  log.splice(i, 0, entry);
}

/**
 * Applies the entries a step from the state's time to `to` passes: those at or after the state's
 * time and before `to`, or every one before `to` on a state never stepped. An entry logged at the
 * time the world last stepped to applies on the step after. Both ends are taken `slack` early: a
 * replayed step's times can differ from the first pass's by rounding.
 */
export function applyLog(
  state: State,
  world: RapierWorld,
  log: readonly Entry[],
  to: number,
  slack: number,
  dims: Dims,
): void {
  const from = state.t - slack;
  for (const e of log) {
    if (e.at >= to - slack) break;
    if (e.at < from) continue;
    const handle = state.handles.get(e.key);
    if (e.kind === 'add') {
      if (handle !== undefined) continue;
      const body = world.createRigidBody(e.desc as never);
      for (const c of e.colliders) world.createCollider(c as never, body as never);
      state.handles.set(e.key, body.handle);
    } else if (handle === undefined) {
    } else if (e.kind === 'drop') {
      world.removeRigidBody(world.getRigidBody(handle) as never);
      state.handles.delete(e.key);
    } else {
      world.getRigidBody(handle).applyImpulse(dims.vector(e.v), true);
    }
  }
}
