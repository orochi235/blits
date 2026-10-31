import type { Entry } from '@stress/scenario';
import { heatmap } from '@stress/scenarios/heatmap/scenario';
import { idle } from '@stress/scenarios/idle';

export const scenarios: Record<string, Entry> = {
  idle: {
    make: idle,
    size: 1,
    frames: 600,
    blurb: 'One subject and one looping voice; the runner’s own smoke test.',
  },
  heatmap: {
    make: heatmap,
    size: 5,
    frames: 3600,
    blurb: 'Thousands of cells, each spring retargeted dozens of times a second.',
  },
};
