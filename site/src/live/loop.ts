import type { Handle } from '@msb235/blits';

/** Sent to a live demo's root to pause it (`detail: true`) or resume it (`detail: false`). */
export const HOLD = 'blits:hold';

/** How long a demo takes to settle to rest as the window loses focus, and to rise from it. */
const SETTLE = 400;

/** A mix the loop can settle: its voices, and its clock. */
interface Settles {
  voices(): Handle<never>[];
  readonly now: number;
}

const settles = (m: object): m is Settles => typeof (m as Settles).voices === 'function';

export interface LoopOptions {
  /** False keeps going out of focus, for something that should never stop. Default true. */
  focus?: boolean;
  /**
   * The mixes to settle to rest before stopping as the window loses focus: their voices fade out
   * over `SETTLE`, and rise again as it comes back; a function gives the mixes there are now. Default
   * the clock itself where it is a mix;
   * false stops at once, for a demo that seeks back, where a fade would cut off its tape ahead.
   */
  settle?: readonly Settles[] | (() => readonly Settles[]) | false;
}

/**
 * Calls `frame` with each animation frame's time until the returned function stops it, while the
 * window has focus (unless `focus` is false) and the demo `root` belongs to is not paused. Losing
 * focus, it first settles its mixes to rest; stopped either way, it waits, and on going again
 * `m.rebase()` takes the time it stood still off the clock.
 */
export function loop(
  m: { rebase(): void },
  root: Element,
  frame: (now: number) => void,
  { focus = true, settle }: LoopOptions = {},
): () => void {
  const mixes = (): readonly Settles[] =>
    settle === false
      ? []
      : typeof settle === 'function'
        ? settle()
        : (settle ?? (settles(m) ? [m] : []));
  let away = focus && !document.hasFocus();
  let held = false;
  // The voices a settle faded, which rise again; while settling, the mix it reads, the mix time
  // it stops at, and the frame time it stops by whatever that clock does.
  let faded: Handle<never>[] = [];
  let clock: Settles | undefined;
  let until = Number.NaN;
  let latest = Number.NaN;
  let last = Number.NaN;
  const going = () => !away && !held;
  const tick = (now: number) => {
    frame(now);
    // It stops where one more frame like the last would end the fades on the mix's clock: a voice
    // whose fade ends is done, and cannot rise.
    const at = clock?.now ?? Number.NaN;
    const step = Number.isNaN(last) ? 0 : at - last;
    last = at;
    if (at + 1.5 * step >= until || now >= latest) {
      until = Number.NaN;
      latest = Number.NaN;
      clock = undefined;
      return;
    }
    id = requestAnimationFrame(tick);
  };
  // Stopped to begin with, it draws one frame and waits.
  let id = requestAnimationFrame(going() ? tick : frame);
  const rise = () => {
    for (const h of faded) h.rise({ over: SETTLE });
    faded = [];
  };
  const change = (fn: () => void) => {
    const was = going();
    const settling = !Number.isNaN(until);
    fn();
    if (was && !going()) {
      const list = mixes();
      if (away && !held && list.length > 0) {
        faded = list.flatMap((x) =>
          x.voices().filter((h) => h.owner === undefined && h.state === 'live'),
        );
        for (const h of faded) h.fade({ over: SETTLE });
        clock = list[0];
        until = (clock?.now ?? 0) + SETTLE;
        last = Number.NaN;
        latest = performance.now() + 2 * SETTLE;
      } else cancelAnimationFrame(id);
    } else if (!was && going()) {
      rise();
      if (settling) {
        until = Number.NaN;
        latest = Number.NaN;
      } else {
        m.rebase();
        id = requestAnimationFrame(tick);
      }
    } else if (held && settling) {
      until = Number.NaN;
      latest = Number.NaN;
      cancelAnimationFrame(id);
    }
  };
  const blur = () => change(() => (away = true));
  const regain = () => change(() => (away = false));
  const hold = (e: Event) => change(() => (held = (e as CustomEvent<boolean>).detail));
  if (focus) {
    window.addEventListener('blur', blur);
    window.addEventListener('focus', regain);
  }
  root.addEventListener(HOLD, hold);
  return () => {
    cancelAnimationFrame(id);
    window.removeEventListener('blur', blur);
    window.removeEventListener('focus', regain);
    root.removeEventListener(HOLD, hold);
  };
}
