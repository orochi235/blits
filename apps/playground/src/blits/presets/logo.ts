import { compose } from '@brand/glyphs.js';
import { logoHues } from '@brand/hues.js';
import type { Composition } from '../composition';

/**
 * The site's rail logo as voices: the word lit on its sign, its hues turning on a clock of their
 * own, and the rainbow and the halo round the pointer that pointing at it brings up. The `hover`
 * level stands in for pointing at it, since the stage's pointer moves only `around` circles. bree's
 * moves (swarm, fall and the rest) are its own effects and are left out.
 */
const WORD = compose('blits');
const { CYCLE } = logoHues();

/**
 * The rail's sign (site/src/live/sign.ts): a dot of padding round the word, a blank column each
 * side of it, 3 blank rows above it and 13 below. The stage stops 2 rows under the word, but the
 * hues turn over the whole sign, as on the rail.
 */
const PAD = 1;
const LEFT = PAD + 1;
const TOP = PAD + 3;
const COLS = WORD.cols + 2 * LEFT;
const ROWS = TOP + WORD.rows + 2;
const SIGN_ROWS = TOP + WORD.rows + 13 + PAD;
const lit = JSON.stringify(WORD.lit.map(([c, r]) => `${c + LEFT},${r + TOP}`));

const c: Composition = {
  version: 1,
  title: 'logo',
  stage: { kind: 'dots', cols: COLS, rows: ROWS },
  length: CYCLE,
  levels: [{ name: 'hover', value: 0, min: 0, max: 1 }],
  rules: { opacity: { rule: 'max', bounds: [0, 1] } },
  groups: [
    {
      id: 'near',
      name: 'near',
      hue: 50,
      kind: 'owner',
      start: 0,
      rate: 1,
      weight: { code: "slew(level('hover'), { riseMs: 150, fallMs: 500 })" },
      fade: {},
    },
  ],
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
        at: `(() => {\n  const { CYCLE, hueAt, turnedHex } = (${logoHues.toString()})();\n  return (phase, s) => ({ color: turnedHex(hueAt(phase * CYCLE, s.col, s.row, ${COLS}, ${SIGN_ROWS})) });\n})()`,
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
      owner: 'near',
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
