import type { Kit, Mix } from '@msb235/blits';
import { type EmissionState, Matrix4, type ParticleSystem } from 'three.quarks';
import { Authored } from './authored.js';
import type { Emission } from './channels.js';

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

export interface Driver<I> {
  attach(subject: I, system: ParticleSystem, opts: AttachOptions): void;
  detach(subject: I): void;
  /** Probes every attached subject and emits its particles, `dt` ms after the last write. */
  write(dt: number): void;
}

interface Bound<O> {
  system: ParticleSystem;
  authored: Authored;
  at: AttachOptions['at'];
  pose: O;
  /** Particle-milliseconds owed by `rate`, below one particle's worth. */
  carry: number;
  count: number;
}

export function drive<I, O extends Partial<Emission>>(
  mix: Mix<I, O>,
  opts: DriveOptions<O>,
): Driver<I> {
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

  const emit = (b: Bound<O>): void => {
    b.authored.apply(b.pose);
    const at = typeof b.at === 'function' ? b.at() : b.at;
    const [x, y, z] = 'x' in at ? [at.x, at.y, at.z] : at;
    const o = b.pose.offset;
    matrix.makeTranslation(x + (o?.[0] ?? 0), y + (o?.[1] ?? 0), z + (o?.[2] ?? 0));
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

  return {
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

    write(dt) {
      for (const [subject, b] of bound) {
        mix.probe(subject, b.pose);
        const rate = b.pose.rate ?? 0;
        if (rate > 0) b.carry += rate * dt;
        const n = Math.floor(b.carry / 1000);
        b.carry -= n * 1000;
        b.count = n;
      }
      if (opts.bursts !== undefined)
        for (const sent of mix.drain<Burst>(opts.bursts)) {
          const b = bound.get(sent.subject);
          const n = Math.floor(sent.event.count);
          if (b !== undefined && n > 0) b.count += n;
        }
      for (const b of bound.values())
        if (b.count > 0) {
          emit(b);
          b.count = 0;
        }
      for (const held of systems.values()) held.authored.restore();
    },
  };
}
