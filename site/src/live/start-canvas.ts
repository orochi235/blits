import { input, kit, mix, patch, sum } from '@msb235/blits';
import { COLS, type Dot, field, ROWS } from './start/field';
import { loop } from './start/row';

interface DotPose {
  lift: number;
  size: number;
}

const DOT = kit<DotPose>({ lift: sum(), size: sum() });

const ripple = patch<Dot, DotPose>(1600, (phase) => ({ lift: Math.sin(phase * 2 * Math.PI) }), {
  writes: ['lift'],
});

// Duration 0: no passes, so it holds until faded.
const swell = patch<Dot, DotPose>(0, () => ({ size: 1 }), { writes: ['size'] });

export default function run(root: HTMLElement): () => void {
  const stage = field(root);

  // A signal is a 0..1 number from outside the clock. This one is how near the pointer is.
  const near = input<Dot>((dot) => {
    const cells = Math.hypot((dot.x - stage.pointer.x) * COLS, (dot.y - stage.pointer.y) * ROWS);
    return Math.max(0, 1 - cells / 4);
  });
  stage.onPointer(() => near.touch());

  const m = mix<Dot, DotPose>(DOT, { name: 'get started: canvas' });
  // One voice reaches all 480 dots, each delayed by its distance from the middle.
  m.cue({ patch: ripple, loop: true, stagger: (dot) => dot.r * 1200 });
  // A voice's weight can be a signal, read per subject: the swell is as strong as the pointer is near.
  m.cue({ patch: swell, weight: near });

  const pose = { lift: 0, size: 0 };
  const stop = loop((now) => {
    m.sync(now);
    stage.clear();
    for (const dot of stage.dots) {
      m.probe(dot, pose);
      stage.dot(
        dot,
        pose.lift * 5,
        2 + pose.lift + pose.size * 5,
        0.6 + 0.3 * pose.lift + 0.1 * pose.size,
      );
    }
  });

  return () => {
    stop();
    m.close();
  };
}
