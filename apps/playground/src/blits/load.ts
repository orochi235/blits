import type { Composition } from './composition';
import { CHANNELS } from './kit';

type Rec = Record<string, unknown>;

const obj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';
const opt = (v: unknown, ok: (v: unknown) => boolean) => v === undefined || ok(v);
const expr = (v: unknown) => obj(v) && str(v.code);
const count = (v: unknown) => Number.isInteger(v) && (v as number) > 0;
const channel = (v: unknown) => CHANNELS.includes(v as never);
const oneOf =
  (...xs: unknown[]) =>
  (v: unknown) =>
    xs.includes(v);

const easing = (v: unknown) =>
  oneOf('linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out')(v) ||
  (obj(v) && Array.isArray(v.bezier) && v.bezier.length === 4 && v.bezier.every(num)) ||
  (obj(v) && count(v.steps) && opt(v.jump, oneOf('start', 'end')));

const stop = (v: unknown) => obj(v) && num(v.at) && obj(v.delta) && opt(v.ease, easing);
const option = (v: unknown) => num(v) || (Array.isArray(v) && v.every(num)) || expr(v);

function patch(p: unknown): boolean {
  if (!obj(p)) return false;
  switch (p.kind) {
    case 'keys':
      return num(p.period) && Array.isArray(p.stops) && p.stops.every(stop) && opt(p.ease, easing);
    case 'fn':
      return (
        num(p.period) &&
        Array.isArray(p.writes) &&
        p.writes.every(channel) &&
        str(p.at) &&
        opt(p.state, str) &&
        opt(p.step, str)
      );
    case 'spring':
    case 'glide':
    case 'tween':
      return (
        channel(p.channel) &&
        obj(p.opts) &&
        Object.values(p.opts).every(option) &&
        opt(p.ease, easing)
      );
    default:
      return false;
  }
}

const fade = (v: unknown) => obj(v) && opt(v.in, num) && opt(v.out, num) && opt(v.ease, easing);
// blits answers an anchor it cannot place by leaving the voice pending, so only the shape is checked.
const placement = (v: unknown) => obj(v) && Object.values(v).every((x) => num(x) || obj(x));

const voice = (v: unknown) =>
  obj(v) &&
  str(v.id) &&
  str(v.name) &&
  num(v.hue) &&
  num(v.start) &&
  num(v.rate) &&
  (typeof v.loop === 'boolean' || num(v.loop)) &&
  (num(v.weight) || expr(v.weight)) &&
  fade(v.fade) &&
  patch(v.patch) &&
  opt(v.stagger, expr) &&
  opt(v.target, expr) &&
  opt(v.hold, oneOf('before', 'after', 'both')) &&
  opt(v.locus, str) &&
  opt(v.from, oneOf('current')) &&
  opt(v.anchor, placement);

const level = (v: unknown) => obj(v) && str(v.name) && num(v.value) && num(v.min) && num(v.max);

const stage = (v: unknown) =>
  obj(v) &&
  ((v.kind === 'dots' && count(v.cols) && count(v.rows)) || (v.kind === 'letters' && str(v.text)));

/** `raw` as a composition when it is a version 1 one of the right shape, else null. */
export function load(raw: unknown): Composition | null {
  if (!obj(raw) || raw.version !== 1) return null;
  if (!str(raw.title) || !num(raw.length) || raw.length < 0 || !stage(raw.stage)) return null;
  if (!Array.isArray(raw.levels) || !raw.levels.every(level)) return null;
  if (!Array.isArray(raw.voices) || !raw.voices.every(voice)) return null;
  const ids = new Set(raw.voices.map((v) => (v as Rec).id));
  if (ids.size !== raw.voices.length) return null;
  return raw as unknown as Composition;
}

// base64url: plain base64's `+` would come back from URLSearchParams as a space.
export function toHash(c: Composition): string {
  const b64 = btoa(encodeURIComponent(JSON.stringify(c)));
  return `c=${b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/** The composition a `#c=…` hash carries, or null when it carries none that loads. */
export function fromHash(hash: string): Composition | null {
  const c = new URLSearchParams(hash.replace(/^#/, '')).get('c');
  if (!c) return null;
  try {
    return load(JSON.parse(decodeURIComponent(atob(c.replace(/-/g, '+').replace(/_/g, '/')))));
  } catch {
    return null;
  }
}
