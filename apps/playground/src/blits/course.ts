import { css } from '@msb235/blits';
import type { Track } from '@pg/widgets/ScoreLanes';
import { compile } from './compile';
import type { Composition } from './composition';
import { FRAME } from './frame';
import type { Mixed } from './kit';
import { Player } from './player';
import type { Subject } from './stage';

/** The channels a track can draw as a line, each read as one number off a pose. */
const NUMBERS: readonly [string, (p: Mixed) => number][] = [
  ['offset x', (p) => p.offset[0] ?? 0],
  ['offset y', (p) => p.offset[1] ?? 0],
  ['turn', (p) => p.turn],
  ['scale', (p) => p.scale],
  ['opacity', (p) => p.opacity],
  ['glow', (p) => p.glow],
];

/**
 * Each voice's and group's track over `c`'s whole length, `n` samples spread evenly across it: its
 * weight, the most any subject takes of it, and for a voice, the channel of its own that moves most
 * on `subject` played alone. A voice that moves only its color gets that color instead.
 */
export function coursesOf(
  c: Composition,
  subjects: readonly Subject[],
  subject = 0,
  n = 241,
): Map<string, Track> {
  const { mix, solos, handles, groupHandles } = compile(c, subjects, { solos: true });
  const weighed = [...handles, ...groupHandles];
  const weights = new Map(weighed.map(([id]) => [id, [] as number[]]));
  const values = new Map([...solos.keys()].map((id) => [id, NUMBERS.map(() => [] as number[])]));
  const colors = new Map([...solos.keys()].map((id) => [id, [] as string[]]));
  const one = subjects[subject] ?? subjects[0];
  const last = Math.max(0, Math.floor(c.length / FRAME + 1e-9));
  const frameOf = (k: number) => Math.round((k / Math.max(1, n - 1)) * last);
  const columns = Player.columnsFor(subjects.length);
  let k = 0;
  // Every frame is played and pulled as the Player plays it: a handle's weight reads the last pull.
  for (let f = 0; f <= last && k < n; f++) {
    const host = f * FRAME;
    for (const m of [mix, ...solos.values()]) {
      m.sync(host);
      m.pull(subjects, columns);
    }
    for (; k < n && frameOf(k) === f; k++) {
      for (const [id, h] of weighed) {
        let w = 0;
        for (const s of subjects) w = Math.max(w, h.weightOf(s));
        weights.get(id)?.push(w);
      }
      if (one === undefined) continue;
      for (const [id, m] of solos) {
        const pose = m.probe(one);
        const rows = values.get(id);
        NUMBERS.forEach(([, read], j) => {
          rows?.[j]?.push(read(pose));
        });
        colors.get(id)?.push(pose.color ? css(pose.color) : 'transparent');
      }
    }
    mix.drain();
    for (const m of solos.values()) m.drain();
  }
  const out = new Map<string, Track>();
  for (const [id, w] of weights) {
    const track: Track = { weights: w };
    let range = 1e-9;
    const rows = values.get(id);
    NUMBERS.forEach(([name], j) => {
      const row = rows?.[j];
      if (!row || row.length === 0) return;
      const r = Math.max(...row) - Math.min(...row);
      if (!(r > range)) return;
      range = r;
      track.channel = name;
      track.values = row;
    });
    const tint = colors.get(id);
    if (track.channel === undefined && tint && new Set(tint).size > 1) {
      track.channel = 'color';
      track.colors = tint;
    }
    out.set(id, track);
  }
  return out;
}
