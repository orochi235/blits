import { useEffect, useRef, useState } from 'react';
import { useFocused } from '../explainers/kit/hooks';
import { onSpace } from '../explainers/kit/space';
import { HOLD } from '../live/loop';

/** A file in `src/live/`: draws into `root` and returns a function that stops it and clears up. */
type Run = (root: HTMLElement) => () => void;

const runs = import.meta.glob<Run>('../live/**/*.ts', { import: 'default' });

/**
 * Runs one file from `src/live/` while it is on screen, and starts it over from the top when it
 * comes back. With reduced motion asked for, it waits for Play. Pause, or the space bar, holds it
 * where it is.
 */
export default function Live({ of }: { of: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [allowed, setAllowed] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [visible, setVisible] = useState(false);
  const [round, setRound] = useState(0);
  const [paused, setPaused] = useState(false);
  const focused = useFocused();
  const figure = useRef<HTMLElement>(null);

  useEffect(() => {
    const load = runs[`../live/${of}`];
    if (load === undefined) throw new Error(`Live: no file at src/live/${of}`);
    void load().then((r) => setRun(() => r));
  }, [of]);

  useEffect(() => {
    const el = root.current;
    if (el === null) return;
    const seen = new IntersectionObserver(([e]) => setVisible(e?.isIntersecting ?? false));
    seen.observe(el);
    return () => seen.disconnect();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new round runs the file again
  useEffect(() => {
    const el = root.current;
    if (el === null || run === null || !allowed || !visible) return;
    const stop = run(el);
    if (paused) el.dispatchEvent(new CustomEvent(HOLD, { detail: true }));
    return () => {
      stop();
      el.replaceChildren();
    };
  }, [run, allowed, visible, round]);

  useEffect(() => {
    root.current?.dispatchEvent(new CustomEvent(HOLD, { detail: paused }));
  }, [paused]);

  useEffect(() => {
    const el = figure.current;
    if (el === null) return;
    return onSpace({
      el,
      toggle: () => {
        if (allowed) setPaused((p) => !p);
        else setAllowed(true);
      },
    });
  }, [allowed]);

  return (
    <figure className="live" ref={figure}>
      <div ref={root} className="live-stage" />
      {allowed && !focused ? (
        // Its loop waits out of focus; the click that focuses the window resumes it.
        <button type="button" className="stage-control" data-glyph="play">
          Paused — focus to resume
        </button>
      ) : allowed ? (
        <span className="stage-controls">
          <button
            type="button"
            className="stage-control"
            data-glyph={paused ? 'play' : 'pause'}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? 'Play' : 'Pause'}
          </button>
          <button type="button" className="stage-control" onClick={() => setRound((n) => n + 1)}>
            Run again
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="stage-control"
          data-glyph="play"
          onClick={() => setAllowed(true)}
        >
          Play
        </button>
      )}
    </figure>
  );
}
