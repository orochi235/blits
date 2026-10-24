import { keys, kit, mix, mul, patch, sum } from '@msb235/blits';

// What one dot is, and the two numbers an effect can move on it.
interface Dot {
  el: HTMLElement;
  index: number;
}
interface DotPose {
  y: number;
  scale: number;
}

// The kit says how two effects combine on each channel: offsets add, scales multiply.
const DOT = kit<DotPose>({ y: sum(), scale: mul() });

// Effects are patches: a pure function of phase (0..1 over the duration) and the subject.
const hop = patch<Dot, DotPose>(900, (phase) => ({ y: -36 * Math.sin(phase * Math.PI) }), {
  writes: ['y'],
});

const breathe = patch<Dot, DotPose>(
  2400,
  (phase, dot) => ({ scale: 1 + 0.15 * Math.sin(2 * Math.PI * phase + dot.index * 0.6) }),
  { writes: ['scale'] },
);

// Or a list of keyframes.
const pop = keys<Dot, DotPose>(
  500,
  [
    { at: 0, delta: { scale: 1 } },
    { at: 0.3, delta: { scale: 1.8 }, ease: 'ease-out' },
    { at: 1, delta: { scale: 1 }, ease: 'ease-in' },
  ],
  {},
);

export default function run(root: HTMLElement): () => void {
  const row = document.createElement('div');
  row.className = 'dots';
  root.append(row);
  const dots: Dot[] = Array.from({ length: 9 }, (_, index) => {
    const el = document.createElement('button');
    el.className = 'dot';
    el.ariaLabel = `Dot ${index + 1}`;
    row.append(el);
    return { el, index };
  });

  // A mix plays voices: each one a patch on its own clock. These two run for good.
  const m = mix<Dot, DotPose>(DOT, { name: 'get started' });
  m.cue({ patch: breathe, loop: true });
  m.cue({ patch: hop, loop: true, stagger: (dot) => dot.index * 80, fade: { in: 600 } });

  // A click cues one more voice, on one dot, for one pass. It multiplies with breathe.
  row.addEventListener('click', (e) => {
    const dot = dots.find((d) => d.el === e.target);
    if (dot) m.cue({ patch: pop, subjects: [dot] });
  });

  // Once a frame: tell the mix the time, then read each dot's pose and draw it.
  const pose = { y: 0, scale: 1 };
  let id = requestAnimationFrame(function frame(now) {
    m.sync(now);
    for (const dot of dots) {
      m.probe(dot, pose);
      dot.el.style.transform = `translateY(${pose.y}px) scale(${pose.scale})`;
    }
    id = requestAnimationFrame(frame);
  });

  return () => {
    cancelAnimationFrame(id);
    m.close();
  };
}
