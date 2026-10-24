import { kit, mix, sum } from '@msb235/blits';
import { type GlowHost, type GlowPose, glowChannels, type Lamp, near, pulse } from './glow';

declare const lamps: Lamp[];
// ---
interface Pose extends GlowPose {
  x: number;
}

const K = kit<Pose>({ ...glowChannels, x: sum() });

// The host object is the app's: the mix hands it to every patch as `setting.host`.
const host: GlowHost = { pointer: { x: 0, y: 0 } };
const m = mix<Lamp, Pose, GlowHost>(K, { host });
m.cue({ patch: pulse, loop: true });
m.cue({ patch: near, subjects: lamps });

addEventListener('pointermove', (e) => {
  host.pointer.x = e.clientX;
  host.pointer.y = e.clientY;
  m.touch(); // something a patch reads changed: ask it again at the next probe
});
