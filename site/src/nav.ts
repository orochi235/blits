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
  { slug: 'patch-library', title: 'Shipping your own patches' },
  { slug: 'lean', title: 'A smaller bundle' },
  { slug: 'debugging', title: 'Debugging a mix' },
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

/** Every page in the order prev and next walk: the rail top to bottom, each guide after the index. */
export const reading: readonly Entry[] = [
  ...start.flatMap((p): Entry[] =>
    p.slug === 'guides'
      ? [p, ...guides.map((g) => ({ slug: `guides/${g.slug}`, title: g.title }))]
      : [p],
  ),
  ...words,
  ...extra,
];
