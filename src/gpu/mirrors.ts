import { warnOnce } from '../warn.js';
import { type Laid, lay, moved } from './lay.js';
import { Mirror, SHARED } from './mirror.js';
import type { PerSubject } from './runner.js';
import type { GpuBuffer, GpuDevice } from './webgpu.js';

/**
 * Whether `ranges` go up faster as one write of the span from the first to the last, unchanged rows
 * included, than one write each. On teitou a write cost about 1 µs, and one write of a span about
 * 0.5 ms plus 0.075 ms per MB (bench/runs/2026-11-03-gpu-upload*.jsonl).
 */
export function spanned(ranges: readonly (readonly [number, number])[]): boolean {
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  if (first === undefined || last === undefined) return false;
  return ranges.length > 500 + (last[1] - first[0]) / 13_000;
}

/**
 * The GPU side's mirrors, one per motion voice it folds, laid end to end in the `persub` buffer in
 * voice order. All made again when the subject list changes.
 */
export class Mirrors {
  private readonly by = new Map<object, Mirror<unknown>>();
  private list: readonly unknown[] = [];
  /** This frame's mirrors in voice order, and where each starts in `persub`, in f32s. */
  private placed: Laid<Mirror<unknown>>[] = [];
  /** Set where `placed` moved since the last upload, so all of it is written next. */
  private moved = true;
  /** The voices asked for a mirror since the last `place`. */
  private readonly asked = new Set<object>();
  /** f32s the laid-out mirrors take. */
  length = 0;

  /** Whether a mirror's runs changed since its last `prepare`. */
  get stirred(): boolean {
    for (const m of this.by.values()) if (m.stirred) return true;
    return false;
  }

  /** `voice`'s mirror of `list` at `delays`, made where it has none or the list changed. */
  of<I>(
    voice: object,
    p: PerSubject,
    packed: Float32Array,
    list: readonly I[],
    delays: Float64Array | null,
  ): Mirror<I> {
    if (list !== this.list) {
      this.clear();
      this.list = list;
    }
    this.asked.add(voice);
    let m = this.by.get(voice);
    if (m === undefined || m.motions !== p.motions || m.packed !== packed || m.delays !== delays) {
      // A patch has room for one watch: a voice cued again on it hands it over.
      for (const [v, other] of this.by)
        if (other.motions === p.motions) {
          if (v !== voice && this.asked.has(v)) warnOnce(p.motions, SHARED);
          other.detach();
          this.by.delete(v);
        }
      m = new Mirror(p.motions, list, packed, delays);
      this.by.set(voice, m);
    }
    return m as Mirror<I>;
  }

  /**
   * Lays out this frame's mirrors, one per voice or undefined for a voice with none, dropping the
   * rest: each one's offset in `persub` in f32s, 0 for none.
   */
  place(mirrors: readonly (Mirror<unknown> | undefined)[]): number[] {
    this.asked.clear();
    const live = new Set(mirrors.filter((m) => m !== undefined));
    for (const [voice, m] of this.by)
      if (!live.has(m)) {
        m.detach();
        this.by.delete(voice);
      }
    const { placed, offsets, end } = lay(mirrors, 0, (m) => m.rows.length);
    if (moved(this.placed, placed)) this.moved = true;
    this.placed = placed;
    this.length = end;
    return offsets.map((o) => o ?? 0);
  }

  /** Writes the rows that changed to `buffer`, or every row where `full` or the layout moved. */
  upload(device: GpuDevice, buffer: GpuBuffer, full: boolean): void {
    const all = full || this.moved;
    for (const { item: mirror, offset } of this.placed) {
      const ranges = mirror.take();
      if (all) {
        if (mirror.rows.length > 0) device.queue.writeBuffer(buffer, offset * 4, mirror.rows);
        continue;
      }
      if (spanned(ranges)) {
        const from = (ranges[0] as [number, number])[0];
        const to = (ranges[ranges.length - 1] as [number, number])[1];
        device.queue.writeBuffer(buffer, offset * 4 + from, mirror.rows.subarray(from / 4, to / 4));
        continue;
      }
      for (const [from, to] of ranges)
        device.queue.writeBuffer(buffer, offset * 4 + from, mirror.rows.subarray(from / 4, to / 4));
    }
    this.moved = false;
  }

  /** Lets go of every mirror. */
  clear(): void {
    this.asked.clear();
    for (const m of this.by.values()) m.detach();
    this.by.clear();
    this.placed = [];
    this.moved = true;
  }
}
