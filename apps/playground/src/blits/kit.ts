import { hex, type Kit, kit, max, mul, sum, vec } from '@msb235/blits';

export interface Pose {
  offset: number[];
  turn: number;
  scale: number;
  color: number;
  opacity: number;
  glow: number;
}

export type ChannelName = keyof Pose;

export const CHANNELS: readonly ChannelName[] = [
  'offset',
  'turn',
  'scale',
  'color',
  'opacity',
  'glow',
];

export const KIT: Kit<Pose> = kit<Pose>({
  offset: vec(2, sum()),
  turn: sum(),
  scale: mul(),
  color: hex(),
  opacity: mul({ bounds: [0, 1] }),
  glow: max(),
});
