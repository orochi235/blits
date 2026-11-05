import type { Gpu } from './gpu.js';

export type Backend = 'webgpu' | 'webgl' | '2d';

/** The backend a sign draws with: the one asked for, else the best this page can do. */
export function pickBackend(
  want: Backend | undefined,
  handle: Gpu | null | undefined,
  canWebgl: () => boolean,
): Backend {
  if (want === 'webgpu' && !handle) throw new Error("bree: backend 'webgpu' needs a gpu handle");
  if (want) return want;
  if (handle) return 'webgpu';
  return canWebgl() ? 'webgl' : '2d';
}

const WEBGL_SLOTS = 12;
let claimed = 0;

/** Claims one of the page's WebGL contexts. Null when all are taken; call the result to give it back. */
export function webglSlot(): (() => void) | null {
  if (claimed >= WEBGL_SLOTS) return null;
  claimed++;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    claimed--;
  };
}
