import type { EffectSpec } from './effects.js';
import type { ModPiece } from './pieces.js';

/** A modulator looping under the whole program, at a weight against the text's 1. */
export interface LayerSpec extends ModPiece {
  /** Its weight when on. Default 1. */
  readonly weight?: number;
}

const effects = {
  hold: {
    name: 'hold',
    about: 'Stands centered, wiping on and off by column and flashing midway.',
    order: { by: 'column', lag: 14 },
    enter: { move: 'cut-on' },
    // One flash pass over the whole hold: steady, three quick flashes in the middle third, steady.
    active: [{ move: 'stand' }, { mod: 'flash', params: { flashes: 3, from: 1 / 3, to: 2 / 3 } }],
    exit: { move: 'cut-off' },
    hold: 3600,
    params: {
      flashes: {
        label: 'flashes',
        about: 'How many times the message blinks in the middle of its hold.',
        to: ['active.1.flashes'],
      },
    },
  },
  scroll: {
    name: 'scroll',
    about: 'Crosses the sign a column at a time.',
    active: { move: 'scroll-across' },
    params: {
      speed: {
        label: 'column time',
        about: 'How long the message waits before moving one column. Higher scrolls more slowly.',
        to: ['active.0.step'],
      },
      direction: {
        label: 'direction',
        about: 'Which way the message travels.',
        to: ['active.0.direction'],
      },
    },
  },
  flip: {
    name: 'flip',
    about: 'Letters unfold, tumble end over end one after another, and fold away.',
    order: { by: 'letter', lag: 90 },
    enter: { move: 'unfold' },
    active: { move: 'tumble', params: { turns: 2 } },
    exit: { move: 'fold' },
    hold: 3000,
    params: {
      turns: {
        label: 'turns',
        about: 'How many times each letter tumbles end over end while it stands.',
        to: ['active.0.turns'],
      },
      fold: {
        label: 'fold time',
        about: 'How long each letter takes to unfold coming on and to fold going.',
        to: ['enter.0.ms', 'exit.0.ms'],
      },
    },
  },
  roll: {
    name: 'roll',
    about: 'Each letter spins through random glyphs like a slot reel, landing left to right.',
    enter: { move: 'reel-in', order: { by: 'letter', lag: 140 } },
    active: { move: 'stand' },
    exit: { move: 'roll-away' },
    hold: 1800,
    params: {
      stagger: {
        label: 'stagger',
        about: 'How long each letter’s reel waits after the one before it lands.',
        to: ['enter.0.lag'],
      },
      glyphs: {
        label: 'glyphs',
        about: 'How many random characters roll past before a letter lands. Higher spins faster.',
        to: ['enter.0.glyphs'],
      },
    },
  },
  fall: {
    name: 'fall',
    about: 'Columns drop in from above at random, then fall out the bottom.',
    enter: { move: 'drop-in', order: { by: 'random', lag: 9, seed: 1 } },
    active: { move: 'stand' },
    exit: { move: 'drop-out', order: { by: 'random', lag: 9, seed: 2 } },
    hold: 1700,
    params: {
      drop: {
        label: 'drop time',
        about: 'How long a column takes to fall, coming on and going. Higher drops more slowly.',
        to: ['enter.0.ms', 'exit.0.ms'],
      },
      scatter: {
        label: 'scatter',
        about:
          'How long each column waits after the one before it. At 0 every column falls together.',
        to: ['enter.0.lag', 'exit.0.lag'],
      },
    },
  },
  matris: {
    name: 'matris',
    about:
      'Streams of dots rain down every column and leave the message behind, then wash it away.',
    enter: { move: 'rain-in' },
    active: { move: 'stand' },
    exit: { move: 'rain-out' },
    hold: 2000,
    params: {
      rain: {
        label: 'rain time',
        about: 'How long the rain takes to leave the message, and to wash it away.',
        to: ['enter.0.ms', 'exit.0.ms'],
      },
      drops: {
        label: 'drops',
        about: 'How many streams fall down each column.',
        to: ['enter.0.drops', 'exit.0.drops'],
      },
    },
  },
  tile: {
    name: 'tile',
    about: 'Repeats the message in tilted brick rows, neighbors scrolling opposite ways.',
    active: { move: 'tile' },
    hold: 9000,
    params: {
      tilt: {
        label: 'tilt',
        about: 'How far the brick rows lean.',
        to: ['active.0.angle'],
      },
      speed: {
        label: 'column time',
        about: 'How long the rows wait before moving one column. Higher scrolls more slowly.',
        to: ['active.0.step'],
      },
      rows: {
        label: 'row gap',
        about: 'How many blank rows separate one row of text from the next.',
        to: ['active.0.leading'],
      },
      gap: {
        label: 'gap',
        about:
          'How many blank columns separate each copy of the message from the next along a row.',
        to: ['active.0.gap'],
      },
    },
  },
  type: {
    name: 'type',
    about: 'Types the message on a letter at a time behind a blinking cursor, then backspaces it.',
    enter: { move: 'type-on' },
    active: { move: 'stand' },
    exit: { move: 'type-off', params: { ms: 60 } },
    hold: 2000,
    params: {
      speed: {
        label: 'letter time',
        about: 'How long each letter takes to type. Higher types more slowly.',
        to: ['enter.0.ms'],
      },
      erase: {
        label: 'erase time',
        about: 'How long each letter takes to backspace away.',
        to: ['exit.0.ms'],
      },
      cursor: {
        label: 'cursor',
        about: 'What stands where the next letter lands: a block, a single column, or nothing.',
        to: ['enter.0.cursor', 'exit.0.cursor'],
      },
      pace: {
        label: 'pace',
        about:
          'Time types on its own. Input waits for a press before each letter typed and each backspaced.',
        to: ['enter.0.pace', 'exit.0.pace'],
      },
    },
  },
  swarm: {
    name: 'swarm',
    about: 'Every dot flies in from a scatter to form the message, then flies off again.',
    enter: { move: 'assemble' },
    active: { move: 'stand' },
    exit: { move: 'scatter', params: { seed: 2 } },
    hold: 1800,
    params: {
      fly: {
        label: 'fly time',
        about: 'How long the dots take to gather, and to fly off. Higher flies more slowly.',
        to: ['enter.0.ms', 'exit.0.ms'],
      },
      spread: {
        label: 'spread',
        about: 'How far from their places the dots scatter.',
        to: ['enter.0.reach', 'exit.0.reach'],
      },
      swirl: {
        label: 'swirl',
        about: 'How far the dots wheel around as they fly. At 0 they fly straight.',
        to: ['enter.0.swirl', 'exit.0.swirl'],
      },
    },
  },
  bounce: {
    name: 'bounce',
    about: 'Letters drop in one after another and bounce to rest, then fall out the bottom.',
    enter: { move: 'bounce-in', order: { by: 'letter', lag: 90 } },
    active: { move: 'stand' },
    exit: { move: 'drop-out', order: { by: 'letter', lag: 50 } },
    hold: 1800,
    params: {
      bounces: {
        label: 'bounces',
        about: 'How many times each letter bounces before it rests.',
        to: ['enter.0.bounces'],
      },
      time: {
        label: 'bounce time',
        about: 'How long each letter takes to fall and bounce. Higher bounces more slowly.',
        to: ['enter.0.ms'],
      },
      stagger: {
        label: 'stagger',
        about: 'How long each letter waits after the one before it, coming on and going.',
        to: ['enter.0.lag', 'exit.0.lag'],
      },
    },
  },
  wave: {
    name: 'wave',
    about: 'Letters unfold, ride a wave rolling along the message, and fold away.',
    order: { by: 'letter', lag: 60 },
    enter: { move: 'unfold' },
    active: { move: 'wave' },
    exit: { move: 'fold' },
    hold: 4800,
    params: {
      height: {
        label: 'height',
        about: 'How many rows the wave lifts and drops the letters.',
        to: ['active.0.height'],
      },
      length: {
        label: 'wavelength',
        about: 'How many columns from one crest to the next. Lower makes a choppier wave.',
        to: ['active.0.length'],
      },
      speed: {
        label: 'wave time',
        about: 'How long one crest takes to pass a letter. Higher rolls more slowly.',
        to: ['active.0.period'],
      },
      by: {
        label: 'moves',
        about: 'Whether each letter bobs whole, or every column on its own, bending the letters.',
        to: ['active.0.by'],
      },
    },
  },
  melt: {
    name: 'melt',
    about: 'Stands, then drips down the sign in streaks, a column at a time.',
    active: { move: 'stand' },
    exit: { move: 'melt' },
    hold: 2000,
    params: {
      melt: {
        label: 'melt time',
        about: 'How long the message takes to drip away.',
        to: ['exit.0.ms'],
      },
      streak: {
        label: 'streak',
        about: 'How long the streak behind each drip grows. At 0 the dots fall clean.',
        to: ['exit.0.tail'],
      },
      stagger: {
        label: 'stagger',
        about: 'How scattered the columns’ start times are. At 0 every column lets go at once.',
        to: ['exit.0.spread'],
      },
    },
  },
  shear: {
    name: 'shear',
    about: 'The top and bottom halves slide in from opposite edges to meet, then part again.',
    enter: { move: 'split-in' },
    active: { move: 'stand' },
    exit: { move: 'split-out', params: { direction: 'right' } },
    hold: 2000,
    params: {
      slide: {
        label: 'slide time',
        about: 'How long the halves take to meet, and to part.',
        to: ['enter.0.ms', 'exit.0.ms'],
      },
    },
  },
} as const satisfies Record<string, EffectSpec>;

const layers = {
  sparkle: { mod: 'sparkle' },
  rainbow: { mod: 'hue-cycle', spread: { by: 'column' }, params: { rate: 0.4, phase: 0.015 } },
  invert: { mod: 'invert' },
  scanline: { mod: 'scanline' },
  fire: { mod: 'fire' },
  glitch: { mod: 'glitch' },
  neon: { mod: 'neon', spread: { by: 'letter' } },
  shimmer: { mod: 'shimmer' },
  aurora: { mod: 'aurora' },
  gradient: { mod: 'gradient' },
} as const satisfies Record<string, LayerSpec>;

export type EffectName = keyof typeof effects;
export type LayerName = keyof typeof layers;
/** The built-in text effects, by name. */
export const EFFECTS: Readonly<Record<EffectName, EffectSpec>> = effects;
/** The built-in layers, by name. */
export const LAYERS: Readonly<Record<LayerName, LayerSpec>> = layers;
