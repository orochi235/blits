import type { Target } from '@msb235/blits-tone';
import * as Tone from 'tone';
import type { Sound } from './show';

/** One oscillator a rising shell borrows: its pitch and its level are what the mix drives. */
export interface Whistle {
  freq: Target;
  gain: Target;
}

export interface Sounds {
  /** Plays a bang or a crackle at `time`, seconds on the audio clock. */
  play(sound: Sound, time: number): void;
  /** A whistle nobody is using, or undefined when every one is in the air. */
  borrow(): Whistle | undefined;
  giveBack(whistle: Whistle): void;
}

const WHISTLES = 6;

/** A source refuses a start at or before its last, so each plays no earlier than just after it. */
function inOrder(): (time: number) => number {
  let last = 0;
  return (time) => {
    last = Math.max(time, last + 0.002);
    return last;
  };
}

/** Builds the instruments. Call it from a click, after `Tone.start()`. */
export function createSounds(): Sounds {
  const master = new Tone.Gain(0.8).toDestination();

  const bangPan = new Tone.Panner(0).connect(master);
  const rumble = new Tone.NoiseSynth({
    noise: { type: 'brown' },
    envelope: { attack: 0.002, decay: 0.7, sustain: 0 },
  }).connect(new Tone.Filter(700, 'lowpass').connect(bangPan));
  const thump = new Tone.MembraneSynth({
    pitchDecay: 0.09,
    octaves: 5,
    envelope: { attack: 0.001, decay: 0.6, sustain: 0 },
  }).connect(bangPan);
  const bangAt = inOrder();

  const cracklePan = new Tone.Panner(0).connect(master);
  const crackle = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.035, sustain: 0 },
  }).connect(new Tone.Filter(3500, 'highpass').connect(cracklePan));
  const crackleAt = inOrder();

  const idle: Whistle[] = Array.from({ length: WHISTLES }, () => {
    const amp = new Tone.Gain(0).connect(master);
    const osc = new Tone.Oscillator(700, 'sine').connect(amp).start();
    return { freq: osc.frequency, gain: amp.gain };
  });

  return {
    play(sound, time) {
      if (sound.kind === 'bang') {
        const at = bangAt(time);
        bangPan.pan.setValueAtTime(sound.pan, at);
        rumble.triggerAttackRelease(0.6, at, Math.min(1, 0.5 + sound.size / 2));
        thump.triggerAttackRelease('C1', 0.5, at, 0.9);
      } else {
        const at = crackleAt(time);
        cracklePan.pan.setValueAtTime(sound.pan, at);
        crackle.triggerAttackRelease(0.03, at, 0.25);
      }
    },
    borrow: () => idle.pop(),
    giveBack: (whistle) => {
      idle.push(whistle);
    },
  };
}
