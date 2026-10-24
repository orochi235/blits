import { color, css, kit, mix, mul, oklab, patch, sum } from '@msb235/blits';

interface Dot {
  el: HTMLElement;
  index: number;
}
interface DotPose {
  y: number;
  scale: number;
  color: number[];
}

const DOT = kit<DotPose>({ y: sum(), scale: mul(), color: color() });

const wave = patch<Dot, DotPose>(
  1800,
  (phase, d) => ({
    y: 16 * Math.sin(2 * Math.PI * phase + d.index * 0.7),
    scale: 1,
    color: oklab(0x2f66d8),
  }),
  { writes: ['y', 'scale', 'color'] },
);

const pulse = patch<Dot, DotPose>(
  900,
  (phase) => ({
    y: 0,
    scale: 1 + 0.5 * Math.sin(Math.PI * phase),
    color: oklab(0xc23d7a),
  }),
  { writes: ['y', 'scale', 'color'] },
);

export default function run(root: HTMLElement): () => void {
  const row = document.createElement('div');
  row.className = 'dots';
  root.append(row);
  const dots: Dot[] = Array.from({ length: 7 }, (_, index) => {
    const el = document.createElement('div');
    el.className = 'dot';
    row.append(el);
    return { el, index };
  });
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'switch';
  root.append(button);

  // Both loops share a locus, so mid-crossfade a dot is a blend of the two, not both stacked.
  const m = mix<Dot, DotPose>(DOT, { name: 'crossfade' });
  const fade = { in: 1200, out: 1200 };
  let playing = 'wave';
  let current = m.cue({ patch: wave, loop: true, locus: 'motion', fade: { out: fade.out } });
  button.textContent = 'Switch to pulse';

  const onClick = () => {
    current.fade();
    playing = playing === 'wave' ? 'pulse' : 'wave';
    current = m.cue({
      patch: playing === 'wave' ? wave : pulse,
      loop: true,
      locus: 'motion',
      fade,
    });
    button.textContent = `Switch to ${playing === 'wave' ? 'pulse' : 'wave'}`;
  };
  button.addEventListener('click', onClick);

  const pose: DotPose = { y: 0, scale: 1, color: [0, 0, 0, 0] };
  let id = requestAnimationFrame(function frame(now) {
    m.sync(now);
    for (const dot of dots) {
      m.probe(dot, pose);
      dot.el.style.transform = `translateY(${pose.y}px) scale(${pose.scale})`;
      dot.el.style.background = css(pose.color);
    }
    id = requestAnimationFrame(frame);
  });

  return () => {
    cancelAnimationFrame(id);
    button.removeEventListener('click', onClick);
    m.close();
  };
}
