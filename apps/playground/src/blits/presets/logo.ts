import { compose } from '@brand/glyphs.js';
import { logoHues } from '@brand/hues.js';
import type { Composition } from '../composition';

/**
 * The site's rail logo as voices: the word lit on its sign, its hues turning on a clock of their
 * own, a halo following the pointer, and the rainbow that hovering runs. bree's moves (swarm, fall
 * and the rest) are its own effects and are left out.
 */
const WORD = compose('blits');
const { CYCLE } = logoHues();

/** The sign: the word with a column each side and 3 blank rows above it, as the rail stands it. */
const LEFT = 2;
const TOP = 4;
const COLS = WORD.cols + 2 * LEFT;
const ROWS = TOP + WORD.rows + 2;
const lit = JSON.stringify(WORD.lit.map(([c, r]) => `${c + LEFT},${r + TOP}`));

const c: Composition = {
  version: 1,
  title: 'logo',
  stage: { kind: 'dots', cols: COLS, rows: ROWS },
  length: CYCLE,
  levels: [{ name: 'hover', value: 0, min: 0, max: 1 }],
  rules: { opacity: { rule: 'max', bounds: [0, 1] } },
  voices: [
    {
      id: 'word',
      name: 'word',
      hue: 80,
      start: 0,
      rate: 1,
      loop: true,
      fade: {},
      weight: 1,
      patch: {
        kind: 'fn',
        period: 1000,
        writes: ['opacity'],
        at: `(() => {\n  const word = new Set(${lit});\n  return (phase, s) => ({ opacity: word.has(\`\${s.col},\${s.row}\`) ? 1 : 0.08 });\n})()`,
      },
    },
    {
      id: 'hues',
      name: 'hues',
      hue: 160,
      start: 0,
      rate: 1,
      loop: true,
      fade: {},
      weight: 1,
      patch: {
        kind: 'fn',
        period: CYCLE,
        writes: ['color'],
        at: `(() => {\n  const { CYCLE, hueAt, turnedHex } = (${logoHues.toString()})();\n  return (phase, s) => ({ color: turnedHex(hueAt(phase * CYCLE, s.col, s.row, ${COLS}, ${ROWS})) });\n})()`,
      },
    },
    {
      id: 'rainbow',
      name: 'rainbow',
      hue: 300,
      start: 0,
      rate: 1,
      loop: true,
      fade: {},
      weight: { code: "slew(level('hover'), { riseMs: 150, fallMs: 500 })" },
      patch: {
        kind: 'fn',
        period: 2500,
        writes: ['color'],
        at: `(() => {\n  const { turnedHex } = (${logoHues.toString()})();\n  return (phase, s) => ({ color: turnedHex(phase * 360 + s.col * 0.015 * 360) });\n})()`,
      },
    },
    {
      id: 'halo',
      name: 'halo',
      hue: 50,
      start: 0,
      rate: 1,
      loop: true,
      fade: {},
      weight: { code: "around(5, { ease: 'ease-out' })" },
      patch: {
        kind: 'keys',
        period: 1000,
        stops: [{ at: 0, delta: { opacity: 0.5, glow: 1.5 } }],
      },
    },
  ],
};
export default c;
