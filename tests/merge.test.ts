import { expect, it } from 'vitest';
import { mergeMarkdown } from '../packages/core/src/merge';

it.each([
  ['red\nblue', 'RED\nblue', 'red\nBLUE', 'RED\nBLUE', false],
  ['abc', 'aXbc', 'abcY', 'aXbcY', false],
  ['hello', 'hello local', 'hello remote', 'hello remote local', false],
  ['old', 'LOCAL', 'REMOTE', 'LOCAL', true],
  ['abc', 'ab', 'abC', 'ab', true],
  ['A😀B', 'A😀BC', 'XA😀B', 'XA😀BC', false],
  ['base', 'same', 'same', 'same', false],
  ['base', 'base', 'remote', 'remote', false],
])('automatically merges %j', (base, local, remote, content, adjusted) => {
  expect(mergeMarkdown(base, local, remote)).toEqual({ content, adjusted });
});

it('bounds repeated-text work for a near-limit document', () => {
  const base = 'a\n'.repeat(100_000);
  const result = mergeMarkdown(base, 'LOCAL\n' + base, base + 'REMOTE\n');
  expect(result.content).toBe('LOCAL\n' + base + 'REMOTE\n');
});
