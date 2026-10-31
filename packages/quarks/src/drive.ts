import type { Kit, Mix } from '@msb235/blits';
import { type EmissionState, Matrix4, ParticleSystem } from 'three.quarks';
import { Authored } from './authored.js';
import type { Emission } from './channels.js';
import { type Host, type Source, wire } from './source.js';

/** A point in world space, as an object or a tuple. */
export type Position = { x: number; y: number; z: number } | readonly [number, number, number];

export interface AttachOptions {
  /** Where the subject emits: a position, or a function asked on each frame it emits. */
  at: Position | (() => Position);
}

/** The event a patch sends to burst particles at its subject. */
export interface Burst {
  count: number;
}

export interface DriveOptions<O> {
  /** The mix's kit, so the driver knows which of its channels are present before any probe. */
  kit: Kit<O>;
  /** The tag whose events are bursts; without one the driver drains nothing. */
  bursts?: string;
}

export interface Driver<I, O = unknown> {
  /**
   * Wires a system to the mix as a `Source`, whose emitters are each a subject of their own. The
   * system needs `worldSpace: true`, as `attach` does.
   */
  wire(system: ParticleSystem): Source<I, O>;
  /** `wire(new ParticleSystem({ worldSpace: true, ...options }))`. */
  particles(options: ConstructorParameters<typeof ParticleSystem>[0]): Source<I, O>;
  attach(subject: I, system: ParticleSystem, opts: AttachOptions): void;
  detach(subject: I): void;
  /**
   * Probes every attached subject and emits what its `rate` owes for the mix time since the last
   * write. Call it after `mix.sync`; the first write owes nothing.
   */
  write(): void;
}

interface Bound<O> {
  system: ParticleSystem;
  authored: Authored;
  at: AttachOptions['at'];
  pose: O;
  /** Particle-milliseconds owed by `rate`, below one particle's worth. */
  carry: number;
  count: number;
  /** Particles `burst` owes on the next write. */
  extra: number;
}

export function drive<I, O extends Partial<Emission>>(
  mix: Mix<I, O>,
  opts: DriveOptions<O>,
): Driver<I, O> {
  const kit = opts.kit as object;
  const applies = {
    speed: 'speed' in kit,
    size: 'size' in kit,
    life: 'life' in kit,
    tint: 'tint' in kit,
  };
  const bound = new Map<I, Bound<O>>();
  const systems = new Map<ParticleSystem, { authored: Authored; users: number }>();
  const matrix = new Matrix4();
  const state: EmissionState = {
    burstIndex: 0,
    burstWaveIndex: 0,
    burstParticleIndex: 0,
    burstParticleCount: 0,
    isBursting: false,
    time: 0,
    waitEmiting: 0,
    travelDistance: 0,
  };

  // Floating-point drift in `rate × dt` lands a hair under a whole particle; this much is ignored.
  const SLACK = 1e-6;

  let now = Number.NaN;
  let timestamp = Number.NaN;
  let rate = Number.NaN;

  const emit = (b: Bound<O>): void => {
    const at = typeof b.at === 'function' ? b.at() : b.at;
    const o = b.pose.offset;
    let x: number;
    let y: number;
    let z: number;
    if ('x' in at) {
      x = at.x;
      y = at.y;
      z = at.z;
    } else {
      x = at[0];
      y = at[1];
      z = at[2];
    }
    // The emitter's world rotation and scale, as quarks itself emits with, at the subject's position.
    const world = b.system.emitter.matrixWorld.elements;
    const e = matrix.elements;
    for (let i = 0; i < 12; i++) e[i] = world[i] as number;
    e[12] = x + (o?.[0] ?? 0);
    e[13] = y + (o?.[1] ?? 0);
    e[14] = z + (o?.[2] ?? 0);
    e[15] = 1;
    b.authored.apply(b.pose);
    // Past the system's own bursts, and no time passing: exactly `count` particles, nothing else.
    state.burstIndex = b.system.emissionBursts.length;
    state.burstWaveIndex = 0;
    state.burstParticleIndex = 0;
    state.burstParticleCount = 0;
    state.isBursting = false;
    state.time = 0;
    state.waitEmiting = b.count;
    state.travelDistance = 0;
    b.system.emit(0, state, matrix);
  };

  const host: Host<I, O> = {
    mix,
    attach: (subject, system, at) => driver.attach(subject, system, { at }),
    detach: (subject) => driver.detach(subject),
    burst: (subject, n) => {
      const b = bound.get(subject);
      if (b !== undefined) b.extra += n;
    },
  };

  const driver: Driver<I, O> = {
    wire: (system) => wire(host, system),
    particles: (options) => wire(host, new ParticleSystem({ worldSpace: true, ...options })),

    attach(subject, system, { at }) {
      if (bound.has(subject)) throw new Error('blits-quarks: that subject is attached already');
      let held = systems.get(system);
      if (held === undefined) {
        held = { authored: new Authored(system, applies), users: 0 };
        systems.set(system, held);
      }
      held.users++;
      bound.set(subject, {
        system,
        authored: held.authored,
        at,
        pose: {} as O,
        carry: 0,
        count: 0,
        extra: 0,
      });
    },

    detach(subject) {
      const b = bound.get(subject);
      if (b === undefined) return;
      bound.delete(subject);
      const held = systems.get(b.system);
      if (held !== undefined && --held.users === 0) {
        held.authored.restore();
        systems.delete(b.system);
      }
    },

    write() {
      // Mix time passed, held to the host's gap at the mix's rate so a seek ahead owes nothing.
      // The rate at either end bounds a ramp's, since it moves linearly between them.
      const gone = Math.min(mix.now - now, (mix.timestamp - timestamp) * Math.max(rate, mix.rate));
      const dt = gone > 0 ? gone : 0;
      now = mix.now;
      timestamp = mix.timestamp;
      rate = mix.rate;
      for (const [subject, b] of bound) {
        mix.probe(subject, b.pose);
        const owed = (b.pose.rate ?? 0) * dt;
        if (Number.isFinite(owed) && owed > 0) b.carry += owed;
        const n = Math.floor((b.carry + SLACK) / 1000);
        b.carry -= n * 1000;
        b.count = n;
      }
      if (opts.bursts !== undefined)
        for (const sent of mix.drain<Burst>(opts.bursts)) {
          const b = bound.get(sent.subject);
          const n = Math.floor(sent.event.count);
          if (b !== undefined && Number.isFinite(n) && n > 0) b.count += n;
        }
      // A subject that throws loses this frame's particles; the rest still emit, the authored
      // values always go back, and the first error is rethrown once they have.
      let failed = false;
      let first: unknown;
      try {
        for (const b of bound.values()) {
          // A burst waits here, not in the probe loop, so a probe that throws does not lose it.
          b.count += b.extra;
          b.extra = 0;
          if (b.count <= 0) continue;
          try {
            emit(b);
          } catch (err) {
            if (!failed) first = err;
            failed = true;
          } finally {
            b.count = 0;
          }
        }
      } finally {
        for (const held of systems.values()) held.authored.restore();
      }
      if (failed) throw first;
    },
  };
  return driver;
}
