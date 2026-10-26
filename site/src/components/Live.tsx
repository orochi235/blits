import { useEffect, useRef, useState } from 'react';

/** A file in `src/live/`: draws into `root` and returns a function that stops it and clears up. */
type Run = (root: HTMLElement) => () => void;

const runs = import.meta.glob<Run>('../live/**/*.ts', { import: 'default' });

/**
 * Runs one file from `src/live/` while it is on screen, and starts it over from the top when it
 * comes back. With reduced motion asked for, it waits for Play.
 */
export default function Live({ of }: { of: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [allowed, setAllowed] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [visible, setVisible] = useState(false);
  const [round, setRound] = useState(0);

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
    return () => {
      stop();
      el.replaceChildren();
    };
  }, [run, allowed, visible, round]);

  return (
    <figure className="live">
      <div ref={root} className="live-stage" />
      {allowed ? (
        <button type="button" className="stage-control" onClick={() => setRound((n) => n + 1)}>
          Run again
        </button>
      ) : (
        <button type="button" className="stage-control" onClick={() => setAllowed(true)}>
          Play
        </button>
      )}
    </figure>
  );
}
