// @vitest-environment happy-dom
import { type Clip, ScoreLanes, type ScoreLanesProps } from '@pg/widgets/ScoreLanes';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const clip = (c: Partial<Clip>): Clip => ({
  id: 'a',
  lane: 0,
  label: 'a',
  hue: 200,
  start: 0,
  pass: 500,
  passes: 2,
  fadeIn: 0,
  fadeOut: 0,
  spread: 0,
  freezeBefore: false,
  freezeAfter: false,
  ...c,
});

function mount(props: Partial<ScoreLanesProps>) {
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  const all: ScoreLanesProps = {
    clips: [],
    links: [],
    duration: 4000,
    playhead: 0,
    selected: null,
    onSelect: () => {},
    onEdit: () => {},
    onScrub: () => {},
    ...props,
  };
  act(() => root?.render(createElement(ScoreLanes, all)));
  const svg = host.querySelector('svg[aria-label="score"]') as SVGSVGElement;
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 100 }) as DOMRect;
  return svg;
}
const pointer = (el: Element, type: string, clientX: number) =>
  act(() => {
    el.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX, clientY: 40 }),
    );
  });

describe('ScoreLanes', () => {
  it('holds a drag on the score, which outlives the handle that began it', () => {
    const held: Element[] = [];
    vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(function (this: Element) {
      held.push(this);
    });
    const svg = mount({ clips: [clip({ passes: Number.POSITIVE_INFINITY })] });
    const arrow = svg.querySelector('[aria-label="end a\'s loop"]') as Element;
    pointer(arrow, 'pointerdown', 990);
    pointer(svg, 'pointermove', 600);
    expect(svg.querySelector('[aria-label="end a\'s loop"]')).toBeNull();
    expect(held).toEqual([svg]);
  });

  it('drops a drag that loses the pointer, with no edit', () => {
    vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(() => {});
    const onEdit = vi.fn();
    const svg = mount({ clips: [clip({ passes: Number.POSITIVE_INFINITY })], onEdit });
    pointer(svg.querySelector('[aria-label="end a\'s loop"]') as Element, 'pointerdown', 990);
    pointer(svg, 'pointermove', 600);
    pointer(svg, 'lostpointercapture', 600);
    pointer(svg, 'pointermove', 700);
    pointer(svg, 'pointerup', 700);
    expect(onEdit).not.toHaveBeenCalled();
  });
});
