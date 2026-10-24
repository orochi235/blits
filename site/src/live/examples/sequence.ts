import { keys, kit, mix, sum } from '@msb235/blits';

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
  const m = mix<Bar, BarPose>(BAR, { name: 'sequence' });
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

  // The mix stays at 0. Each frame reads it at the scrubber's time, without moving it.
  let t = 0;
  let held = false;
  const onInput = () => {
    held = true;
    t = Number(scrub.value);
  };
  const onRelease = () => {
    held = false;
  };
  scrub.addEventListener('input', onInput);
  scrub.addEventListener('change', onRelease);

  const pose = { x: 0 };
  let last = performance.now();
  let id = requestAnimationFrame(function frame(now) {
    if (!held) t = (t + Math.max(0, now - last)) % LENGTH;
    last = now;
    scrub.value = String(t);
    const at = m.project(t);
    for (const bar of bars) {
      at.probe(bar, pose);
      bar.el.style.left = `calc(${pose.x} * (100% - 6rem))`;
    }
    id = requestAnimationFrame(frame);
  });

  return () => {
    cancelAnimationFrame(id);
    scrub.removeEventListener('input', onInput);
    scrub.removeEventListener('change', onRelease);
    m.close();
  };
}
