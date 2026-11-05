import { kit, mix, patch, sum } from '@msb235/blits';
import { createHistory } from '@weasel-js/history';
import { loop } from '../loop';

interface Dot {
  index: number;
}
interface DotPose {
  y: number;
}

const DOT = kit<DotPose>({ y: sum() });
const COUNT = 7;
/** How far back the mix remembers, and so how far the scrubber reaches, in ms. */
const MEMORY = 10_000;
/** How far ahead the ghosts read, in ms. */
const AHEAD = 500;

const bob = patch<Dot, DotPose>(
  2400,
  (phase, d) => ({ y: 14 * Math.sin(2 * Math.PI * phase + d.index * 0.8) }),
  { writes: ['y'] },
);
const hop = patch<Dot, DotPose>(600, (phase) => ({ y: -46 * Math.sin(Math.PI * phase) }), {
  writes: ['y'],
});

export default function run(root: HTMLElement): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'scrub-demo';
  const row = document.createElement('div');
  row.className = 'scrub-dots';
  const dots = Array.from({ length: COUNT }, (_, index) => {
    const column = document.createElement('div');
    column.className = 'scrub-column';
    const ghost = document.createElement('div');
    ghost.className = 'scrub-ghost';
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'scrub-dot';
    el.ariaLabel = `Hop dot ${index + 1}`;
    column.append(ghost, el);
    row.append(column);
    return { subject: { index } as Dot, el, ghost };
  });
  const scrubber = document.createElement('input');
  scrubber.type = 'range';
  scrubber.step = 'any';
  scrubber.ariaLabel = 'Mix time';
  const time = document.createElement('span');
  time.className = 'scrub-time';
  const controls = document.createElement('div');
  controls.className = 'rig-row scrub-controls';
  controls.append(scrubber, time);
  wrap.append(row, controls);
  root.append(wrap);

  const m = mix<Dot, DotPose>(DOT, {
    name: 'scrubbing',
    history: { ms: MEMORY, tape: createHistory },
  });
  m.cue({ patch: bob, loop: true });
  // Each hop is a call on the mix, so the tape records it and a seek forward plays it again.
  for (const d of dots)
    d.el.addEventListener('click', () => m.cue({ patch: hop, subjects: [d.subject] }));

  // Dragging holds the mix: it isn't synced, so nothing new is recorded, and each move seeks it.
  // Letting go takes the time held off the clock and plays on from where the thumb is.
  let latest = 0;
  let held = false;
  const grab = () => {
    held = true;
  };
  const seek = () => {
    held = true;
    m.seek(Number(scrubber.value));
  };
  const release = () => {
    held = false;
    latest = m.now;
    m.rebase();
  };
  scrubber.addEventListener('pointerdown', grab);
  scrubber.addEventListener('input', seek);
  scrubber.addEventListener('change', release);

  const pose: DotPose = { y: 0 };
  const stop = loop(
    m,
    root,
    (now) => {
      if (!held) {
        m.sync(now);
        latest = m.now;
        scrubber.min = String(Math.max(0, latest - MEMORY + 50));
        scrubber.max = String(latest);
        scrubber.value = String(latest);
      }
      const ahead = m.project(m.now + AHEAD);
      for (const d of dots) {
        m.probe(d.subject, pose);
        d.el.style.transform = `translateY(${pose.y}px)`;
        ahead.probe(d.subject, pose);
        d.ghost.style.transform = `translateY(${pose.y}px)`;
      }
      const behind = (latest - m.now) / 1000;
      time.textContent = behind > 0.005 ? `${behind.toFixed(2)} s back` : 'live';
    },
    { settle: false },
  );

  return () => {
    stop();
    m.close();
  };
}
