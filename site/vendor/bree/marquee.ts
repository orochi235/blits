import { type Handle, mix } from '@msb235/blits';
import { board, KIT, type Led, type Pose, SIZE, type Subject } from './board.js';
import { cueBorder } from './border.js';
import { AMBER } from './color.js';
import { signColumns } from './draw.js';
import type { Stop } from './effects.js';
import { faceOf } from './font.js';
import { gridOf } from './grid.js';
import { cueLayers } from './layers.js';
import type { Marquee, MarqueeOptions } from './marquee-api.js';
import { onGpu } from './modulators/shader.js';
import { layOut, PassClock, type PassScene } from './pass.js';
import { cueProgram, effectOf, type StagedScene, stageProgram } from './program.js';
import { attach, pullChannels, readChannels, register } from './render/attach.js';
import { createOverlay } from './render/overlay.js';
import { createTicker } from './ticker.js';

/** A gap between frames this long is a hidden tab coming back, and is left out of the show. */
const AWAY_MS = 250;
/** Frames a WebGPU sign keeps reading its channels back after `columns` was last read. */
const READ_FRAMES = 60;

/**
 * A sign on `canvas`, playing its program in a loop under whichever layers are on. It sizes the
 * canvas to the largest that fits its parent element, and draws every animation frame.
 */
export function createMarquee(canvas: HTMLCanvasElement, opts: MarqueeOptions = {}): Marquee {
  const named = typeof opts.grid === 'string' ? opts.grid : undefined;
  // A triangle tiling lays a font dot across two places, so its sign is twice as many across.
  const across = named === 'triangles' ? SIZE.cols * 2 : SIZE.cols;
  const b = board(opts.cols ?? across, opts.rows ?? SIZE.rows, opts.border !== false, named);
  const leds: readonly Led[] = [...b.dots, ...b.bulbs];
  const cols = signColumns(leds.length);
  const cells = signColumns(b.cells.length);
  const drawing = attach(canvas, b, leds, {
    draw: opts.draw ?? true,
    backend: opts.backend,
    gpu: opts.gpu,
    backed: opts.housing ?? true,
    grid: gridOf(opts.grid),
  });
  const { sign, backend } = drawing;
  const m = mix<Subject, Pose>(KIT, {
    name: opts.name ?? `marquee ${canvas.id ? `#${canvas.id} ` : ''}${b.cols}×${b.rows}`,
    labelOf: (s: Subject) => (s.kind === 'cell' ? `cell ${s.i}` : `dot ${s.x},${s.y}`),
    engine: drawing.engine,
  });
  drawing.bind(m);
  if (opts.rate !== undefined && opts.rate !== 1) m.ramp(opts.rate, 0);
  if (opts.defects) sign?.setDefects(opts.defects);
  if (opts.fade) sign?.setFade(opts.fade);
  if (opts.ghost) sign?.setGhost(opts.ghost);
  if (opts.lamps) sign?.setLamps(opts.lamps);
  let color = opts.color ?? AMBER;

  let program = opts.program ?? [];
  let effects = opts.effects ?? {};
  let live = true;
  let pass: Handle<Subject> | null = null;
  let scenes: readonly PassScene[] = [];
  let length = 0;
  let stops: readonly Stop[] = [];
  /** The stop the pass is waiting at, or null while it is not waiting. */
  let held: number | null = null;
  /** Where the pass stood at the last frame, so a rest it ran past since holds it. */
  let passed = Number.NEGATIVE_INFINITY;
  const clock = new PassClock();
  /** A pass ended; the next starts at the next frame, so one that ends at once cannot spin. */
  let due = false;
  let staged: readonly StagedScene[] = [];
  /** Cues the staged pass afresh, from its start. */
  const cue = () => {
    const mine = cueProgram(m, staged);
    clock.set(m.now);
    pass = mine;
    mine.done.then(() => {
      if (pass === mine) due = true;
    });
    return mine;
  };
  // Each pass reads the program and effects as they stand when it starts.
  const again = (from = 0) => {
    if (!live) return;
    const all = typeof program === 'function' ? program() : program;
    const offset = from > 0 && from < all.length ? from : 0;
    const chosen = offset ? all.slice(offset) : all;
    staged = stageProgram(b, chosen, effects, onGpu(m));
    ({ scenes, length, stops } = layOut(staged, offset));
    held = null;
    passed = Number.NEGATIVE_INFINITY;
    if (chosen.length > 0) cue();
    else pass = null;
  };
  again();

  let synced = false;
  let early: { at: number; rate: number } | null = null;
  /** Moves the pass to `at`, playing at `rate`. */
  const moveTo = (at: number, rate: number) => {
    if (pass === null) return;
    // A scene that has ended has left the mix, so the pass is cued again and moved from its start.
    pass.fade({ over: 0 });
    const fresh = cue();
    fresh.seek(at);
    fresh.rate = rate;
    clock.set(m.now, at, rate);
    held = null;
    passed = at;
  };
  /** Holds the pass at the first rest it has reached since the last frame. */
  const rest = () => {
    if (pass === null || held !== null) return;
    const now = clock.read(m.now);
    const i = stops.findIndex((s) => !s.release && s.at > passed && s.at <= now);
    if (i < 0) {
      passed = now;
      return;
    }
    moveTo((stops[i] as Stop).at, 0);
    held = i;
  };

  /**
   * Throws on a scene naming no effect or face; a program given as a function is checked as each
   * pass starts.
   */
  const check = (p: typeof program, e: typeof effects) => {
    if (typeof p !== 'function')
      for (const scene of p) {
        effectOf(scene, e);
        faceOf(scene.face);
      }
  };

  const layers = cueLayers(m, b, opts.layers);
  const border = cueBorder(m, b, opts.border || { bulbs: 'unlit' });

  let last = performance.now();
  let mixMs = 0;
  let drawMs = 0;
  let frames = 0;
  /** The frame `columns` was last read in; reading back runs while it is recent. */
  let readAt = Number.NEGATIVE_INFINITY;
  const frame = (now: number) => {
    let gap = now - last;
    last = now;
    if (gap > AWAY_MS) {
      m.rebase();
      gap = 0;
    }
    if (due) {
      due = false;
      // A pass that cannot start leaves the sign idle, its layers playing, until setProgram or
      // setEffects.
      try {
        again();
      } catch (e) {
        pass = null;
        console.error(e);
      }
    }
    const t0 = performance.now();
    m.sync(now);
    synced = true;
    if (early) {
      moveTo(early.at, early.rate);
      early = null;
    }
    clock.settle(m.now);
    rest();
    overlay.prepare();
    pullChannels(m, b, cols, cells, drawing.cpuChannels());
    overlay.follow();
    overlay.highlight();
    const t1 = performance.now();
    sign?.render(cols, color, gap);
    if (backend === 'webgpu' && frames - readAt <= READ_FRAMES)
      readChannels(m, b, cols, cells, drawing);
    frames++;
    const t2 = performance.now();
    const raw = { mixMs: t1 - t0, drawMs: t2 - t1 };
    mixMs += (raw.mixMs - mixMs) * 0.05;
    drawMs += (raw.drawMs - drawMs) * 0.05;
    opts.onFrame?.({ mixMs, drawMs, backend, raw });
  };
  const overlay = createOverlay(b, cols, drawing, () => self, opts.follow);
  /** Settles the follow outside a frame, pulling any channel it moved onto the CPU. */
  const prepare = () => {
    const was = drawing.cpuChannels();
    overlay.prepare();
    const moved = [...drawing.cpuChannels()].filter((c) => !was.has(c));
    pullChannels(m, b, cols, cells, new Set(moved));
  };

  const self: Marquee = {
    board: b,
    backend,
    get columns() {
      readAt = frames;
      return cols;
    },
    repaint() {
      prepare();
      overlay.follow();
      sign?.render(cols, color, 0);
    },
    setHighlight(next) {
      prepare();
      overlay.setHighlight(next);
      sign?.render(cols, color, 0);
    },
    mix: m,
    setProgram(next) {
      check(next, effects);
      const idle = pass === null;
      program = next;
      if (idle) again();
    },
    setEffects(next) {
      check(program, next);
      effects = next;
      if (pass === null) again();
    },
    restart(fromScene = 0) {
      early = null;
      pass?.fade({ over: 0 });
      due = false;
      again(fromScene);
    },
    pass() {
      if (pass === null || length === 0) return null;
      return {
        at: Math.min(length, Math.max(0, clock.read(m.now))),
        length,
        scenes,
        waiting: held !== null,
      };
    },
    seek(ms, opts = {}) {
      if (pass === null) return;
      const at = Math.min(length, Math.max(0, ms));
      const rate = opts.hold ? 0 : 1;
      // The mix has no time to seek from until its first sync, so the first frame makes the seek.
      if (!synced) {
        early = { at, rate };
        clock.set(Number.NaN, at, rate);
        held = null;
        passed = at;
        return;
      }
      moveTo(at, rate);
    },
    step() {
      if (held === null) return;
      const k = held + 1;
      const next = stops[k];
      if (next === undefined) {
        moveTo((stops[held] as Stop).at, 1);
        return;
      }
      moveTo(next.at, next.release ? 1 : 0);
      if (!next.release) held = k;
    },
    setLayer(name, on, params) {
      layers.set(name, on, params);
    },
    setColor(hex) {
      color = hex;
    },
    ramp(rate, ms = 200) {
      m.ramp(rate, ms);
    },
    setDefects(defects) {
      sign?.setDefects(defects);
    },
    setFade(fade) {
      sign?.setFade(fade);
    },
    setGhost(ghost) {
      sign?.setGhost(ghost);
    },
    setLamps(lamps) {
      sign?.setLamps(lamps);
    },
    setBorder(next) {
      border.set(next);
    },
    destroy() {
      live = false;
      stop();
      drawing.destroy();
      m.close();
    },
  };
  register(self, drawing);
  const stop = (opts.ticker ?? createTicker()).add(frame);
  return self;
}
