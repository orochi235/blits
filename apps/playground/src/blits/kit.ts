import {
  add,
  color,
  darken,
  difference,
  hardLight,
  ink,
  type Kit,
  kit,
  last,
  lighten,
  max,
  min,
  mul,
  multiply,
  norm,
  overlay,
  screen,
  softLight,
  sum,
  vec,
} from '@msb235/blits';

/** What an author writes: color as 0xrrggbb, as the color picker and the presets hold it. */
export interface Pose {
  offset: number[];
  turn: number;
  scale: number;
  color: number;
  opacity: number;
  glow: number;
}

/** What the mix folds: color as OKLab with coverage, which `compile` turns each authored color into. */
export type Mixed = Omit<Pose, 'color'> & { color: number[] };

export type ChannelName = keyof Pose;

export const CHANNELS: readonly ChannelName[] = [
  'offset',
  'turn',
  'scale',
  'color',
  'opacity',
  'glow',
];

/** The channels the mix folds as one number, which a wave can swing. */
export type SwingName = { [K in keyof Mixed]: Mixed[K] extends number ? K : never }[keyof Mixed];

export const SWINGS: readonly SwingName[] = ['turn', 'scale', 'opacity', 'glow'];

/** How a channel of one or more numbers folds its voices. `last` has no rest and takes no bounds. */
export const NUMBER_RULES = ['sum', 'mul', 'max', 'min', 'norm', 'last'] as const;
export type NumberRule = (typeof NUMBER_RULES)[number];

export interface NumberRuleSpec {
  rule: NumberRule;
  bounds?: [number, number];
}

const BLENDS = {
  multiply,
  screen,
  add,
  lighten,
  darken,
  overlay,
  softLight,
  hardLight,
  difference,
} as const;

/** The color rules, the blend modes last. */
export const COLOR_RULES = [
  'replace',
  'average',
  ...(Object.keys(BLENDS) as (keyof typeof BLENDS)[]),
] as const;

/**
 * `replace`: the last voice's color wins, eased by weight; `average`: weights blend every color;
 * a blend mode lays each voice over the subject's base color as a layer, its weight the opacity.
 * `color` travels straight across OKLab, as light mixes; `ink` goes round the hue.
 */
export interface ColorRuleSpec {
  rule: (typeof COLOR_RULES)[number];
  type: 'color' | 'ink';
}

/** Each channel's fold rule; `offset` is two numbers folded alike, which `last` cannot vouch for. */
export interface Rules {
  offset: NumberRuleSpec & { rule: Exclude<NumberRule, 'last'> };
  turn: NumberRuleSpec;
  scale: NumberRuleSpec;
  color: ColorRuleSpec;
  opacity: NumberRuleSpec;
  glow: NumberRuleSpec;
}

export const DEFAULT_RULES: Rules = {
  offset: { rule: 'sum' },
  turn: { rule: 'sum' },
  scale: { rule: 'mul' },
  color: { rule: 'replace', type: 'ink' },
  opacity: { rule: 'mul', bounds: [0, 1] },
  glow: { rule: 'max' },
};

const RULES = { sum, mul, max, min, norm } as const;

function numberChannel({ rule, bounds }: NumberRuleSpec) {
  if (rule === 'last') return last<number>();
  return RULES[rule](bounds ? { bounds } : undefined);
}

function colorChannel({ rule, type }: ColorRuleSpec) {
  const of = rule === 'replace' ? last() : rule === 'average' ? sum() : BLENDS[rule]();
  return type === 'ink' ? ink(of) : color(of);
}

/** The most numbers a subject's color takes under any rule, as a `pull` column holds it. */
export const COLOR_AXES = Math.max(
  ...COLOR_RULES.flatMap((rule) =>
    (['color', 'ink'] as const).map((type) => {
      const rest = colorChannel({ rule, type }).rest;
      return Array.isArray(rest) ? rest.length : 4;
    }),
  ),
);

/** The kit a composition's rules make: each channel the default unless the rules name another. */
export function kitOf(rules: Partial<Rules> = {}): Kit<Mixed> {
  const r = { ...DEFAULT_RULES, ...rules };
  return kit<Mixed>({
    offset: vec(2, numberChannel(r.offset)),
    turn: numberChannel(r.turn),
    scale: numberChannel(r.scale),
    color: colorChannel(r.color),
    opacity: numberChannel(r.opacity),
    glow: numberChannel(r.glow),
  });
}

export const KIT: Kit<Mixed> = kitOf();
