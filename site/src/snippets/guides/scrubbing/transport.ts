import { kit, mix, type Patch, sum, transport } from '@msb235/blits';
import { createHistory } from '@weasel-js/history';

interface Letter {
  char: string;
}
interface Lamp {
  id: number;
}
interface LetterPose {
  y: number;
}
interface LampPose {
  level: number;
}
declare const drop: Patch<Letter, LetterPose>;
declare const flash: Patch<Lamp, LampPose>;
// ---
const show = transport({ history: { ms: 10_000, tape: createHistory } });
const motion = mix<Letter, LetterPose>(kit<LetterPose>({ y: sum() }), { transport: show });
const light = mix<Lamp, LampPose>(kit<LampPose>({ level: sum() }), { transport: show });

// An anchor reaches into another mix through a score both voices name.
motion.cue({ patch: drop, name: 'drop', score: 'scene' });
light.cue({
  patch: flash,
  score: 'scene',
  anchor: { start: { after: { score: 'scene', name: 'drop' } } },
});

// Once a frame, the transport syncs both; seeking it moves both.
requestAnimationFrame(function frame(now) {
  show.sync(now);
  requestAnimationFrame(frame);
});
show.seek(show.now - 2000);
