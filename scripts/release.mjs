// Releases the engine at VERSION, then blits-panel at the same version and every companion on it.
//
//   npm run release -- 1.1.1          do it
//   npm run release -- 1.1.1 --dry    print what it would release, change nothing
//
// The engine goes first and has to be on npm before the rest: the packages' lockfile entries and
// the workflow's peer check both resolve it from the registry. Tags are pushed one at a time and
// each run is waited on, because the workflow's concurrency group cancels a middle pending run.
// A rerun skips any step whose tag already exists, so it picks up where a failure stopped it.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ENGINE = '@msb235/blits';
const PACKAGES = [
  { dir: 'packages/panel', tag: 'panel-v', lockstep: true },
  { dir: 'packages/quarks', tag: 'quarks-v' },
  { dir: 'packages/tone', tag: 'tone-v' },
  { dir: 'packages/rapier', tag: 'rapier-v' },
];

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const version = args.find((a) => !a.startsWith('--'));
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: npm run release -- <version> [--dry]');
  process.exit(2);
}

const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { encoding: 'utf8', ...opts }).trim();
const sh = (cmd, argv) => execFileSync(cmd, argv, { stdio: 'inherit' });
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const writeJson = (f, j) => writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
const tagExists = (t) => run('git', ['tag', '--list', t]) !== '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The Unreleased section's body, or undefined when there is none. */
function unreleased(log) {
  const m = readFileSync(log, 'utf8').match(/^## Unreleased\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  return m?.[1];
}

/** Renames Unreleased to `## v`, or writes `## v` with `fallback` as its body when there is none. */
function stamp(log, v, fallback) {
  const text = readFileSync(log, 'utf8');
  if (new RegExp(`^## ${v.replaceAll('.', '\\.')}$`, 'm').test(text)) return;
  if (/^## Unreleased$/m.test(text)) {
    writeFileSync(log, text.replace(/^## Unreleased$/m, `## ${v}`));
    return;
  }
  if (!fallback) throw new Error(`${log} has no Unreleased section to release as ${v}`);
  const at = text.search(/^## /m);
  writeFileSync(log, `${text.slice(0, at)}## ${v}\n\n${fallback}\n\n${text.slice(at)}`);
}

/** The next version under this repo's changelog rule: below 1.0.0 a break bumps the minor, else the patch. */
function bump(current, body) {
  const [major, minor, patch] = current.split('.').map(Number);
  const breaking = /^### Breaking$/m.test(body ?? '');
  const added = /^### Added$/m.test(body ?? '');
  if (major === 0) return breaking ? `0.${minor + 1}.0` : `0.${minor}.${patch + 1}`;
  if (breaking) return `${major + 1}.0.0`;
  return added ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

/** Waits on the release run for `tag`, failing the release if it fails. */
async function watch(tag) {
  for (let i = 0; i < 30; i++) {
    const runs = JSON.parse(
      run('gh', ['run', 'list', '-w', 'release.yml', '-L', '20', '--json', 'databaseId,headBranch']),
    );
    const found = runs.find((r) => r.headBranch === tag);
    if (found) {
      console.log(`${tag}: watching run ${found.databaseId}`);
      sh('gh', ['run', 'watch', String(found.databaseId), '--exit-status', '--interval', '30']);
      return;
    }
    await sleep(5000);
  }
  throw new Error(`no release run appeared for ${tag}`);
}

async function onNpm(name, v) {
  for (let i = 0; i < 30; i++) {
    try {
      if (run('npm', ['view', `${name}@${v}`, 'version']) === v) return;
    } catch {}
    await sleep(10000);
  }
  throw new Error(`${name}@${v} never appeared on npm`);
}

// What goes out.
const plan = PACKAGES.map((p) => {
  const pkg = readJson(`${p.dir}/package.json`);
  const next = p.lockstep ? version : bump(pkg.version, unreleased(`${p.dir}/CHANGELOG.md`));
  return { ...p, name: pkg.name, from: pkg.version, to: next };
});
console.log(`${ENGINE} ${readJson('package.json').version} -> ${version}`);
for (const p of plan) console.log(`${p.name} ${p.from} -> ${p.to}`);
if (dry) process.exit(0);

if (run('git', ['status', '--porcelain']) !== '') throw new Error('the tree has uncommitted changes');
if (run('git', ['branch', '--show-current']) !== 'main') throw new Error('release from main');
sh('git', ['fetch', '-q', 'origin']);
if (run('git', ['rev-list', '--count', 'main..origin/main']) !== '0') throw new Error('main is behind origin');

// The engine.
const engineTag = `v${version}`;
if (!tagExists(engineTag)) {
  if (!unreleased('CHANGELOG.md')?.trim()) throw new Error("the engine's CHANGELOG has nothing under Unreleased");
  stamp('CHANGELOG.md', version);
  const root = readJson('package.json');
  root.version = version;
  writeJson('package.json', root);
  sh('npm', ['install', '--package-lock-only', '--ignore-scripts']);
  sh('git', ['commit', '-qam', `release ${ENGINE} ${version}`]);
  sh('git', ['tag', engineTag]);
  sh('git', ['push', '-q', 'origin', 'main', engineTag]);
  await watch(engineTag);
}
await onNpm(ENGINE, version);

// The packages on it.
const pending = plan.filter((p) => !tagExists(`${p.tag}${p.to}`));
if (pending.length) {
  for (const p of pending) {
    const f = `${p.dir}/package.json`;
    const pkg = readJson(f);
    pkg.version = p.to;
    pkg.devDependencies[ENGINE] = version;
    if (p.lockstep) pkg.peerDependencies[ENGINE] = version;
    writeJson(f, pkg);
    stamp(`${p.dir}/CHANGELOG.md`, p.to, `### Changed\n\n- Built and tested against engine ${version}.`);
  }
  sh('npm', ['install', '--package-lock-only', '--ignore-scripts']);
  const names = pending.map((p) => `${p.name.replace('@msb235/', '')} ${p.to}`);
  const list = names.length > 2 ? `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}` : names.join(' and ');
  sh('git', ['commit', '-qam', `release ${list} on engine ${version}`]);
  for (const p of pending) sh('git', ['tag', `${p.tag}${p.to}`]);
  sh('git', ['push', '-q', 'origin', 'main']);
}
for (const p of plan) {
  const tag = `${p.tag}${p.to}`;
  if (run('git', ['ls-remote', '--tags', 'origin', tag]) === '') {
    sh('git', ['push', '-q', 'origin', tag]);
    await watch(tag);
  }
}
console.log(`released ${ENGINE} ${version} and ${plan.map((p) => `${p.name} ${p.to}`).join(', ')}`);
