import {
  type Handle,
  type Kit,
  type Mix,
  type MixOptions,
  mix,
  patch,
  type VoiceSpec,
} from '@msb235/blits';
import type { Pose2, Pose3 } from './channels.js';
import { dimsOf, type RapierModule, type RapierWorld } from './rapier.js';
import { applyLog, copy, type Entry, insert, type State, worldOf } from './world.js';

/** Each pushed body's force, then torque, by key. */
type Pushes = Record<number, number[]>;

/** What `physics` takes: a mix's options, the Rapier module, and the world's gravity. */
export interface PhysicsOptions<H> extends MixOptions<H> {
  /** An initialized Rapier module. `@dimforge/rapier3d-compat` makes a 3D world, `rapier2d-compat` a 2D one. */
  rapier: RapierModule;
  /** Default: `[0, -9.81]` or `[0, -9.81, 0]`. */
  gravity?: readonly number[];
}

/** A rigid body: the mix's subject for its pose, with its controls beside it. */
export interface Body<O, H> {
  readonly key: number;
  /** The subject whose `force` and `torque` push the body, read before the world steps. */
  readonly controls: object;
  /** The voice that shows the body where the world puts it, in `Physics.role`. Weight 1. */
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

/** Makes a mix that holds a Rapier world, stepped on its `stepMs` clock and replayed by its history. */
export function physics<O extends Pose2 | Pose3, H extends object = Record<string, never>>(
  kit: Kit<O>,
  opts: PhysicsOptions<H>,
): Physics<O, H> {
  const { rapier, gravity, ...rest } = opts;
  const dims = dimsOf(rapier);
  const g = gravity ?? (dims.n === 2 ? [0, -9.81] : [0, -9.81, 0]);
  const m = mix<object, O, H>(kit, { ...rest, stepMs: rest.stepMs ?? 1000 / 60 });
  const log: Entry[] = [];
  // Each frame's pushes at its mix time. A seek replays steps on what the host reads now, so the
  // world reads the pushes of the frame that caused each step from here instead: the first frame
  // at or after the step's end, looked up half a step early since replayed times can round apart.
  const pushLog: { at: number; pushes: Pushes }[] = [];
  const keep = rest.history?.ms ?? 0;
  const pushesAt = (t: number): Pushes => {
    let lo = 0;
    let hi = pushLog.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((pushLog[mid] as { at: number }).at < t) lo = mid + 1;
      else hi = mid;
    }
    return (pushLog[lo] ?? pushLog[pushLog.length - 1])?.pushes ?? {};
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
        const pushes = pushesAt(setting.timestamp - dt / 2);
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
    },
  );
  const WORLD = {};
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
  const out = m.pose();
  let next = 0;

  return {
    mix: m,
    role: ROLE,
    body(desc, ...colliders) {
      const key = next++;
      insert(log, { at: now(), key, kind: 'add', desc, colliders });
      const controls = {};
      const own = (spec: Omit<VoiceSpec<object, O, H>, 'subjects'>, subject: object) => {
        if ('subjects' in spec)
          throw new Error('blits-rapier: a body cues on itself; its spec names no subjects');
        return m.cue({ ...spec, subjects: [subject] } as VoiceSpec<object, O, H>);
      };
      const body: Body<O, H> = {
        key,
        controls,
        simulated: undefined as unknown as Handle<object>,
        cue: (spec) => own(spec, body),
        drive: (spec) => {
          driven.add(body);
          return own(spec, controls);
        },
        impulse: (v) => insert(log, { at: now(), key, kind: 'impulse', v: [...v] }),
        drop: () => {
          insert(log, { at: now(), key, kind: 'drop' });
        },
      };
      (body as { simulated: Handle<object> }).simulated = m.cue({
        patch: simulated,
        subjects: [body],
        role: ROLE,
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
      while (pushLog.length > 0 && (pushLog[pushLog.length - 1] as { at: number }).at >= at)
        pushLog.pop();
      pushLog.push({ at, pushes });
      let old = 0;
      while (old < pushLog.length - 1 && (pushLog[old + 1] as { at: number }).at < at - keep) old++;
      if (old > 0) pushLog.splice(0, old);
      m.probe(WORLD);
      live = seen;
    },
    world: () => (live === undefined ? undefined : worldOf(live, rapier)),
  };
}
