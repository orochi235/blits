import { bothOf } from '@pg/blits/both';
import { flowOf, foldOf } from '@pg/blits/flow';
import { PRESETS } from '@pg/blits/presets';
import { timingOf } from '@pg/blits/timing';
import { toneOf, wired } from '@pg/blits/wire';
import type { LayoutDirection } from '@weasel-js/diagram';
import type { Meta, StoryObj } from '@weasel-js/forge';
import { useState } from 'react';
import { FlowDiagram } from './index';

const meta: Meta<typeof FlowDiagram> = { title: 'playground/FlowDiagram', component: FlowDiagram };
export default meta;

type Story = StoryObj<typeof FlowDiagram>;

/** The composition of the preset named `name`, or of the first preset. */
function preset(name?: string) {
  const found = name === undefined ? PRESETS[0] : PRESETS.find((p) => p.name === name);
  if (found === undefined) throw new Error(`no preset ${name}`);
  return found.comp;
}

const VIEWS = {
  flow: (name: string) => flowOf(preset(name)),
  timing: (name: string) => timingOf(preset(name)),
  both: (name: string) => {
    const comp = preset(name);
    return bothOf(flowOf(comp), timingOf(comp));
  },
};

interface ControlsArgs {
  preset: string;
  view: keyof typeof VIEWS;
  direction: LayoutDirection;
  width: number;
  height: number;
  minScale: number;
  hold: boolean;
}

function Controlled({ preset: name, view, ...rest }: ControlsArgs) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div>
      <div>picked: {picked ?? 'none'}</div>
      <FlowDiagram {...rest} flow={VIEWS[view](name)} selected={picked} onSelect={setPicked} />
    </div>
  );
}

export const Controls: StoryObj<ControlsArgs> = {
  args: {
    preset: 'crossfade',
    view: 'flow',
    direction: 'down',
    width: 360,
    height: 560,
    minScale: 0.75,
    hold: false,
  },
  argTypes: {
    selected: { control: false },
    preset: { control: 'select', options: PRESETS.map((p) => p.name) },
    view: { control: 'inline-radio', options: Object.keys(VIEWS) },
    direction: { control: 'inline-radio', options: ['down', 'up', 'right', 'left'] },
    width: { control: { type: 'range', min: 200, max: 1200, step: 20 } },
    height: { control: { type: 'range', min: 200, max: 1200, step: 20 } },
    minScale: { control: { type: 'range', min: 0.25, max: 1.5, step: 0.05 } },
    hold: {
      control: 'boolean',
      description: 'Keep nodes where they stood when the preset or view changes',
    },
  },
  render: (args) => <Controlled {...args} />,
};

function Picking({ name }: { name: string }) {
  const comp = preset(name);
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
    const comp = { ...preset(), voices, levels };
    return <FlowDiagram flow={flowOf(comp)} width={360} height={800} />;
  },
};

export const FoldOfScale: Story = {
  render: () => (
    <FlowDiagram
      flow={foldOf(flowOf(preset('crossfade')), 'scale')}
      width={360}
      height={400}
      direction="up"
    />
  ),
};

/** View C: the flow and the timing as one diagram, timing edges in amber. */
export const Both: Story = {
  render: () => {
    const comp = preset('anchors');
    return <FlowDiagram flow={bothOf(flowOf(comp), timingOf(comp))} width={360} height={900} />;
  },
};

function Editing() {
  const [comp, setComp] = useState(preset('owner fade'));
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
