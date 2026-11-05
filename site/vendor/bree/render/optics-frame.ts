import type { Board, Led } from '../board.js';
import { dotColor, rgb } from '../color.js';
import { type Afflictions, afflict, afflictions, type Defect } from '../defects.js';
import {
  FADE,
  type Fade,
  type Ghost,
  ghosts,
  type SignColumns,
  settle,
  shownLit,
} from '../optics.js';

/** What each light shows this frame, for a renderer to draw. */
export interface Lit {
  /** Brightness, 0..1; 0 where the light is too dim to draw. */
  shine: Float32Array;
  /** Three per light: its color as sRGB, 0..1. Only meaningful where `shine` is above 0. */
  rgb: Float32Array;
  /** How far each light blooms, as a multiple of its radius. */
  bloom: Float32Array;
}

/** The per-light state that carries from one frame to the next: settling, ghosts and fault timing. */
export interface OpticsFrame {
  /** Advances `dt` ms from the mix's columns and writes what every light shows into `out`. */
  step(cols: SignColumns, fallback: number, dt: number, brightness: number, out: Lit): void;
  /** Replaces the broken lights. */
  setDefects(defects: readonly Defect[]): void;
  /** Sets how fast the lights light and go dark. */
  setFade(fade: Fade): void;
  /** Sets how much an unlit dot shows of its lit row and column. */
  setGhost(ghost: Ghost): void;
}

/** An empty `Lit` for `n` lights. */
export function lit(n: number): Lit {
  return {
    shine: new Float32Array(n),
    rgb: new Float32Array(n * 3),
    bloom: new Float32Array(n),
  };
}

/** The least a light must show to be drawn. */
export const MIN_SHOWN = 0.02;

/** A frame stepper for `leds` on `b`, in the order the sign was given its lights. */
export function createOpticsFrame(b: Board, leds: readonly Led[]): OpticsFrame {
  const shown = new Float64Array(leds.length);
  const leak = new Float64Array(leds.length);
  let broken: Afflictions = afflictions(leds, []);
  let fade: Fade = FADE;
  let ghost: Ghost = {};
  let clock = 0;
  return {
    step({ lit: on, gain, tint, hue, chroma, glow, invert }, fallback, dt, brightness, out) {
      clock += dt;
      for (let i = 0; i < leds.length; i++) {
        const target = afflict(broken, i, shownLit(on[i] ?? 0, invert[i] ?? 0), clock);
        shown[i] = settle(shown[i] ?? 0, target, dt, fade);
      }
      ghosts(b, shown, ghost, leak);
      for (let i = 0; i < leds.length; i++) {
        const now = (shown[i] ?? 0) + (leak[i] ?? 0) * (broken.scale[i] ?? 1);
        out.bloom[i] = glow[i] ?? 1;
        if (now < MIN_SHOWN) {
          out.shine[i] = 0;
          continue;
        }
        out.shine[i] = Math.min(now * Math.min(gain[i] ?? 1, 1) * brightness, 1);
        out.rgb.set(rgb(dotColor(tint, i * 4, hue[i] ?? 0, chroma[i] ?? 1, fallback)), i * 3);
      }
    },
    setDefects(defects) {
      broken = afflictions(leds, defects);
    },
    setFade(next) {
      fade = next;
    },
    setGhost(next) {
      ghost = next;
    },
  };
}
