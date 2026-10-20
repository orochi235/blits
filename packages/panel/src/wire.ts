import type { Command, Event, Source } from './protocol.js';

/**
 * One end of a channel that carries strings: a `chrome.runtime.Port`, a window bridge, a
 * `MessagePort`. The panel's two halves talk across one when they are not in the same page.
 */
export interface Wire {
  send(text: string): void;
  /** Returns what stops listening. */
  listen(fn: (text: string) => void): () => void;
}

type Message = { e: Event } | { c: Command } | { hello: true };

/** JSON, keeping the numbers JSON has no word for: NaN and the infinities. */
export function encode(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    typeof v === 'number' && !Number.isFinite(v) ? { $n: String(v) } : v,
  );
}

export function decode<T>(text: string): T {
  return JSON.parse(text, (_k, v) =>
    v !== null && typeof v === 'object' && typeof v.$n === 'string' && Object.keys(v).length === 1
      ? Number(v.$n)
      : v,
  ) as T;
}

/**
 * The panel's side of a wire: a `Source` whose events come from `serve` on the other end. Asks
 * the other end for the state as it stands on its first subscriber, so nothing sent before the
 * panel was listening is missed.
 */
export function wireSource(wire: Wire): Source & { refresh(): void; close(): void } {
  const fns = new Set<(event: Event) => void>();
  const stop = wire.listen((text) => {
    const m = decode<Message>(text);
    if ('e' in m) for (const fn of [...fns]) fn(m.e);
  });
  return {
    subscribe(fn) {
      fns.add(fn);
      if (fns.size === 1) wire.send(encode({ hello: true }));
      return () => {
        fns.delete(fn);
      };
    },
    send(command) {
      wire.send(encode({ c: command }));
    },
    /** Asks the other end for its state again, as after it was replaced by a reload. */
    refresh() {
      wire.send(encode({ hello: true }));
    },
    close() {
      stop();
      fns.clear();
    },
  };
}

/** The page's side of a wire: hands `source`'s events across and its commands back. */
export function serve(source: Source, wire: Wire): () => void {
  let off = () => {};
  const listen = () => {
    off();
    off = source.subscribe((e) => wire.send(encode({ e })));
  };
  const stop = wire.listen((text) => {
    const m = decode<Message>(text);
    if ('hello' in m) listen();
    else if ('c' in m) source.send(m.c);
  });
  listen();
  return () => {
    stop();
    off();
  };
}
