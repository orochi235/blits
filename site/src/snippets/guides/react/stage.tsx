import { kit, type Mix, mix, mul, sum } from '@msb235/blits';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface CardPose {
  y: number;
  scale: number;
}

export const CARD = kit<CardPose>({ y: sum(), scale: mul() });

/** What a component under the provider reaches: the mix once it is made, and a ref for its element. */
export interface Stage {
  mix: Mix<HTMLElement, CardPose> | null;
  /** A ref callback: pass it as `ref` and the loop draws the element until it unmounts. */
  track(el: HTMLElement | null): (() => void) | undefined;
}

const StageContext = createContext<Stage | null>(null);

export function useStage(): Stage {
  const stage = useContext(StageContext);
  if (stage === null) throw new Error('useStage needs a <StageProvider> above it');
  return stage;
}

export function StageProvider({ children }: { children: ReactNode }) {
  // The elements the loop draws, kept outside React state: adding one renders nothing.
  const elements = useRef(new Set<HTMLElement>()).current;
  const [m, setMix] = useState<Mix<HTMLElement, CardPose> | null>(null);

  useEffect(() => {
    const m = mix<HTMLElement, CardPose>(CARD, { name: 'cards' });
    setMix(m);
    const pose = { y: 0, scale: 1 };
    let id = requestAnimationFrame(function frame(now) {
      m.sync(now);
      for (const el of elements) {
        m.probe(el, pose);
        el.style.transform = `translateY(${pose.y}px) scale(${pose.scale})`;
      }
      id = requestAnimationFrame(frame);
    });
    const shown = () => document.hidden || m.rebase();
    document.addEventListener('visibilitychange', shown);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('visibilitychange', shown);
      m.close();
    };
  }, [elements]);

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
