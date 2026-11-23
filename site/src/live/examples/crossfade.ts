import { color, css, kit, mix, mul, oklab, patch, sum } from '@msb235/blits';
import { demo } from '../demo';

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

export default demo((d) => {
  const { root } = d;
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

  // Both loops share a role, so mid-crossfade a dot is a blend of the two, not both stacked.
  const m = mix<Dot, DotPose>(DOT, d.options('crossfade'));
  d.closes(m);
  const fade = { in: 1200, out: 1200 };
  m.cue({
    patch: wave,
    loop: true,
    role: 'motion',
    name: 'wave',
    tags: ['wave'],
    fade: { out: fade.out },
  });
  // What is playing is read from the mix, which a seek back puts as it was: the loop not fading.
  const playing = () => (m.voices('pulse').some((v) => v.state !== 'fading') ? 'pulse' : 'wave');
  const label = () => {
    const text = `Switch to ${playing() === 'wave' ? 'pulse' : 'wave'}`;
    if (button.textContent !== text) button.textContent = text;
  };
  label();

  d.on(button, 'click', () => {
    const to = playing() === 'wave' ? 'pulse' : 'wave';
    for (const v of m.voices()) if (v.state !== 'fading') v.fade();
    const patch = to === 'wave' ? wave : pulse;
    m.cue({ patch, loop: true, role: 'motion', name: to, tags: [to], fade });
    label();
  });

  const pose: DotPose = { y: 0, scale: 1, color: [0, 0, 0, 0] };
  d.frame(m, (now) => {
    m.sync(now);
    label();
    for (const dot of dots) {
      m.probe(dot, pose);
      dot.el.style.transform = `translateY(${pose.y}px) scale(${pose.scale})`;
      dot.el.style.background = css(pose.color);
    }
  });
});
