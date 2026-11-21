// skulkr's config for blits: README.md in the skulkr checkout says what each setting does.
const NVM = 'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; . "$NVM_DIR/nvm.sh" >/dev/null; nvm use >/dev/null';

export default {
  name: 'blits',

  partition: {
    roots: ['src', 'packages/*/src', 'apps/*/src', 'site/src'],
    extensions: ['ts', 'tsx', 'css', 'astro'],
    exclude: [/\.test\.[^/]+$/, /\.d\.ts$/, /(^|\/)fixtures\//],
    // `packages/tone/src` → `tone`; `apps/stress/src/x` → `apps.stress.x`; `src/gpu` → `gpu`.
    areaId: (dir) =>
      dir
        .replace(/^src(\/|$)/, 'core$1')
        .replace(/^packages\/([^/]+)\/src/, '$1')
        .replace(/^apps\/([^/]+)\/src/, 'apps.$1')
        .replace(/\//g, '.'),
  },

  // How a batch of fixes is tested before main moves: the whole suite, on the fleet.
  gate: { name: 'test', command: ['onto', 'test'] },

  checks: {
    test: 'npx vitest run <file>',
    typecheck: 'npm run typecheck',
    lint: 'npm run lint',
    tally: {
      test: String.raw`\bvitest run\b.*?\s([\w./@-]+\.test\.tsx?)\b`,
      testPath: String.raw`\.test\.tsx?$`,
      lint: String.raw`\bnpm run lint\b`,
      final: String.raw`\bnpm run typecheck\b`,
    },
    // skulkr runs this itself over each fixer's changed files, rather than taking the fixer's word for it.
    verify: { command: 'npx vitest related --run --maxWorkers=4 {files}' },
  },

  rules: {
    reviewer: [
      'Read the repo\'s CLAUDE.md first. A demo or explainer under `site/` or `apps/` that keeps its own clock,',
      'animates in frame-loop math, or leaves a mix unnamed breaks its rules, and that is a defect.',
    ].join(' '),
    fixer: 'Every fix a user of the published packages could notice gets a line under "Unreleased" in that package\'s CHANGELOG.md.',
  },

  record: {
    dir: 'docs/audits',
    trailer: 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>',
  },

  setup: {
    prelude: NVM,
    install: { lockfile: 'package-lock.json', command: 'npm ci --no-audit --no-fund' },
  },

  // blits is on the fleet (.onto/tests); onto places each job on whichever node has room.
  runner: 'onto',
  concurrency: { review: 18, fix: 18 },

  claude: {
    configDir: '~/.claude-msb',
    models: { review: 'opus', fix: 'opus', match: 'haiku' },
    effort: { review: 'medium', fix: 'medium' },
  },

  // List-price dollars: each job's ceiling, and one run's cap.
  areasPerRound: 4,
  budget: { review: 8, match: 1, fix: 15, capUsd: 40 },
};
