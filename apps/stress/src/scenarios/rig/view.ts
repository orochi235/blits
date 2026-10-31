import { BONES } from './clips';

/** Rest joints of a figure in unit height, x centered; index is the bone, the parent follows. */
const JOINTS: readonly (readonly [number, number, number])[] = [
  [0, 0.5, -1],
  [0, 0.38, 0],
  [0, 0.28, 1],
  [0, 0.2, 2],
  [0, 0.1, 3],
  [-0.08, 0.5, 0],
  [-0.1, 0.7, 5],
  [-0.1, 0.9, 6],
  [-0.05, 0.95, 7],
  [0.08, 0.5, 0],
  [0.1, 0.7, 9],
  [0.1, 0.9, 10],
  [0.12, 0.25, 2],
  [0.2, 0.4, 12],
  [0.22, 0.55, 13],
  [-0.12, 0.25, 2],
  [-0.2, 0.4, 15],
  [-0.22, 0.55, 16],
  [0.05, 0.95, 11],
  [0.03, 0.09, 4],
];

/** Offsets are drawn at this scale and held within `LIMIT`, since the IK hold sends an arm bone's y up to a full figure height. */
const REACH = 1.5;
const LIMIT = 0.3;
const near = (v: number) => Math.max(-LIMIT, Math.min(LIMIT, v * REACH));

/** Stick figures in a grid, each bone at its rest joint plus its animated `pos` in x and y. */
export function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  chars: number,
  pos: Float64Array,
): void {
  const cols = Math.max(1, Math.round(Math.sqrt((chars * w) / h)));
  const rows = Math.ceil(chars / cols);
  const cw = w / cols;
  const ch = h / rows;
  const size = Math.min(cw * 1.4, ch * 0.9);
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  const at = new Float64Array(BONES * 2);
  for (let c = 0; c < chars; c++) {
    const ox = (c % cols) * cw + cw / 2;
    const oy = Math.floor(c / cols) * ch + (ch - size) / 2;
    for (let b = 0; b < BONES; b++) {
      const j = (c * BONES + b) * 3;
      const [x, y] = JOINTS[b] as readonly number[] as [number, number];
      at[b * 2] = ox + (x + near(pos[j] as number)) * size;
      at[b * 2 + 1] = oy + (y + near(pos[j + 1] as number)) * size;
    }
    for (let b = 1; b < BONES; b++) {
      const p = (JOINTS[b] as readonly number[])[2] as number;
      ctx.strokeStyle = b >= 12 && b <= 14 ? '#f2c14e' : '#9fb4d8';
      ctx.beginPath();
      ctx.moveTo(at[p * 2] as number, at[p * 2 + 1] as number);
      ctx.lineTo(at[b * 2] as number, at[b * 2 + 1] as number);
      ctx.stroke();
    }
    ctx.fillStyle = '#e8eefc';
    ctx.beginPath();
    ctx.arc(at[8] as number, at[9] as number, size * 0.05, 0, 2 * Math.PI);
    ctx.fill();
  }
}
