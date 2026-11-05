import { type Handle, type Mix, mix, oklab } from '@msb235/blits';
import { KIT, type Pose, type Subject } from '../board.js';
import { AMBER } from '../color.js';
import type { Defect } from '../defects.js';
import { signColumns } from '../draw.js';
import { GRIDS } from '../grid.js';
import { attach, pullChannels } from '../render/attach.js';
import type { Placement } from '../render/placement.js';
import type { SignLights } from '../render/sign-lights.js';
import { createTicker } from '../ticker.js';
import type { Readout, ReadoutDefect, ReadoutOptions, Surface, SurfaceOptions } from './api.js';
import { type Layout, layOutReadouts } from './layout.js';
import { type Box, type Canvas, type Placed, surfacePlacement } from './placement.js';
import { TYPES } from './types/index.js';
import { half as HALF } from './types/segments.js';
import { valueVoice } from './voice.js';

/** A gap between frames this long is a hidden tab coming back. */
const AWAY_MS = 250;
const NIXIE = 0xff6a1a;

interface Entry extends Placed {
  readonly opts: ReadoutOptions;
  value: string | number;
  color: number;
  defects: readonly ReadoutDefect[];
}

const insides = new WeakMap<Surface, { mix: Mix<Subject, Pose>; layout: () => Layout }>();

/** A surface's mix and layout, for tests that cue effects on its readouts. Not for consumers. */
export const insideOf = (s: Surface) => insides.get(s);

/** Splits a value for a readout led by a ½ digit: the ½ digit's part, and the rest. */
function splitHalf(value: string | number, cells: number): [string, string | number] {
  const str = String(value);
  const minus = str.startsWith('-');
  const body = minus ? str.slice(1) : str;
  const one = body.replace(/[.:,]/g, '').length > cells && body.startsWith('1');
  return [`${minus ? '-' : ''}${one ? '1' : ''}`, one ? body.slice(1) : body];
}

/**
 * A surface on `canvas`, its readouts placed by `boxOf` and the canvas sized by `sizing`: the core
 * of `createPanel` and `createOverlay`.
 */
export function createSurface(
  canvas: HTMLCanvasElement,
  opts: SurfaceOptions,
  sizing: Canvas,
  boxOf: (o: ReadoutOptions, canvas: HTMLCanvasElement) => () => Box | null,
): Surface {
  const entries: Entry[] = [];
  const placement: Placement = surfacePlacement(() => entries, sizing);
  let layout: Layout = layOutReadouts([]);
  const lightsOf = (l: Layout): SignLights => ({
    board: l.board,
    leds: l.leds,
    prims: l.prims,
    place: () => placement,
  });
  const drawing = attach(canvas, layout.board, layout.leds, {
    draw: opts.draw ?? true,
    backend: opts.backend,
    gpu: opts.gpu,
    housing: 'clear',
    grid: GRIDS.square,
    lights: lightsOf(layout),
  });
  const { sign } = drawing;
  const m = mix<Subject, Pose>(KIT, { name: 'readouts', engine: drawing.engine });
  drawing.bind(m);
  if (opts.fade) sign?.setFade(opts.fade);
  if (opts.ghost) sign?.setGhost(opts.ghost);
  if (opts.lamps) sign?.setLamps(opts.lamps);
  let cols = signColumns(layout.leds.length);
  let cells = signColumns(layout.board.cells.length);
  let voice: Handle<Subject> | null = null;
  let shaped = true;
  let valued = true;

  const reshape = () => {
    layout = layOutReadouts(
      entries.map((e) => ({
        type: TYPES[e.opts.type],
        cells: e.opts.cells,
        face: e.opts.face ?? 'plate',
        ends: e.opts.ends,
        half: e.opts.half,
      })),
    );
    for (const [i, e] of entries.entries()) e.spot = layout.spots[i] as Layout['spots'][number];
    drawing.reshape(lightsOf(layout));
    cols = signColumns(layout.leds.length);
    cells = signColumns(layout.board.cells.length);
    const defects: Defect[] = entries.flatMap((e) =>
      e.defects.map((d) => ({
        ...d,
        at: { x: e.spot.first + d.at.cell, y: e.spot.base + d.at.slot },
      })),
    );
    sign?.setDefects(defects);
    placement.refit();
  };

  /** Cues the readouts' values afresh, the last cue faded out at once. */
  const play = () => {
    const b = layout.board;
    const on = new Float32Array(b.cols * b.rows);
    const tint = new Float32Array(b.cols * b.rows * 4);
    for (const e of entries) {
      const type = TYPES[e.opts.type];
      const align = e.opts.align ?? type.align;
      const [lead, rest] = e.opts.half ? splitHalf(e.value, e.opts.cells) : ['', e.value];
      const shown = [
        ...(e.opts.half
          ? HALF.encode(lead, 1, 'right').map((s) => ({ s, lights: HALF.cell.lights }))
          : []),
        ...type.encode(rest, e.opts.cells, align).map((s) => ({ s, lights: type.cell.lights })),
      ];
      const color = oklab(e.color);
      for (const [c, { s, lights }] of shown.entries())
        for (const [slot, light] of lights.entries()) {
          const i = (e.spot.base + slot) * b.cols + c;
          on[i] = s.has(light.name) ? 1 : 0;
          tint.set(color, i * 4);
        }
    }
    voice?.fade({ over: 0 });
    voice = m.cue({ name: 'values', patch: valueVoice(b, on, tint), subjects: b.dots, loop: true });
  };

  let last = performance.now();
  const frame = (now: number) => {
    let gap = now - last;
    last = now;
    if (gap > AWAY_MS || gap < 0) {
      m.rebase();
      gap = 0;
    }
    if (shaped) {
      shaped = false;
      valued = true;
      reshape();
    }
    if (valued) {
      valued = false;
      play();
    }
    const t0 = performance.now();
    m.sync(now);
    pullChannels(m, layout.board, cols, cells, drawing.cpuChannels());
    const t1 = performance.now();
    sign?.render(cols, AMBER, gap);
    if (!opts.onFrame) return;
    const raw = { mixMs: t1 - t0, drawMs: performance.now() - t1 };
    mixMs += (raw.mixMs - mixMs) * 0.05;
    drawMs += (raw.drawMs - drawMs) * 0.05;
    opts.onFrame({ mixMs, drawMs, backend: drawing.backend, raw });
  };
  let mixMs = 0;
  let drawMs = 0;
  const stop = (opts.ticker ?? createTicker()).add(frame);

  const self: Surface = {
    backend: drawing.backend,
    readout(o) {
      const type = TYPES[o.type];
      if (!type) throw new Error(`bree: no readout type named ${o.type}`);
      const e: Entry = {
        opts: o,
        value: o.value ?? '',
        color: o.color ?? (o.type === 'nixie' ? NIXIE : AMBER),
        defects: o.defects ?? [],
        slant: o.slant ?? 0,
        spot: { base: 0, first: 0, width: 1, height: 1 },
        box: boxOf(o, canvas),
      };
      entries.push(e);
      shaped = true;
      const r: Readout = {
        get value() {
          return e.value;
        },
        set(value) {
          e.value = value;
          valued = true;
        },
        color(hex) {
          e.color = hex;
          valued = true;
        },
        moveTo(at, height) {
          e.box = boxOf({ ...o, at, height: height ?? o.height }, canvas);
        },
        setDefects(defects) {
          e.defects = defects;
          shaped = true;
        },
        destroy() {
          const i = entries.indexOf(e);
          if (i < 0) return;
          entries.splice(i, 1);
          shaped = true;
        },
      };
      return r;
    },
    destroy() {
      stop();
      drawing.destroy();
      m.close();
    },
  };
  insides.set(self, { mix: m, layout: () => layout });
  return self;
}
