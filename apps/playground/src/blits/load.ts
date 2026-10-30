import { placementFault } from './anchor';
import {
  type Composition,
  type Level,
  MAX_AHEAD,
  MAX_ANNOUNCED,
  MAX_COLS,
  MAX_GROUPS,
  MAX_HITS,
  MAX_LENGTH,
  MAX_LEVELS,
  MAX_MARKS,
  MAX_ROWS,
  MAX_TAGS,
  MAX_TEXT,
  MAX_VOICES,
} from './composition';
import { CSS } from './easing';
import { levelsOk } from './edit';
import { parentOf, treeFault } from './groups';
import { CHANNELS, SWINGS } from './kit';

type Rec = Record<string, unknown>;

const obj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';
const opt = (v: unknown, ok: (v: unknown) => boolean) => v === undefined || ok(v);
const expr = (v: unknown) => obj(v) && str(v.code);
const count = (v: unknown, max = Infinity) =>
  Number.isInteger(v) && (v as number) > 0 && (v as number) <= max;
const channel = (v: unknown) => CHANNELS.includes(v as never);
const oneOf =
  (...xs: unknown[]) =>
  (v: unknown) =>
    xs.includes(v);

const easing = (v: unknown) =>
  v === 'linear' ||
  (str(v) && Object.hasOwn(CSS, v)) ||
  (obj(v) && Array.isArray(v.bezier) && v.bezier.length === 4 && v.bezier.every(num)) ||
  (obj(v) && count(v.steps) && opt(v.jump, oneOf('start', 'end')));

const byChannel = (ok: (v: unknown) => boolean) => (v: unknown) =>
  obj(v) && Object.entries(v).every(([k, x]) => channel(k) && ok(x));
const stop = (v: unknown) => obj(v) && num(v.at) && obj(v.delta) && opt(v.ease, easing);
const option = (v: unknown) => num(v) || (Array.isArray(v) && v.every(num)) || expr(v);

function patch(p: unknown): boolean {
  if (!obj(p)) return false;
  switch (p.kind) {
    case 'keys':
      return (
        num(p.period) &&
        Array.isArray(p.stops) &&
        p.stops.every(stop) &&
        opt(p.ease, easing) &&
        opt(p.easeBy, byChannel(easing)) &&
        opt(p.delayBy, byChannel(num))
      );
    case 'fn':
      return (
        num(p.period) &&
        Array.isArray(p.writes) &&
        p.writes.every(channel) &&
        str(p.at) &&
        opt(p.state, str) &&
        opt(p.step, str)
      );
    case 'wave':
      return (
        num(p.period) &&
        oneOf('sine', 'triangle', 'saw', 'square')(p.shape) &&
        num(p.cycles) &&
        num(p.phase) &&
        obj(p.depth) &&
        Object.entries(p.depth).every(([k, d]) => SWINGS.includes(k as never) && num(d))
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
const placement = (v: unknown) => placementFault(v) === null;
const texts = (max: number) => (v: unknown) => Array.isArray(v) && v.length <= max && v.every(str);
const hit = (v: unknown) => obj(v) && num(v.at) && v.at >= 0 && str(v.event);
const announced = (v: unknown) =>
  obj(v) && str(v.name) && num(v.at) && opt(v.score, str) && opt(v.tags, texts(MAX_TAGS));

const bool = (v: unknown) => typeof v === 'boolean';
const freeze = oneOf('before', 'after', 'both');
const strength = oneOf('weak', 'strong', 'required');
const hints = (v: unknown) =>
  obj(v) &&
  opt(v.faster, num) &&
  opt(v.slower, num) &&
  opt(v.overlap, bool) &&
  opt(v.ballast, bool) &&
  opt(v.priority, strength);

/** A voice's or group's `tags`, `score`, `hits`, and `marks`. */
const marked = (v: Rec) =>
  opt(v.tags, texts(MAX_TAGS)) &&
  opt(v.score, str) &&
  opt(v.hits, (x) => Array.isArray(x) && x.length <= MAX_HITS && x.every(hit)) &&
  opt(
    v.marks,
    (x) =>
      obj(x) &&
      Object.keys(x).length <= MAX_MARKS &&
      Object.values(x).every((at) => num(at) && at >= 0),
  );

const voice = (v: unknown) =>
  obj(v) &&
  str(v.id) &&
  str(v.name) &&
  num(v.hue) &&
  num(v.start) &&
  num(v.rate) &&
  opt(v.seek, num) &&
  opt(v.stepMs, (x) => num(x) && x >= 0) &&
  opt(v.catchUp, oneOf('exact', 'fresh')) &&
  (bool(v.loop) || num(v.loop)) &&
  (num(v.weight) || expr(v.weight)) &&
  fade(v.fade) &&
  patch(v.patch) &&
  opt(v.stagger, expr) &&
  opt(v.target, expr) &&
  opt(v.freeze, freeze) &&
  opt(v.hold, freeze) &&
  opt(v.role, str) &&
  opt(v.locus, str) &&
  opt(v.from, oneOf('current')) &&
  opt(v.anchor, placement) &&
  opt(v.owner, str) &&
  opt(v.hints, hints) &&
  marked(v);

const fitStep = (v: unknown) =>
  obj(v) &&
  (oneOf('condense', 'shed', 'conclude')(v.kind) ||
    (v.kind === 'overrun' && opt(v.cap, num)) ||
    (v.kind === 'code' && str(v.code)));
const spanSettings = (v: unknown) =>
  obj(v) &&
  opt(v.duration, num) &&
  opt(v.priority, strength) &&
  opt(v.order, oneOf('queue', 'stagger', 'together')) &&
  opt(v.share, (x) => num(x) && x >= 0 && x <= 1) &&
  opt(v.spill, oneOf('instant', 'overrun')) &&
  opt(v.fit, (x) => Array.isArray(x) && x.every(fitStep));

const group = (v: unknown) =>
  obj(v) &&
  str(v.id) &&
  str(v.name) &&
  num(v.hue) &&
  oneOf('owner', 'span')(v.kind) &&
  opt(v.owner, str) &&
  num(v.start) &&
  num(v.rate) &&
  opt(v.seek, num) &&
  (num(v.weight) || expr(v.weight)) &&
  fade(v.fade) &&
  opt(v.freeze, freeze) &&
  opt(v.anchor, placement) &&
  opt(v.hints, hints) &&
  marked(v) &&
  (v.kind === 'span' ? opt(v.span, spanSettings) : v.span === undefined);

/** Whether the groups' `owner` links make a tree that blits can cue. */
function groupsOk(c: Composition): boolean {
  const groups = c.groups ?? [];
  const ids = [...c.voices, ...groups].map((x) => x.id);
  if (new Set(ids).size !== ids.length || treeFault(c) !== null) return false;
  return !groups.some((g) => g.kind === 'owner' && parentOf(c, g.id)?.kind === 'span');
}

const level = (v: unknown) => obj(v) && str(v.name) && num(v.value) && num(v.min) && num(v.max);

const stage = (v: unknown) =>
  obj(v) &&
  ((v.kind === 'dots' && count(v.cols, MAX_COLS) && count(v.rows, MAX_ROWS)) ||
    (v.kind === 'letters' && str(v.text) && [...v.text].length <= MAX_TEXT));

const positive = (v: unknown) => num(v) && v > 0;
const mixSettings = (v: unknown) =>
  obj(v) &&
  opt(v.stepMs, (x) => x === 'off' || positive(x)) &&
  opt(v.maxDt, positive) &&
  opt(v.reduce, (x) => typeof x === 'boolean') &&
  opt(v.lanes, (x) => typeof x === 'boolean');

const bookSettings = (v: unknown) =>
  obj(v) && opt(v.ahead, (x) => num(x) && x >= 0 && x <= MAX_AHEAD);

const bounds = (v: unknown) =>
  Array.isArray(v) && v.length === 2 && v.every(num) && (v[0] as number) < (v[1] as number);
const numberRule =
  (...rules: string[]) =>
  (v: unknown) =>
    obj(v) &&
    rules.includes(v.rule as string) &&
    opt(v.bounds, bounds) &&
    !(v.rule === 'last' && v.bounds !== undefined);
const NUMBER_RULES = ['sum', 'mul', 'max', 'last'];
const RULE_CHECKS: Record<string, (v: unknown) => boolean> = {
  offset: numberRule('sum', 'mul', 'max'),
  turn: numberRule(...NUMBER_RULES),
  scale: numberRule(...NUMBER_RULES),
  opacity: numberRule(...NUMBER_RULES),
  glow: numberRule(...NUMBER_RULES),
  color: (v) =>
    obj(v) &&
    oneOf('replace', 'average')(v.rule) &&
    (v.path === undefined ? oneOf('oklch', 'oklab')(v.lerp) : oneOf('hue', 'linear')(v.path)),
};
const rules = (v: unknown) =>
  obj(v) && Object.entries(v).every(([ch, r]) => RULE_CHECKS[ch]?.(r) === true);

/** `raw` as a composition when it is a version 1 one of the right shape, else null. */
export function load(raw: unknown): Composition | null {
  if (!obj(raw) || raw.version !== 1) return null;
  if (!str(raw.title) || !num(raw.length) || raw.length <= 0 || raw.length > MAX_LENGTH)
    return null;
  if (!stage(raw.stage)) return null;
  if (!opt(raw.mix, mixSettings) || !opt(raw.book, bookSettings) || !opt(raw.rules, rules))
    return null;
  if (
    !opt(raw.announced, (a) => Array.isArray(a) && a.length <= MAX_ANNOUNCED && a.every(announced))
  )
    return null;
  if (!opt(raw.blends, (b) => obj(b) && Object.values(b).every(expr))) return null;
  const { levels, voices } = raw;
  if (!Array.isArray(levels) || levels.length > MAX_LEVELS || !levels.every(level)) return null;
  if (!levelsOk(levels as Level[])) return null;
  if (!Array.isArray(voices) || voices.length > MAX_VOICES || !voices.every(voice)) return null;
  const { groups } = raw;
  if (!opt(groups, (g) => Array.isArray(g) && g.length <= MAX_GROUPS && g.every(group)))
    return null;
  if (!groupsOk(raw as unknown as Composition)) return null;
  // Saved and shared before blits named it `path`.
  const color = (raw.rules as Rec | undefined)?.color as Rec | undefined;
  if (color !== undefined && 'lerp' in color) {
    color.path ??= color.lerp === 'oklch' ? 'hue' : 'linear';
    delete color.lerp;
  }
  // Saved and shared before blits named them `freeze` and `role`.
  for (const v of voices as Rec[]) {
    if ('hold' in v) {
      v.freeze ??= v.hold;
      delete v.hold;
    }
    if ('locus' in v) {
      v.role ??= v.locus;
      delete v.locus;
    }
  }
  return raw as unknown as Composition;
}

// base64url of the UTF-8 bytes: plain base64's `+` would come back from URLSearchParams as a space.
export function toHash(c: Composition): string {
  let bin = '';
  for (const b of new TextEncoder().encode(JSON.stringify(c))) bin += String.fromCharCode(b);
  return `c=${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/** The composition a `#c=…` hash carries, or null when it carries none that loads. */
export function fromHash(hash: string): Composition | null {
  const c = new URLSearchParams(hash.replace(/^#/, '')).get('c');
  if (!c) return null;
  try {
    const bin = atob(c.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return load(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    return null;
  }
}
