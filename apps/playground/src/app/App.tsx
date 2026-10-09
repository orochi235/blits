import { compile } from '@pg/blits/compile';
import { type Composition, MAX_VOICES, type Voice } from '@pg/blits/composition';
import { FRAME } from '@pg/blits/frame';
import { Player, type SeekBy } from '@pg/blits/player';
import { DEFAULT, PRESETS } from '@pg/blits/presets';
import { applyEdit, clipsOf } from '@pg/blits/score';
import { subjectsOf } from '@pg/blits/stage';
import { Stage } from '@pg/blits/stages/Stage';
import { type ClipEdit, ScoreLanes } from '@pg/widgets/ScoreLanes';
import { LabShell } from '@weasel-js/labkit';
import { Tab, TabList, TabPanel, Tabs } from '@weasel-js/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import s from './App.module.css';
import { CompFields, StageControls } from './CompositionControls';
import { FlowPanel } from './FlowPanel';
import { Inspector } from './Inspector';
import { Transport } from './Transport';
import { useComposition } from './useComposition';
import { VoiceColumn } from './VoiceColumn';

/** The most wall time one tick plays, so a hidden tab coming back does not replay seconds at once. */
const MAX_TICK_MS = 250;

/** How long "link copied" stays up. */
const NOTICE_MS = 3000;

let made = 0;
const freshId = () =>
  typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `v${Date.now()}-${++made}`;

function freshVoice(voices: readonly Voice[]): Voice {
  const names = new Set(voices.map((v) => v.name));
  let n = voices.length + 1;
  while (names.has(`voice ${n}`)) n++;
  return {
    id: freshId(),
    name: `voice ${n}`,
    hue: (voices.length * 67) % 360,
    start: 0,
    rate: 1,
    loop: true,
    weight: 1,
    fade: {},
    patch: {
      kind: 'keys',
      period: 1000,
      stops: [
        { at: 0, delta: { glow: 0 } },
        { at: 0.5, delta: { glow: 1 }, ease: 'ease-in-out' },
        { at: 1, delta: { glow: 0 }, ease: 'ease-in-out' },
      ],
    },
  };
}

export function App() {
  const { comp, set, undo, redo, share } = useComposition(DEFAULT);
  const compRef = useRef(comp);
  compRef.current = comp;
  const subjects = useMemo(() => subjectsOf(comp.stage), [comp.stage]);
  const last = useRef<Player | null>(null);
  const compiled = useRef<Composition | null>(null);
  // A new stage needs new columns, so a new player; it takes over the old one's playhead and sliders.
  const player = useMemo(() => {
    const build = () => compile(compRef.current, subjects, { solos: true });
    const p = new Player(build, subjects, { levels: compRef.current.levels, from: last.current });
    last.current = p;
    compiled.current = compRef.current;
    return p;
  }, [subjects]);
  const [frame, setFrame] = useState(0);
  const tick = useCallback(() => setFrame((f) => f + 1), []);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(true);
  const [live, setLive] = useState(false);
  const [seekBy, setSeekBy] = useState<SeekBy>('replay');
  useEffect(() => {
    player.seekBy = seekBy;
  }, [player, seekBy]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'plots' | 'voice'>('plots');
  const faultKey = player.built.errors.map((e) => e.voice ?? '').join('|');
  const faulted = useMemo(() => new Set(faultKey.split('|').filter(Boolean)), [faultKey]);
  const pickVoice = (id: string | null) => {
    setSelected(id);
    if (id !== null) setTab('voice');
  };
  const [picked, setPicked] = useState<number | null>(0);
  const shown = picked !== null && picked < subjects.length ? picked : null;
  useEffect(() => player.pick(shown), [player, shown]);
  // A link the clipboard took, or one it refused, left on screen to copy by hand.
  const [shared, setShared] = useState<{ copied: boolean; url: string } | null>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    linkRef.current?.select();
    if (!shared?.copied) return;
    const id = setTimeout(() => setShared(null), NOTICE_MS);
    return () => clearTimeout(id);
  }, [shared]);

  // Every edit recompiles and replays to the playhead.
  useEffect(() => {
    if (compiled.current !== comp) player.rebuild(comp.levels);
    compiled.current = comp;
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
          t = length > 0 ? t % length : 0;
        }
        player.seek(t);
        tick();
      }
      id = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(id);
  }, [playing, rate, loop, player, tick]);

  const play = useCallback(
    (on: boolean) => {
      if (on && player.t >= compRef.current.length - FRAME) player.seek(0);
      setPlaying(on);
    },
    [player],
  );

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

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      // The score's handles take space themselves; a button's or canvas's own use of it is cancelled.
      const skip = 'input, textarea, select, [contenteditable], [tabindex]:not(button, canvas)';
      if ((e.target as HTMLElement).closest(skip)) return;
      e.preventDefault();
      if (!e.repeat) play(!playing);
    };
    // Capture, because weasel's canvases claim space for their hand tool on the window.
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [play, playing]);

  const { clips, links } = useMemo(() => clipsOf(comp, subjects), [comp, subjects]);
  const scrub = (t: number) => {
    player.seek(Math.min(Math.max(t, 0), comp.length));
    tick();
  };
  const edit = (e: ClipEdit) => set(applyEdit(compRef.current, e));
  const voice = comp.voices.find((v) => v.id === selected);
  const setVoice = (next: Voice) =>
    set({
      ...compRef.current,
      voices: compRef.current.voices.map((v) => (v.id === next.id ? next : v)),
    });
  const addVoice = () => {
    if (compRef.current.voices.length >= MAX_VOICES) return;
    const v = freshVoice(compRef.current.voices);
    set({ ...compRef.current, voices: [...compRef.current.voices, v] });
    pickVoice(v.id);
  };
  const deleteVoice = (id: string) => {
    set({ ...compRef.current, voices: compRef.current.voices.filter((v) => v.id !== id) });
    setSelected(null);
  };
  const copyLink = () => {
    const url = share();
    const failed = () => setShared({ copied: false, url });
    if (!navigator.clipboard?.writeText) return failed();
    navigator.clipboard.writeText(url).then(() => setShared({ copied: true, url }), failed);
  };

  const loadPreset = (name: string) => {
    const preset = PRESETS.find((x) => x.name === name);
    if (!preset) return;
    set(preset.comp);
    setSelected(null);
  };
  const header = (
    <div className={s.header}>
      <label className={s.row}>
        preset
        <select
          value={PRESETS.find((x) => x.comp === comp)?.name ?? ''}
          onChange={(e) => loadPreset(e.target.value)}
        >
          <option value="" disabled>
            {comp.title}
          </option>
          {PRESETS.map((x) => (
            <option key={x.name} value={x.name}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <CompFields comp={comp} onChange={set} />
    </div>
  );

  return (
    <LabShell title="blits playground" mode="dark" header={header}>
      <div className={s.grid}>
        <section className={s.stage} aria-label="stage">
          <StageControls comp={comp} onChange={set} />
          <Stage
            stage={comp.stage}
            subjects={subjects}
            columns={player.columns}
            frame={frame}
            picked={shown}
            onPick={setPicked}
          />
        </section>
        <section className={s.inspector} aria-label="inspector">
          <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as 'plots' | 'voice')}>
            <TabList aria-label="middle column">
              <Tab id="plots">Plots</Tab>
              <Tab id="voice">Voice</Tab>
            </TabList>
            <TabPanel id="plots">
              <Inspector player={player} comp={comp} />
            </TabPanel>
            <TabPanel id="voice">
              <VoiceColumn
                comp={comp}
                onComp={set}
                voice={voice}
                player={player}
                subject={shown !== null ? subjects[shown] : undefined}
                live={live}
                shared={shared}
                linkRef={linkRef}
                onAddVoice={addVoice}
                onDeleteVoice={deleteVoice}
                onVoice={setVoice}
                onShare={copyLink}
                onCloseShare={() => setShared(null)}
                onActed={tick}
              />
            </TabPanel>
          </Tabs>
        </section>
        <aside className={s.side} aria-label="flow">
          <FlowPanel comp={comp} faulted={faulted} selected={selected} onVoice={pickVoice} />
        </aside>
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
            livened={player.livened}
            seekBy={seekBy}
            onSeekBy={setSeekBy}
            mixRate={player.built.mix.rate}
            onMixRate={(r) => {
              player.liveMix((m) => {
                m.rate = r;
              });
              tick();
            }}
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
            onSelect={pickVoice}
            onScrub={scrub}
            onEdit={edit}
          />
        </section>
      </div>
    </LabShell>
  );
}
