import { kit, patch, sum } from '@msb235/blits';
import type { VoiceDef } from '../kit/scene';

/**
 * One sung syllable or played chord: a subject, carrying where it falls in its line and how long it
 * is held. Pitches are scale steps from the key's tonic, so the tune plays in any key and mode.
 */
export interface Syllable {
  id: string;
  text: string;
  /** Beats from the start of its line. */
  onset: number;
  beats: number;
  /** The tune's step; for a chord, its root's degree. */
  step: number;
  /** Steps sung with it, a harmony part. */
  harmony: number[];
}

/**
 * `lit` is 1 once a syllable is sung; `hop` runs 0 to 1 across the syllable, carrying the ball on to
 * the next. Both are scaled by the voice's weight, so a fade dims them together.
 */
export interface Pose {
  lit: number;
  hop: number;
}

export type Part = 'count' | 'lead' | 'chorus' | 'chords';

export interface Line {
  name: string;
  part: Part;
  syllables: Syllable[];
  beats: number;
  /** Where it starts: after the line named, or with it, as a chord line plays under its line. */
  after?: string;
  with?: string;
}

interface Tune {
  beats: number[];
  steps: number[];
  harmony?: number[];
}

/**
 * "Deck the Halls", as steps of the scale from its tonic: 0 the tonic, 7 an octave up, -1 the step
 * below. In D major the line runs A G F# E D E F# D, and the fa-la E F# G E F# E D C# D, sung with a
 * part a third above it.
 */
const CALL: Tune = { beats: [1.5, 0.5, 1, 1, 1, 1, 1, 1], steps: [4, 3, 2, 1, 0, 1, 2, 0] };
const ANSWER: Tune = {
  beats: [0.5, 0.5, 0.5, 0.5, 1.5, 0.5, 1, 1, 2],
  steps: [1, 2, 3, 1, 2, 1, 0, -1, 0],
  harmony: [3, 4, 5, 3, 4, 3, 3, 1, 2],
};
const COUNT: Tune = { beats: [1, 1, 1, 1], steps: [11, 11, 11, 11] };
/** The chords under each, by the degree of their root: I under a line, IV I V I under a fa-la. */
const CALL_CHORDS: Tune = { beats: [8], steps: [0] };
const ANSWER_CHORDS: Tune = { beats: [2, 2, 2, 2], steps: [3, 0, 4, 0] };

const LEAD = [
  'It rubs the lo- tion on its skin,',
  'Or else it gets the hose a- gain.',
  'Put the lo- tion in the bas- ket.',
];
const FA_LA = 'Fa la la la la, la la la la.';

function line(
  name: string,
  part: Part,
  words: string[],
  tune: Tune,
  place: { after?: string; with?: string },
): Line {
  let onset = 0;
  const syllables = words.map((text, i) => {
    const harmony = tune.harmony?.[i];
    const s = {
      id: `${name}/${i}`,
      text,
      onset,
      beats: tune.beats[i] ?? 1,
      step: tune.steps[i] ?? 0,
      harmony: harmony === undefined ? [] : [harmony],
    };
    onset += s.beats;
    return s;
  });
  return { name, part, syllables, beats: onset, ...place };
}

/** A chord line's subjects carry no text: the stage names each chord in the key it plays in. */
const unnamed = (tune: Tune) => tune.steps.map(() => '');

export const LINES: Line[] = [
  line('count-in', 'count', ['1', '2', '3', '4'], COUNT, {}),
  ...LEAD.flatMap((words, k) => {
    const n = k + 1;
    return [
      line(`line ${n}`, 'lead', words.split(' '), CALL, {
        after: k === 0 ? 'count-in' : `fa-la ${k}`,
      }),
      line(`fa-la ${n}`, 'chorus', FA_LA.split(' '), ANSWER, { after: `line ${n}` }),
      line(`chords ${n}`, 'chords', unnamed(CALL_CHORDS), CALL_CHORDS, { with: `line ${n}` }),
      line(`chords ${n}′`, 'chords', unnamed(ANSWER_CHORDS), ANSWER_CHORDS, {
        with: `fa-la ${n}`,
      }),
    ];
  }),
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

/** Semitones above the tonic of each degree, per mode. */
export const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  'phrygian dominant': [0, 1, 4, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
} as const;
export type Mode = keyof typeof MODES;

export const KEYS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const;
export type Key = (typeof KEYS)[number];

export interface SongConfig {
  tempo: number;
  lag: number;
  key: Key;
  mode: Mode;
  chords: boolean;
}

/** A step's MIDI note: the tonic sits between A3 and G♯4, so every key sings in about one range. */
export function midiOf(step: number, c: Pick<SongConfig, 'key' | 'mode'>): number {
  const pc = KEYS.indexOf(c.key);
  const tonic = 57 + ((pc - 9 + 12) % 12);
  const octave = Math.floor(step / 7);
  return tonic + 12 * octave + (MODES[c.mode][step - 7 * octave] as number);
}

/** A chord's name: its root, and `m`, `°` or `+` by the third and fifth the mode stacks on it. */
export function chordName(degree: number, c: Pick<SongConfig, 'key' | 'mode'>): string {
  const root = midiOf(degree, c);
  const third = midiOf(degree + 2, c) - root;
  const fifth = midiOf(degree + 4, c) - root;
  const kind = third === 3 ? (fifth === 6 ? '°' : 'm') : fifth === 8 ? '+' : '';
  return `${KEYS[root % 12]}${kind}`;
}

/** What a hit carries, for whoever sounds it. */
export interface Note {
  part: Part;
  /** MIDI notes: a sung note's tune first and its harmony after; a chord's root, then its triad. */
  midi: number[];
  /** How long it is held, in ms. */
  ms: number;
}

function notesOf(l: Line, s: Syllable, c: SongConfig): number[] {
  const steps =
    l.part === 'chords'
      ? [s.step - 14, s.step - 7, s.step - 5, s.step - 3]
      : [s.step, ...s.harmony];
  return steps.map((n) => midiOf(n, c));
}

/** How long the reverb rings on after the last note, in ms. */
const TAIL = 1500;

/** Where the song starts, in ms. */
const OPEN = 300;

/** How long the song runs at this config, its last note's ring included. */
export function songMs(c: Pick<SongConfig, 'tempo' | 'lag'>): number {
  const beat = 60_000 / c.tempo;
  const sung = LINES.filter((l) => l.part !== 'chords');
  const answers = sung.filter((l) => l.part === 'chorus').length;
  const beats = sung.reduce((n, l) => n + l.beats, 0) + answers * c.lag;
  return OPEN + beats * beat + TAIL;
}

const COLOR: Record<Part, string> = { count: 'v3', lead: 'v1', chorus: 'v2', chords: 'v4' };

/**
 * One voice per line, on a track per part. The count-in starts the song; each lead line comes in
 * after the answer before it, each answer after its line, `lag` beats late, and each chord line with
 * the line it plays under.
 */
export function voices(c: SongConfig): VoiceDef<Syllable, Pose>[] {
  const beat = 60_000 / c.tempo;
  return LINES.filter((l) => c.chords || l.part !== 'chords').map((l) => {
    const start =
      l.with !== undefined
        ? { with: l.with }
        : l.after === undefined
          ? OPEN
          : l.part === 'chorus'
            ? { after: l.after, by: c.lag * beat }
            : { after: l.after };
    return {
      name: l.name,
      color: COLOR[l.part],
      track: l.part === 'count' ? 'count-in' : l.part,
      spec: {
        name: l.name,
        tags: [l.part],
        subjects: l.syllables,
        loop: false,
        fade: { out: 120 },
        patch: sung(l, beat),
        hits: l.syllables.map((s) => ({
          at: s.onset * beat,
          event: { part: l.part, midi: notesOf(l, s, c), ms: s.beats * beat } satisfies Note,
        })),
        ...(typeof start === 'number' ? { start } : { anchor: { start } }),
      },
    };
  });
}
