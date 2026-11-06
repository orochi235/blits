import type { Meta, StoryObj } from '@weasel-js/forge';
import { useState } from 'react';
import { CodePane, type CodePaneProps } from './index';

const meta: Meta<typeof CodePane> = { title: 'playground/CodePane', component: CodePane };
export default meta;

const AT = '(phase, s, set) => ({\n  turn: Math.sin(phase * Math.PI * 2) * 30,\n  glow: phase,\n})';
function Harness({ error, line }: { error?: string; line?: number }) {
  const [v, setV] = useState(AT);
  return (
    <div style={{ width: 420 }}>
      <CodePane
        label="at"
        value={v}
        onCommit={setV}
        error={error ?? null}
        errorLine={line ?? null}
      />
    </div>
  );
}
/** Holds what was committed, starting over whenever the `value` control changes. */
function Held({ value, ...rest }: Omit<CodePaneProps, 'onCommit'>) {
  const [v, setV] = useState(value);
  return <CodePane {...rest} value={v} onCommit={setV} />;
}

interface ControlsArgs {
  value: string;
  label: string;
  error: string;
  errorLine: number;
  rows: number;
  width: number;
}

export const Controls: StoryObj<ControlsArgs> = {
  args: { value: AT, label: 'at', error: '', errorLine: 0, rows: 6, width: 420 },
  argTypes: {
    value: { control: 'textarea' },
    label: { control: 'text' },
    error: { control: 'text', description: 'Empty: no error' },
    errorLine: {
      control: { type: 'range', min: 0, max: 10, step: 1 },
      description: '0: the message shows without a gutter mark',
    },
    rows: { control: { type: 'range', min: 1, max: 20, step: 1 } },
    width: { control: { type: 'range', min: 200, max: 800, step: 10 } },
  },
  render: ({ value, error, errorLine, width, ...rest }) => (
    <div style={{ width }}>
      <Held
        key={value}
        value={value}
        error={error || null}
        errorLine={errorLine || null}
        {...rest}
      />
    </div>
  ),
};

export const Clean: StoryObj<typeof CodePane> = { render: () => <Harness /> };
export const ErrorOnLine2: StoryObj<typeof CodePane> = {
  render: () => <Harness error="s.nope is undefined" line={2} />,
};
export const ErrorNoLine: StoryObj<typeof CodePane> = {
  render: () => <Harness error="Unexpected token '}'" />,
};
