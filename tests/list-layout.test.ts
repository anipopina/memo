import { expect, it } from 'vitest';
import { listLayout } from '../packages/core/src/list-layout';
import { parseListLine } from '../packages/core/src/list-lines';

function layout(source: string) {
  return listLayout(
    source.split('\n').map((line) => {
      const list = parseListLine(line);
      return { marker: list?.marker ?? null, indent: list?.indent ?? '' };
    }),
  );
}

it('counts each parent child sequence independently, including deeper levels', () => {
  const result = layout(
    '1. parent\n    2. child\n        3. grandchild\n    4. child\n5. parent\n    6. child',
  );
  expect(result.map((item) => item?.marker)).toEqual([
    '1.',
    '1.',
    '1.',
    '2.',
    '2.',
    '1.',
  ]);
});

it('uses disc, circle, then square at all deeper bullet levels', () => {
  const result = layout(
    '- a\n    - b\n        - c\n            - d\n                - e\n    - f\n- g',
  );
  expect(result.map((item) => item?.marker)).toEqual([
    '•',
    '◦',
    '▪',
    '▪',
    '▪',
    '◦',
    '•',
  ]);
});

it('uses actual parents for mixed indent styles and mixed list types', () => {
  const result = layout('1. a\n  - b\n\t1. c\n  - d\n2. e');
  expect(result).toEqual([
    { marker: '1.', depth: 0 },
    { marker: '◦', depth: 1 },
    { marker: '1.', depth: 2 },
    { marker: '◦', depth: 1 },
    { marker: '2.', depth: 0 },
  ]);
});

it('starts a new sequence after a paragraph or a change of list type', () => {
  expect(
    layout('1. a\n- b\n1. c\n\n2. d').map((item) => item?.marker ?? null),
  ).toEqual(['1.', '•', '1.', null, '2.']);
});

it('preserves each root start number while restarting child sequences at one', () => {
  expect(
    layout('2. a\n    9. b\n    7. c\n8. d\n    3. e\n\n12. f\n1. g').map(
      (item) => item?.marker ?? null,
    ),
  ).toEqual(['2.', '1.', '2.', '3.', '1.', null, '12.', '13.']);
});
