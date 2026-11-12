import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Link from '@tiptap/extension-link';
import { MemoLine } from '../spikes/editor/src/memo-line';
import {
  parseMarkdown,
  serializeMarkdown,
} from '../packages/core/src/markdown';

const fixtures = [
  '',
  '\n',
  '\n\n',
  'a\n',
  'a\n\nb\n\n',
  ' \t\n  ',
  '- one\n- \n- two\n',
  '  - nested\n1. numbered\n- [ ] task',
  '- parent\n    - child\n        - grandchild\n- next\n',
  '1. first\n    1. nested\n    2. next child\n2. second\n',
  '003.  padded\r\n\t9.\twith tab\n    -  spaced gap\n',
  '1000000000. literal unsupported marker\n-\n1.\n',
  '# heading\n\n**bold** _italic_ ~~strike~~\n> quote\n---',
  '| a | b |\n|---|---|\n| c | d |\n',
  '```ts\nconst x = 1;\n```\n<!-- keep -->\n<script>alert(1)</script>',
  'a  \nb\r\nc\n\r\n',
  '👨‍👩‍👧‍👦 が 😀\n',
  'https://example.com/a?q=1&x=2\n[label](https://example.com)\n<https://example.com>\nwww.example.com',
];

const schema = getSchema([Document, MemoLine, Text, Link]);

describe('Markdown fidelity', () => {
  it.each(fixtures)('preserves the exact source: %j', (source) => {
    const document = schema.nodeFromJSON(parseMarkdown(source));
    document.check();
    expect(serializeMarkdown(document.toJSON())).toBe(source);
  });
  it('never introduces HTML nodes or executable links', () => {
    const doc = parseMarkdown(
      '<img src=x onerror=alert(1)> javascript:alert(1) https://example.com',
    );
    expect(doc.content?.[0].content?.filter((node) => node.marks).length).toBe(
      1,
    );
    expect(
      doc.content?.[0].content?.every((node) => node.type === 'text'),
    ).toBe(true);
  });
});
