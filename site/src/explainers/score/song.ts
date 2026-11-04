import { kit, patch, sum } from '@msb235/blits';
import type { VoiceDef } from '../kit/scene';

/** One sung syllable: a subject, carrying where it falls in its line and how long it is held. */
export interface Syllable {
  id: string;
  text: string;
  /** Beats from the start of its line. */
  onset: number;
  beats: number;
}

/**
 * `lit` is 1 once a syllable is sung; `hop` runs 0 to 1 across the syllable, carrying the ball on to
 * the next. Both are scaled by the voice's weight, so a fade dims them together.
 */
export interface Pose {
  lit: number;
  hop: number;
}

export type Part = 'count' | 'lead' | 'chorus';

export interface Line {
  name: string;
  part: Part;
  syllables: Syllable[];
  beats: number;
}

/** The tune of "Deck the Halls": a dotted beat, a half, then beats; the answer runs on quicker. */
const CALL = [1.5, 0.5, 1, 1, 1.5, 0.5, 1, 1];
const ANSWER = [1.5, 0.5, 1, 1, 1, 0.5, 0.5, 0.5, 1.5];
const COUNT = [1, 1, 1, 1];

const LEAD = [
  'It rubs the lo- tion on its skin,',
  'Or else it gets the hose a- gain.',
  'Put the lo- tion in the bas- ket.',
];
const FA_LA = 'Fa la la la la, la la la la.';

function line(name: string, part: Part, words: string, rhythm: number[]): Line {
  let onset = 0;
  const syllables = words.split(' ').map((text, i) => {
    const s = { id: `${name}/${i}`, text, onset, beats: rhythm[i] ?? 1 };
    onset += s.beats;
    return s;
  });
  return { name, part, syllables, beats: onset };
}

export const LINES: Line[] = [
  line('count-in', 'count', '1 2 3 4', COUNT),
  ...LEAD.flatMap((words, k) => [
    line(`line ${k + 1}`, 'lead', words, CALL),
    line(`fa-la ${k + 1}`, 'chorus', FA_LA, ANSWER),
  ]),
];

export const SUBJECTS: Syllable[] = LINES.flatMap((l) => l.syllables);

export const K = kit<Pose>({ lit: sum(), hop: sum() });

/** The line a voice sings, as a patch: each syllable lights on its beat and hops on to the next. */
function sung(l: Line, beat: number) {
  return patch<Syllable, Pose>(
    l.beats * beat,
    (phase, s) => {
      const t = phase * l.beats;
      if (t < s.onset) return { lit: 0, hop: 0 };
      return { lit: 1, hop: Math.min(1, (t - s.onset) / s.beats) };
    },
    { writes: ['lit', 'hop'] },
  );
}

export interface SongConfig {
  tempo: number;
  lag: number;
}

const COLOR: Record<Part, string> = { count: 'v3', lead: 'v1', chorus: 'v2' };

/**
 * One voice per line. The count-in starts the song; each lead line comes in after the answer before
 * it, and each answer after its line, `lag` beats late.
 */
export function voices(c: SongConfig): VoiceDef<Syllable, Pose>[] {
  const beat = 60_000 / c.tempo;
  return LINES.map((l, i) => {
    const before = LINES[i - 1]?.name;
    const start =
      before === undefined
        ? 300
        : l.part === 'chorus'
          ? { after: before, by: c.lag * beat }
          : { after: before };
    return {
      name: l.name,
      color: COLOR[l.part],
      spec: {
        name: l.name,
        tags: [l.part],
        subjects: l.syllables,
        loop: false,
        fade: { out: 120 },
        patch: sung(l, beat),
        ...(typeof start === 'number' ? { start } : { anchor: { start } }),
      },
    };
  });
}
