import { EASED } from '../../closed.js';
import { curveData } from '../../easing.js';
import { motionOf } from '../../motion.js';
import type { ChannelLookup, Packed, Runner } from '../runner.js';
import { closedWgsl, FORMS } from '../wgsl/closed.js';
import { widthOf } from './keys.js';

const runners = new Map<string, Runner>();

/** One runner per law form, axis count and channel written, since the kernel names its output. */
function motionRunner(form: number, axes: number, writes: string): Runner {
  const key = `motion:${form}:${axes}:${writes}`;
  let r = runners.get(key);
  if (r === undefined) {
    const c = closedWgsl(form, axes);
    r = {
      key,
      helpers: c.helpers,
      wgsl: [
        'let k = base;',
        'let r = sub;',
        'let t = values[k];',
        `var x: array<f32, ${axes}>;`,
        c.body,
        `out.${writes} = ${axes === 1 ? 'x[0]' : 'x'};`,
      ].join(' '),
      writes: [writes],
      fields: [],
      stride: 3 + 3 * axes,
    };
    runners.set(key, r);
  }
  return r;
}

/**
 * A `tween`, `spring` or `glide` patch's runner and numbers: a placeholder for the voice's time,
 * then the law's settle and constants, then a tween's curve. Each subject's run is its own, which
 * a `Mirror` keeps on the GPU and puts the voice's time in front of.
 */
export function motionPack(patch: object, channels: ChannelLookup): Packed | undefined {
  const motions = motionOf<unknown>(patch);
  if (motions === undefined) return undefined;
  const name = (patch as { writes: readonly string[] }).writes[0] as string;
  const code = channels.get(name);
  if (code === undefined) return { why: `it writes ${name}, whose rule the GPU has no WGSL for` };
  if (motions.round) return { why: 'it moves round the hue, which the GPU does not' };
  const axes = widthOf(code);
  if (motions.n >= 0 && motions.n !== axes)
    return { why: `its subjects move on ${motions.n} axes, and ${name} takes ${axes}` };
  const law = motions.law();
  const form = law[0] as number;
  if (!FORMS.has(form)) return { why: `the GPU has no WGSL for its law ${form}` };
  let curve: readonly number[] = [];
  if (form === EASED) {
    const data = curveData(motions.ease);
    if (data === undefined) return { why: 'its easing is a function, which the GPU cannot run' };
    curve = data;
  }
  return {
    runner: motionRunner(form, axes, name),
    values: Float32Array.from([0, ...Array.from(law).slice(1), ...curve]),
    perSubject: { motions },
  };
}
