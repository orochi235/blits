/** A canvas kept fitted to its parent box. */
export interface Fit {
  /** Fits it again now, as after a change to the pitch asked for. */
  refit(): void;
  /** Stops following the box and the pixel ratio. */
  stop(): void;
}

/**
 * Keeps `canvas` fitted in its parent, `across` × `down` pitches, as large as both of the box's
 * sides allow unless `want()` gives a pitch in CSS pixels. After each fit, `sized` gets the pitch
 * in device pixels, with the canvas already sized.
 */
export function fitCanvas(
  canvas: HTMLCanvasElement,
  across: number,
  down: number,
  want: () => number | undefined,
  sized: (pitch: number) => void,
): Fit {
  const box = canvas.parentElement as HTMLElement;
  const refit = () => {
    const css = want() ?? Math.min(box.clientWidth / across, box.clientHeight / down);
    canvas.style.width = `${Math.floor(css * across)}px`;
    canvas.style.height = `${Math.floor(css * down)}px`;
    const pitch = css * devicePixelRatio;
    canvas.width = Math.round(pitch * across);
    canvas.height = Math.round(pitch * down);
    sized(pitch);
  };
  const watch = new ResizeObserver(refit);
  watch.observe(box);
  // A move to a screen of another pixel ratio resizes nothing, so the ratio is watched too.
  let ratio: MediaQueryList | null = null;
  const onRatio = () => {
    refit();
    followRatio();
  };
  const followRatio = () => {
    ratio?.removeEventListener('change', onRatio);
    ratio =
      typeof matchMedia === 'function' ? matchMedia(`(resolution: ${devicePixelRatio}dppx)`) : null;
    ratio?.addEventListener('change', onRatio);
  };
  followRatio();
  refit();
  return {
    refit,
    stop() {
      watch.disconnect();
      ratio?.removeEventListener('change', onRatio);
    },
  };
}
