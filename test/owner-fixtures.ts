import { kit, sum } from '../src/channels.js';
import { keys, patch } from '../src/patch.js';
import type { Mix } from '../src/types.js';
export interface Pose {
  x: number;
  y: number;
}
export const K = kit<Pose>({ x: sum(), y: sum() });
export interface Part {
  id: string;
}
export const a = { id: 'a' };
export const b = { id: 'b' };

/** x reads the voice's own elapsed ms, so a pose shows the voice clock. */
export const clock = patch<Part, Pose>(0, (_p, _s, setting) => ({ x: setting.elapsed }), {
  writes: ['x'],
});
export const ten = patch<Part, Pose>(0, () => ({ y: 10 }), { writes: ['y'] });
export const ramp = keys<Part, Pose>(100, [
  { at: 0, delta: { y: 0 } },
  { at: 1, delta: { y: 10 } },
]);
// Integrates toward 50, so its value depends on the steps it was handed, not on where its clock is.
export const drift = () =>
  patch<Part, Pose, { x: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
    writes: ['x'],
    state: () => ({ x: 0 }),
    step: (s, dt) => {
      s.x += (50 - s.x) * Math.min(1, dt / 200);
    },
  });

export const x = (m: Mix<Part, Pose>, at: number, part = a): number => {
  m.sync(at);
  return m.probe(part).x;
};
