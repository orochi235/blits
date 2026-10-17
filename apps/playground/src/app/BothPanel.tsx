import { bothOf } from '@pg/blits/both';
import type { Composition } from '@pg/blits/composition';
import { flowOf } from '@pg/blits/flow';
import type { Player } from '@pg/blits/player';
import { lit, liveOf, timingOf } from '@pg/blits/timing';
import { type End, toneOf, wired } from '@pg/blits/wire';
import { FlowDiagram } from '@pg/widgets/FlowDiagram';
import { useMemo, useRef, useState } from 'react';
import s from './FlowPanel.module.css';
import { flowKey } from './flowKey';
import { useSize } from './useSize';

export interface BothPanelProps {
  comp: Composition;
  /** Ids of voices and groups that failed to compile. */
  faulted: ReadonlySet<string>;
  player: Player;
  /** The selected voice's or group's id. */
  selected: string | null;
  onVoice: (id: string) => void;
  /** An edit made by joining two ports. */
  onComp: (c: Composition) => void;
}

type At = { x: number; y: number };
// Where nodes were dragged, kept while the page is open so a tab switch does not lose them.
let dragged: ReadonlyMap<string, At> = new Map();

export function BothPanel({ comp, faulted, player, selected, onVoice, onComp }: BothPanelProps) {
  const flow = useMemo(() => flowOf(comp, faulted), [comp, faulted]);
  const timing = useMemo(() => timingOf(comp, faulted), [comp, faulted]);
  const now = bothOf(flow, lit(timing, liveOf(player.built, player.host)));
  const kept = useRef({ key: flowKey(now), flow: now });
  const key = flowKey(now);
  if (kept.current.key !== key) kept.current = { key, flow: now };
  const shown = kept.current.flow;
  const [size, ref] = useSize();
  const [editing, setEditing] = useState(false);
  const [positions, setPositions] = useState(dragged);
  const place = (next: ReadonlyMap<string, At>) => {
    dragged = next;
    setPositions(next);
  };
  const nodeOf = (id: string) =>
    comp.groups?.some((g) => g.id === id) ? `group:${id}` : `voice:${id}`;
  const pick = (id: string | null) => {
    if (id?.startsWith('voice:') || id?.startsWith('group:'))
      onVoice(id.slice(id.indexOf(':') + 1));
  };
  const join = (a: End, b: End) => wired(comp, flow.code, a, b);
  return (
    <section className={s.panel} aria-label="both">
      <div className={s.crumbs}>
        <label>
          <input type="checkbox" checked={editing} onChange={(e) => setEditing(e.target.checked)} />
          edit
        </label>
        {positions.size > 0 && (
          <button type="button" onClick={() => place(new Map())}>
            lay out
          </button>
        )}
        <span>
          {editing
            ? 'amber dot to amber dot: start (left) or end (right) waits on the other · blue dot onto a top: its weight'
            : 'blue edge: signal flow · amber edge: what waits on what'}
        </span>
      </div>
      <div ref={ref} className={s.canvas}>
        {size && (
          <FlowDiagram
            flow={shown}
            width={size.width}
            height={size.height}
            selected={selected ? nodeOf(selected) : null}
            onSelect={pick}
            positions={positions}
            hold={editing}
            {...(editing
              ? {
                  onMove: (moves) => {
                    const next = new Map(dragged);
                    for (const m of moves) next.set(m.id, { x: m.x, y: m.y });
                    place(next);
                  },
                  onConnect: (a, b) => {
                    const next = join(a, b);
                    if (next) onComp(next);
                  },
                  canConnect: (a, b) => join(a, b) !== null,
                  portTone: (node, port) => toneOf(flow.code, node, port),
                }
              : {})}
          />
        )}
      </div>
    </section>
  );
}
