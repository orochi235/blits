import { compile, FRAME } from '@pg/blits/compile';
import { Player } from '@pg/blits/player';
import { DEFAULT } from '@pg/blits/presets';
import { applyEdit, clipsOf } from '@pg/blits/score';
import { subjectsOf } from '@pg/blits/stage';
import { Stage } from '@pg/blits/stages/Stage';
import { type ClipEdit, ScoreLanes } from '@pg/widgets/ScoreLanes';
import { LabShell } from '@weasel-js/labkit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import s from './App.module.css';
import { Transport } from './Transport';
import { useComposition } from './useComposition';

/** The most wall time one tick plays, so a hidden tab coming back does not replay seconds at once. */
const MAX_TICK_MS = 250;

export function App() {
  const { comp, set, undo, redo } = useComposition(DEFAULT);
  const compRef = useRef(comp);
  compRef.current = comp;
  const subjects = useMemo(() => subjectsOf(comp.stage), [comp.stage]);
  const last = useRef<Player | null>(null);
  // A new stage needs new columns, so a new player; it picks up the old one's playhead and sliders.
  const player = useMemo(() => {
    const p = new Player(() => compile(compRef.current, subjects, { solos: true }), subjects);
    const was = last.current;
    if (was) {
      for (const [name, v] of was.moved) p.setLevel(name, v);
      p.seek(was.t);
    }
    last.current = p;
    return p;
  }, [subjects]);
  const [frame, setFrame] = useState(0);
  const tick = useCallback(() => setFrame((f) => f + 1), []);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(true);
  const [live, setLive] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(0);

  // Every edit recompiles and replays to the playhead.
  useEffect(() => {
    player.rebuild(comp.levels);
    tick();
  }, [comp, player, tick]);

  useEffect(() => {
    if (!playing) return;
    let prev = performance.now();
    let owed = 0;
    let id = requestAnimationFrame(function step(now) {
      owed += Math.min(now - prev, MAX_TICK_MS) * rate;
      prev = now;
      const frames = Math.floor(owed / FRAME);
      if (frames > 0) {
        owed -= frames * FRAME;
        const length = compRef.current.length;
        let t = player.t + frames * FRAME;
        if (t > length) {
          if (!loop) {
            player.seek(length);
            tick();
            setPlaying(false);
            return;
          }
          t %= length;
        }
        player.seek(t);
        tick();
      }
      id = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(id);
  }, [playing, rate, loop, player, tick]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [undo, redo]);

  const { clips, links } = useMemo(() => clipsOf(comp, subjects), [comp, subjects]);
  const scrub = (t: number) => {
    player.seek(Math.min(Math.max(t, 0), comp.length));
    tick();
  };
  const edit = (e: ClipEdit) => set(applyEdit(compRef.current, e));
  const play = (on: boolean) => {
    if (on && player.t >= comp.length - FRAME) player.seek(0);
    setPlaying(on);
  };

  return (
    <LabShell title="blits playground" mode="dark">
      <div className={s.grid}>
        <section className={s.stage}>
          <Stage
            stage={comp.stage}
            subjects={subjects}
            columns={player.columns}
            frame={frame}
            picked={picked}
            onPick={setPicked}
          />
        </section>
        <section className={s.inspector} aria-label="inspector" />
        <aside className={s.side} aria-label="voice and patch" />
        <section className={s.score}>
          <Transport
            playing={playing}
            onPlaying={play}
            rate={rate}
            onRate={setRate}
            loop={loop}
            onLoop={setLoop}
            t={player.t}
            length={comp.length}
            live={live}
            onLive={setLive}
            levels={comp.levels}
            moved={player.moved}
            onLevel={(name, v) => {
              player.setLevel(name, v);
              tick();
            }}
          />
          <ScoreLanes
            clips={clips}
            links={links}
            duration={comp.length}
            playhead={player.t}
            selected={selected}
            onSelect={setSelected}
            onScrub={scrub}
            onEdit={edit}
          />
        </section>
      </div>
    </LabShell>
  );
}
