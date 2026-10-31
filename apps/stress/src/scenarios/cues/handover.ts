import { keys, kit, max, mix, sum } from '@msb235/blits';
import type { Finding } from '@stress/scenario';

interface Fixture {
  i: number;
}
interface Pose {
  level: number;
  hue: number;
}

/**
 * A cue handing over to its follow: the follow starts off the cue's coast, and the cue leaves at the
 * follow's start. Named both ways, blits refuses it as waiting on itself; empty when it is taken.
 */
export function handover(): Finding[] {
  const m = mix<Fixture, Pose>(kit<Pose>({ level: max(), hue: sum() }));
  const step = () => keys<Fixture, Pose>(100, [{ at: 1, delta: { level: 1 } }], { ease: 'linear' });
  try {
    m.cue({
      patch: step(),
      name: 'q1',
      freeze: 'after',
      anchor: { out: { of: 'q2', mark: 'start' } },
    });
    m.cue({
      patch: step(),
      name: 'q2',
      freeze: 'after',
      anchor: { start: { of: 'q1', mark: 'coast', by: 50 } },
    });
    return [];
  } catch (e) {
    return [
      {
        kind: 'undecided',
        what: `a cue that leaves at its follow's start, the follow starting 50 ms after the cue coasts, is refused when both anchors name their voice (${String(e)}); the same plan with the out picked by tag is taken and plays as the model says, so the stack picks by tag`,
      },
    ];
  } finally {
    m.close();
  }
}
