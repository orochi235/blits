/** Sent to a live demo's root to pause it (`detail: true`) or resume it (`detail: false`). */
export const HOLD = 'blits:hold';

/**
 * Calls `frame` with each animation frame's time until the returned function stops it, while the
 * window has focus and the demo `root` belongs to is not paused. Stopped either way, it waits, and on
 * going again `m.rebase()` takes the time it stood still off the clock.
 */
export function loop(
  m: { rebase(): void },
  root: Element,
  frame: (now: number) => void,
): () => void {
  let away = !document.hasFocus();
  let held = false;
  const going = () => !away && !held;
  const tick = (now: number) => {
    frame(now);
    id = requestAnimationFrame(tick);
  };
  // Stopped to begin with, it draws one frame and waits.
  let id = requestAnimationFrame(going() ? tick : frame);
  const change = (fn: () => void) => {
    const was = going();
    fn();
    if (was && !going()) cancelAnimationFrame(id);
    else if (!was && going()) {
      m.rebase();
      id = requestAnimationFrame(tick);
    }
  };
  const blur = () => change(() => (away = true));
  const focus = () => change(() => (away = false));
  const hold = (e: Event) => change(() => (held = (e as CustomEvent<boolean>).detail));
  window.addEventListener('blur', blur);
  window.addEventListener('focus', focus);
  root.addEventListener(HOLD, hold);
  return () => {
    cancelAnimationFrame(id);
    window.removeEventListener('blur', blur);
    window.removeEventListener('focus', focus);
    root.removeEventListener(HOLD, hold);
  };
}
