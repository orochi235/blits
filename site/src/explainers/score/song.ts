import { kit, patch, sum } from '@msb235/blits';
import type { VoiceDef } from '../kit/scene';

/** One sung syllable: a subject, carrying where it falls in its line and how long it is held. */
export interface Syllable {
  id: string;
  text: string;
  /** Beats from the start of its line. */
  onset: number;
  beats: number;
  /** What it is sung on, as a note name. */
  pitch: string;
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

interface Tune {
  beats: number[];
  pitches: string[];
}

/** "Deck the Halls" in D: the line, and the fa-la answering it an octave down. */
const CALL: Tune = {
  beats: [1.5, 0.5, 1, 1, 1, 1, 1, 1],
  pitches: ['A4', 'G4', 'F#4', 'E4', 'D4', 'E4', 'F#4', 'D4'],
};
const ANSWER: Tune = {
  beats: [1.5, 0.5, 1, 1, 1.5, 0.5, 1, 1, 2],
  pitches: ['E3', 'F#3', 'G3', 'E3', 'F#3', 'E3', 'D3', 'C#3', 'D3'],
};
const COUNT: Tune = { beats: [1, 1, 1, 1], pitches: ['A5', 'A5', 'A5', 'A5'] };

const LEAD = [
  'It rubs the lo- tion on its skin,',
  'Or else it gets the hose a- gain.',
  'Put the lo- tion in the bas- ket.',
];
const FA_LA = 'Fa la la la la, la la la la.';

function line(name: string, part: Part, words: string, tune: Tune): Line {
  let onset = 0;
  const syllables = words.split(' ').map((text, i) => {
    const s = {
      id: `${name}/${i}`,
      text,
      onset,
      beats: tune.beats[i] ?? 1,
      pitch: tune.pitches[i] ?? 'D4',
    };
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

/** What a syllable's hit carries, for whoever sounds it. */
export interface Note {
  part: Part;
  pitch: string;
  /** How long it is held, in ms. */
  ms: number;
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
        hits: l.syllables.map((s) => ({
          at: s.onset * beat,
          event: { part: l.part, pitch: s.pitch, ms: s.beats * beat } satisfies Note,
        })),
        ...(typeof start === 'number' ? { start } : { anchor: { start } }),
      },
    };
  });
}
