import type { Meta, StoryObj } from '@weasel-js/forge';
import { useState } from 'react';
import { type Clip, type ClipEdit, type Link, ScoreLanes } from './index';

const meta: Meta<typeof ScoreLanes> = { title: 'playground/ScoreLanes', component: ScoreLanes };
export default meta;

const base = { fadeIn: 0, fadeOut: 0, spread: 0, freezeBefore: false, freezeAfter: false };
const CLIPS: Clip[] = [
  {
    ...base,
    id: 'wave',
    lane: 0,
    label: 'wave · keys',
    hue: 220,
    start: 0,
    pass: 1000,
    passes: 2,
    fadeIn: 300,
    fadeOut: 250,
    spread: 900,
    spreadAt: 200,
  },
  {
    ...base,
    id: 'pulse',
    lane: 1,
    label: 'pulse · fn',
    hue: 155,
    start: 1000,
    pass: 600,
    passes: Number.POSITIVE_INFINITY,
    group: 'echo',
  },
  {
    ...base,
    id: 'settle',
    lane: 2,
    label: 'settle · spring',
    hue: 280,
    start: 3000,
    pass: 1300,
    passes: 1,
    freezeBefore: true,
    freezeAfter: true,
    group: 'echo',
  },
  {
    ...base,
    id: 'spin',
    lane: 3,
    label: 'spin · keys',
    hue: 45,
    start: 2000,
    pass: 900,
    passes: 1,
    fadeIn: 150,
    fadeOut: 150,
    locked: true,
  },
  {
    ...base,
    id: 'drift',
    lane: 4,
    label: 'drift · motion',
    hue: 10,
    start: 500,
    pass: 0,
    passes: Number.POSITIVE_INFINITY,
    fadeIn: 400,
  },
];
const LINKS: Link[] = [
  { from: { clip: 'spin', edge: 'start' }, to: { clip: 'wave', edge: 'end' } },
];

function apply(clips: Clip[], e: ClipEdit): Clip[] {
  if (e.kind === 'group') {
    const target = clips.find((c) => c.id === e.with);
    const group = target?.group ?? (target ? `g-${target.id}` : undefined);
    return clips.map((c) => (c.id === e.clip || c.id === target?.id ? { ...c, group } : c));
  }
  return clips.map((c) => {
    if (c.id !== e.clip) return c;
    if (e.kind === 'move') return { ...c, start: e.start };
    if (e.kind === 'passes') return { ...c, passes: e.passes };
    if (e.kind === 'fadeIn') return { ...c, fadeIn: e.ms };
    if (e.kind === 'fadeOut') return { ...c, fadeOut: e.ms };
    if (e.kind === 'hatch')
      return {
        ...c,
        freezeBefore: e.hatch === 'before' || e.hatch === 'both',
        freezeAfter: e.hatch === 'after' || e.hatch === 'both',
      };
    return c;
  });
}

function Harness() {
  const [clips, setClips] = useState(CLIPS);
  const [links, setLinks] = useState(LINKS);
  const [playhead, setPlayhead] = useState(1300);
  const [selected, setSelected] = useState<string | null>(null);
  const edit = (e: ClipEdit) => {
    if (e.kind === 'link') setLinks((l) => [...l.filter((x) => x.from.clip !== e.clip), e.link]);
    else setClips((c) => apply(c, e));
  };
  return (
    <div style={{ width: 900 }}>
      <ScoreLanes
        clips={clips}
        links={links}
        duration={6000}
        playhead={playhead}
        selected={selected}
        onSelect={setSelected}
        onScrub={setPlayhead}
        onEdit={edit}
      />
    </div>
  );
}

export const Arrangement: StoryObj<typeof ScoreLanes> = { render: () => <Harness /> };
