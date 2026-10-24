import { checkPatch, setting } from '@msb235/blits/testing';
import { expect, it } from 'vitest';
import { glowChannels, near, pulse } from './glow';

const subject = { x: 0, y: 0 };
const host = { pointer: { x: 50, y: 0 } };

it('gives a mix nothing it cannot rely on', () => {
  expect(checkPatch(pulse, { subject, kit: glowChannels })).toEqual([]);
  expect(checkPatch(near, { subject, kit: glowChannels, host })).toEqual([]);
});

it('glows by distance', () => {
  expect(near.at(0, subject, setting({ host })).glow).toBeCloseTo(0.75);
});
