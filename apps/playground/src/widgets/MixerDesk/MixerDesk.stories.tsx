import type { Meta, StoryObj } from '@weasel-js/forge';
import { useState } from 'react';
import { type Desk, MixerDesk } from './index';

const meta: Meta<typeof MixerDesk> = { title: 'playground/MixerDesk', component: MixerDesk };
export default meta;

type Story = StoryObj<typeof MixerDesk>;

const buses = [
  { id: 'offset', label: 'offset', rule: 'vec(2, sum)' },
  { id: 'scale', label: 'scale', rule: 'mul' },
  { id: 'color', label: 'color', rule: 'color(last, oklch)' },
  { id: 'glow', label: 'glow', rule: 'max' },
];

const DESK: Desk = {
  buses,
  strips: [
    { id: 'lift', label: 'lift', hue: 210, taps: ['offset'], detail: 'keys · 1200 ms · loop' },
    { id: 'warm', label: 'warm', hue: 30, taps: ['scale', 'color'] },
    { id: 'cool', label: 'cool', hue: 190, taps: ['scale', 'color'] },
    { id: 'halo', label: 'a halo with a long name', hue: 280, taps: ['glow'] },
    { id: 'bad', label: 'broken', hue: 0, taps: ['glow'], faulted: true },
  ],
  groups: [
    { id: 'pair', label: 'crossfade pair', hue: 120, first: 'warm', last: 'cool', depth: 1 },
    { id: 'all', label: 'everything', hue: 60, first: 'lift', last: 'halo', depth: 0 },
  ],
};

const LIT: Desk = {
  buses: buses.map((b, i) => ({
    ...b,
    value: ['12.0, -3.5', '1.18', '#d98a4f', '0.40'][i],
    ...(b.id === 'color' ? { swatch: '#d98a4f' } : {}),
  })),
  strips: DESK.strips.map((s, i) => ({ ...s, level: [1, 0.72, 0.28, 0.4, 0][i] })),
  groups: DESK.groups?.map((g) => ({ ...g, level: g.id === 'pair' ? 1 : 0.85 })),
};

function Picking({ desk, width }: { desk: Desk; width: number }) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div>
      <div>picked: {picked ?? 'none'}</div>
      <MixerDesk desk={desk} width={width} selected={picked} onSelect={setPicked} />
    </div>
  );
}

export const Unlit: Story = { render: () => <Picking desk={DESK} width={360} /> };
export const Lit: Story = { render: () => <Picking desk={LIT} width={360} /> };

/** More strips than fit: the desk grows wider than the room it was given. */
export const Crowded: Story = {
  render: () => (
    <Picking
      width={360}
      desk={{
        buses,
        strips: Array.from({ length: 16 }, (_, i) => ({
          id: `v${i}`,
          label: `voice ${i}`,
          hue: (i * 47) % 360,
          taps: [i, i * 3 + 1].map((k) => buses[k % buses.length]?.id ?? 'glow'),
          level: (i % 5) / 4,
        })),
      }}
    />
  ),
};
