import type { Demo } from './demo';

/** Labels a play/pause button for what a click does, with the glyph `glyph.css` draws. */
export function showPlay(button: HTMLElement, paused: boolean): void {
  button.textContent = paused ? 'Play' : 'Pause';
  button.dataset.glyph = paused ? 'play' : 'pause';
}

/**
 * Has `button` pause and play `clock` through its `rate`, until demo `d` stops. Returns the
 * relabel, for the frame loop to call: a seek back restores the rate then, and playing on replays
 * the rate writes made since, with no event to tell of either.
 */
export function playPause(
  d: Pick<Demo, 'on'>,
  clock: { rate: number },
  button: HTMLElement,
): () => void {
  let shown: boolean | undefined;
  const label = () => {
    const paused = clock.rate === 0;
    if (paused !== shown) showPlay(button, paused);
    shown = paused;
  };
  d.on(button, 'click', () => {
    clock.rate = clock.rate === 0 ? 1 : 0;
    label();
  });
  label();
  return label;
}

/**
 * A play button and a slider over sweeps that loop every `period`, until demo `d` stops: dragging
 * pauses `clock` and seeks each of `sweeps()` there. Returns where the first of them is in its
 * pass, for the slider, which the frame loop calls, and which relabels the button as `playPause`'s
 * does.
 */
export function scrubbed(
  d: Pick<Demo, 'on'>,
  clock: { rate: number },
  button: HTMLElement,
  slider: HTMLInputElement,
  period: number,
  sweeps: () => Iterable<{ readonly elapsed: number; seek(elapsed: number): unknown } | undefined>,
): () => number {
  const label = playPause(d, clock, button);
  d.on(slider, 'input', () => {
    if (clock.rate !== 0) {
      clock.rate = 0;
      label();
    }
    const to = Number(slider.value);
    for (const s of sweeps()) s?.seek(to);
  });
  return () => {
    label();
    for (const s of sweeps())
      if (s !== undefined && Number.isFinite(s.elapsed))
        return ((s.elapsed % period) + period) % period;
    return 0;
  };
}
