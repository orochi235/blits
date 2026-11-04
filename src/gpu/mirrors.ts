import { Mirror } from './mirror.js';
import type { PerSubject } from './runner.js';
import type { GpuBuffer, GpuDevice } from './webgpu.js';

/**
 * The GPU side's mirrors, one per motion voice it folds, laid end to end in the `persub` buffer in
 * voice order. All made again when the subject list changes.
 */
export class Mirrors {
  private readonly by = new Map<object, Mirror<unknown>>();
  private list: readonly unknown[] = [];
  /** This frame's mirrors in voice order, and where each starts in `persub`, in f32s. */
  private placed: { mirror: Mirror<unknown>; offset: number }[] = [];
  /** Set where `placed` moved since the last upload, so all of it is written next. */
  private moved = true;
  /** f32s the laid-out mirrors take. */
  length = 0;

  /** Whether a mirror's runs changed since its last `prepare`. */
  get stirred(): boolean {
    for (const m of this.by.values()) if (m.stirred) return true;
    return false;
  }

  /** `voice`'s mirror of `list`, made where it has none or the list changed. */
  of<I>(voice: object, p: PerSubject, packed: Float32Array, list: readonly I[]): Mirror<I> {
    if (list !== this.list) {
      this.clear();
      this.list = list;
    }
    let m = this.by.get(voice);
    if (m === undefined || m.motions !== p.motions) {
      m?.detach();
      m = new Mirror(p.motions, list, packed);
      this.by.set(voice, m);
    }
    return m as Mirror<I>;
  }

  /**
   * Lays out this frame's mirrors, one per voice or undefined for a voice with none, dropping the
   * rest: each one's offset in `persub` in f32s, 0 for none.
   */
  place(mirrors: readonly (Mirror<unknown> | undefined)[]): number[] {
    const live = new Set(mirrors.filter((m) => m !== undefined));
    for (const [voice, m] of this.by)
      if (!live.has(m)) {
        m.detach();
        this.by.delete(voice);
      }
    const placed: { mirror: Mirror<unknown>; offset: number }[] = [];
    let at = 0;
    const offsets = mirrors.map((m) => {
      if (m === undefined) return 0;
      const offset = at;
      placed.push({ mirror: m, offset });
      at += m.rows.length;
      return offset;
    });
    const was = this.placed;
    if (
      placed.length !== was.length ||
      placed.some((p, k) => p.mirror !== was[k]?.mirror || p.offset !== was[k]?.offset)
    )
      this.moved = true;
    this.placed = placed;
    this.length = at;
    return offsets;
  }

  /** Writes the rows that changed to `buffer`, or every row where `full` or the layout moved. */
  upload(device: GpuDevice, buffer: GpuBuffer, full: boolean): void {
    const all = full || this.moved;
    for (const { mirror, offset } of this.placed) {
      const ranges = mirror.take();
      if (all) {
        if (mirror.rows.length > 0) device.queue.writeBuffer(buffer, offset * 4, mirror.rows);
        continue;
      }
      for (const [from, to] of ranges)
        device.queue.writeBuffer(buffer, offset * 4 + from, mirror.rows.subarray(from / 4, to / 4));
    }
    this.moved = false;
  }

  /** Lets go of every mirror. */
  clear(): void {
    for (const m of this.by.values()) m.detach();
    this.by.clear();
    this.placed = [];
    this.moved = true;
  }
}
