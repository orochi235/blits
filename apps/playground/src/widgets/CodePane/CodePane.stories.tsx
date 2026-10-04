import type { Meta, StoryObj } from '@weasel-js/forge';
import { useState } from 'react';
import { CodePane } from './index';

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
export const Clean: StoryObj<typeof CodePane> = { render: () => <Harness /> };
export const ErrorOnLine2: StoryObj<typeof CodePane> = {
  render: () => <Harness error="s.nope is undefined" line={2} />,
};
export const ErrorNoLine: StoryObj<typeof CodePane> = {
  render: () => <Harness error="Unexpected token '}'" />,
};
