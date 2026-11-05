import { curve, type Easing, patch } from '@msb235/blits';
import type { Pose, Subject } from '../board.js';
import type { ChoiceParam, NumberParam } from '../params.js';
import type { Channel } from '../planes.js';
import { depth, type Modulator, modulator } from './modulator.js';

const MS: NumberParam = {
  label: 'length',
  min: 100,
  max: 10000,
  step: 100,
  value: 1500,
  unit: 'ms',
  about: 'How long the change takes from start to finish.',
};
const SWEEP: NumberParam = {
  label: 'sweep',
  min: 0,
  max: 0.95,
  step: 0.05,
  value: 0.5,
  unit: 'of the pass',
  about:
    'How much of the pass the spread staggers the starts over. At 0 every dot changes together; higher sends the change across the sign as a wave.',
};
const EASE: ChoiceParam = {
  label: 'easing',
  choices: ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'],
  value: 'ease-in-out',
  about:
    'How the change picks up and slows down: linear is steady, ease-in starts slow, ease-out ends slow, and ease-in-out does both.',
};

type Stop = { at: number; value: number };

interface Spec {
  name: string;
  about: string;
  channel: Channel;
  /** Channel values at the start and end of a pass, and the peak between if it comes back. */
  stops(depth: number): Stop[];
  depth: number;
  /** What `depth` does to the sign, for its tooltip. */
  depthAbout: string;
}

/** Plays its channel once along an easing: rank spreads the starts over `sweep` of the pass, every subject done by its end. */
const eased = (s: Spec): Modulator =>
  modulator({
    name: s.name,
    about: s.about,
    params: { ms: MS, easing: EASE, depth: depth(s.depth, s.depthAbout), sweep: SWEEP },
    writes: [s.channel],
    on: 'dots',
    patch: (at, v, rank) => {
      const p = v as { ms: number; easing: string; depth: number; sweep: number };
      const ease = curve(p.easing as Easing);
      const stops = s.stops(p.depth);
      const valueAt = (u: number): number => {
        let i = 0;
        while (i < stops.length - 2 && u > (stops[i + 1] as Stop).at) i++;
        const a = stops[i] as Stop;
        const b = stops[i + 1] as Stop;
        return a.value + (b.value - a.value) * ease((u - a.at) / (b.at - a.at));
      };
      const maxRank = at.board.dots.reduce((m, d) => Math.max(m, rank(d)), 0);
      return patch<Subject, Pose>(
        p.ms,
        (phase, subject) => {
          const start = maxRank > 0 ? (rank(subject) / maxRank) * p.sweep : 0;
          const u = Math.min(1, Math.max(0, (phase - start) / (1 - p.sweep)));
          return { [s.channel]: valueAt(u) } as Partial<Pose>;
        },
        { writes: [s.channel] },
      );
    },
  });

/** Gain falling once from full to `1 - depth`. */
export const dim = eased({
  name: 'dim',
  about: 'Dots fade down and stay down.',
  channel: 'gain',
  stops: (d) => [
    { at: 0, value: 1 },
    { at: 1, value: 1 - d },
  ],
  depth: 0.7,
  depthAbout: 'How far the dots fade. At 1 they go dark; lower leaves them brighter.',
});

/** Chroma falling once from full to `1 - depth`. */
export const desaturate = eased({
  name: 'desaturate',
  about: 'Colors drain toward gray.',
  channel: 'chroma',
  stops: (d) => [
    { at: 0, value: 1 },
    { at: 1, value: 1 - d },
  ],
  depth: 1,
  depthAbout: 'How much color drains away. At 1 the dots end fully gray; lower keeps some color.',
});

/** Glow rising to `1 + depth` at mid-pass and settling back. */
export const flare = eased({
  name: 'flare',
  about: 'The halos flare up and settle.',
  channel: 'glow',
  stops: (d) => [
    { at: 0, value: 1 },
    { at: 0.5, value: 1 + d },
    { at: 1, value: 1 },
  ],
  depth: 1,
  depthAbout: 'How bright the halos get at the peak of the flare. Higher flares more.',
});
