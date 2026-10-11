import type { Mix } from '@msb235/blits';
import type { DriveOptions, Driver } from '../src/index.js';
import { drive, Tone } from './audio.js';
import {
  type Act,
  DUR,
  frameTimes,
  type Handles,
  make,
  type Pose,
  SR,
  SUBJECT,
  scene,
} from './scene.js';

export interface RenderOptions {
  acts?: readonly Act[];
  grid?: number;
  ahead?: number;
  /** How far the host's clock reads past the audio clock, ms. */
  skew?: number;
  /** How far off the audio clock each of the host's readings of it may be, ms either way. */
  jitter?: number;
  /** Called after each frame's write, with the frame's audio time. */
  each?: (f: number, driver: Driver<string, Pose>, m: Mix<string, Pose>, h: Handles) => void;
}

export interface Rendered {
  /** `freq` and `gain` as the audio thread played them, a sample each, and an impulse per note. */
  freq: Float32Array;
  gain: Float32Array;
  notes: Float32Array;
  /** The frame each act was made at, audio ms, in the order of `acts`. */
  done: number[];
}

/**
 * Plays the scene through the driver into an offline render. Each parameter is a `Tone.Signal`
 * routed straight to an output channel, so the rendered buffer is the parameter's curve.
 */
export async function render(opts: RenderOptions = {}): Promise<Rendered> {
  const { acts = [], skew = 0, jitter = 0 } = opts;
  const done: number[] = [];
  const buffer = await Tone.Offline(
    () => {
      const freq = new Tone.Signal(0);
      const gain = new Tone.Signal(0);
      const merge = new Tone.Merge({ channels: 3 });
      freq.connect(merge, 0, 0);
      gain.connect(merge, 0, 1);
      merge.toDestination();
      const raw = Tone.getContext().rawContext;

      const m = make();
      const h = scene(m, skew);
      let read = 0;
      const take: DriveOptions['take'] = (item, time) => {
        if (!('hit' in item)) return undefined;
        const src = raw.createConstantSource();
        Tone.connect(src, merge, 0, 2);
        src.start(time);
        src.stop(time + 2 / SR);
        return { cancel: () => src.disconnect() };
      };
      const driver = drive(m, {
        clock: () => read / 1000,
        grid: opts.grid,
        ahead: opts.ahead,
        take,
      });
      driver.attach(SUBJECT, { freq, gain });

      let seed = 11;
      for (const f of frameTimes()) {
        seed = (seed * 16807) % 2147483647;
        read = Math.max(0, f + ((seed / 2147483647) * 2 - 1) * jitter);
        m.sync(f + skew);
        acts.forEach((act, k) => {
          if (done[k] !== undefined || f < act.at) return;
          act.run(m, h);
          done[k] = f;
        });
        driver.write();
        opts.each?.(f, driver, m, h);
      }
    },
    DUR / 1000,
    3,
    SR,
  );
  // Copies: node-web-audio-api's arrays read freed memory once their AudioBuffer is collected.
  return {
    freq: buffer.getChannelData(0).slice(),
    gain: buffer.getChannelData(1).slice(),
    notes: buffer.getChannelData(2).slice(),
    done,
  };
}

/** The sample playing at scene time `t` ms. */
export const sampleAt = (t: number): number => Math.round((t * SR) / 1000);

/** The largest gap between a rendered curve and the mix's own values, each ms outside `skip`. */
export function worst(
  curve: Float32Array,
  ref: readonly Pose[],
  channel: keyof Pose,
  skip: readonly [number, number] = [DUR, DUR],
): number {
  let max = 0;
  for (let t = 20; t < DUR - 1; t++) {
    if (t >= skip[0] && t <= skip[1]) continue;
    max = Math.max(max, Math.abs((curve[sampleAt(t)] as number) - (ref[t] as Pose)[channel]));
  }
  return max;
}

/** When each rendered note began, scene ms. */
export function onsets(notes: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < notes.length; i++)
    if ((notes[i] as number) > 0.5 && (i === 0 || (notes[i - 1] as number) <= 0.5))
      out.push((i * 1000) / SR);
  return out;
}

/** How far each expected note is from the nearest rendered one, ms. */
export function offBy(notes: Float32Array, truth: readonly number[]): number[] {
  const heard = onsets(notes);
  return truth.map((t) => Math.min(...heard.map((o) => Math.abs(o - t))));
}
