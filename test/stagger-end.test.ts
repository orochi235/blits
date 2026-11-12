import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { Mix, VoiceSpec } from '../src/types.js';

// A staggered voice reaching its subjects by `target` ends by the latest stagger it has met. These
// check that a read ahead or a replay after a seek back, with no reads of the late subject, ends it
// where the live mix did.

interface Pose {
  x: number;
}
interface Part {
  id: string;
}
const K = kit<Pose>({ x: sum() });
const a = { id: 'a' };
const b = { id: 'b' };
const saw = patch<Part, Pose>(100, (phase) => ({ x: 1 + phase * 30 }), { writes: ['x'] });
const CUE = 32;
const frames: number[] = [];
for (let t = 0; t <= 480; t += 16) frames.push(t);
const after = frames.filter((t) => t >= CUE);

type Extra = Partial<VoiceSpec<Part, Pose>>;
const cases: [string, Extra][] = [
  ['ending at once', {}],
  ['fading out', { fade: { out: 60 } }],
  ['freezing after', { freeze: 'after' }],
  ['looping twice', { loop: 2 }],
  // Run back, it ends at its least stagger, so its late subject is staggered below 0.
  ['running back', { rate: -1, stagger: (s) => (s === a ? 0 : -200) }],
  [
    'running back and fading out',
    { rate: -1, fade: { out: 60 }, stagger: (s) => (s === a ? 0 : -200) },
  ],
];

/**
 * Plays the mix live, reading `a` every frame and `b`, staggered 200 ms past it unless `extra` says
 * otherwise, only once at `late`, and keeps what `a` showed each frame.
 */
function live(extra: Extra, late: number) {
  const m = mix<Part, Pose>(K, { history: { ms: 100_000, every: 50, tape }, stepMs: 4 });
  const shown = new Map<number, number>();
  for (const t of frames) {
    m.sync(t);
    if (t === CUE) m.cue({ patch: saw, stagger: (s) => (s === a ? 0 : 200), ...extra });
    if (t === late) m.probe(b);
    shown.set(t, m.probe(a).x);
  }
  return { m, shown };
}

const want = (shown: Map<number, number>) => after.map((t) => [t, shown.get(t)]);
const ahead = (m: Mix<Part, Pose>) => after.map((t) => [t, m.project(t).probe(a).x]);

describe('a staggered target voice', () => {
  for (const [what, extra] of cases) {
    for (const late of [CUE, 64, 160]) {
      const when =
        late === CUE ? 'at its cue' : late === 64 ? 'after its cue' : 'past its first end';
      it(`${what}, with its late subject met ${when}, reads ahead from before its cue to the end the live mix had`, () => {
        const { m, shown } = live(extra, late);
        m.seek(16);
        expect(ahead(m)).toEqual(want(shown));
      });

      it(`${what}, with its late subject met ${when}, replays from before its cue to the end the live mix had`, () => {
        const { m, shown } = live(extra, late);
        m.seek(16);
        const replayed = after.map((t) => {
          m.seek(t);
          return [t, m.probe(a).x];
        });
        expect(replayed).toEqual(want(shown));
      });

      it(`${what}, with its late subject met ${when}, lands on the live end seeking straight past it`, () => {
        const { m, shown } = live(extra, late);
        m.seek(16);
        for (const t of [160, 240, 320, 400]) {
          m.seek(t);
          expect(m.probe(a).x, `seek(${t})`).toBe(shown.get(t));
        }
      });
    }
  }

  it('reads ahead from its cue frame to the end the live mix had', () => {
    const { m, shown } = live({}, 64);
    m.seek(CUE);
    expect(ahead(m)).toEqual(want(shown));
  });
});
