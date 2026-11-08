/** Labels a play/pause button for what a click does, with the glyph `glyph.css` draws. */
export function showPlay(button: HTMLElement, paused: boolean): void {
  button.textContent = paused ? 'Play' : 'Pause';
  button.dataset.glyph = paused ? 'play' : 'pause';
}

/**
 * Has `button` pause and play `clock` through its `rate`. Returns the relabel, for a pause made
 * elsewhere.
 */
export function playPause(clock: { rate: number }, button: HTMLElement): () => void {
  const label = () => showPlay(button, clock.rate === 0);
  button.addEventListener('click', () => {
    clock.rate = clock.rate === 0 ? 1 : 0;
    label();
  });
  label();
  return label;
}

/**
 * A play button and a slider over sweeps that loop every `period`: dragging pauses `clock` and
 * seeks each of `sweeps()` there. Returns where they stand, the clock's time shifted by the last
 * drag.
 */
export function scrubbed(
  clock: { rate: number; readonly now: number },
  button: HTMLElement,
  slider: HTMLInputElement,
  period: number,
  sweeps: () => Iterable<{ seek(elapsed: number): unknown } | undefined>,
): () => number {
  const label = playPause(clock, button);
  let shift = 0;
  // `now` is NaN until the first sync.
  const now = () => (Number.isFinite(clock.now) ? clock.now : 0);
  slider.addEventListener('input', () => {
    if (clock.rate !== 0) {
      clock.rate = 0;
      label();
    }
    const to = Number(slider.value);
    for (const s of sweeps()) s?.seek(to);
    shift = to - now();
  });
  return () => (((now() + shift) % period) + period) % period;
}
