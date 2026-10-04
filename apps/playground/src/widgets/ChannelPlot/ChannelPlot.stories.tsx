import type { Meta, StoryObj } from '@weasel-js/forge';
import { ChannelPlot } from './index';

const meta: Meta<typeof ChannelPlot> = { title: 'playground/ChannelPlot', component: ChannelPlot };
export default meta;

const times = Array.from({ length: 121 }, (_, i) => i * 25);
const a = times.map((t) => Math.sin(t / 400));
const b = times.map((t) => (t > 1200 ? 0.6 : 0));
const folded = a.map((v, i) => v + (b[i] ?? 0));

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
