import type { Meta, StoryObj } from '@weasel-js/forge';
import { useState } from 'react';
import { ExprInput } from './index';

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
export const Valid: StoryObj<typeof ExprInput> = {
  render: () => <Harness initial="(s) => s.col * 80" />,
};
export const Broken: StoryObj<typeof ExprInput> = {
  render: () => <Harness initial="(s) => s.col *" error="Unexpected token '}'" />,
};
export const Unlabeled: StoryObj<typeof ExprInput> = {
  render: () => <Harness initial="(s) => s.col * 80" hideLabel />,
};
