import type { Composition } from '@pg/blits/composition';
import { FRAME } from '@pg/blits/frame';
import type { Player } from '@pg/blits/player';
import { type RefObject, useCallback, useEffect, useState } from 'react';

/**
 * Plays `player` on the animation frame, syncing its transport at each frame's time, and looping
 * at the composition's length or stopping there. Paused, it stops syncing, and on playing again
 * `rebase` takes the time it stood still off the clock. Space toggles it from anywhere but a text
 * field or a control that uses it.
 */
export function usePlayback(
  player: Player,
  comp: RefObject<Composition>,
  opts: { loop: boolean; tick(): void },
) {
  const { loop, tick } = opts;
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    player.rebase();
    let id = requestAnimationFrame(function step(now) {
      player.sync(now);
      const end = comp.current.length;
      // While something else moves the mix's clock, the score follows it and never loops.
      if (player.t >= end && !player.following) {
        if (!loop) {
          player.seek(end);
          tick();
          setPlaying(false);
          return;
        }
        player.lap(end > 0 ? player.t % end : 0, end);
      }
      tick();
      id = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(id);
  }, [playing, loop, player, tick, comp]);

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
