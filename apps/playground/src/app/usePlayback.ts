import type { Composition } from '@pg/blits/composition';
import { FRAME } from '@pg/blits/frame';
import type { Player } from '@pg/blits/player';
import { type RefObject, useCallback, useEffect, useState } from 'react';

/** The most wall time one tick plays, so a hidden tab coming back does not replay seconds at once. */
const MAX_TICK_MS = 250;

/**
 * Plays `player` on the animation frame at `rate`, looping at the composition's length or stopping
 * there, and toggles with Space from anywhere but a text field or the score's own handles.
 */
export function usePlayback(
  player: Player,
  comp: RefObject<Composition>,
  opts: { rate: number; loop: boolean; tick(): void },
) {
  const { rate, loop, tick } = opts;
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    let prev = performance.now();
    let owed = 0;
    let id = requestAnimationFrame(function step(now) {
      owed += Math.min(now - prev, MAX_TICK_MS) * rate;
      prev = now;
      const frames = Math.floor(owed / FRAME);
      if (frames > 0) {
        owed -= frames * FRAME;
        const end = comp.current.length;
        let t = player.t + frames * FRAME;
        if (t > end) {
          if (!loop) {
            player.seek(end);
            tick();
            setPlaying(false);
            return;
          }
          t = end > 0 ? t % end : 0;
        }
        player.seek(t);
        tick();
      }
      id = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(id);
  }, [playing, rate, loop, player, tick, comp]);

  const play = useCallback(
    (on: boolean) => {
      if (on && player.t >= comp.current.length - FRAME) player.seek(0);
      setPlaying(on);
    },
    [player, comp],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      // The score's handles take space themselves; a button's or canvas's own use of it is canceled.
      const skip = 'input, textarea, select, [contenteditable], [tabindex]:not(button, canvas)';
      if ((e.target as HTMLElement).closest(skip)) return;
      e.preventDefault();
      if (!e.repeat) play(!playing);
    };
    // Capture, because weasel's canvases claim space for their hand tool on the window.
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [play, playing]);

  return { playing, play };
}
