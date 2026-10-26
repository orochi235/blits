import type { Handle, Mix } from '@msb235/blits';
import { mix } from '@msb235/blits';
import { createHistory } from '@weasel-js/history';
import { FRAME, type Frame, HISTORY, type Scene, type SceneEvent, type VoiceDef } from './scene';

interface Played<I, O> {
  mix: Mix<I, O>;
  handles: Handle[];
  /** The mix's `seq` after each frame it synced, by frame number; a hidden frame has none. */
  seqs: number[];
}

/** One frame of the mix as it was synced, by frame number: where its clock stood. */
type Nows = number[];

export interface PlayerOptions {
  /** What a debugger lists the main mix as. */
  name?: string;
  /** Explainer ms one run lasts: how far back history has to reach. */
  duration: number;
  /**
   * False for a run nobody watches or scrubs: no history, and every mix off a debugger's list from
   * the start.
   */
  listed?: boolean;
}

/**
 * Plays a scene on one mix for the player's life, frame by frame. Moving back seeks the mix, which
 * keeps history and a tape for the purpose, so the mix a debugger has picked stays the one playing.
 * Where the mix is not where this player left it, because a debugger held, stepped or sought it,
 * the player's time follows the mix.
 */
export class Player<I, O, C> {
  private readonly main: Played<I, O>;
  /** One single-voice mix per voice, played in step, so the ledger can itemize the fold. */
  private readonly solos: Played<I, O>[];
  private readonly subjects: I[];
  private readonly voices: VoiceDef<I, O>[];
  private readonly events: SceneEvent<I, O>[];
  private readonly nows: Nows = [];
  private poses: O[];
  private alone: O[];
  private hidden = false;
  /** Every frame's `record` this run, so a seek back can show the trace as it stood. */
  private history: { t: number; values: number[] }[] = [];
  /** The frame shown, as a count of `FRAME`s from 0; -1 before the first. */
  private k = -1;
  /** The furthest frame played; events up to it are on the tape, and play from there. */
  private reached = -1;
  /** The host clock every sync passes: it only goes forward, wherever the mix is sought. */
  private wall = 0;
  private closed = false;
  /** True while this player is the one calling the mix, so a wake it causes is not a debugger's. */
  private own = false;

  constructor(
    private readonly scene: Scene<I, O, C>,
    private readonly config: C,
    opts: PlayerOptions,
  ) {
    const listed = opts.listed ?? true;
    const options = {
      ...scene.options?.(config),
      ...(listed
        ? {
            history: {
              ms: opts.duration + 1000,
              every: FRAME,
              inputs: true,
              tape: createHistory,
            },
          }
        : {}),
    };
    this.voices = scene.voices(config);
    this.subjects = scene.subjects(config);
    const play = (voices: VoiceDef<I, O>[], name?: string): Played<I, O> => {
      const m = mix<I, O>(scene.kit, { ...options, name });
      return { mix: m, handles: voices.map((v) => m.cue(v.spec)), seqs: [] };
    };
    this.main = play(this.voices, opts.name);
    this.solos = scene.ledger ? this.voices.map((v) => play([v])) : [];
    for (const solo of this.solos) solo.mix.close();
    if (!listed) this.main.mix.close();
    this.events = [...(scene.events?.(config) ?? [])].sort((a, b) => a.at - b.at);
    this.poses = this.subjects.map(() => ({}) as O);
    this.alone = this.voices.map(() => ({}) as O);
  }

  /** Takes the mix off the list a debugger reads, for a player done with. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.main.mix.close();
  }

  /**
   * The frame at `t`: played forward to it, or sought back to it. The frame's own `t` can differ,
   * where a debugger moved the mix and the player followed.
   */
  at(t: number): Frame<I, O> {
    const target = Math.max(0, Math.floor(t / FRAME + 1e-6));
    this.own = true;
    try {
      if (target < this.k) this.back(target);
      while (this.k < target) {
        if (!this.step()) break;
      }
    } finally {
      this.own = false;
    }
    return this.frame();
  }

  /**
   * Calls `fn` when something other than this player wakes the mix: a debugger taking its clock,
   * or setting it going, while the explainer is paused. Returns a function that stops listening.
   */
  onWoken(fn: () => void): () => void {
    return this.main.mix.onWake(() => {
      if (!this.own) fn();
    });
  }

  /**
   * The frame the mix is at, where a debugger moved it since the last frame this player played;
   * null where it is where the player left it.
   */
  moved(): Frame<I, O> | null {
    const kept = this.nows[this.k];
    const now = this.main.mix.now;
    if (kept === undefined || Number.isNaN(now) || Math.abs(now - kept) <= 0.5) return null;
    this.follow(now);
    return this.frame();
  }

  private frame(): Frame<I, O> {
    return {
      t: Math.max(0, this.k) * FRAME,
      subjects: this.subjects,
      poses: this.poses,
      voices: this.voices,
      alone: this.alone,
      handles: this.main.handles,
      history: this.history.length > HISTORY ? this.history.slice(-HISTORY) : this.history,
      hidden: this.hidden,
    };
  }

  /** Plays one frame on; false where the mix was found elsewhere and the player followed it. */
  private step(): boolean {
    const { scene, config } = this;
    const k = this.k + 1;
    const t = k * FRAME;
    let ran = false;
    if (k > this.reached) {
      for (const e of this.events) {
        if (e.at > t - FRAME && e.at <= t) {
          ran = true;
          e.run(this.main.mix, this.main.handles);
          this.solos.forEach((solo, i) => {
            const only = this.main.handles.map((_, j) => (j === i ? solo.handles[0] : inert));
            e.run(solo.mix, only as Handle[], i);
          });
        }
      }
    }
    this.k = k;
    this.reached = Math.max(this.reached, k);
    // A hidden frame passes on the host's clock too; only the sync is missing.
    this.wall += FRAME;
    if (scene.syncing && !scene.syncing(t, config)) {
      this.hidden = true;
      this.keep(t);
      return true;
    }
    this.hidden = false;
    const before = this.lastNow(k - 1);
    for (const p of [this.main, ...this.solos]) {
      p.mix.sync(this.wall);
      p.seqs[k] = p.mix.seq;
    }
    const now = this.main.mix.now;
    const planned =
      this.nows[k] ?? (ran || before === undefined ? now : before.now + (k - before.k) * FRAME);
    if (Math.abs(now - planned) > 0.5) return this.follow(now);
    this.nows[k] = now;
    this.read(t);
    this.keep(t);
    return true;
  }

  /** The last frame at or before `k` that synced, and where the mix's clock stood then. */
  private lastNow(k: number): { k: number; now: number } | undefined {
    for (let j = k; j >= 0; j--) {
      const now = this.nows[j];
      if (now !== undefined) return { k: j, now };
    }
    return undefined;
  }

  /** Moves the player to the frame the mix's clock says, after a debugger moved it. */
  private follow(now: number): false {
    let k = Math.floor(now / FRAME + 1e-6);
    for (let j = this.nows.length - 1; j >= 0; j--) {
      const n = this.nows[j];
      if (n !== undefined && n <= now + 0.5) {
        k = j + Math.max(0, Math.floor((now - n) / FRAME + 1e-6));
        break;
      }
    }
    this.forget(k);
    this.k = k;
    this.nows[k] = now;
    for (const p of [this.main, ...this.solos]) p.seqs[k] = p.mix.seq;
    this.read(k * FRAME, true);
    return false;
  }

  /** Seeks every mix back to frame `k`, or to the last one before it that synced. */
  private back(k: number): void {
    const last = this.lastNow(k);
    if (last === undefined || this.main.seqs[last.k] === undefined) return;
    for (const p of [this.main, ...this.solos]) {
      const s = p.seqs[last.k];
      if (s !== undefined) p.mix.seek({ frame: s });
    }
    this.forget(last.k);
    this.k = k;
    this.hidden = !!this.scene.syncing && !this.scene.syncing(k * FRAME, this.config);
    this.read(last.k * FRAME, true);
    // The frames between were hidden: the trace held what the last synced frame showed.
    for (let j = last.k + 1; j <= k; j++) this.keep(j * FRAME);
  }

  /** Lets go of what was kept after frame `k`: a seek back to it replaces those frames. */
  private forget(k: number): void {
    this.nows.length = Math.min(this.nows.length, k + 1);
    for (const p of [this.main, ...this.solos]) p.seqs.length = Math.min(p.seqs.length, k + 1);
    const t = k * FRAME;
    this.history = this.history.filter((h) => h.t <= t);
  }

  /**
   * Probes each subject the host asks about at `t`. After a move, one it does not ask about shows
   * what it did the last frame it was asked about, read back through `project`.
   */
  private read(t: number, moved = false): void {
    const { scene, config } = this;
    this.subjects.forEach((s, i) => {
      if (!scene.probing || scene.probing(t, s, config)) {
        this.poses[i] = this.main.mix.probe(s, {} as O);
        return;
      }
      if (!moved) return;
      for (let j = Math.floor(t / FRAME + 1e-6) - 1; j >= 0; j--) {
        const seq = this.main.seqs[j];
        if (seq === undefined || !scene.probing(j * FRAME, s, config)) continue;
        this.poses[i] = this.main.mix.project({ frame: seq }).probe(s, {} as O);
        return;
      }
    });
    if (scene.ledger) {
      const focus = scene.ledger.subject(this.subjects);
      this.solos.forEach((solo, i) => {
        this.alone[i] = solo.mix.probe(focus, {} as O);
      });
    }
  }

  private keep(t: number): void {
    if (!this.scene.record) return;
    this.history.push({
      t,
      values: this.scene.record(
        { t, subjects: this.subjects, poses: this.poses, alone: this.alone },
        this.config,
      ),
    });
  }
}

/** One voice across a run: its weight, and the channel of its own that moves most, if one does. */
export interface Course {
  weights: number[];
  channel?: string;
  /** That channel's value with the voice alone, for the ledger's subject, at the same times. */
  values?: number[];
}

/**
 * Each voice across a run, at `n` evenly spaced times from 0 to `duration`. Its weight is the
 * largest it has for any subject, so a stagger or a voice reaching a few subjects still shows.
 */
export function coursesOver<I, O, C>(
  scene: Scene<I, O, C>,
  config: C,
  duration: number,
  n = 240,
): Course[] {
  const player = new Player(scene, config, { duration, listed: false });
  const voices = scene.voices(config);
  const weights = voices.map(() => [] as number[]);
  const channels = scene.ledger?.channels ?? [];
  // Per voice, per ledger channel: its numeric values, or null once one was not a number.
  const values = voices.map(() => channels.map((): number[] | null => []));
  for (let k = 0; k < n; k++) {
    const f = player.at((k / (n - 1)) * duration);
    f.handles.forEach((h, i) => {
      let w = 0;
      for (const s of f.subjects) w = Math.max(w, h.weightOf(s));
      weights[i]?.push(w);
      const alone = (f.alone[i] ?? {}) as Record<string, unknown>;
      channels.forEach((c, j) => {
        const row = values[i]?.[j];
        if (row === null || row === undefined) return;
        const v = alone[c];
        if (typeof v === 'number') row.push(v);
        else if (v !== undefined) (values[i] as (number[] | null)[])[j] = null;
      });
    });
  }
  return voices.map((_, i) => {
    let best: { channel: string; values: number[]; range: number } | undefined;
    channels.forEach((c, j) => {
      const row = values[i]?.[j];
      if (!row || row.length < n) return;
      const range = Math.max(...row) - Math.min(...row);
      if (range > 1e-9 && (best === undefined || range > best.range))
        best = { channel: c, values: row, range };
    });
    const out: Course = { weights: weights[i] ?? [] };
    if (best) {
      out.channel = best.channel;
      out.values = best.values;
    }
    return out;
  });
}
