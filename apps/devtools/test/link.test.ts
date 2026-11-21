import { describe, expect, it, vi } from 'vitest';
import { type LinkPort, link } from '../src/link.js';

class FakePort implements LinkPort {
  sent: string[] = [];
  private msg: ((t: string) => void)[] = [];
  private bye: (() => void)[] = [];
  private gone = false;
  postMessage(text: string) {
    if (this.gone) throw new Error('Attempting to use a disconnected port object');
    this.sent.push(text);
  }
  onMessage = { addListener: (fn: (t: string) => void) => this.msg.push(fn) };
  onDisconnect = { addListener: (fn: () => void) => this.bye.push(fn) };
  deliver(text: string) {
    for (const fn of this.msg) fn(text);
  }
  drop() {
    this.gone = true;
    for (const fn of this.bye) fn();
  }
}

describe("the panel page's link to the worker", () => {
  it('drops a send while its port is reopening, then carries both ways on the new one', () => {
    vi.useFakeTimers();
    try {
      const ports: FakePort[] = [];
      const wire = link(() => {
        const p = new FakePort();
        ports.push(p);
        return p;
      });
      const got: string[] = [];
      wire.listen((t) => got.push(t));
      ports[0]?.drop();
      expect(() => wire.send('lost')).not.toThrow();
      vi.advanceTimersByTime(100);
      wire.send('kept');
      ports[1]?.deliver('back');
      expect(ports[1]?.sent).toEqual(['kept']);
      expect(got).toEqual(['back']);
    } finally {
      vi.useRealTimers();
    }
  });
});
