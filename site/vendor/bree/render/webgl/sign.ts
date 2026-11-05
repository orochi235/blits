import type { Board, Led } from '../../board.js';
import { rgb } from '../../color.js';
import type { Lamps, Shape, Sign } from '../../draw.js';
import type { Grid } from '../../grid.js';
import type { Fade, Ghost } from '../../optics.js';
import { webglSlot } from '../backend.js';
import { BLOOM, HOUSING } from '../bloom-params.js';
import { gaussian } from '../blur.js';
import { LAMP_SIZE, LED } from '../lights.js';
import { createOpticsFrame, lit } from '../optics-frame.js';
import { boardLights, type SignLights } from '../sign-lights.js';
import { SOCKET_COLORS, WIRE_SHARE } from '../sign2d.js';
import { dark, reclaim, shed, shedContext } from './context.js';
import {
  bind,
  build,
  type Data,
  free,
  type Program,
  type Resources,
  sizeTargets,
  type Target,
  upload as uploadTo,
} from './gl.js';

/**
 * A sign like `createSign`'s, drawn with WebGL 2: every light one instance, its glow blurred on
 * the GPU. Null where the page has no WebGL 2 or no WebGL context left to give, so the canvas is
 * still free for 2D. Where the canvas is WebGL's but its context can't be used (lost for good, or
 * a shader fails to build) the sign draws nothing. A sign destroyed on `canvas` gives its context
 * back to the next made there, which draws once it is restored.
 */
export function createWebGlSign(
  canvas: HTMLCanvasElement,
  b: Board,
  leds: readonly Led[],
  backed: boolean,
  grid: Grid,
): (Sign & { readonly backend: 'webgl' }) | null {
  return createWebGlSignOf(canvas, boardLights(b, leds, grid), backed);
}

/** `createWebGlSign` for any lights. */
export function createWebGlSignOf(
  canvas: HTMLCanvasElement,
  lights: SignLights,
  backed: boolean,
): (Sign & { readonly backend: 'webgl' }) | null {
  const release = webglSlot();
  if (!release) return shed.has(canvas) ? dark() : null;
  const made = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!made) {
    release();
    return null;
  }
  const gl: WebGL2RenderingContext = made;
  const pending = gl.isContextLost() ? reclaim(canvas) : null;
  if (gl.isContextLost() && !pending) {
    release();
    return dark();
  }
  gl.getExtension('EXT_float_blend');
  let shape: Shape = lights;
  let frame = createOpticsFrame(shape.board, shape.leds);
  let out = lit(shape.leds.length);
  let upload = new Float32Array(shape.leds.length * 8);
  let lamps: Lamps = {};
  let fade: Fade | undefined;
  let ghost: Ghost | undefined;
  const placement = lights.place(() => lamps.pitch);
  const viewCount = () => Math.max(...shape.prims.view, 0) + 1;
  const make = () => build(gl, shape.prims, shape.leds.length, viewCount());
  let res: Resources | null = null;
  try {
    res = gl.isContextLost() ? null : make();
  } catch (e) {
    console.error(e);
    shedContext(canvas, gl);
    release();
    return dark();
  }
  let gone = false;

  const run = (p: Program, r: Resources) => {
    bind(gl, p);
    gl.uniform2f(p.u.u_canvas ?? null, canvas.width, canvas.height);
    gl.uniform1f(p.u.u_lamp ?? null, lamps.size ?? LAMP_SIZE);
    const units: [string, WebGLTexture][] = [
      ['u_views', r.views.tex],
      ['u_shows', r.shows.tex],
      ['u_points', r.points.tex],
    ];
    for (const [i, [name, tex]] of units.entries()) {
      gl.activeTexture(gl.TEXTURE1 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(p.u[name] ?? null, 1 + i);
    }
  };
  const into = (t: Target | null) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t?.fb ?? null);
    gl.viewport(0, 0, t?.w ?? canvas.width, t?.h ?? canvas.height);
  };
  const instances = (r: Resources) => {
    gl.bindVertexArray(r.lights);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, r.instances);
  };
  const full = (r: Resources, p: Program, src: Target, gain = 1) => {
    bind(gl, p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(p.u.u_src ?? null, 0);
    gl.uniform1f(p.u.u_gain ?? null, gain);
    gl.bindVertexArray(r.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  /** Paints the housing, every socket and every faceplate into its texture. */
  function paintHousing(r: Resources): void {
    if (!r.targets) return;
    uploadViews(gl, r.views, placement.views);
    into(r.targets.house);
    const [hr, hg, hb] = backed ? rgb(HOUSING) : [0, 0, 0];
    gl.clearColor(hr, hg, hb, backed ? 1 : 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    run(r.housing, r);
    gl.uniform1f(r.housing.u.u_wire ?? null, WIRE_SHARE);
    gl.uniform3fv(r.housing.u.u_sockets ?? null, SOCKET_RGB);
    instances(r);
  }

  /** Blurs the splat along one axis into `dst`, `sigma` texels of `src` wide. */
  function blur(r: Resources, src: Target, dst: Target, sigma: number, x: boolean): void {
    const { weights, spacing } = gaussian(sigma);
    into(dst);
    bind(gl, r.blur);
    gl.uniform1fv(r.blur.u.u_weight ?? null, weights);
    gl.uniform2f(r.blur.u.u_step ?? null, x ? spacing / src.w : 0, x ? 0 : spacing / src.h);
    full(r, r.blur, src);
  }

  function draw(r: Resources, spread: number): void {
    const t = r.targets;
    if (!t) return;
    uploadTo(gl, r.shows, upload);
    const sigma = placement.blur ? placement.pitch * BLOOM.spread * spread : 0;
    const glows = spread > 0;
    if (glows) {
      into(t.splat);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      run(r.glow, r);
      gl.uniform1f(r.glow.u.u_glow ?? null, spread);
      gl.uniform1f(r.glow.u.u_scale ?? null, r.half ? 1 : 0.5);
      gl.uniform1f(r.glow.u.u_blurred ?? null, placement.blur ? 1 : 0);
      gl.uniform1f(r.glow.u.u_spread ?? null, BLOOM.spread);
      instances(r);
      gl.disable(gl.BLEND);
      if (sigma > 0) {
        blur(r, t.splat, t.across, sigma, true);
        blur(r, t.across, t.blurred, sigma / 2, false);
      }
    }
    into(null);
    gl.disable(gl.BLEND);
    full(r, r.copy, t.house);
    gl.enable(gl.BLEND);
    // As in 2D, glow and bodies both add onto the housing.
    gl.blendFunc(gl.ONE, gl.ONE);
    if (glows) full(r, r.copy, sigma > 0 ? t.blurred : t.splat, r.half ? 1 : 2);
    run(r.body, r);
    gl.uniform1f(r.body.u.u_core ?? null, LED.core);
    gl.uniform3f(r.body.u.u_coreTint ?? null, ...rgb(LED.coreTint));
    gl.uniform1f(r.body.u.u_coreAlpha ?? null, LED.coreAlpha);
    instances(r);
  }

  function sized(): void {
    if (!res) return;
    sizeTargets(gl, res, canvas.width, canvas.height);
    paintHousing(res);
  }
  const stop = placement.start(canvas, sized);

  const onLost = (e: Event) => {
    e.preventDefault();
    res = null;
  };
  const onRestored = () => {
    try {
      res = make();
    } catch (e) {
      // Stays dark for good, its slot given back to the page.
      console.error(e);
      res = null;
      canvas.removeEventListener('webglcontextrestored', onRestored);
      shedContext(canvas, gl);
      release();
      return;
    }
    sized();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    backend: 'webgl',
    render(cols, fallback, dt) {
      const bright = Math.max(lamps.brightness ?? 1, 0);
      frame.step(cols, fallback, dt, bright, out);
      if (!res || canvas.width === 0 || canvas.height === 0) return;
      if (placement.update()) paintHousing(res);
      const n = shape.leds.length;
      for (let i = 0; i < n; i++) {
        upload[i * 8] = out.shine[i] as number;
        upload.set(out.rgb.subarray(i * 3, i * 3 + 3), i * 8 + 1);
        upload[i * 8 + 4] = out.bloom[i] as number;
      }
      draw(res, Math.max(lamps.glow ?? 1, 0));
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
      upload = new Float32Array(next.leds.length * 8);
      if (!res) return;
      free(gl, res);
      res = null;
      try {
        res = make();
      } catch (e) {
        console.error(e);
        return;
      }
      sized();
    },
    destroy() {
      if (gone) return;
      gone = true;
      stop();
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (res) free(gl, res);
      res = null;
      pending?.();
      shedContext(canvas, gl);
      release();
    },
  };
}

/** Each socket's color as GLSL reads `u_sockets`, by `SOCKET` value. */
const SOCKET_RGB = new Float32Array(
  Array.from({ length: 6 }, (_, s) => rgb(SOCKET_COLORS[s] ?? 0)).flat(),
);

/** Uploads the views, each its transform then its clip, as two texels. */
function uploadViews(gl: WebGL2RenderingContext, d: Data, views: Float32Array): void {
  uploadTo(gl, d, views.subarray(0, Math.min(views.length, d.w * d.h * 4)));
}
