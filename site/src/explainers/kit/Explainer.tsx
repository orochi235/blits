import { ControlPanel, interstellarTheme, resolveConfigSchema } from '@weasel-js/labkit';
import { ThemeProvider } from '@weasel-js/theme/react';
import '@weasel-js/labkit/styles.css';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useFocused, useReducedMotion, useVisible, useWidth } from './hooks';
import { type Ink, readInk } from './ink';
import { Ledger } from './Ledger';
import { type Frame, Player, type Scene, weightsOver } from './scene';
import { Timeline } from './Timeline';

type Schema<C> = { defaults(): C } & Parameters<typeof resolveConfigSchema>[0];

export interface ExplainerProps<I, O, C> {
  /** Builds the scene from the current config. Called again whenever a control moves. */
  scene: (config: C) => Scene<I, O, C>;
  schema?: Schema<C>;
  /** Explainer ms one play-through lasts before it loops. */
  duration: number;
  /** Stage height as a fraction of its width, up to `MAX_STAGE_H`. */
  aspect?: number;
  draw(ctx: CanvasRenderingContext2D, frame: Frame<I, O>, size: Size, ink: Ink, config: C): void;
  /** How the ledger prints one channel's value. Numbers default to three decimals. */
  format?: Partial<Record<string, (v: unknown) => ReactNode>>;
  /** A line under the stage saying what to look at. */
  caption?: ReactNode;
  /** What a click on the stage changes in the config, given where it landed; nothing for undefined. */
  pick?(x: number, y: number, size: Size, config: C): Partial<C> | undefined;
}

export interface Size {
  w: number;
  h: number;
}

const noConfig = { defaults: () => ({}) } as unknown as Schema<never>;

export function Explainer<I, O, C>(props: ExplainerProps<I, O, C>) {
  return (
    <ThemeProvider theme={interstellarTheme} selection={{ mode: 'auto' }}>
      <ExplainerBody {...props} />
    </ThemeProvider>
  );
}

function ExplainerBody<I, O, C>({
  scene,
  schema,
  duration,
  aspect = 0.4,
  draw,
  format,
  caption,
  pick,
}: ExplainerProps<I, O, C>) {
  const s = (schema ?? noConfig) as Schema<C>;
  const resolved = useMemo(() => (schema ? resolveConfigSchema(schema) : null), [schema]);
  const [config, setConfig] = useState<C>(() => s.defaults());
  const built = useMemo(() => scene(config), [scene, config]);
  const player = useMemo(() => new Player(built, config), [built, config]);
  useEffect(() => () => player.close(), [player]);
  const tracks = useMemo(() => {
    const weights = weightsOver(built, config, duration);
    const voices = built.voices(config);
    // A scene that cues its voices from events still needs something to scrub along.
    if (voices.length === 0) return [{ name: '', color: '', weights: [1, 1] }];
    return voices.map((v, i) => ({ name: v.name, color: v.color, weights: weights[i] ?? [] }));
  }, [built, config, duration]);

  const reduced = useReducedMotion();
  const [playing, setPlaying] = useState(!reduced);
  const [t, setT] = useState(0);
  const [frame, setFrame] = useState<Frame<I, O> | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useWidth(canvas, aspect);
  const visible = useVisible(canvas);
  const focused = useFocused();

  useEffect(() => {
    if (!playing || !visible || !focused) return;
    let last = performance.now();
    let id = requestAnimationFrame(function tick(now) {
      const dt = Math.min(now - last, 100);
      last = now;
      setT((prev) => (prev + dt >= duration ? 0 : prev + dt));
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [playing, visible, focused, duration]);

  useEffect(() => {
    const f = player.at(t);
    setFrame(f);
    const el = canvas.current;
    if (!el || size.w === 0) return;
    const ratio = window.devicePixelRatio || 1;
    el.width = Math.round(size.w * ratio);
    el.height = Math.round(size.h * ratio);
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    draw(ctx, f, size, readInk(el), config);
  }, [player, t, size, draw, config]);

  const ledger = built.ledger;
  return (
    <figure className="explainer">
      <div className="explainer-stage">
        <canvas
          ref={canvas}
          className={pick ? 'pickable' : undefined}
          onClick={
            pick &&
            ((e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const change = pick(e.clientX - r.left, e.clientY - r.top, size, config);
              if (change) setConfig((c) => ({ ...c, ...change }));
            })
          }
        />
      </div>
      <Timeline
        duration={duration}
        t={t}
        tracks={tracks}
        seek={(to) => {
          setPlaying(false);
          setT(to);
        }}
      />
      <div className="explainer-transport">
        <button type="button" onClick={() => setPlaying((p) => !p)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <output className="explainer-time">{(t / 1000).toFixed(2).padStart(5, ' ')} s</output>
      </div>
      {caption && <figcaption>{caption}</figcaption>}
      <div className="explainer-panels">
        {ledger && frame && (
          <Ledger
            frame={frame}
            channels={ledger.channels}
            focus={frame.subjects.indexOf(ledger.subject(frame.subjects))}
            format={format}
          />
        )}
        {resolved && (
          <div className="explainer-controls">
            <ControlPanel
              schema={resolved}
              config={config as Record<string, unknown>}
              setConfig={(path, value) => setConfig((c) => ({ ...c, [path]: value }) as C)}
            />
          </div>
        )}
      </div>
    </figure>
  );
}
