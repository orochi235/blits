import type { Mixer } from './mixer.js';
import type { Outline, OutlineVoice, Placement } from './types.js';
import type { Voice } from './voice.js';

const PARTS = ['enter', 'active', 'exit'] as const;

/** A deep copy of data made of plain objects, arrays and primitives, as a placement is. */
function copy<T>(v: T): T {
  if (Array.isArray(v)) return v.map(copy) as T;
  if (typeof v !== 'object' || v === null) return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])) as T;
}

function kindOf<I, O>(voice: Voice<I, O>): OutlineVoice['kind'] {
  if (voice.holding === null) return 'voice';
  if (voice.fitting !== null) return 'span';
  return voice.arc !== null ? 'arc' : 'owner';
}

function outlineOf<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): OutlineVoice {
  const { spec } = voice;
  const writes = new Set(voice.patch.writes as readonly string[]);
  return {
    id: voice.id,
    name: spec.name,
    kind: kindOf(voice),
    owner: voice.owner?.id,
    part: voice.part < 0 ? undefined : PARTS[voice.part],
    state: voice.state,
    writes: (mix.names as string[]).filter((n) => writes.has(n)),
    role: spec.role,
    weight:
      voice.blend !== null ? 'blend' : typeof spec.weight === 'function' ? 'signal' : voice.weight,
    stagger: spec.stagger !== undefined,
    target: spec.target !== undefined || spec.subjects !== undefined,
    score: spec.score,
    tags: [...(spec.tags ?? [])],
    anchor: spec.anchor === undefined ? undefined : copy<Placement>(spec.anchor),
    marks: spec.marks === undefined ? undefined : { ...spec.marks },
  };
}

/** What `mix.describe()` returns. */
export function describe<I, O>(mix: Mixer<I, O>): Outline {
  return {
    name: mix.name,
    channels: mix.names.map((name, i) => ({
      name: name as string,
      kind: mix.channels[i]?.kind,
    })),
    voices: mix.cued.filter((v) => v.state !== 'done').map((v) => outlineOf(mix, v)),
  };
}
