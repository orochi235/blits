import type { Composition } from '@pg/blits/composition';
import { FRAME } from '@pg/blits/frame';
import type { Player } from '@pg/blits/player';
import { type RefObject, useCallback, useEffect, useState } from 'react';

/** The most wall time one tick plays, so a hidden tab coming back does not replay seconds at once. */
const MAX_TICK_MS = 250;

/**
 * Plays `player` on the animation frame at `rate`, looping at the composition's length or stopping
 * there, and toggles with Space from anywhere but a text field or a control that uses it.
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
    const space = (e: KeyboardEvent) =>
      e.key === ' ' && !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey);
    const toggle = (e: KeyboardEvent) => {
      e.preventDefault();
      if (!e.repeat) play(!playing);
    };
    // A handle that takes space itself cancels it first; a button's own use of it is canceled.
    const key = (e: KeyboardEvent) => {
      if (!space(e) || e.defaultPrevented) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      toggle(e);
    };
    // A tab swallows space without using it, so it is heard on the way down.
    const tab = (e: KeyboardEvent) => {
      if (space(e) && (e.target as HTMLElement).closest('[role="tab"]')) toggle(e);
    };
    window.addEventListener('keydown', key);
    window.addEventListener('keydown', tab, true);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keydown', tab, true);
    };
  }, [play, playing]);

  return { playing, play };
}
