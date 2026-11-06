import { NUMBER_RULES } from '@pg/blits/kit';
import type { Meta, StoryObj } from '@weasel-js/forge';
import { FoldStamp, type FoldStampProps } from './FoldStamp';
import css from './FoldStamp.stories.module.css';

const meta: Meta<typeof FoldStamp> = { title: 'playground/FoldStamp', component: FoldStamp };
export default meta;

function Rows({ rows }: { rows: [string, Omit<FoldStampProps, 'rule'>][] }) {
  return (
    <div className={css.sheet}>
      {rows.map(([name, props]) => (
        <section key={name}>
          <h2>{name}</h2>
          <div className={css.row}>
            {NUMBER_RULES.map((rule) => (
              <figure key={rule}>
                <FoldStamp rule={rule} {...props} />
                <figcaption>{rule}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export const Looks: StoryObj<typeof FoldStamp> = {
  render: () => (
    <Rows
      rows={[
        ['default: glowing, hue', {}],
        ['bold', { line: 'bold' }],
        ['bold, hue', { line: 'bold', encode: 'hue' }],
        ['bold, opacity', { line: 'bold', encode: 'opacity' }],
        ['glowing, hue', { line: 'glowing', encode: 'hue' }],
        ['glowing, warm hue', { line: 'glowing', encode: 'hue', ramp: 'warm' }],
        ['fine', { line: 'fine' }],
      ]}
    />
  ),
};

export const Weights: StoryObj<typeof FoldStamp> = {
  render: () => (
    <Rows
      rows={[1, 0.6, 0.3, 0].map((weight) => [
        `bold, hue, weight ${weight}`,
        { line: 'bold', encode: 'hue', weight },
      ])}
    />
  ),
};

export const Small: StoryObj<typeof FoldStamp> = {
  render: () => <Rows rows={[['48 px, bold, hue', { line: 'bold', encode: 'hue', size: 48 }]]} />,
};
