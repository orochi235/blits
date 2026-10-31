import type { Entry } from '@stress/scenario';
import { idle } from '@stress/scenarios/idle';

export const scenarios: Record<string, Entry> = {
  idle: {
    make: idle,
    size: 1,
    frames: 600,
    blurb: 'One subject and one looping voice; the runner’s own smoke test.',
  },
};
