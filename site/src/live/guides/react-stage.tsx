import { type Handle, keys, kit, type Mix, mix, mul, patch, sum } from '@msb235/blits';
import { createHistory } from '@weasel-js/history';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { loop } from '../loop';

interface CardPose {
  y: number;
  scale: number;
}

const CARD = kit<CardPose>({ y: sum(), scale: mul() });

interface Stage {
  mix: Mix<HTMLElement, CardPose> | null;
  track(el: HTMLElement | null): (() => void) | undefined;
}

const StageContext = createContext<Stage | null>(null);

function useStage(): Stage {
  const stage = useContext(StageContext);
  if (stage === null) throw new Error('useStage needs a <StageProvider> above it');
  return stage;
}

function StageProvider({
  children,
  root,
  onFrame,
}: {
  children: ReactNode;
  root: Element;
  onFrame: () => void;
}) {
  const elements = useRef(new Set<HTMLElement>()).current;
  const [m, setMix] = useState<Mix<HTMLElement, CardPose> | null>(null);
  useRendered();

  useEffect(() => {
    const m = mix<HTMLElement, CardPose>(CARD, {
      name: 'cards',
      history: { ms: 10_000, tape: createHistory },
    });
    setMix(m);
    const pose = { y: 0, scale: 1 };
    const stop = loop(m, root, (now) => {
      m.sync(now);
      for (const el of elements) {
        m.probe(el, pose);
        el.style.transform = `translateY(${pose.y}px) scale(${pose.scale})`;
      }
      onFrame();
    });
    return () => {
      stop();
      m.close();
    };
  }, [elements, onFrame, root]);

  const stage = useMemo<Stage>(
    () => ({
      mix: m,
      track(el) {
        if (el === null) return undefined;
        elements.add(el);
        return () => {
          elements.delete(el);
          m?.drop(el);
        };
      },
    }),
    [m, elements],
  );
  return <StageContext.Provider value={stage}>{children}</StageContext.Provider>;
}

const lift = keys<HTMLElement, CardPose>(
  400,
  [
    { at: 0, delta: { y: 0, scale: 1 } },
    { at: 0.4, delta: { y: -12, scale: 1.06 }, ease: 'ease-out' },
    { at: 1, delta: { y: 0, scale: 1 }, ease: 'ease-in' },
  ],
  {},
);

const raised = patch<HTMLElement, CardPose>(0, () => ({ y: -6, scale: 1.03 }), {
  writes: ['y', 'scale'],
});

function Card({ title }: { title: string }) {
  const stage = useStage();
  const hover = useRef<Handle | undefined>(undefined);
  const latest = useRef<Handle | undefined>(undefined);
  const [lifted, setLifted] = useState(false);
  useRendered();
  return (
    <div className="react-card">
      <button
        type="button"
        className="card"
        ref={stage.track}
        onPointerEnter={(e) => {
          hover.current = stage.mix?.cue({
            patch: raised,
            subjects: [e.currentTarget],
            fade: { in: 150, out: 300 },
          });
        }}
        onPointerLeave={() => hover.current?.fade()}
        onClick={(e) => {
          const h = stage.mix?.cue({ patch: lift, subjects: [e.currentTarget] });
          if (h === undefined) return;
          latest.current = h;
          setLifted(true);
          void h.done.then(() => latest.current === h && setLifted(false));
        }}
      >
        {title}
      </button>
      <span className="react-card-state">{lifted ? 'lifted' : 'resting'}</span>
    </div>
  );
}

const breathe = patch<HTMLElement, CardPose>(
  2400,
  (phase) => {
    const s = Math.sin(2 * Math.PI * phase);
    return { y: -3 * s, scale: 1 + 0.02 * s };
  },
  { writes: ['y', 'scale'] },
);

function Breathe() {
  const { mix } = useStage();
  useRendered();
  useEffect(() => {
    const h = mix?.cue({ patch: breathe, loop: true, fade: { in: 400, out: 400 } });
    return () => h?.fade();
  }, [mix]);
  return null;
}

function BreatheSwitch() {
  const [breathing, setBreathing] = useState(true);
  useRendered();
  return (
    <>
      {breathing && <Breathe />}
      <button type="button" className="switch" onClick={() => setBreathing((b) => !b)}>
        {breathing ? 'Stop breathing' : 'Breathe'}
      </button>
    </>
  );
}

const RenderCount = createContext<() => void>(() => {});

/** Counts each commit of the calling component, once even where StrictMode runs effects twice. */
function useRendered() {
  const counted = useContext(RenderCount);
  const commit = {};
  const last = useRef<object | null>(null);
  useEffect(() => {
    if (last.current === commit) return;
    last.current = commit;
    counted();
  });
}

export function Demo({
  root,
  onRender,
  onFrame,
}: {
  root: Element;
  onRender: () => void;
  onFrame: () => void;
}) {
  return (
    <RenderCount.Provider value={onRender}>
      <StageProvider root={root} onFrame={onFrame}>
        <div className="cards">
          {['Channel', 'Patch', 'Voice', 'Mix'].map((title) => (
            <Card key={title} title={title} />
          ))}
        </div>
        <BreatheSwitch />
      </StageProvider>
    </RenderCount.Provider>
  );
}
