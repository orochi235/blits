import type { Handle, Mix } from '@msb235/blits';
import { cue, HISTORY_MS, type Pose, type Shell } from './show';

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
   * Call each frame after the mix syncs. A shell over gives its whistle back but keeps its sparks
   * until history can no longer reach its end; a seek back into its rise borrows a whistle again.
   */
  tend(): void;
}

interface Flight<W> {
  handle: Handle<Shell>;
  whistle: W | undefined;
  /** Whether it rose with a whistle, so a replay of the rise asks for one again. */
  whistled: boolean;
  /** Mix time it was first seen over, since it last played. */
  over: number | undefined;
}

export function createLauncher<W>(m: Mix<Shell, Pose>, opts: LaunchOptions<W>): Launcher {
  const { sparks, sound, whistles } = opts;
  const flights = new Map<Shell, Flight<W>>();
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
  return {
    launch(s) {
      sparks.attach(s);
      const f: Flight<W> = {
        handle: cue(m, s),
        whistle: undefined,
        whistled: false,
        over: undefined,
      };
      whistle(s, f);
      f.whistled = f.whistle !== undefined;
      flights.set(s, f);
      return f.handle;
    },
    tend() {
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
        }
      }
    },
  };
}
