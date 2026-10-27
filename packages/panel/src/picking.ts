import { offered } from './offer.js';
import { Outline } from './outline.js';

interface Hooks {
  /** The mix that lists a subject, by id. */
  owner(subject: unknown): number | undefined;
  arming(on: boolean): void;
  picked(subject: unknown, mix: number): void;
}

/** Picking a subject by clicking it on the page, and the outline drawn over it. */
export function picking(
  opts: {
    pick?: (x: number, y: number) => unknown;
    outline?: (subject: unknown) => DOMRect | undefined;
    ignore?: Element;
  },
  hooks: Hooks,
) {
  const box = new Outline();
  const outline = (s: unknown) => {
    let rect: DOMRect | undefined;
    if (s !== undefined)
      rect =
        (opts.outline ?? offered().outline)?.(s) ??
        (s instanceof Element ? s.getBoundingClientRect() : undefined);
    box.show(rect);
  };

  const inPanel = (ev: Event) =>
    opts.ignore !== undefined && ev.composedPath().includes(opts.ignore);

  /** The subject under a point, and the mix that lists it. */
  const at = (x: number, y: number): [unknown, number] | undefined => {
    const custom = (opts.pick ?? offered().pick)?.(x, y);
    if (custom !== undefined) {
      const e = hooks.owner(custom);
      if (e !== undefined) return [custom, e];
    }
    const els =
      typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(x, y)
        : [document.elementFromPoint(x, y)].filter((el): el is Element => el !== null);
    for (const el of els) {
      if (el === box.el || opts.ignore?.contains(el)) continue;
      for (let n: Element | null = el; n !== null; n = n.parentElement) {
        const e = hooks.owner(n);
        if (e !== undefined) return [n, e];
      }
    }
    return undefined;
  };

  const onMove = (ev: PointerEvent) => {
    if (inPanel(ev)) return;
    outline(at(ev.clientX, ev.clientY)?.[0]);
  };
  const onClick = (ev: MouseEvent) => {
    if (inPanel(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const hit = at(ev.clientX, ev.clientY);
    arm(false);
    if (hit !== undefined) hooks.picked(hit[0], hit[1]);
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') arm(false);
  };
  let armed = false;
  const arm = (on: boolean) => {
    if (on === armed) return;
    armed = on;
    if (on) {
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
    } else {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      outline(undefined);
    }
    hooks.arming(on);
  };

  return { arm, outline };
}
