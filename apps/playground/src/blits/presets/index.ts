import type { Composition } from '../composition';
import crossfade from './crossfade';
import foldRules from './fold-rules';
import freezeHandover from './freeze-handover';
import ownerFade from './owner-fade';
import pointerGlow from './pointer-glow';
import spanFit from './span-fit';
import springRetarget from './spring-retarget';
import staggerWave from './stagger-wave';

export const PRESETS: { name: string; comp: Composition }[] = [
  { name: 'stagger wave', comp: staggerWave },
  { name: 'crossfade', comp: crossfade },
  { name: 'spring retarget', comp: springRetarget },
  { name: 'freeze handover', comp: freezeHandover },
  { name: 'pointer glow', comp: pointerGlow },
  { name: 'fold rules', comp: foldRules },
  { name: 'owner fade', comp: ownerFade },
  { name: 'span fit', comp: spanFit },
];

export const DEFAULT: Composition = staggerWave;
