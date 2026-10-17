import { bothOf } from '@pg/blits/both';
import { flowOf, foldOf } from '@pg/blits/flow';
import { PRESETS } from '@pg/blits/presets';
import { timingOf } from '@pg/blits/timing';
import { toneOf, wired } from '@pg/blits/wire';
import type { Meta, StoryObj } from '@weasel-js/forge';
import { useState } from 'react';
import { FlowDiagram } from './index';

const meta: Meta<typeof FlowDiagram> = { title: 'playground/FlowDiagram', component: FlowDiagram };
export default meta;

type Story = StoryObj<typeof FlowDiagram>;

function Picking({ name }: { name: string }) {
  const comp = PRESETS.find((p) => p.name === name)!.comp;
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div>
      <div>picked: {picked ?? 'none'}</div>
      <FlowDiagram
        flow={flowOf(comp)}
        width={360}
        height={560}
        selected={picked}
        onSelect={setPicked}
      />
    </div>
  );
}

export const Crossfade: Story = { render: () => <Picking name="crossfade" /> };
export const PointerGlow: Story = { render: () => <Picking name="pointer glow" /> };
export const FoldRules: Story = { render: () => <Picking name="fold rules" /> };
export const StaggerWave: Story = { render: () => <Picking name="stagger wave" /> };

/** Every preset's voices at once, to judge crossings in a crowded column. */
export const Crowded: Story = {
  render: () => {
    const voices = PRESETS.flatMap((p) =>
      p.comp.voices.map((v) => ({ ...v, id: `${p.name}/${v.id}` })),
    );
    const levels = [
      ...new Map(PRESETS.flatMap((p) => p.comp.levels).map((l) => [l.name, l])).values(),
    ];
    const comp = { ...PRESETS[0]!.comp, voices, levels };
    return <FlowDiagram flow={flowOf(comp)} width={360} height={800} />;
  },
};

export const FoldOfScale: Story = {
  render: () => (
    <FlowDiagram
      flow={foldOf(flowOf(PRESETS.find((p) => p.name === 'crossfade')!.comp), 'scale')}
      width={360}
      height={400}
      direction="up"
    />
  ),
};

/** View C: the flow and the timing as one diagram, timing edges in amber. */
export const Both: Story = {
  render: () => {
    const comp = PRESETS.find((p) => p.name === 'anchors')!.comp;
    return <FlowDiagram flow={bothOf(flowOf(comp), timingOf(comp))} width={360} height={900} />;
  },
};

function Editing() {
  const [comp, setComp] = useState(PRESETS.find((p) => p.name === 'owner fade')!.comp);
  const [positions, setPositions] = useState(new Map<string, { x: number; y: number }>());
  const flow = flowOf(comp);
  return (
    <FlowDiagram
      flow={bothOf(flow, timingOf(comp))}
      width={360}
      height={700}
      positions={positions}
      hold
      onMove={(moves) =>
        setPositions((was) => new Map([...was, ...moves.map((m) => [m.id, m] as const)]))
      }
      onConnect={(a, b) => {
        const next = wired(comp, flow.code, a, b);
        if (next) setComp(next);
      }}
      canConnect={(a, b) => wired(comp, flow.code, a, b) !== null}
      portTone={(node, port) => toneOf(flow.code, node, port)}
    />
  );
}

/** View D: drag an amber dot to another to anchor, a blue one onto a top to weight; nodes drag. */
export const Editable: Story = { render: () => <Editing /> };
