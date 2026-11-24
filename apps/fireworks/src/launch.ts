import type { Handle, Mix } from '@msb235/blits';
import { AUTO, cue, HISTORY_MS, PACER, type Pose, type Shell, shell } from './show';

/** What a launch hands a shell to: the sparks, the sound, and the pool its whistle comes from. */
export interface LaunchOptions<W> {
  sparks: { attach(s: Shell): void; detach(s: Shell): void };
  sound: { attach(s: Shell, whistle: W): void; detach(s: Shell): void };
  whistles: { borrow(): W | undefined; giveBack(whistle: W): void };
}

export interface Launcher {
  /** Cues a shell and attaches it; the handle is the bloom's. */
  launch(s: Shell): Handle<Shell>;
  /**
   * Call each frame after the mix syncs. It launches a shell for each beat of the voice that keeps
   * launching, once: a beat a seek back plays again gets the shell the mix cues again from its
   * tape, and a new one only where a call since cut that cue off. A shell over gives its whistle
   * back but keeps its sparks until history can no longer reach its end; a seek back into its rise
   * borrows a whistle again.
   */
  tend(): void;
}

interface Flight<W> {
  handle: Handle<Shell>;
  /** Mix time it was launched at, where a replay of the tape cues it again. */
  at: number;
  whistle: W | undefined;
  /** Whether it rose with a whistle, so a replay of the rise asks for one again. */
  whistled: boolean;
  /** Mix time it was first seen over, since it last played. */
  over: number | undefined;
}

/** The beat a shell was launched on: the pacing voice's id and its pass. */
const beatOf = (voice: number, pass: number) => `${voice}:${pass}`;

export function createLauncher<W>(m: Mix<Shell, Pose>, opts: LaunchOptions<W>): Launcher {
  const { sparks, sound, whistles } = opts;
  const flights = new Map<Shell, Flight<W>>();
  /** The shell each beat launched. */
  const beats = new Map<string, Shell>();
  /** Beats played again whose shell the tape has not cued again yet. */
  const owed = new Set<string>();
  const whistle = (s: Shell, f: Flight<W>) => {
    f.whistle = whistles.borrow();
    if (f.whistle !== undefined) sound.attach(s, f.whistle);
  };
  const silence = (s: Shell, f: Flight<W>) => {
    if (f.whistle === undefined) return;
    sound.detach(s);
    whistles.giveBack(f.whistle);
    f.whistle = undefined;
  };
  const launch = (s: Shell): Handle<Shell> => {
    sparks.attach(s);
    const f: Flight<W> = {
      handle: cue(m, s),
      at: m.now,
      whistle: undefined,
      whistled: false,
      over: undefined,
    };
    whistle(s, f);
    f.whistled = f.whistle !== undefined;
    flights.set(s, f);
    return f.handle;
  };
  const pace = () => {
    m.probe(PACER);
    for (const { voice, event } of m.drain<number>(AUTO)) owed.add(beatOf(voice, event));
    let voices: Handle<Shell>[] | undefined;
    for (const key of owed) {
      const was = beats.get(key);
      const f = was === undefined ? undefined : flights.get(was);
      // The tape cues it again in the frame that reaches the mix time it was launched at.
      if (f !== undefined && m.now < f.at) continue;
      owed.delete(key);
      voices ??= m.voices();
      if (f !== undefined && voices.includes(f.handle)) continue;
      const s = shell();
      launch(s);
      beats.set(key, s);
    }
  };
  return {
    launch,
    tend() {
      pace();
      for (const [s, f] of flights) {
        if (f.handle.state !== 'done') {
          f.over = undefined;
          if (f.whistled && f.whistle === undefined) whistle(s, f);
          continue;
        }
        silence(s, f);
        f.over = Math.min(f.over ?? m.now, m.now);
        if (m.now - f.over > HISTORY_MS) {
          sparks.detach(s);
          m.drop(s);
          flights.delete(s);
          for (const [key, b] of beats) if (b === s) beats.delete(key);
        }
      }
    },
  };
}
