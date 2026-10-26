import type { Composition } from '../composition';
import anchors from './anchors';
import backward from './backward';
import blend from './blend';
import boundedGlow from './bounded-glow';
import crossfade from './crossfade';
import foldRules from './fold-rules';
import freezeHandover from './freeze-handover';
import marksHits from './marks-hits';
import ownerFade from './owner-fade';
import pointerGlow from './pointer-glow';
import spanFit from './span-fit';
import springRetarget from './spring-retarget';
import staggerWave from './stagger-wave';

export const PRESETS: { name: string; comp: Composition }[] = [
  { name: 'stagger wave', comp: staggerWave },
  { name: 'crossfade', comp: crossfade },
  { name: 'blend', comp: blend },
  { name: 'spring retarget', comp: springRetarget },
  { name: 'freeze handover', comp: freezeHandover },
  { name: 'pointer glow', comp: pointerGlow },
  { name: 'bounded glow', comp: boundedGlow },
  { name: 'fold rules', comp: foldRules },
  { name: 'owner fade', comp: ownerFade },
  { name: 'span fit', comp: spanFit },
  { name: 'marks and hits', comp: marksHits },
  { name: 'anchors', comp: anchors },
  { name: 'backward', comp: backward },
];

export const DEFAULT: Composition = staggerWave;
