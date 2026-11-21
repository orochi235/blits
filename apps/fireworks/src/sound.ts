import type { Target } from '@msb235/blits-tone';
import * as Tone from 'tone';
import { panOf, type Shell, type Sound, sizeOf } from './show';

/** One oscillator a rising shell borrows: its pitch and its level are what the mix drives. */
export interface Whistle {
  freq: Target;
  gain: Target;
}

export interface Sounds {
  /** Plays a shell's bang or crackle at `time`, seconds on the audio clock. */
  play(sound: Sound, shell: Shell, time: number): void;
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

/** How long after its last sound a burst still rings, in seconds, before another shell may take it. */
const RING_S = 0.8;

/** One shell's bang and crackles, through a panner of their own so another shell can't move them. */
interface Burst {
  owner: Shell | undefined;
  /** When on the audio clock its last sound is over. */
  until: number;
  pan: Tone.Panner;
  bang(at: number, size: number): void;
  crackle(at: number): void;
}

function createBurst(out: Tone.ToneAudioNode): Burst {
  const pan = new Tone.Panner(0).connect(out);
  const rumble = new Tone.NoiseSynth({
    noise: { type: 'brown' },
    envelope: { attack: 0.002, decay: 0.7, sustain: 0 },
  }).connect(new Tone.Filter(700, 'lowpass').connect(pan));
  const thump = new Tone.MembraneSynth({
    pitchDecay: 0.09,
    octaves: 5,
    envelope: { attack: 0.001, decay: 0.6, sustain: 0 },
  }).connect(pan);
  const crackle = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.035, sustain: 0 },
  }).connect(new Tone.Filter(3500, 'highpass').connect(pan));
  const bangAt = inOrder();
  const crackleAt = inOrder();
  const burst: Burst = {
    owner: undefined,
    until: 0,
    pan,
    bang(time, size) {
      const at = bangAt(time);
      burst.until = Math.max(burst.until, at + RING_S);
      rumble.triggerAttackRelease(0.6, at, size);
      thump.triggerAttackRelease('C1', 0.5, at, 0.9);
    },
    crackle(time) {
      const at = crackleAt(time);
      burst.until = Math.max(burst.until, at + RING_S);
      crackle.triggerAttackRelease(0.03, at, 0.25);
    },
  };
  return burst;
}

/** Builds the instruments. Call it from a click, after `Tone.start()`. */
export function createSounds(): Sounds {
  const master = new Tone.Gain(0.8).toDestination();

  // As many as there are shells sounding at once.
  const bursts: Burst[] = [];
  const burstFor = (shell: Shell, at: number): Burst => {
    const held = bursts.find((b) => b.owner === shell);
    if (held) return held;
    let burst = bursts.find((b) => b.until <= at);
    if (!burst) {
      burst = createBurst(master);
      bursts.push(burst);
    }
    burst.owner = shell;
    burst.pan.pan.setValueAtTime(panOf(shell), at);
    return burst;
  };

  const idle: Whistle[] = Array.from({ length: WHISTLES }, () => {
    const amp = new Tone.Gain(0).connect(master);
    const osc = new Tone.Oscillator(700, 'sine').connect(amp).start();
    return { freq: osc.frequency, gain: amp.gain };
  });

  return {
    play(sound, shell, time) {
      const burst = burstFor(shell, time);
      if (sound === 'bang') burst.bang(time, Math.min(1, 0.5 + sizeOf(shell) / 2));
      else burst.crackle(time);
    },
    borrow: () => idle.pop(),
    giveBack: (whistle) => {
      idle.push(whistle);
    },
  };
}
