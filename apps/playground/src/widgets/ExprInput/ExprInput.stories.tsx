import type { Meta, StoryObj } from '@weasel-js/forge';
import { useState } from 'react';
import { ExprInput, type ExprInputProps } from './index';

const meta: Meta<typeof ExprInput> = { title: 'playground/ExprInput', component: ExprInput };
export default meta;

function Harness({
  initial,
  error,
  hideLabel,
}: {
  initial: string;
  error?: string;
  hideLabel?: boolean;
}) {
  const [v, setV] = useState(initial);
  return (
    <ExprInput
      label="stagger"
      hideLabel={hideLabel}
      value={v}
      onCommit={setV}
      error={error ?? null}
    />
  );
}
/** Holds what was committed, starting over whenever the `value` control changes. */
function Held({ value, ...rest }: Omit<ExprInputProps, 'onCommit'>) {
  const [v, setV] = useState(value);
  return <ExprInput {...rest} value={v} onCommit={setV} />;
}

interface ControlsArgs {
  value: string;
  label: string;
  hideLabel: boolean;
  placeholder: string;
  error: string;
}

export const Controls: StoryObj<ControlsArgs> = {
  args: {
    value: '(s) => s.col * 80',
    label: 'stagger',
    hideLabel: false,
    placeholder: '(s) => 0',
    error: '',
  },
  argTypes: {
    value: { control: 'text' },
    label: { control: 'text' },
    hideLabel: { control: 'boolean' },
    placeholder: { control: 'text' },
    error: { control: 'text', description: 'Empty: no error' },
  },
  render: ({ value, error, ...rest }) => (
    <Held key={value} value={value} error={error || null} {...rest} />
  ),
};

export const Valid: StoryObj<typeof ExprInput> = {
  render: () => <Harness initial="(s) => s.col * 80" />,
};
export const Broken: StoryObj<typeof ExprInput> = {
  render: () => <Harness initial="(s) => s.col *" error="Unexpected token '}'" />,
};
export const Unlabeled: StoryObj<typeof ExprInput> = {
  render: () => <Harness initial="(s) => s.col * 80" hideLabel />,
};
