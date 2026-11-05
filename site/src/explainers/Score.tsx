import { f } from '@weasel-js/labkit';
import { Explainer } from './kit/Explainer';
import type { Scene } from './kit/scene';
import { choir, primeOn, type Singers, soundWanted } from './score/sing';
import {
  K,
  KEYS,
  type Key,
  MODES,
  type Mode,
  type Pose,
  SUBJECTS,
  type Syllable,
  songMs,
  voices,
} from './score/song';
import { stage } from './score/stage';

/** The longest the song runs, at the slowest tempo and the latest answers; the cut can fall anywhere in it. */
const LONGEST = songMs({ tempo: 140, lag: 1 });
/** The voice the cut fades. */
const CUT = 'line 2';

const SOUND = 'Sound';
primeOn(SOUND);

const config = f.schema({
  sound: f.boolean(soundWanted()).label(SOUND),
  tempo: f.number(160).range(140, 200).step(5).label('Tempo, beats a minute'),
  lag: f.number(0).range(0, 1).step(0.25).label('Chorus answers late by, beats'),
  key: f.enum<Key>('D', [...KEYS]).label('Key'),
  mode: f.enum<Mode>('dorian', Object.keys(MODES) as Mode[]).label('Mode'),
  chords: f.boolean(true).label('Chords'),
  singers: f.enum<Singers>('dogs', ['dogs', 'choir']).label('Chorus sung by'),
  cut: f
    .number(Number.POSITIVE_INFINITY)
    .range(0, LONGEST)
    .step(50)
    .suffix('ms')
    .endless('never')
    .label('Cut line 2 at'),
});
type Config = ReturnType<typeof config.defaults>;

function scene(c: Config): Scene<Syllable, Pose, Config> {
  return {
    kit: K,
    subjects: () => SUBJECTS,
    voices: () => voices(c),
    attach: (m) => (c.sound ? choir(m, c.singers) : { close() {} }),
    events: () => {
      if (!Number.isFinite(c.cut)) return [];
      const i = voices(c).findIndex((v) => v.name === CUT);
      return [{ at: c.cut, run: (_m, handles) => handles[i]?.fade() }];
    },
  };
}

export default function Score() {
  return (
    <Explainer
      scene={scene}
      schema={config}
      duration={songMs}
      aspect={0.36}
      caption={
        <>
          The lead sings a line and the chorus answers it, a ball bouncing over each, over the
          chords. Each line is one voice, from its <code>start</code> to its <code>end</code>, and
          the tracks below give each part one row. Each answer hangs from its line's{' '}
          <code>end</code>, each line from the answer before it, and each run of chords starts{' '}
          <code>with</code> what it plays under. Cut line 2 short and it fades out there with{' '}
          <code>fade()</code>, and its answer, its chords, and everything after come in early.
        </>
      }
      draw={(ctx, frame, size, ink, c) => {
        stage(ctx, { x: 12, y: 8, w: size.w - 24, h: size.h - 16 }, ink, frame, c);
      }}
    />
  );
}
