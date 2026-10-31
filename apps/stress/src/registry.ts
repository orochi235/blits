import type { Entry } from '@stress/scenario';
import { cues } from '@stress/scenarios/cues/scenario';
import { feed } from '@stress/scenarios/feed/scenario';
import { heatmap } from '@stress/scenarios/heatmap/scenario';
import { idle } from '@stress/scenarios/idle';
import { kiosk } from '@stress/scenarios/kiosk/scenario';
import { timeline } from '@stress/scenarios/timeline/scenario';

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
  feed: {
    make: feed,
    size: 1,
    frames: 3600,
    blurb:
      'A live feed: 100 items a second arrive and leave while the list is re-sorted and filtered.',
  },
  timeline: {
    make: timeline,
    size: 1,
    frames: 2400,
    blurb:
      'A video timeline: 300 clips in nested spans, scrubbed, jumped and shuttled from −2× to 4× under history.',
  },
  cues: {
    make: cues,
    size: 1,
    frames: 7200,
    blurb:
      'A lighting desk: 500 cues over 48 fixtures, with follows, GO pressed mid-fade, BACK, and manual faders, checked against a plain model of the cue sheet.',
  },
  kiosk: {
    make: kiosk,
    size: 72,
    frames: 15_552_000,
    window: 3600,
    framesFor: (size) => Math.round(size * 216_000),
    blurb:
      'A signage wall left on for days: 2,000 subjects under looping patterns, crossfaded and burst, with the clock slept through hourly, checked for drift, growth, and return to rest.',
  },
};
