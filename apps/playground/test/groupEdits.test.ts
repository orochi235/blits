import type { Composition, Group, Voice } from '@pg/blits/composition';
import { groupsFull } from '@pg/blits/edit';
import { addGroup, deleteGroup, joinGroup, setGroup } from '@pg/blits/groupEdits';
import { load } from '@pg/blits/load';
import { describe, expect, it } from 'vitest';
import { comp, group, voice } from './helpers';

const vv = (id: string, over: Partial<Voice> = {}) =>
  voice({ id, patch: { kind: 'keys', period: 400, stops: [] }, loop: false, ...over });
const span = (id: string, over: Partial<Group> = {}) =>
  group({ id, kind: 'span', span: {}, ...over });
const ids = (c: Composition) => c.voices.map((x) => x.id);
const g = (c: Composition, id: string) => c.groups?.find((x) => x.id === id) as Group;
const vo = (c: Composition, id: string) => c.voices.find((x) => x.id === id);
const loads = (c: Composition) => expect(load(structuredClone(c))).not.toBeNull();

describe('addGroup', () => {
  it('adds a group with defaults and a name unique across voices and groups', () => {
    const d = addGroup(comp([vv('a', { name: 'group 1' })]), 'owner');
    expect(d.groups?.[0]).toMatchObject({
      name: 'group 2',
      kind: 'owner',
      start: 0,
      rate: 1,
      weight: 1,
      fade: {},
    });
    expect(d.groups?.[0]).not.toHaveProperty('span');
    const e = addGroup(d, 'span');
    expect(e.groups?.[1]).toMatchObject({ name: 'group 3', kind: 'span', span: {} });
    expect(new Set([...ids(e), ...(e.groups ?? []).map((x) => x.id)]).size).toBe(3);
    expect(e.groups?.[1]?.hue).not.toBe(e.groups?.[0]?.hue);
    loads(e);
  });

  it('adds none past MAX_GROUPS', () => {
    let c = comp([vv('a')]);
    while (!groupsFull(c)) c = addGroup(c, 'owner');
    expect(addGroup(c, 'span')).toBe(c);
    loads(c);
  });
});

describe('joinGroup', () => {
  it('moves a voice under a group or back to the top, reordering voices to cue order', () => {
    const c = comp([vv('a'), vv('b'), vv('c', { owner: 'g' })], [group({ id: 'g' })]);
    const d = joinGroup(c, 'b', 'g');
    expect(vo(d, 'b')?.owner).toBe('g');
    expect(ids(d)).toEqual(['a', 'b', 'c']);
    const e = joinGroup(c, 'a', 'g');
    expect(ids(e)).toEqual(['a', 'c', 'b']);
    loads(e);
    const top = joinGroup(e, 'c', null);
    expect(vo(top, 'c')).not.toHaveProperty('owner');
    loads(top);
  });

  it('joining a span drops the start and the start anchor, keeping the end anchor', () => {
    const c = comp(
      [vv('a', { start: 300, anchor: { in: 50, end: { after: 'b' } } }), vv('b')],
      [span('s')],
    );
    const d = joinGroup(c, 'a', 's');
    expect(vo(d, 'a')).toMatchObject({ owner: 's', start: 0, anchor: { end: { after: 'b' } } });
    expect(vo(d, 'a')?.anchor).not.toHaveProperty('in');
    loads(d);
    const bare = joinGroup({ ...c, voices: [vv('a', { anchor: { start: 5 } })] }, 'a', 's');
    expect(vo(bare, 'a')).not.toHaveProperty('anchor');
  });

  it('a group joining a span drops its start and start anchor', () => {
    const c = comp(
      [vv('a', { owner: 'k' })],
      [span('s'), span('k', { start: 40, anchor: { start: 5 } })],
    );
    const d = joinGroup(c, 'k', 's');
    expect(g(d, 'k')).toMatchObject({ owner: 's', start: 0 });
    expect(g(d, 'k')).not.toHaveProperty('anchor');
    loads(d);
  });

  it('leaving a span drops the hints', () => {
    const c = comp(
      [vv('a', { owner: 's', hints: { faster: 2 } })],
      [span('s'), group({ id: 'o' })],
    );
    expect(vo(joinGroup(c, 'a', 'o'), 'a')).not.toHaveProperty('hints');
    expect(vo(joinGroup(c, 'a', null), 'a')).not.toHaveProperty('hints');
  });

  it('refuses an owner into a span, a cycle, and unknown ids', () => {
    const c = comp(
      [vv('a', { owner: 'in' })],
      [group({ id: 'out' }), group({ id: 'in', owner: 'out' }), span('s')],
    );
    expect(joinGroup(c, 'out', 's')).toBe(c);
    expect(joinGroup(c, 'out', 'in')).toBe(c);
    expect(joinGroup(c, 'out', 'out')).toBe(c);
    expect(joinGroup(c, 'nobody', 'out')).toBe(c);
    expect(joinGroup(c, 'a', 'nobody')).toBe(c);
    expect(joinGroup(c, 'a', 'in')).toBe(c);
    const nested = joinGroup(c, 's', 'in');
    expect(g(nested, 's').owner).toBe('in');
    loads(nested);
  });
});

describe('deleteGroup', () => {
  it('moves what it holds up to its parent', () => {
    const c = comp(
      [vv('a', { owner: 'in' }), vv('b')],
      [group({ id: 'out' }), group({ id: 'in', owner: 'out' }), group({ id: 'k', owner: 'in' })],
    );
    const d = deleteGroup(c, 'in');
    expect(d.groups?.map((x) => x.id)).toEqual(['out', 'k']);
    expect(vo(d, 'a')?.owner).toBe('out');
    expect(g(d, 'k').owner).toBe('out');
    loads(d);
    const top = deleteGroup(d, 'out');
    expect(vo(top, 'a')).not.toHaveProperty('owner');
    expect(g(top, 'k')).not.toHaveProperty('owner');
    loads(top);
    expect(deleteGroup(c, 'nobody')).toBe(c);
  });

  it('a deleted span’s members lose their hints', () => {
    const c = comp([vv('a', { owner: 's', hints: { ballast: true } })], [span('s')]);
    expect(vo(deleteGroup(c, 's'), 'a')).not.toHaveProperty('hints');
  });
});

describe('setGroup', () => {
  const held = comp(
    [vv('a', { owner: 's', hints: { faster: 2 } })],
    [span('s', { span: { duration: 500 } })],
  );

  it('replaces the group, keeping span settings only on a span', () => {
    const renamed = setGroup(held, { ...g(held, 's'), name: 'x', rate: 2 });
    expect(g(renamed, 's')).toMatchObject({ name: 'x', rate: 2, span: { duration: 500 } });
    const owner = setGroup(held, { ...g(held, 's'), kind: 'owner' });
    expect(g(owner, 's')).not.toHaveProperty('span');
    expect(vo(owner, 'a')).not.toHaveProperty('hints');
    loads(owner);
    const back = setGroup(owner, { ...g(owner, 's'), kind: 'span' });
    expect(g(back, 's').span).toEqual({});
    loads(back);
  });

  it('refuses switching to an owner while a span holds it', () => {
    const c = comp([], [span('s'), span('k', { owner: 's' })]);
    expect(setGroup(c, { ...g(c, 'k'), kind: 'owner' })).toBe(c);
  });

  it('switching an owner to a span refuses an owner it holds, and places its voices', () => {
    const c = comp(
      [vv('a', { owner: 'o', start: 200 })],
      [group({ id: 'o' }), group({ id: 'inner', owner: 'o' })],
    );
    expect(setGroup(c, { ...g(c, 'o'), kind: 'span' })).toBe(c);
    const solo = comp([vv('a', { owner: 'o', start: 200 })], [group({ id: 'o' })]);
    const d = setGroup(solo, { ...g(solo, 'o'), kind: 'span' });
    expect(vo(d, 'a')?.start).toBe(0);
    loads(d);
  });

  it('a changed owner goes through the join rules', () => {
    const c = comp([vv('b'), vv('a', { owner: 'k' })], [group({ id: 'o' }), group({ id: 'k' })]);
    const d = setGroup(c, { ...g(c, 'k'), owner: 'o' });
    expect(g(d, 'k').owner).toBe('o');
    expect(setGroup(c, { ...g(c, 'o'), owner: 'o' })).toBe(c);
    expect(setGroup(c, { ...g(c, 'o'), id: 'nobody' })).toBe(c);
    loads(d);
  });
});
