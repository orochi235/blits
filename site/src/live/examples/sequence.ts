import { keys, kit, mix, sum } from '@msb235/blits';
import { createHistory } from '@weasel-js/history';
import { loop } from '../loop';

interface Bar {
  el: HTMLElement;
}
interface BarPose {
  x: number;
}

const BAR = kit<BarPose>({ x: sum() });
const LENGTH = 3200;

const slide = keys<Bar, BarPose>(
  700,
  [
    { at: 0, delta: { x: 0 } },
    { at: 1, delta: { x: 1 }, ease: 'ease-in-out' },
  ],
  {},
);

export default function run(root: HTMLElement): () => void {
  const lanes = document.createElement('div');
  lanes.className = 'lanes';
  root.append(lanes);
  const bars: Bar[] = ['first', 'second', 'third'].map((name) => {
    const lane = document.createElement('div');
    lane.className = 'lane';
    const el = document.createElement('div');
    el.className = 'bar';
    el.textContent = name;
    lane.append(el);
    lanes.append(lane);
    return { el };
  });
  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.min = '0';
  scrub.max = String(LENGTH);
  scrub.ariaLabel = 'Time';
  root.append(scrub);

  // Placed on the mix's score: the second starts once the first coasts, holding its last frame,
  // and the third starts with the second.
  const [a, b, c] = bars as [Bar, Bar, Bar];
  // History reaches back over the whole run, so the slider can seek anywhere in it.
  const m = mix<Bar, BarPose>(BAR, {
    name: 'sequence',
    history: { ms: LENGTH + 1000, tape: createHistory },
  });
  m.sync(0);
  m.cue({ patch: slide, subjects: [a], name: 'first', start: 200, freeze: 'after' });
  m.cue({
    patch: slide,
    subjects: [b],
    name: 'second',
    anchor: { start: { of: 'first', mark: 'coast', by: 300 } },
    freeze: 'after',
  });
  m.cue({
    patch: slide,
    subjects: [c],
    name: 'third',
    anchor: { start: { with: 'second', by: 250 } },
    freeze: 'after',
  });

  // Played, the mix syncs each frame and seeks back to 0 at the end of the run. Held, it isn't
  // synced, so nothing is recorded over the run, and the slider seeks it anywhere in it.
  let held = false;
  const onInput = () => {
    held = true;
    m.seek(Number(scrub.value));
  };
  const onRelease = () => {
    held = false;
    m.rebase();
  };
  scrub.addEventListener('input', onInput);
  scrub.addEventListener('change', onRelease);

  const pose = { x: 0 };
  // The cues' starts count from the first frame, which the mix synced to as 0.
  let first = Number.NaN;
  const stop = loop(
    m,
    root,
    (now) => {
      if (Number.isNaN(first)) first = now;
      if (!held) {
        m.sync(now - first);
        if (m.now >= LENGTH) m.seek(0);
        scrub.value = String(m.now);
      }
      for (const bar of bars) {
        m.probe(bar, pose);
        bar.el.style.left = `calc(${pose.x} * (100% - 6rem))`;
      }
    },
    { settle: false },
  );

  return () => {
    stop();
    scrub.removeEventListener('input', onInput);
    scrub.removeEventListener('change', onRelease);
    m.close();
  };
}
