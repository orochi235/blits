/** The words in reading order. Each is a page at `/<slug>/` and a TypeDoc `@category`. */
export const words = [
  { slug: 'channel', title: 'Channel and kit' },
  { slug: 'patch', title: 'Patch' },
  { slug: 'voice', title: 'Voice' },
  { slug: 'mix', title: 'Mix' },
  { slug: 'signal', title: 'Signal' },
  { slug: 'time', title: 'Time' },
  { slug: 'blending', title: 'Blending' },
  { slug: 'role', title: 'Role' },
  { slug: 'score', title: 'Score' },
  { slug: 'state', title: 'Patch state' },
  { slug: 'engine', title: 'Engine' },
] as const;

export type Word = (typeof words)[number]['slug'];

/** The pages for someone starting out, above the words. */
export const start = [
  { slug: 'start', title: 'Get started' },
  { slug: 'guides', title: 'Guides' },
  { slug: 'examples', title: 'Examples' },
  { slug: 'why', title: 'Why blits' },
] as const;

/** One task each, at `/guides/<slug>/`, in the order the guides index lists them. */
export const guides = [
  { slug: 'frame-loop', title: 'The frame loop and hidden tabs' },
  { slug: 'in-order', title: 'Effects in order' },
  { slug: 'scrubbing', title: 'Scrubbing and reading ahead' },
  { slug: 'react', title: 'From React' },
  { slug: 'three', title: 'Driving three.js' },
  { slug: 'physics', title: 'Physics with Rapier' },
  { slug: 'patch-library', title: 'Shipping your own patches' },
  { slug: 'lean', title: 'A smaller bundle' },
  { slug: 'debugging', title: 'Debugging a mix' },
] as const;

/** The examples with a page of their own, at `/examples/<slug>/`, after the examples index. */
export const examples = [
  { slug: 'blend-modes', title: 'Blend modes' },
  { slug: 'number-rules', title: 'Number rules' },
  { slug: 'stack-order', title: 'Order matters' },
  { slug: 'light-board', title: 'Light board' },
  { slug: 'retheme', title: 'Retheme' },
  { slug: 'threshold-wipe', title: 'Threshold wipe' },
  { slug: 'hit-flash', title: 'Hit flash' },
  { slug: 'white-balance', title: 'White balance' },
] as const;

export const extra = [
  { slug: 'glossary', title: 'Glossary' },
  { slug: 'reference', title: 'Reference' },
  { slug: 'changelog', title: 'Changelog' },
  { slug: 'built-on', title: 'Built on blits' },
] as const;

/** Apps the dev server links to; they run only on this machine, so the built site leaves them out. */
export const local = [{ href: 'http://localhost:4881/', title: 'Playground (local)' }] as const;

interface Entry {
  slug: string;
  title: string;
}

/** The pages listed under a page in `start`, each at `/<parent>/<slug>/`. */
export const under: Record<string, readonly Entry[]> = { guides, examples };

/** Every page in the order prev and next walk: the rail top to bottom, each subpage after its index. */
export const reading: readonly Entry[] = [
  ...start.flatMap((p): Entry[] => [
    p,
    ...(under[p.slug] ?? []).map((g) => ({ slug: `${p.slug}/${g.slug}`, title: g.title })),
  ]),
  ...words,
  ...extra,
];
