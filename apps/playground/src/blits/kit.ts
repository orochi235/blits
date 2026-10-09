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

export const KIT: Kit<Mixed> = kit<Mixed>({
  offset: vec(2, sum()),
  turn: sum(),
  scale: mul(),
  color: color(last(), { lerp: 'oklch' }),
  opacity: mul({ bounds: [0, 1] }),
  glow: max(),
});
