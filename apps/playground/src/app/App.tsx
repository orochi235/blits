import { syncBlend, withVoice } from '@pg/blits/blend';
import { compile } from '@pg/blits/compile';
import { type Composition, type Group, MAX_VOICES, type Voice } from '@pg/blits/composition';
import { coursesOf } from '@pg/blits/course';
import { FRAME } from '@pg/blits/frame';
import { addGroup, deleteGroup, setGroup } from '@pg/blits/groupEdits';
import { Player, type SeekBy } from '@pg/blits/player';
import { DEFAULT, PRESETS } from '@pg/blits/presets';
import { applyEdit } from '@pg/blits/score';
import { subjectsOf } from '@pg/blits/stage';
import { Stage } from '@pg/blits/stages/Stage';
import { type ClipEdit, ScoreLanes } from '@pg/widgets/ScoreLanes';
import { LabShell, Split, usePersistedState } from '@weasel-js/labkit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import s from './App.module.css';
import { CompFields, StageControls } from './CompositionControls';
import { DiagramTabs } from './DiagramTabs';
import { EventsPanel } from './EventsPanel';
import { freshVoice } from './freshVoice';
import { Inspector } from './Inspector';
import { type PanelTab, PanelTabs } from './PanelTabs';
import { ReadBack } from './ReadBack';
import { Transport } from './Transport';
import { useComposition } from './useComposition';
import { usePlayback } from './usePlayback';
import { useScore } from './useScore';
import { useTracksOpen } from './useTracksOpen';
import { VoiceColumn } from './VoiceColumn';

/** How long "link copied" stays up. */
const NOTICE_MS = 3000;
/** The right column's width before anyone drags its edge. */
const PANEL_WIDTH = 440;

export function App() {
  const { comp, set, undo, redo, share } = useComposition(DEFAULT);
  const compRef = useRef(comp);
  compRef.current = comp;
  const subjects = useMemo(() => subjectsOf(comp.stage), [comp.stage]);
  const last = useRef<Player | null>(null);
  const compiled = useRef<Composition | null>(null);
  // A new stage needs new columns, so a new player; it takes over the old one's playhead and sliders.
  const player = useMemo(() => {
    const build = () => compile(compRef.current, subjects, { solos: true, name: 'playground' });
    const p = new Player(build, subjects, { levels: compRef.current.levels, from: last.current });
    last.current = p;
    compiled.current = compRef.current;
    return p;
  }, [subjects]);
  const [frame, setFrame] = useState(0);
  const tick = useCallback(() => setFrame((f) => f + 1), []);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(true);
  const { playing, play } = usePlayback(player, compRef, { rate, loop, tick });
  const [live, setLive] = useState(false);
  const [seekBy, setSeekBy] = useState<SeekBy>('replay');
  useEffect(() => {
    player.seekBy = seekBy;
  }, [player, seekBy]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>('plots');
  const [panelWidth, setPanelWidth] = usePersistedState('panelWidth', PANEL_WIDTH, {
    scope: 'lab',
  });
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

  const { clips, links, headers, marks, built, fold } = useScore(comp, subjects);
  const tracks = useMemo(() => coursesOf(comp, subjects, shown ?? 0), [comp, subjects, shown]);
  const [tracksOpen, toggleTracks] = useTracksOpen();
  const scrub = (t: number) => {
    player.seek(Math.min(Math.max(t, 0), comp.length));
    tick();
  };
  const edit = (e: ClipEdit) => set(applyEdit(compRef.current, e, built));
  const voice = comp.voices.find((v) => v.id === selected);
  const group = comp.groups?.find((g) => g.id === selected);
  const setVoice = (next: Voice) => set(withVoice(compRef.current, next));
  const addVoice = () => {
    if (compRef.current.voices.length >= MAX_VOICES) return;
    const v = freshVoice(compRef.current.voices);
    set({ ...compRef.current, voices: [...compRef.current.voices, v] });
    pickVoice(v.id);
  };
  const deleteVoice = (id: string) => {
    const voices = compRef.current.voices.filter((v) => v.id !== id);
    set(syncBlend({ ...compRef.current, voices }, id));
    setSelected(null);
  };
  const addGroupOf = (kind: Group['kind']) => {
    const was = compRef.current;
    const next = addGroup(was, kind);
    if (next === was) return;
    set(next);
    pickVoice(next.groups?.at(-1)?.id ?? null);
  };
  const removeGroup = (id: string) => {
    set(deleteGroup(compRef.current, id));
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

  const panels = (
    <PanelTabs
      tab={tab}
      onTab={setTab}
      plots={
        <>
          <Inspector player={player} comp={comp} />
          <ReadBack player={player} />
        </>
      }
      voice={
        <VoiceColumn
          comp={comp}
          onComp={set}
          voice={voice}
          group={group}
          player={player}
          subject={shown !== null ? subjects[shown] : undefined}
          live={live}
          shared={shared}
          linkRef={linkRef}
          onAddVoice={addVoice}
          onAddGroup={addGroupOf}
          onDeleteVoice={deleteVoice}
          onVoice={setVoice}
          onGroup={(g) => set(setGroup(compRef.current, g))}
          onDeleteGroup={removeGroup}
          onShare={copyLink}
          onCloseShare={() => setShared(null)}
          onActed={tick}
        />
      }
      events={<EventsPanel player={player} comp={comp} onComp={set} live={live} onActed={tick} />}
    />
  );

  return (
    <LabShell title="blits playground" mode="dark" header={header}>
      <Split
        className={s.split}
        contentClassName={s.grid}
        side="end"
        label="panels"
        width={panelWidth}
        defaultWidth={PANEL_WIDTH}
        minWidth={280}
        maxWidth={960}
        contentMinWidth={560}
        onWidthChange={setPanelWidth}
        sidebar={panels}
      >
        <section className={s.stage} aria-label="stage">
          <StageControls comp={comp} onChange={set} />
          <Stage
            stage={comp.stage}
            subjects={subjects}
            columns={player.columns}
            colorAxes={player.built.colorAxes}
            frame={frame}
            picked={shown}
            onPick={setPicked}
            onPoint={(x, y) => {
              player.point(x, y);
              tick();
            }}
          />
        </section>
        <DiagramTabs
          comp={comp}
          faulted={faulted}
          player={player}
          selected={selected}
          onVoice={pickVoice}
          onComp={set}
        />
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
            onStep={(n) => scrub(player.t + n * FRAME)}
            clock={player.clock}
            mixRate={player.built.mix.rate}
            onMixRate={(r, over) => {
              player.liveMix((m) => {
                if (over === undefined) m.rate = r;
                else m.ramp(r, over);
              });
              tick();
            }}
            onMute={(over) => {
              player.liveMix((m) => m.mute(over === undefined ? undefined : { over }));
              tick();
            }}
            levels={comp.levels}
            moved={player.moved}
            onLevel={(name, v) => {
              player.setLevel(name, v);
              tick();
            }}
            tracksOpen={tracksOpen}
            onTracks={toggleTracks}
          />
          <ScoreLanes
            clips={clips}
            links={links}
            headers={headers}
            marks={marks}
            onFold={fold}
            tracks={tracks}
            open={tracksOpen}
            duration={comp.length}
            playhead={player.t}
            selected={selected}
            onSelect={pickVoice}
            onScrub={scrub}
            onEdit={edit}
          />
        </section>
      </Split>
    </LabShell>
  );
}
