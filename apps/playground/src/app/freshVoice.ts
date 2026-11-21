import type { Composition, Voice } from '@pg/blits/composition';

let made = 0;
const freshId = () =>
  typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `v${Date.now()}-${++made}`;

/** A new voice for `c`, named apart from every voice and group, which share one name space. */
export function freshVoice(c: Pick<Composition, 'voices' | 'groups'>): Voice {
  const { voices } = c;
  const names = new Set([...voices, ...(c.groups ?? [])].map((x) => x.name));
  let n = voices.length + 1;
  while (names.has(`voice ${n}`)) n++;
  return {
    id: freshId(),
    name: `voice ${n}`,
    hue: (voices.length * 67) % 360,
    start: 0,
    rate: 1,
    loop: true,
    weight: 1,
    fade: {},
    patch: {
      kind: 'keys',
      period: 1000,
      stops: [
        { at: 0, delta: { glow: 0 } },
        { at: 0.5, delta: { glow: 1 }, ease: 'ease-in-out' },
        { at: 1, delta: { glow: 0 }, ease: 'ease-in-out' },
      ],
    },
  };
}
