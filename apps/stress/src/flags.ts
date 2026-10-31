export const USAGE =
  'usage: stress <name> [--size n] [--frames n] [--seed n] [--window n] [--lanes off] [--root dir]';

export interface Flags {
  size?: number;
  frames?: number;
  seed?: number;
  window?: number;
  lanes?: boolean;
  root?: string;
}

type Rule = (v: string) => number | boolean | string | undefined;

const positive: Rule = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const count: Rule = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};
const RULES: Record<keyof Flags, Rule> = {
  size: positive,
  frames: count,
  window: count,
  seed: (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  },
  lanes: (v) => (v === 'off' ? false : v === 'on' ? true : undefined),
  root: (v) => v,
};

/** Reads `--flag value` pairs; returns the reason for refusing them as a string. */
export function parse(args: readonly string[]): Flags | string {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i] as string;
    const value = args[i + 1];
    if (!flag.startsWith('--')) return `unexpected argument "${flag}"`;
    if (flag.includes('=')) return `write "${flag.replace('=', ' ')}", not "${flag}"`;
    const name = flag.slice(2);
    const rule = RULES[name as keyof Flags];
    if (!rule) return `unknown flag ${flag}`;
    if (value === undefined || value.startsWith('--')) return `${flag} needs a value`;
    const v = rule(value);
    if (v === undefined) return `${flag} cannot be "${value}"`;
    out[name] = v;
  }
  return out as Flags;
}
