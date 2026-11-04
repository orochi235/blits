import type { BookedHit, Marked, Mix } from '@msb235/blits';
import {
  type AudioEngine,
  createAudioEngine,
  createDelayEffect,
  createReverbEffect,
  impulseResponse,
  type NoiseOptions,
  type NoteOptions,
} from '@weasel-js/audio';
import type { Attached } from '../kit/scene';
import type { Note, Pose, Syllable } from './song';

type Voice = ReturnType<AudioEngine['playNote']>;

let shared: AudioEngine | null = null;

/** One engine for the page, its bus run through a long echo and a cathedral of reverb. */
function engine(): AudioEngine {
  if (shared) return shared;
  const e = createAudioEngine({ buses: ['choir'] });
  const inserts = e.bus('choir').inserts;
  inserts.add(createDelayEffect(e.context, { time: 420, feedback: 0.25, mix: 0.18 }));
  const impulse = impulseResponse(e.context, 6, { decayDb: 60 });
  inserts.add(createReverbEffect(e.context, { impulse, mix: 0.65 }));
  e.bus('choir').setGain(0.8);
  shared = e;
  return e;
}

/** Where a viewer's choice of sound on or off is kept. */
const SOUND_KEY = 'blits-score-sound';

/** Whether the viewer last left sound on. */
export function soundWanted(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === 'on';
  } catch {
    return false;
  }
}

/**
 * Watches the checkbox labeled `label`: it keeps the viewer's choice, and makes the engine inside
 * the click that turns sound on. A browser starts an `AudioContext` only within a user gesture, and
 * the explainer builds its player after the click, outside it. Sound left on from a last visit
 * starts at the first click or key on the page instead.
 */
export function primeOn(label: string): void {
  if (typeof document === 'undefined') return;
  document.addEventListener(
    'click',
    (event) => {
      const box = event.target;
      if (!(box instanceof HTMLInputElement) || box.getAttribute('aria-label') !== label) return;
      try {
        localStorage.setItem(SOUND_KEY, box.checked ? 'on' : 'off');
      } catch {}
      if (box.checked)
        void engine()
          .unlock()
          .catch(() => undefined);
    },
    { capture: true },
  );
}

/** A sung "ah": detuned saws through a soft low-pass filter, swelling in and out. */
const AH: Omit<NoteOptions, 'pitch'> = {
  wave: 'sawtooth',
  filter: { type: 'lowpass', frequency: 1600, Q: 1.2 },
  envelope: { attack: 70, decay: 200, sustain: 0.75, release: 450 },
  bus: 'choir',
};

/** Who sings the chorus: a choir on "ah", or dogs barking each note at its pitch. */
export type Singers = 'choir' | 'dogs';

/** One bark at `midi`: a buzzy body dropping onto the pitch through a snapping filter, and a breath of noise on the onset. */
function bark(
  midi: number,
  at: number,
  gain: number,
  pan: number,
  note: (o: NoteOptions) => Voice,
  noise: (o: NoiseOptions) => Voice,
): Voice[] {
  return [
    note({
      pitch: { midi: midi + 3 },
      glide: { to: { midi }, ms: 50 },
      wave: [1, 0.7, 0.5, 0.35, 0.2, 0.1],
      filter: {
        type: 'bandpass',
        frequency: 700,
        Q: 2.5,
        amount: 1400,
        envelope: { attack: 3, decay: 90, sustain: 0.1, release: 60 },
      },
      envelope: { attack: 4, decay: 110, sustain: 0.15, release: 70 },
      duration: 120,
      gain,
      pan,
      when: at,
      bus: 'choir',
    }),
    noise({
      noise: 'pink',
      filter: { type: 'bandpass', frequency: 1500, Q: 1 },
      envelope: { attack: 2, decay: 40, sustain: 0, release: 30 },
      duration: 40,
      gain: gain * 0.6,
      pan,
      when: at,
      bus: 'choir',
    }),
  ];
}

/** The voices one hit is sounded by: a click, a chord on the organ, or the tune in a detuned pair with its harmony. */
function sing(
  e: AudioEngine,
  n: Note,
  when: number,
  sounding: Set<Voice>,
  singers: Singers,
): Voice[] {
  const ms = Math.max(60, n.ms * 0.92);
  // A voice can be dropped as it is launched, before there is a handle to forget.
  const keep =
    <O extends { onDone?: () => void; onDrop?: (reason: never) => void }>(
      launch: (o: O) => Voice,
    ) =>
    (o: O): Voice => {
      let v: Voice | undefined;
      let ended = false;
      const end = () => {
        ended = true;
        if (v) sounding.delete(v);
      };
      v = launch({ ...o, onDone: end, onDrop: end });
      if (!ended) sounding.add(v);
      return v;
    };
  const play = keep<NoteOptions>((o) => e.playNote(o));
  const hiss = keep<NoiseOptions>((o) => e.playNoise(o));
  const [tune = 60, ...rest] = n.midi;
  if (n.part === 'count') {
    return [
      play({
        pitch: { midi: tune },
        wave: 'triangle',
        duration: 40,
        gain: 0.25,
        when,
        bus: 'choir',
        envelope: { attack: 1, decay: 60, sustain: 0, release: 40 },
      }),
    ];
  }
  if (n.part === 'chords') {
    // A soft organ under the singing: the root low, the triad above it, slow to swell.
    return n.midi.map((midi, i) =>
      play({
        pitch: { midi },
        wave: [1, 0.4, 0.2, 0.1],
        gain: i === 0 ? 0.12 : 0.07,
        pan: [0, -0.35, 0.35, 0][i] ?? 0,
        duration: ms,
        when,
        bus: 'choir',
        envelope: { attack: 160, decay: 300, sustain: 0.8, release: 600 },
      }),
    );
  }
  if (n.part === 'chorus' && singers === 'dogs') {
    // A note held a beat and a half or longer gets a second, smaller bark halfway through it.
    const times = n.ms >= 600 ? [when, when + n.ms / 2] : [when];
    return times.flatMap((at, k) =>
      n.midi.flatMap((midi, i) =>
        bark(
          midi,
          at,
          (i === 0 ? 0.3 : 0.22) * (k === 0 ? 1 : 0.7),
          i === 0 ? -0.25 : 0.35,
          play,
          hiss,
        ),
      ),
    );
  }
  const parts = [
    { midi: tune, detune: -6, pan: -0.3, gain: 0.2 },
    { midi: tune, detune: 6, pan: 0.3, gain: 0.2 },
    ...rest.map((midi, i) => ({ midi, detune: i % 2 === 0 ? -4 : 4, pan: 0.4, gain: 0.16 })),
  ];
  return parts.map(({ midi, ...p }) => play({ ...AH, ...p, pitch: { midi }, duration: ms, when }));
}

/**
 * Sings the mix's hits: `mix.book` hands each syllable over ahead of time, on the audio clock, and
 * takes back any whose time moves. Only while the player plays on in time; a scrub or a step back
 * stops what is sounding and books nothing.
 */
export function choir(m: Mix<Syllable, Pose>, singers: Singers): Attached {
  const e = engine();
  if (e.state() !== 'running') void e.unlock().catch(() => undefined);
  let playing = true;
  // Each voice leaves this as it ends, so it holds only what is booked or sounding.
  const sounding = new Set<Voice>();
  const booker = m.book<Note>({
    clock: () => e.now(),
    ahead: 150,
    late: 30,
    take(item: Marked | BookedHit<Note, Syllable>, when: number, lateBy: number) {
      if (!playing || lateBy > 0 || !('hit' in item)) return undefined;
      const voices = sing(e, item.event, when, sounding, singers);
      return {
        cancel: () => {
          for (const v of voices) v.stop(30);
        },
      };
    },
  });
  const hush = () => {
    for (const v of [...sounding]) v.stop(60);
  };
  return {
    moving(on) {
      if (!on && playing) hush();
      playing = on;
    },
    close() {
      booker.cancel();
      hush();
    },
  };
}
