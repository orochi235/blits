import { Lanes } from '../lanes.js';
import { Mixer, made } from '../mixer.js';
import type { Engine, Kit, Mix, MixOptions } from '../types.js';
import { GpuSide } from './side.js';
import type { GpuDevice } from './webgpu.js';

const sides = new WeakMap<object, GpuSide<unknown>>();

/** The mixer behind a mix: the mix object is one. Throws for a mix no stock engine made. */
export function mixerOf<I, O, H>(m: Mix<I, O, H>): Mixer<I, O> {
  if (!(m instanceof Mixer)) throw new Error('blits: this mix was not made by a stock engine');
  return m as unknown as Mixer<I, O>;
}

/**
 * What `gpu` takes.
 *
 * @category gpu
 */
export interface GpuOptions {
  /** The device to fold on: `await (await navigator.gpu.requestAdapter()).requestDevice()`. */
  device: GpuDevice;
}

/**
 * An engine that folds `keys`, `wave`, `tween`, `spring`, `glide` and shader patch voices on the
 * GPU, into buffers a host draws from, and runs everything else as the stock `mixer` does. Each
 * frame, `gpuOf(m).channel(name)` gives the buffer for a channel the GPU folded, and
 * `gpuOf(m).read(name)` its values in JS from the previous frame; `probe`, `pull`, `project`, and
 * `seek` run on the CPU, through each shader patch's `at`.
 *
 * @category gpu
 */
export function gpu(opts: GpuOptions): Engine {
  return {
    name: 'gpu',
    runs: new Set<'fn' | 'keys' | 'motion'>(['fn', 'keys', 'motion']),
    create<I, O, H = unknown>(kit: Kit<O>, mixOpts: MixOptions<H>): Mix<I, O, H> {
      const m = made<I, O, H>(kit, mixOpts, Lanes);
      const side = new GpuSide<I>(mixerOf(m) as never, opts.device);
      sides.set(m, side as GpuSide<unknown>);
      const close = m.close.bind(m);
      m.close = () => {
        side.close();
        sides.delete(m);
        close();
      };
      return m;
    },
  };
}

/**
 * The GPU half of a mix the `gpu` engine made. Throws for any other mix.
 *
 * @category gpu
 */
export function gpuOf<I, O, H>(m: Mix<I, O, H>): GpuSide<I> {
  const side = sides.get(m);
  if (side === undefined) throw new Error('blits: gpuOf takes a mix the gpu engine made');
  return side as GpuSide<I>;
}
