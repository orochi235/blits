import type { BookedHit, Marked, Mix } from '@msb235/blits';
import {
  type AudioEngine,
  createAudioEngine,
  createDelayEffect,
  createReverbEffect,
  impulseResponse,
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
  inserts.add(createDelayEffect(e.context, { time: 420, feedback: 0.42, mix: 0.3 }));
  const impulse = impulseResponse(e.context, 6, { decayDb: 60 });
  inserts.add(createReverbEffect(e.context, { impulse, mix: 0.65 }));
  e.bus('choir').setGain(0.8);
  shared = e;
  return e;
}

/** A sung "ah": detuned saws through a low, slightly peaked filter, swelling in and out. */
const AH: Omit<NoteOptions, 'pitch'> = {
  wave: 'sawtooth',
  filter: { type: 'lowpass', frequency: 700, Q: 2 },
  envelope: { attack: 70, decay: 200, sustain: 0.75, release: 450 },
  bus: 'choir',
};

/** The voices one note is sung by: the lead alone, the chorus doubled an octave down, both spread. */
function sing(e: AudioEngine, n: Note, when: number, sounding: Set<Voice>): Voice[] {
  const ms = Math.max(60, n.ms * 0.92);
  const play = (o: NoteOptions): Voice => {
    // A voice can be dropped inside `playNote`, before there is a handle to forget.
    let v: Voice | undefined;
    let ended = false;
    const end = () => {
      ended = true;
      if (v) sounding.delete(v);
    };
    v = e.playNote({ ...o, onDone: end, onDrop: end });
    if (!ended) sounding.add(v);
    return v;
  };
  if (n.part === 'count') {
    return [
      play({
        pitch: n.pitch,
        wave: 'triangle',
        duration: 40,
        gain: 0.25,
        when,
        bus: 'choir',
        envelope: { attack: 1, decay: 60, sustain: 0, release: 40 },
      }),
    ];
  }
  const parts =
    n.part === 'lead'
      ? [
          { detune: -6, pan: -0.2, gain: 0.22 },
          { detune: 6, pan: 0.2, gain: 0.22 },
        ]
      : [
          { detune: -10, pan: -0.6, gain: 0.2 },
          { detune: 0, pan: 0, gain: 0.2 },
          { detune: 10, pan: 0.6, gain: 0.2 },
          { detune: -1200, pan: -0.3, gain: 0.26 },
          { detune: -1195, pan: 0.3, gain: 0.26 },
        ];
  return parts.map((p) => play({ ...AH, ...p, pitch: n.pitch, duration: ms, when }));
}

/**
 * Sings the mix's hits: `mix.book` hands each syllable over ahead of time, on the audio clock, and
 * takes back any whose time moves. Only while the player plays on in time; a scrub or a step back
 * stops what is sounding and books nothing.
 */
export function choir(m: Mix<Syllable, Pose>): Attached {
  const e = engine();
  let playing = true;
  // Each voice leaves this as it ends, so it holds only what is booked or sounding.
  const sounding = new Set<Voice>();
  const booker = m.book<Note>({
    clock: () => e.now(),
    ahead: 150,
    late: 30,
    take(item: Marked | BookedHit<Note, Syllable>, when: number, lateBy: number) {
      if (!playing || lateBy > 0 || !('hit' in item)) return undefined;
      const voices = sing(e, item.event, when, sounding);
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
