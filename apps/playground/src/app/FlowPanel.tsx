import type { Composition } from '@pg/blits/composition';
import { flowOf, foldOf } from '@pg/blits/flow';
import type { ChannelName } from '@pg/blits/kit';
import { FlowDiagram } from '@pg/widgets/FlowDiagram';
import { useMemo, useRef, useState } from 'react';
import s from './FlowPanel.module.css';
import { flowKey } from './flowKey';
import { useSize } from './useSize';

export interface FlowPanelProps {
  comp: Composition;
  /** Ids of voices that failed to compile. */
  faulted: ReadonlySet<string>;
  /** The selected voice's id. */
  selected: string | null;
  onVoice: (id: string) => void;
}

export function FlowPanel({ comp, faulted, selected, onVoice }: FlowPanelProps) {
  const [fold, setFold] = useState<ChannelName | null>(null);
  const built = useMemo(() => flowOf(comp, faulted), [comp, faulted]);
  const kept = useRef({ key: flowKey(built), flow: built });
  const key = flowKey(built);
  if (kept.current.key !== key) kept.current = { key, flow: built };
  const flow = kept.current.flow;
  const shown = useMemo(() => (fold ? foldOf(flow, fold) : flow), [flow, fold]);
  const [size, ref] = useSize();
  const pick = (id: string | null) => {
    if (id?.startsWith('voice:')) onVoice(id.slice('voice:'.length));
    else if (id?.startsWith('ch:') && !fold) setFold(id.slice('ch:'.length) as ChannelName);
  };
  return (
    <section className={s.panel} aria-label="flow">
      <nav className={s.crumbs}>
        {fold ? (
          <>
            <button type="button" onClick={() => setFold(null)}>
              Flow
            </button>
            <span aria-hidden>›</span>
            <span>{fold}</span>
          </>
        ) : (
          <span>Flow</span>
        )}
      </nav>
      <div ref={ref} className={s.canvas}>
        {fold && shown.nodes.length === 0 ? (
          <p className={s.empty}>nothing writes {fold}</p>
        ) : (
          size && (
            <FlowDiagram
              flow={shown}
              width={size.width}
              height={size.height}
              direction={fold ? 'up' : 'down'}
              selected={selected ? `voice:${selected}` : null}
              onSelect={pick}
            />
          )
        )}
      </div>
    </section>
  );
}
