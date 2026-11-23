import { describe, expect, it } from 'vitest';
import { Frames } from '../src/frames.js';

describe('the frames a transport keeps', () => {
  it('finds the last frame at or before a time, as frames leave the front', () => {
    const frames = new Frames();
    for (let seq = 1; seq <= 5000; seq++) {
      frames.push({ seq, at: seq * 10, u: seq * 10 });
      frames.shed(seq * 10 - 1000);
      expect(frames.length).toBe(Math.min(seq, 101));
      expect(frames.at(seq * 10 + 5)?.seq).toBe(seq);
      const oldest = Math.max(1, seq - 100);
      expect(frames.at(oldest * 10)?.seq).toBe(oldest);
      expect(frames.at(oldest * 10 - 1)?.seq).toBeUndefined();
    }
    expect(frames.all().map((f) => f.seq)).toEqual(Array.from({ length: 101 }, (_, i) => 4900 + i));
  });

  it('hands each frame it lets go of to the caller, oldest first', () => {
    const frames = new Frames();
    for (let seq = 1; seq <= 10; seq++) frames.push({ seq, at: seq, u: seq });
    const shed: number[] = [];
    frames.shed(4.5, (f) => shed.push(f.seq));
    expect(shed).toEqual([1, 2, 3]);
    expect(frames.at(4)?.seq).toBe(4);
    expect(frames.at(3)).toBeUndefined();
  });

  it('holds two frames at one mix time apart, and lands on the later', () => {
    const frames = new Frames();
    frames.push({ seq: 1, at: 0, u: 0 });
    frames.push({ seq: 2, at: 0, u: 16 });
    expect(frames.at(0)?.seq).toBe(2);
  });

  it('lets go of frames held at one mix time however the list was closed up as the hold began', () => {
    const settled = (pauseAt: number) => {
      const frames = new Frames();
      let seq = 0;
      for (let i = 0; i < pauseAt; i++) {
        frames.push({ seq: ++seq, at: 16 * i, u: 16 * i }, 1000);
        frames.shed(16 * i - 1000);
      }
      const held = 16 * (pauseAt - 1);
      for (let i = pauseAt; i < pauseAt + 3000; i++) {
        frames.push({ seq: ++seq, at: held, u: 16 * i }, 1000);
        frames.shed(held - 1000);
      }
      return frames.length;
    };
    const lengths = [];
    for (let p = 560; p < 600; p++) lengths.push(settled(p));
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(40);
  });
});
