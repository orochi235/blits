import { cssOf } from '../color.js';
import type { Lamps, Shape, Sign } from '../draw.js';
import type { Fade, Ghost } from '../optics.js';
import {
  BLOOM,
  BULB_COLOR,
  DOT_COLOR,
  PLATE_COLOR,
  SEGMENT_COLOR,
  WIRE_COLOR,
} from './bloom-params.js';
import { type Housing, housingPaint } from './housing.js';
import { LAMP_SIZE, LED } from './lights.js';
import { createOpticsFrame, type Lit, lit } from './optics-frame.js';
import { paintTraced, traceOwn, tracePrim } from './paint2d.js';
import { VIEW } from './placement.js';
import { glowOfPrim, NO_LIGHT, radiusOfPrim, SOCKET } from './prims.js';
import type { SignLights } from './sign-lights.js';

/** An unlit wire's width as a share of a lit one's. */
export const WIRE_SHARE = 0.15;

/** Each socket's color, by `SOCKET` value; a wire's is drawn thin. */
export const SOCKET_COLORS: Readonly<Record<number, number>> = {
  [SOCKET.dot]: DOT_COLOR,
  [SOCKET.bulb]: BULB_COLOR,
  [SOCKET.segment]: SEGMENT_COLOR,
  [SOCKET.wire]: WIRE_COLOR,
  [SOCKET.plate]: PLATE_COLOR,
};

/** How far a light of radius `r` blooms: its radius times `glow`, nothing at 0. */
export function haloRadius(r: number, glow: number): number {
  return r * Math.max(glow, 0);
}

const hexOf = (out: Lit, l: number) =>
  (Math.round((out.rgb[l * 3] as number) * 255) << 16) |
  (Math.round((out.rgb[l * 3 + 1] as number) * 255) << 8) |
  Math.round((out.rgb[l * 3 + 2] as number) * 255);

/** A sign drawing `lights` on `canvas` with the 2D canvas API, round a `housing` housing. */
export function createSign2d(
  canvas: HTMLCanvasElement,
  lights: SignLights,
  housing: Housing = 'dark',
): Sign {
  const paint = housingPaint(housing);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const layer = () => {
    const c = document.createElement('canvas');
    return { c, x: c.getContext('2d') as CanvasRenderingContext2D };
  };
  const glow = layer();
  const body = layer();
  const house = layer();
  let shape: Shape = lights;
  let frame = createOpticsFrame(shape.board, shape.leds);
  let out = lit(shape.leds.length);
  let lamps: Lamps = {};
  let fade: Fade | undefined;
  let ghost: Ghost | undefined;
  const placement = lights.place(() => lamps.pitch);

  /** Runs `each` per primitive with `c` clipped to and transformed into its view. */
  const perView = (c: CanvasRenderingContext2D, each: (k: number, scale: number) => void) => {
    const { prims } = shape;
    let at = -1;
    let scale = 0;
    for (let k = 0; k < prims.n; k++) {
      const v = prims.view[k] as number;
      if (v !== at) {
        if (at >= 0) c.restore();
        at = v;
        const o = v * VIEW;
        const w = (i: number) => placement.views[o + i] as number;
        scale = w(2);
        c.save();
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.beginPath();
        c.rect(w(4), w(5), w(6) - w(4), w(7) - w(5));
        c.clip();
        c.setTransform(scale, 0, -w(3) * scale, scale, w(0), w(1));
      }
      if (scale > 0) each(k, scale);
    }
    if (at >= 0) c.restore();
  };

  function paintHousing(): void {
    const h = house.x;
    h.setTransform(1, 0, 0, 1, 0, 0);
    h.clearRect(0, 0, house.c.width, house.c.height);
    if (paint.backing !== null) {
      h.fillStyle = cssOf(paint.backing);
      h.fillRect(0, 0, house.c.width, house.c.height);
    }
    if (!paint.sockets) return;
    const lamp = lamps.size ?? LAMP_SIZE;
    const { prims } = shape;
    perView(h, (k, scale) => {
      const socket = prims.socket[k] as number;
      if (socket === SOCKET.none) return;
      const css = cssOf(SOCKET_COLORS[socket] ?? DOT_COLOR);
      if (socket === SOCKET.wire) {
        const r = Math.max(radiusOfPrim(prims, k, lamp) * WIRE_SHARE, 0.5 / scale);
        paintTraced(h, tracePrim(h, prims, k, r), css);
      } else paintTraced(h, traceOwn(h, prims, k, lamp), css);
    });
  }

  const stop = placement.start(canvas, () => {
    for (const l of [glow, body, house]) {
      l.c.width = canvas.width;
      l.c.height = canvas.height;
    }
    paintHousing();
  });

  /** Draws each lit primitive's lens into the body and its bloom into the glow. */
  function paintLights(spread: number): void {
    const lamp = lamps.size ?? LAMP_SIZE;
    const { prims } = shape;
    const b = body.x;
    const g = glow.x;
    for (const c of [g, b]) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, canvas.width, canvas.height);
    }
    perView(b, (k, scale) => {
      const l = prims.light[k] as number;
      const shine = l === NO_LIGHT ? 0 : (out.shine[l] as number);
      if (!(shine > 0)) return;
      const css = cssOf(hexOf(out, l));
      const r = radiusOfPrim(prims, k, lamp);
      b.globalAlpha = shine;
      paintTraced(b, tracePrim(b, prims, k, r), css);
      b.globalAlpha = shine * LED.coreAlpha;
      paintTraced(b, tracePrim(b, prims, k, r * LED.core), cssOf(LED.coreTint));
      const bloom = haloRadius(r, (out.bloom[l] as number) * spread * glowOfPrim(prims, k));
      if (bloom <= 0) return;
      const m = b.getTransform();
      g.globalAlpha = shine;
      if (placement.blur) {
        g.setTransform(m);
        paintTraced(g, tracePrim(g, prims, k, bloom), css);
        return;
      }
      // Each view blooms by its own pitch, as the marquee's canvas blur does by its one: the halo's
      // shadow, blurred that far, cast from a copy drawn off the canvas. A shadow's blur is 2σ.
      const sigma = scale * BLOOM.spread * spread * glowOfPrim(prims, k);
      const away = canvas.width + canvas.height + sigma * 8;
      g.setTransform(m.a, m.b, m.c, m.d, m.e - away, m.f);
      g.shadowColor = css;
      g.shadowBlur = sigma * 2;
      g.shadowOffsetX = away;
      paintTraced(g, tracePrim(g, prims, k, bloom), css);
      g.shadowBlur = 0;
      g.shadowOffsetX = 0;
    });
    b.globalAlpha = 1;
    g.globalAlpha = 1;
  }

  return {
    render(cols, fallback, dt) {
      const spread = Math.max(lamps.glow ?? 1, 0);
      frame.step(cols, fallback, dt, Math.max(lamps.brightness ?? 1, 0), out);
      // A canvas with no size, its box unlaid or hidden, can't be drawn from.
      if (canvas.width === 0 || canvas.height === 0) return;
      if (placement.update()) paintHousing();
      paintLights(spread);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      // A housing with no backing covers nothing, so the last frame's glow is cleared first.
      if (paint.backing === null) ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!paint.blank) ctx.drawImage(house.c, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      if (placement.blur)
        ctx.filter = `blur(${(placement.pitch * BLOOM.spread * spread).toFixed(1)}px)`;
      ctx.drawImage(glow.c, 0, 0);
      ctx.filter = 'none';
      ctx.drawImage(body.c, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    },
    setDefects(defects) {
      frame.setDefects(defects);
    },
    setFade(next) {
      fade = next;
      frame.setFade(next);
    },
    setGhost(next) {
      ghost = next;
      frame.setGhost(next);
    },
    setLamps(next) {
      lamps = next;
      placement.refit();
    },
    reshape(next) {
      shape = next;
      frame = createOpticsFrame(next.board, next.leds);
      if (fade) frame.setFade(fade);
      if (ghost) frame.setGhost(ghost);
      out = lit(next.leds.length);
      if (canvas.width > 0) paintHousing();
    },
    destroy() {
      stop();
    },
  };
}
