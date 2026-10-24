import { color, type Kit, oklab, patch, sum } from '@msb235/blits';

/** The channels the patches below write. A host spreads these into its own kit. */
export interface GlowPose {
  glow: number;
  tint: number[];
}

export const glowChannels: Kit<GlowPose> = { glow: sum(), tint: color() };

/** What these patches read from the host's `host` option. */
export interface GlowHost {
  pointer: { x: number; y: number };
}

/** A subject has to say where it is for `near` to work. */
export interface Lamp {
  x: number;
  y: number;
}

/** A slow pulse. Its writes come from the kit it names. */
export const pulse = patch<Lamp, GlowPose>(
  1600,
  (phase) => ({ glow: 0.5 - 0.5 * Math.cos(2 * Math.PI * phase), tint: oklab(0xffb347) }),
  { kit: glowChannels },
);

/** Brighter the nearer the host's pointer is. */
export const near = patch<Lamp, GlowPose, void, GlowHost>(
  0,
  (_phase, lamp, setting) => {
    const d = Math.hypot(lamp.x - setting.host.pointer.x, lamp.y - setting.host.pointer.y);
    return { glow: Math.max(0, 1 - d / 200) };
  },
  { writes: ['glow'], kit: glowChannels, reads: ['pointer'] },
);
