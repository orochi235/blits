import { ControlPanel, interstellarTheme, resolveConfigSchema } from '@weasel-js/labkit';
import { ThemeProvider } from '@weasel-js/theme/react';
import '@weasel-js/labkit/styles.css';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { type Ink, readInk } from './ink';
import { type Frame, Player, type Scene } from './scene';

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
}: ExplainerProps<I, O, C>) {
  const s = (schema ?? noConfig) as Schema<C>;
  const resolved = useMemo(() => (schema ? resolveConfigSchema(schema) : null), [schema]);
  const [config, setConfig] = useState<C>(() => s.defaults());
  const built = useMemo(() => scene(config), [scene, config]);
  const player = useMemo(() => new Player(built, config), [built, config]);

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
        <canvas ref={canvas} />
      </div>
      <div className="explainer-transport">
        <button type="button" onClick={() => setPlaying((p) => !p)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          aria-label="Time"
          min={0}
          max={duration}
          step={1}
          value={Math.round(t)}
          onChange={(e) => {
            setPlaying(false);
            setT(Number(e.target.value));
          }}
        />
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

function Ledger<I, O>({
  frame,
  channels,
  focus,
  format,
}: {
  frame: Frame<I, O>;
  channels: readonly string[];
  focus: number;
  format?: Partial<Record<string, (v: unknown) => ReactNode>>;
}) {
  const show = (key: string, v: unknown): ReactNode => {
    const f = format?.[key];
    if (f) return f(v);
    return fmt(v);
  };
  const pose = (frame.poses[focus] ?? {}) as Record<string, unknown>;
  return (
    <table className="ledger">
      <thead>
        <tr>
          <th scope="col">Voice</th>
          <th scope="col" className="num">
            Weight
          </th>
          {channels.map((c) => (
            <th key={c} scope="col" className="num">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {frame.voices.map((v, i) => {
          const h = frame.handles[i];
          const alone = (frame.alone[i] ?? {}) as Record<string, unknown>;
          return (
            <tr key={v.name} className={h?.state === 'done' ? 'gone' : undefined}>
              <th scope="row">
                <span className="swatch" data-color={v.color} />
                {v.name}
              </th>
              <td className="num">{h ? fmt(h.weightOf(frame.subjects[focus] as I)) : ''}</td>
              {channels.map((c) => (
                <td key={c} className="num">
                  {show(c, alone[c])}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Folded</th>
          <td className="num" />
          {channels.map((c) => (
            <td key={c} className="num">
              {show(c, pose[c])}
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
}

export function fmt(v: unknown): string {
  if (typeof v === 'number') return v.toFixed(3);
  if (Array.isArray(v)) return v.map((x) => fmt(x)).join(', ');
  if (v === undefined) return '—';
  return String(v);
}

function useReducedMotion(): boolean {
  const [r] = useState(
    () =>
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  return r;
}

/** A stage, its controls, and its caption fit a window about 800 px tall together. */
const MAX_STAGE_H = 400;

function useWidth(ref: React.RefObject<HTMLElement | null>, aspect: number): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry?.contentRect.width ?? 0);
      setSize({ w, h: Math.min(MAX_STAGE_H, Math.round(w * aspect)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, aspect]);
  return size;
}

/** Whether the window has focus: a page behind another app stops playing, as one scrolled away does. */
function useFocused(): boolean {
  const [on, setOn] = useState(() => typeof document === 'undefined' || document.hasFocus());
  useEffect(() => {
    const focus = () => setOn(true);
    const blur = () => setOn(false);
    window.addEventListener('focus', focus);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('focus', focus);
      window.removeEventListener('blur', blur);
    };
  }, []);
  return on;
}

function useVisible(ref: React.RefObject<HTMLElement | null>): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOn(entry?.isIntersecting ?? true));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return on;
}
