import type { Sign } from '../../draw.js';

/** A context a destroyed sign gave up, kept so a sign made later on its canvas can restore it. */
interface Shed {
  readonly lose: WEBGL_lose_context;
  /** Whether its lost event has been dispatched; a restore before then is ignored. */
  passed: boolean;
  onPassed: (() => void) | null;
}
export const shed = new WeakMap<HTMLCanvasElement, Shed>();

/**
 * Asks for the context a destroyed sign lost on `canvas` back, once its lost event has gone by;
 * the new sign builds on the restored event. Gives what calls off the restore, while it is still
 * to come, or null where no sign of ours lost the context.
 */
export function reclaim(canvas: HTMLCanvasElement): (() => void) | null {
  const state = shed.get(canvas);
  if (!state) return null;
  shed.delete(canvas);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  // Restoring from inside the lost event's dispatch is ignored as well.
  const restore = () => {
    timer = setTimeout(() => {
      done = true;
      state.lose.restoreContext();
    }, 0);
  };
  if (state.passed) restore();
  else state.onPassed = restore;
  return () => {
    if (done) return;
    clearTimeout(timer);
    state.onPassed = null;
    shed.set(canvas, state);
  };
}

/**
 * Loses `gl` and keeps it for the next sign made on `canvas` to restore. Its lost event's default
 * is prevented, since a context whose loss went unprevented can't be restored.
 */
export function shedContext(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext): void {
  const lose = gl.isContextLost() ? null : gl.getExtension('WEBGL_lose_context');
  if (!lose) return;
  const state: Shed = { lose, passed: false, onPassed: null };
  shed.set(canvas, state);
  canvas.addEventListener(
    'webglcontextlost',
    (e) => {
      e.preventDefault();
      state.passed = true;
      state.onPassed?.();
    },
    { once: true },
  );
  lose.loseContext();
}

/** A WebGL sign that draws nothing: its canvas is WebGL's, so it can't fall back to 2D. */
export function dark(): Sign & { readonly backend: 'webgl' } {
  return {
    backend: 'webgl',
    render() {},
    setDefects() {},
    setFade() {},
    setGhost() {},
    setLamps() {},
    reshape() {},
    destroy() {},
  };
}
