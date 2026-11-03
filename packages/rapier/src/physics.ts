import {
  type Handle,
  type Kit,
  type Mix,
  type MixOptions,
  mix,
  patch,
  type Signal,
  type VoiceSpec,
} from '@msb235/blits';
import type { Pose2, Pose3 } from './channels.js';
import { dimsOf, type Placed, type RapierModule, type RapierWorld } from './rapier.js';
import { applyLog, copy, type Entry, insert, pack, type State, unpack, worldOf } from './world.js';

/** Each pushed body's force, then torque, by key. */
type Pushes = Record<number, number[]>;
/** Each held body's shown pose, and the one before it if it was held then too, by key. */
type Holds = Record<number, { now: Placed; before: Placed | undefined; dt: number }>;
/** What a frame did to the world: its pushes, and the bodies its authored voices held. */
interface Frame {
  at: number;
  pushes: Pushes;
  holds: Holds;
}

/**
 * What `physics` takes: a mix's options, the Rapier module, and the world's gravity. There is no
 * `keyOf`: every subject is the driver's own, and it keys them itself for a history store.
 */
export interface PhysicsOptions<H> extends Omit<MixOptions<H>, 'keyOf'> {
  /** An initialized Rapier module. `@dimforge/rapier3d-compat` makes a 3D world, `rapier2d-compat` a 2D one. */
  rapier: RapierModule;
  /** Default: `[0, -9.81]` or `[0, -9.81, 0]`. */
  gravity?: readonly number[];
  /**
   * The weight of every body's simulated voice, a signal reading each body. A signal hands a body
   * between physics and authored motion with no weight written from the frame loop. Default 1.
   */
  weight?: number | Signal<object, H>;
}

/** A rigid body: the mix's subject for its pose, with its controls beside it. */
export interface Body<O, H> {
  readonly key: number;
  /** The subject whose `force` and `torque` push the body, read before the world steps. */
  readonly controls: object;
  /** The voice that shows the body where the world puts it, in `Physics.role`, at `PhysicsOptions.weight`. */
  readonly simulated: Handle<object>;
  /** Cues a voice on the body's pose. In `Physics.role` it is an alternative to the simulation; outside it, it adds on top. */
  cue(spec: Omit<VoiceSpec<object, O, H>, 'subjects'>): Handle<object>;
  /** Cues a voice on the body's controls. */
  drive(spec: Omit<VoiceSpec<object, O, H>, 'subjects'>): Handle<object>;
  /** Applies an impulse once, on the step after the mix's current time, and again on any replay through it. */
  impulse(v: readonly number[]): void;
  /** Takes the body out of the world on the step after the mix's current time. A seek back before then brings it back. */
  drop(): void;
}

/** A Rapier world held in a blits mix. */
export interface Physics<O, H> {
  readonly mix: Mix<object, O, H>;
  /** The role every body's simulated voice plays. */
  readonly role: string;
  /**
   * Adds a body made from Rapier's descriptions, on the step after the mix's current time, or on
   * the first step before the mix has synced.
   */
  body(desc: unknown, ...colliders: unknown[]): Body<O, H>;
  /** Syncs the mix to `now`, reads every body's controls, and steps the world. Call it in place of `mix.sync`. */
  sync(now: number): void;
  /** The world as it stands after the last `sync`, for reading. A change made to it is lost at the next seek. */
  world(): RapierWorld | undefined;
}

const ROLE = 'physics';

const copyOf = (r: number | readonly number[]): number | number[] =>
  typeof r === 'number' ? r : [...r];

/** Makes a mix that holds a Rapier world, stepped on its `stepMs` clock and replayed by its history. */
export function physics<O extends Pose2 | Pose3, H extends object = Record<string, never>>(
  kit: Kit<O>,
  opts: PhysicsOptions<H>,
): Physics<O, H> {
  const { rapier, gravity, weight, ...rest } = opts;
  const dims = dimsOf(rapier);
  const g = gravity ?? (dims.n === 2 ? [0, -9.81] : [0, -9.81, 0]);
  // Every subject is the driver's own: the world, each body and each body's controls.
  const keys = new WeakMap<object, string>();
  const m = mix<object, O, H>(kit, {
    ...rest,
    stepMs: rest.stepMs ?? 1000 / 60,
    keyOf: (subject: object) => keys.get(subject) as string,
  });
  const log: Entry[] = [];
  // Each frame's pushes at its mix time. A seek replays steps on what the host reads now, so the
  // world reads the pushes of the frame that caused each step from here instead: the first frame
  // at or after the step's end, looked up half a step early since replayed times can round apart.
  // With a store, history reaches back without end, so the log is kept as far.
  const pushLog: Frame[] = [];
  const keep = rest.history?.store ? Number.POSITIVE_INFINITY : (rest.history?.ms ?? 0);
  const frameAt = (t: number): Frame | undefined => {
    let lo = 0;
    let hi = pushLog.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((pushLog[mid] as { at: number }).at < t) lo = mid + 1;
      else hi = mid;
    }
    return pushLog[lo] ?? pushLog[pushLog.length - 1];
  };
  let seen: State | undefined;
  let live: State | undefined;

  const world = patch<object, O, State, H>(
    0,
    (_p, _s, setting) => {
      const s = setting.state;
      // A world first read before it has stepped holds the bodies added before then.
      if (Number.isNaN(s.t)) {
        applyLog(s, worldOf(s, rapier), log, setting.timestamp, 0, dims);
        s.t = setting.timestamp;
      }
      seen = s;
      return {};
    },
    {
      writes: [],
      state: () => ({
        bytes: null,
        world: new rapier.World(dims.vector(g) as never),
        handles: new Map(),
        t: Number.NaN,
      }),
      step: (s, dt, _subject, setting) => {
        const w = worldOf(s, rapier);
        w.timestep = dt / 1000;
        applyLog(s, w, log, setting.timestamp, dt / 2, dims);
        const frame = frameAt(setting.timestamp - dt / 2);
        const pushes = frame?.pushes ?? {};
        const holds = frame?.holds ?? {};
        for (const k in holds) {
          const handle = s.handles.get(+k);
          const h = holds[k];
          if (handle !== undefined && h !== undefined)
            dims.place(w.getRigidBody(handle), h.now, h.before, h.dt);
        }
        const pushed: number[] = [];
        for (const k in pushes) {
          const handle = s.handles.get(+k);
          if (handle === undefined) continue;
          const v = pushes[k] as number[];
          const b = w.getRigidBody(handle);
          b.addForce(dims.vector(v), true);
          dims.torque(b, dims.n === 2 ? (v[2] ?? 0) : v.slice(3));
          pushed.push(handle);
        }
        w.step();
        for (const handle of pushed) {
          const b = w.getRigidBody(handle);
          b.resetForces(false);
          b.resetTorques(false);
        }
        s.t = setting.timestamp;
      },
      clone: copy,
      pack,
      unpack,
    },
  );
  const WORLD = {};
  keys.set(WORLD, 'world');
  let started = false;

  const simulated = patch<object, O>(
    0,
    (_p, subject) => {
      const handle = live?.handles.get((subject as Body<O, H>).key);
      if (live === undefined || handle === undefined) return {};
      const b = worldOf(live, rapier).getRigidBody(handle);
      return { position: dims.position(b), rotation: dims.rotation(b) } as Partial<O>;
    },
    { writes: ['position', 'rotation'] as (keyof O)[] },
  );

  const now = () => (Number.isNaN(m.timestamp) ? Number.NEGATIVE_INFINITY : m.timestamp);
  const driven = new Set<Body<O, H>>();
  // Each body's voices in the simulation's role besides its own, and its pose the last frame they held it.
  const authored = new Map<Body<O, H>, Handle<object>[]>();
  const held = new Map<Body<O, H>, { pose: Placed; at: number }>();
  const out = m.pose();
  const shown = m.pose();
  // Read at the end of each frame, for the next frame's steps to apply.
  let holding: Holds = {};
  const holdsAt = (at: number): Holds => {
    const holds: Holds = {};
    for (const [body, voices] of authored) {
      const playing = voices.filter((v) => v.state !== 'done');
      if (playing.length === 0) {
        authored.delete(body);
        held.delete(body);
        continue;
      }
      if (playing.length < voices.length) authored.set(body, playing);
      const p = m.probe(body, shown) as unknown as Placed;
      // Shown with none of the simulation, the body is put where it is shown, so the simulation
      // takes it back from there.
      if (
        !live?.handles.has(body.key) ||
        body.simulated.weightOf(body) > 0 ||
        !playing.some((v) => v.weightOf(body) > 0)
      ) {
        held.delete(body);
        continue;
      }
      const now = { position: [...p.position], rotation: copyOf(p.rotation) };
      const last = held.get(body);
      holds[body.key] = { now, before: last?.pose, dt: last === undefined ? 0 : at - last.at };
      held.set(body, { pose: now, at });
    }
    return holds;
  };
  let next = 0;

  return {
    mix: m,
    role: ROLE,
    body(desc, ...colliders) {
      const key = next++;
      insert(log, { at: now(), key, kind: 'add', desc, colliders });
      const controls = {};
      keys.set(controls, `controls ${key}`);
      const own = (spec: Omit<VoiceSpec<object, O, H>, 'subjects'>, subject: object) => {
        if ('subjects' in spec)
          throw new Error('blits-rapier: a body cues on itself; its spec names no subjects');
        return m.cue({ ...spec, subjects: [subject] } as VoiceSpec<object, O, H>);
      };
      const body: Body<O, H> = {
        key,
        controls,
        simulated: undefined as unknown as Handle<object>,
        cue: (spec) => {
          const h = own(spec, body);
          if (spec.role === ROLE) authored.set(body, [...(authored.get(body) ?? []), h]);
          return h;
        },
        drive: (spec) => {
          driven.add(body);
          return own(spec, controls);
        },
        impulse: (v) => insert(log, { at: now(), key, kind: 'impulse', v: [...v] }),
        drop: () => {
          insert(log, { at: now(), key, kind: 'drop' });
        },
      };
      keys.set(body, `body ${key}`);
      (body as { simulated: Handle<object> }).simulated = m.cue({
        patch: simulated,
        subjects: [body],
        role: ROLE,
        ...(weight === undefined ? {} : { weight }),
      });
      return body;
    },
    sync(t) {
      m.sync(t);
      // Cued before the mix has a time, the world would catch up from mix time 0 on its first step.
      if (!started) {
        started = true;
        m.cue({ patch: world, subjects: [WORLD] });
      }
      const pushes: Pushes = {};
      for (const body of driven) {
        const p = m.probe(body.controls, out) as unknown as {
          force: number[];
          torque: number | number[];
        };
        const torque = typeof p.torque === 'number' ? [p.torque] : p.torque;
        if (p.force.some((x) => x !== 0) || torque.some((x) => x !== 0))
          pushes[body.key] = [...p.force, ...torque];
      }
      const at = m.timestamp;
      let back = false;
      while (pushLog.length > 0 && (pushLog[pushLog.length - 1] as { at: number }).at >= at) {
        pushLog.pop();
        back = true;
      }
      // A seek back leaves the holds read before it, and their speeds, behind.
      if (back) {
        holding = {};
        held.clear();
      }
      pushLog.push({ at, pushes, holds: holding });
      let old = 0;
      while (old < pushLog.length - 1 && (pushLog[old + 1] as { at: number }).at < at - keep) old++;
      if (old > 0) pushLog.splice(0, old);
      m.probe(WORLD);
      live = seen;
      holding = holdsAt(at);
    },
    world: () => (live === undefined ? undefined : worldOf(live, rapier)),
  };
}
