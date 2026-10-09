import { color, type Kit, kit, last, max, mul, sum, vec } from '@msb235/blits';

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
export type NumberRule = 'sum' | 'mul' | 'max' | 'last';

export interface NumberRuleSpec {
  rule: NumberRule;
  bounds?: [number, number];
}

/** `replace`: the last voice's color wins, eased by weight; `average`: weights blend every color. */
export interface ColorRuleSpec {
  rule: 'replace' | 'average';
  lerp: 'oklch' | 'oklab';
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
  color: { rule: 'replace', lerp: 'oklch' },
  opacity: { rule: 'mul', bounds: [0, 1] },
  glow: { rule: 'max' },
};

const RULES = { sum, mul, max } as const;

function numberChannel({ rule, bounds }: NumberRuleSpec) {
  if (rule === 'last') return last<number>();
  return RULES[rule](bounds ? { bounds } : undefined);
}

/** The kit a composition's rules make: each channel the default unless the rules name another. */
export function kitOf(rules: Partial<Rules> = {}): Kit<Mixed> {
  const r = { ...DEFAULT_RULES, ...rules };
  return kit<Mixed>({
    offset: vec(2, numberChannel(r.offset)),
    turn: numberChannel(r.turn),
    scale: numberChannel(r.scale),
    color: color(r.color.rule === 'replace' ? last() : sum(), { lerp: r.color.lerp }),
    opacity: numberChannel(r.opacity),
    glow: numberChannel(r.glow),
  });
}

export const KIT: Kit<Mixed> = kitOf();
