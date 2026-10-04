import type { Composition } from '../composition';
import crossfade from './crossfade';
import foldRules from './fold-rules';
import holdHandover from './hold-handover';
import pointerGlow from './pointer-glow';
import springRetarget from './spring-retarget';
import staggerWave from './stagger-wave';

export const PRESETS: { name: string; comp: Composition }[] = [
  { name: 'stagger wave', comp: staggerWave },
  { name: 'crossfade', comp: crossfade },
  { name: 'spring retarget', comp: springRetarget },
  { name: 'hold handover', comp: holdHandover },
  { name: 'pointer glow', comp: pointerGlow },
  { name: 'fold rules', comp: foldRules },
];

export const DEFAULT: Composition = staggerWave;
