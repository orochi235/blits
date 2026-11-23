import { describe, expect, it } from 'vitest';
import { createLauncher } from '../src/launch.js';
import { createShow, HISTORY_MS, type Shell, shell } from '../src/show.js';

/** A launcher on a fresh show, with drivers and a pool of `pool` whistles that log what they're told. */
function setup(pool = 1) {
  const m = createShow();
  const log: string[] = [];
  let free = pool;
  const launcher = createLauncher<string>(m, {
    sparks: {
      attach: () => log.push('sparks on'),
      detach: () => log.push('sparks off'),
    },
    sound: {
      attach: (_s: Shell, w: string) => log.push(`whistle on ${w}`),
      detach: () => log.push('whistle off'),
    },
    whistles: {
      borrow: () => (free > 0 ? `w${free--}` : undefined),
      giveBack: () => {
        free++;
      },
    },
  });
  let host = 0;
  m.sync(host);
  const until = (t: number) => {
    while (m.now < t) {
      host += 50;
      m.sync(host);
      launcher.tend();
    }
  };
  return { m, log, launcher, until, free: () => free };
}

describe('launching a shell', () => {
  it('keeps a finished shell attached, so a seek back into it plays its sparks and whistle', async () => {
    const { m, log, launcher, until, free } = setup();
    const h = launcher.launch(shell(0, 5));
    until(3000);
    await h.done;
    expect(h.state).toBe('done');
    expect(log).not.toContain('sparks off');
    expect(free()).toBe(1);

    log.length = 0;
    m.seek(500);
    until(550);
    expect(h.state).not.toBe('done');
    expect(log).toContain('whistle on w1');
    expect(log).not.toContain('sparks off');
  });

  it('lets a shell go once history can no longer reach its end', () => {
    const { log, launcher, until, free } = setup();
    launcher.launch(shell(0, 5));
    until(2500);
    expect(log).not.toContain('sparks off');
    until(2000 + HISTORY_MS + 200);
    expect(log).toContain('sparks off');
    expect(free()).toBe(1);
  });
});
