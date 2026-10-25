import { first } from './clone.js';
import { open as openRecord } from './everyone.js';
import { merged, unband } from './fold.js';
import type { Lanes } from './lanes.js';
import { locusScratch } from './locus.js';
import type { Mixer } from './mixer.js';
import type { Subject } from './subject.js';
import type { Channel } from './types.js';
import type { Voice } from './voice.js';

// V8 reads a local const as a constant, where it reads an import from its module on every call.
const open = openRecord;

/**
 * Whether a fold's next voice is its chain's next record, `held`, and not the next voice sharing
 * one record, `sharers[q]`: the two lists are each in voice order, and a fold takes them as one.
 */
export function chainFirst<I, O>(
  held: Subject<unknown> | null,
  sharers: readonly Voice<I, O>[],
  q: number,
): boolean {
  if (held === null) return false;
  if (q >= sharers.length || held.voice === null) return true;
  const next = sharers[q] as Voice<I, O>;
  return next.id > (held.voice as Voice<I, O>).id;
}

/** `foldWith`'s voices with a locus in play: each locus folds at its first member's place. */
export function foldLoci<I, O>(
  this: Mixer<I, O>,
  subject: I,
  pose: Record<string, unknown>,
  head: Subject<unknown>,
  laned: boolean,
  dry: boolean,
  except: number | undefined,
  owed: number,
): O {
  const now = this.now;
  // A patch reading the pose can fold again from inside this one, so each depth has its own.
  let k = this.locusScratch[this.locusDepth];
  if (k === undefined) {
    k = locusScratch<I, O>(this.channels.length);
    this.locusScratch[this.locusDepth] = k;
  }
  this.locusDepth++;
  try {
    k.n = 0;
    k.m = 0;
    k.names.length = 0;
    const sharers = this.sharers;
    let q = 0;
    let at: Subject<unknown> | null = head;
    while (at !== null || q < sharers.length) {
      const mine = chainFirst(at, sharers, q);
      let voice: Voice<I, O> | null;
      let rec: Subject<unknown> | null;
      if (mine) {
        rec = at as Subject<unknown>;
        voice = rec.voice as Voice<I, O> | null;
        at = rec.next;
      } else {
        voice = sharers[q++] as Voice<I, O>;
        rec = voice.state === 'pending' ? null : voice.everyone;
      }
      if (voice === null || rec === null) continue;
      if (laned && voice.laned && !this.owedBy(owed, voice)) continue;
      if (voice.id === except || voice.state === 'done') continue;
      const held: Subject<unknown> = rec;
      if (!mine) open(voice, held, head.slot);
      const delta = this.read(voice, subject, now, dry, held);
      if (owed >= 0 && voice.laned) (this.lanes as Lanes<I, O>).paid(voice.id, owed, held.weight);
      if (!mine) q = this.shared(voice, head.slot, held, q);
      if (delta === null) continue;
      const locus = voice.spec.locus;
      let group = -1;
      if (locus !== undefined) {
        group = k.names.indexOf(locus);
        const m = k.m++;
        k.mVoices[m] = voice;
        k.mDeltas[m] = delta;
        k.mWeights[m] = this.w;
        if (group >= 0) {
          k.mGroups[m] = group;
          continue;
        }
        group = k.names.length;
        k.names.push(locus);
        k.mGroups[m] = group;
      }
      const n = k.n++;
      k.voices[n] = voice;
      k.helds[n] = held;
      k.deltas[n] = delta;
      k.weights[n] = locus === undefined ? this.w : 0;
      k.groups[n] = group;
    }

    let bands = head.loci;
    if (bands === null) {
      bands = new Map();
      head.loci = bands;
    }

    for (let n = 0; n < k.n; n++) {
      const group = k.groups[n] as number;
      if (group < 0) {
        const weight = k.weights[n] as number;
        if (weight > 0)
          this.apply(
            pose,
            k.voices[n] as Voice<I, O>,
            k.helds[n] as Subject<unknown>,
            k.deltas[n] as Record<string, unknown>,
            weight,
          );
        else unband(k.helds[n]);
        continue;
      }
      const weight = this.foldLocus(k, group);
      const name = k.names[group] as string;
      if (!(weight > 0)) {
        bands.get(name)?.fill(2);
        continue;
      }
      let on = bands.get(name);
      if (on === undefined) {
        on = new Uint8Array(this.channels.length);
        bands.set(name, on);
      }
      for (let t = 0; t < k.touched.length; t++) {
        const slot = k.touched[t] as number;
        const value = k.values[slot];
        k.values[slot] = undefined;
        const key = this.names[slot] as string;
        const channel = this.channels[slot] as Channel<unknown>;
        // A channel folds at the weight of the members that wrote it, not the whole locus.
        const taken = k.taken[slot] as number;
        const w = taken > 1 ? 1 : taken;
        if (channel.rest !== undefined && channel.scale) {
          // pose[key] is the copy of rest this fold made, so it is ours to write into.
          pose[key] = channel.fold
            ? channel.fold(pose[key], value, w)
            : merged(channel, pose[key], channel.scale(value, w));
          continue;
        }
        const band = on[slot] as number;
        const passes = this.passes(band === 0 ? undefined : band === 1, w);
        on[slot] = passes ? 1 : 2;
        if (passes)
          pose[key] = pose[key] === undefined ? first(value) : merged(channel, pose[key], value);
      }
    }
    return pose as O;
  } finally {
    for (let n = 0; n < k.n; n++) {
      k.voices[n] = null;
      k.helds[n] = null;
      k.deltas[n] = null;
    }
    for (let m = 0; m < k.m; m++) {
      k.mVoices[m] = null;
      k.mDeltas[m] = null;
    }
    // Left set only where a channel's lerp threw partway, which the next fold must not inherit.
    for (let t = 0; t < k.touched.length; t++) {
      const slot = k.touched[t] as number;
      k.met[slot] = 0;
      k.values[slot] = undefined;
    }
    k.touched.length = 0;
    this.locusDepth--;
  }
}
