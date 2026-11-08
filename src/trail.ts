import type { Column } from './pull.js';

/** One `pull`'s subjects and the numbers it wrote for them, column by column. */
interface Pulled<I> {
  list: I[];
  keys: string[];
  axes: number[];
  data: Float64Array[];
  /** Each subject's position in `list`, made the first time a retarget asks. */
  index: Map<I, number> | null;
}

/** Every `pull` made at one mix time. */
interface Frame<I> {
  at: number;
  pulls: Pulled<I>[];
  count: number;
}

const frame = <I>(): Frame<I> => ({ at: Number.NaN, pulls: [], count: 0 });

/**
 * The last two frames `pull` read, kept as copies of its columns: the first retarget from
 * `'current'` takes the speed to leave at from them, as the mix keeps no poses until one is cued.
 * Copying the columns costs nothing a `pull` would notice, where keeping a pose a subject would.
 */
export class Trail<I> {
  private now: Frame<I> = frame();
  private before: Frame<I> = frame();

  record(at: number, list: readonly I[], columns: readonly Column[]): void {
    if (this.now.at !== at) {
      const spare = this.before;
      this.before = this.now;
      this.now = spare;
      spare.at = at;
      spare.count = 0;
    }
    const f = this.now;
    let p = f.pulls[f.count];
    if (p === undefined) {
      p = { list: [], keys: [], axes: [], data: [], index: null };
      f.pulls.push(p);
    }
    f.count++;
    const n = list.length;
    p.list.length = n;
    for (let i = 0; i < n; i++) p.list[i] = list[i] as I;
    p.index = null;
    p.keys.length = columns.length;
    p.axes.length = columns.length;
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c] as Column;
      const len = n * col.axes;
      let data = p.data[c];
      if (data === undefined || data.length < len) {
        data = new Float64Array(Math.max(len, 64));
        p.data[c] = data;
      }
      data.set(col.out.subarray(0, len));
      p.keys[c] = col.key;
      p.axes[c] = col.axes;
    }
  }

  /** The subject's last two frames here, latest first, each with the channels pulled for it. */
  frames(subject: I): { at: number; pose: Record<string, unknown> }[] {
    const out: { at: number; pose: Record<string, unknown> }[] = [];
    for (const f of [this.now, this.before]) {
      if (Number.isNaN(f.at)) continue;
      const pose = poseIn(f, subject);
      if (pose !== undefined) out.push({ at: f.at, pose });
    }
    return out;
  }

  clear(): void {
    this.now = frame();
    this.before = frame();
  }
}

/** What a frame's pulls wrote for `subject`, the latest pull first; undefined where none read it. */
function poseIn<I>(f: Frame<I>, subject: I): Record<string, unknown> | undefined {
  let pose: Record<string, unknown> | undefined;
  for (let k = f.count - 1; k >= 0; k--) {
    const p = f.pulls[k] as Pulled<I>;
    if (p.index === null) {
      p.index = new Map();
      for (let i = p.list.length - 1; i >= 0; i--) p.index.set(p.list[i] as I, i);
    }
    const i = p.index.get(subject);
    if (i === undefined) continue;
    pose ??= {};
    for (let c = 0; c < p.keys.length; c++) {
      const key = p.keys[c] as string;
      if (key in pose) continue;
      const axes = p.axes[c] as number;
      const data = p.data[c] as Float64Array;
      const at = i * axes;
      if (axes === 1) {
        const v = data[at] as number;
        if (!Number.isNaN(v)) pose[key] = v;
      } else {
        const v = Array.from(data.subarray(at, at + axes));
        if (!v.some(Number.isNaN)) pose[key] = v;
      }
    }
  }
  return pose;
}
