import type { Board, Led } from '../../board.js';
import type { Lamps, Shape, Sign } from '../../draw.js';
import type { Grid } from '../../grid.js';
import { CHANNELS, type Fade, type Ghost, type SignColumns } from '../../optics.js';
import type { Gpu } from '../gpu.js';
import { LAMP_SIZE } from '../lights.js';
import { boardLights, type SignLights } from '../sign-lights.js';
import { createGpuOptics } from './optics.js';
import { createPainter, type Look } from './pipelines.js';
import { type ChannelSource, createSources, type Follow, planOf } from './sources.js';

export type { ChannelSource, Follow } from './sources.js';

/** A sign drawn with WebGPU, which also lays a followed sign's planes and a highlight on the GPU. */
export interface WebGpuSign extends Sign {
  readonly backend: 'webgpu';
  /** Swaps how lit each dot whose entry is 1 shows; null clears it. */
  setHighlight(mask: Uint8Array | null): void;
  /** Lays another sign's planes over this one's dots, from its `output`; null stops. */
  setFollow(from: Follow | null): void;
  /** Ten numbers per light, each channel at its `SLOT`: the poses the optics read, for a follower. */
  readonly output: GPUBuffer;
  /**
   * The channels the next render reads from the columns rather than the source's buffer, dots and
   * bulbs alike. It holds until the source's mix syncs or changes again, or the source starts or
   * stops keeping a channel on the CPU.
   */
  cpuChannels(): ReadonlySet<keyof SignColumns>;
}

/**
 * A sign like `createSign`'s, drawn with WebGPU on `handle`'s device. Each frame it reads every
 * channel `source` folds on the GPU straight from its buffer, and the rest from the columns; the
 * source's subjects are `b.dots` then `b.cells`, and `leds` must be `b.dots` then `b.bulbs`. Once
 * the device is lost it draws nothing.
 */
export function createWebGpuSign(
  canvas: HTMLCanvasElement,
  b: Board,
  leds: readonly Led[],
  backed: boolean,
  grid: Grid,
  handle: Gpu,
  source: ChannelSource | null,
): WebGpuSign {
  return createWebGpuSignOf(canvas, boardLights(b, leds, grid), handle, source, backed);
}

/** `createWebGpuSign` for any lights. */
export function createWebGpuSignOf(
  canvas: HTMLCanvasElement,
  lights: SignLights,
  handle: Gpu,
  source: ChannelSource | null,
  backed: boolean,
): WebGpuSign {
  const { device, format } = handle;
  const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!ctx) throw new Error('bree: this canvas has no WebGPU context to give');
  ctx.configure({ device, format, alphaMode: 'premultiplied' });
  const make = (shape: Shape) => {
    const sources = createSources(device, shape.board);
    const optics = createGpuOptics(device, shape.board, shape.leds, sources.pose);
    const views = Math.max(...shape.prims.view, 0) + 1;
    const painter = createPainter(device, format, shape.prims, optics.shows, views);
    return { sources, optics, painter };
  };
  let parts = make(lights);
  let lamps: Lamps = {};
  let fade: Fade | undefined;
  let ghost: Ghost | undefined;
  const placement = lights.place(() => lamps.pitch);
  const lost = watchLost(handle);
  let off = false;
  let gone = false;

  const look = (): Look => ({
    pitch: placement.pitch,
    blurred: placement.blur,
    lamp: lamps.size ?? LAMP_SIZE,
    glow: Math.max(lamps.glow ?? 1, 0),
  });
  /** Runs `work`, and stops drawing for good where the device refuses it. */
  const guard = (work: () => void) => {
    if (off || lost.off) return;
    try {
      work();
    } catch (e) {
      off = true;
      console.error(e);
    }
  };
  const sized = () =>
    guard(() => parts.painter.size(canvas.width, canvas.height, look(), backed, placement.views));
  const stop = placement.start(canvas, sized);
  const free = () => {
    parts.painter.destroy();
    parts.optics.destroy();
    parts.sources.destroy();
  };

  return {
    backend: 'webgpu',
    get output() {
      return parts.sources.pose;
    },
    cpuChannels() {
      const plan = planOf(source);
      return new Set(CHANNELS.filter((_, c) => plan[c] === null));
    },
    render(cols, fallback, dt) {
      guard(() => {
        if (placement.update()) parts.painter.repaint(look(), backed, placement.views);
        const enc = device.createCommandEncoder();
        parts.sources.gather(enc, cols, source);
        parts.optics.step(enc, fallback, dt, Math.max(lamps.brightness ?? 1, 0));
        if (canvas.width > 0 && canvas.height > 0)
          parts.painter.draw(enc, ctx.getCurrentTexture().createView(), look());
        device.queue.submit([enc.finish()]);
      });
    },
    setDefects(next) {
      guard(() => parts.optics.setDefects(next));
    },
    setFade(next) {
      fade = next;
      parts.optics.setFade(next);
    },
    setGhost(next) {
      ghost = next;
      parts.optics.setGhost(next);
    },
    setLamps(next) {
      lamps = next;
      placement.refit();
    },
    setHighlight(mask) {
      guard(() => parts.sources.setHighlight(mask));
    },
    setFollow(from) {
      guard(() => parts.sources.setFollow(from));
    },
    reshape(next) {
      guard(() => {
        free();
        parts = make(next);
        if (fade) parts.optics.setFade(fade);
        if (ghost) parts.optics.setGhost(ghost);
      });
      sized();
    },
    destroy() {
      if (gone) return;
      gone = true;
      off = true;
      stop();
      try {
        free();
        ctx.unconfigure();
      } catch {}
    },
  };
}

/**
 * A flag set once `handle`'s device is lost. It lives outside the sign's scope, since the handle
 * outlives its signs and its `lost` promise would otherwise hold every sign ever made.
 */
function watchLost(handle: Gpu): { off: boolean } {
  const state = { off: false };
  void handle.lost.then(() => {
    state.off = true;
  });
  return state;
}
