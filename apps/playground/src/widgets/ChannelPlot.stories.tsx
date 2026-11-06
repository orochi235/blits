import { ChannelPlot } from '@msb235/blits-panel';
import type { Meta, StoryObj } from '@weasel-js/forge';

const meta: Meta<typeof ChannelPlot> = { title: 'playground/ChannelPlot', component: ChannelPlot };
export default meta;

const times = Array.from({ length: 121 }, (_, i) => i * 25);
const a = times.map((t) => Math.sin(t / 400));
const b = times.map((t) => (t > 1200 ? 0.6 : 0));
const folded = a.map((v, i) => v + (b[i] ?? 0));

const c = times.map((t) => Math.cos(t / 250) * 0.5);
const SERIES = {
  'two voices and the fold': [
    { id: 'a', hue: 220, values: a },
    { id: 'b', hue: 30, values: b },
    { id: 'fold', hue: 0, values: folded, thick: true },
  ],
  'one voice': [{ id: 'a', hue: 220, values: a, thick: true }],
  'three voices': [
    { id: 'a', hue: 220, values: a },
    { id: 'b', hue: 30, values: b },
    { id: 'c', hue: 140, values: c },
  ],
};

interface ControlsArgs {
  series: keyof typeof SERIES;
  label: string;
  playhead: number;
  width: number;
  height: number;
  span: boolean;
  from: number;
  to: number;
}

export const Controls: StoryObj<ControlsArgs> = {
  args: {
    series: 'two voices and the fold',
    label: 'turn · subject 3',
    playhead: 1500,
    width: 320,
    height: 90,
    span: false,
    from: 0,
    to: 3000,
  },
  argTypes: {
    series: {
      control: 'select',
      options: Object.keys(SERIES),
      description: 'Which series to plot',
    },
    label: { control: 'text' },
    playhead: { control: { type: 'range', min: 0, max: 3000, step: 25 } },
    width: { control: { type: 'range', min: 160, max: 720, step: 10 } },
    height: { control: { type: 'range', min: 40, max: 240, step: 5 } },
    span: { control: 'boolean', description: 'Draw a set span of time, not the samples’ own' },
    from: { control: { type: 'range', min: -1000, max: 3000, step: 50 }, if: { arg: 'span' } },
    to: { control: { type: 'range', min: 0, max: 4000, step: 50 }, if: { arg: 'span' } },
  },
  render: ({ series, span, from, to, ...rest }) => (
    <ChannelPlot
      times={times}
      series={SERIES[series]}
      {...(span ? { range: [from, to] as const } : {})}
      {...rest}
    />
  ),
};

export const TwoVoicesAndTheFold: StoryObj<typeof ChannelPlot> = {
  render: () => (
    <ChannelPlot
      label="turn · subject 3"
      times={times}
      playhead={1500}
      series={[
        { id: 'a', hue: 220, values: a },
        { id: 'b', hue: 30, values: b },
        { id: 'fold', hue: 0, values: folded, thick: true },
      ]}
    />
  ),
};
