import type { Handle } from '@msb235/blits';
import type { Finding } from '@stress/scenario';

/** Frames a voice may be `done` before its promise must have resolved. */
const GRACE = 60;

/**
 * Counts each handle's `done` resolutions as promises settle. A handle may resolve again only after
 * a seek back has revived it; resolving while still resolved, or staying resolved after the voice
 * is live again, is a fail. The host must yield between frames for the `.then` handlers to run.
 */
export function doneWatch<I>(handles: readonly Handle<I>[]) {
  const hooked = new Map<number, Promise<void>>();
  const resolved = new Set<Promise<void>>();
  const standing = new Set<number>();
  const doneSince = new Map<number, number>();
  const flagged = new Set<string>();
  const found: Finding[] = [];
  let resolutions = 0;
  let renewed = 0;

  function flag(key: string, f: number, what: string): void {
    if (flagged.has(key)) return;
    flagged.add(key);
    found.push({ kind: 'fail', at: f, what });
  }

  function hook(h: Handle<I>, f: number): Promise<void> {
    const p = h.done;
    if (hooked.get(h.id) === p) return p;
    if (hooked.has(h.id)) renewed++;
    hooked.set(h.id, p);
    p.then(() => {
      resolved.add(p);
      resolutions++;
      if (standing.has(h.id)) {
        flag(
          `twice${h.id}`,
          f,
          `voice ${h.id} resolved done a second time without a seek back reviving it`,
        );
      }
      standing.add(h.id);
    });
    return p;
  }

  /** Looks at every handle after frame `f`'s sync. */
  function scan(f: number): void {
    for (const h of handles) {
      const p = hook(h, f);
      const state = h.state;
      if (state === 'done') {
        const since = doneSince.get(h.id) ?? f;
        doneSince.set(h.id, since);
        if (f - since > GRACE && !resolved.has(p)) {
          flag(
            `late${h.id}`,
            f,
            `voice ${h.id} has been done for ${f - since} frames and its done never resolved`,
          );
        }
        continue;
      }
      doneSince.delete(h.id);
      if (resolved.has(p)) {
        flag(
          `stale${h.id}`,
          f,
          `voice ${h.id} is ${state} again after a seek back, but its done is still resolved`,
        );
      } else standing.delete(h.id);
    }
  }

  return { scan, findings: () => found, stats: () => ({ resolutions, renewed }) };
}
