import type { JSONContent } from '@tiptap/core';
import { find } from 'linkifyjs';
import { parseListLine } from './list-lines';

function inlineContent(text: string): JSONContent[] {
  const content: JSONContent[] = [];
  let offset = 0;
  for (const link of find(text, 'url')) {
    if (!/^https?:\/\//i.test(link.value)) continue;
    if (link.start > offset)
      content.push({ type: 'text', text: text.slice(offset, link.start) });
    content.push({
      type: 'text',
      text: link.value,
      marks: [{ type: 'link', attrs: { href: link.value } }],
    });
    offset = link.end;
  }
  if (offset < text.length)
    content.push({ type: 'text', text: text.slice(offset) });
  return content;
}

/** Full Markdown parsing would normalize syntax that this editor does not support. */
export function parseMarkdown(source: string): JSONContent {
  const lines = source.split('\n');
  return {
    type: 'doc',
    content: lines.map((raw, index) => {
      const crlf = index < lines.length - 1 && raw.endsWith('\r');
      const text = crlf ? raw.slice(0, -1) : raw;
      const list = parseListLine(text);
      return {
        type: 'paragraph',
        attrs: {
          marker: list?.marker ?? null,
          indent: list?.indent ?? '',
          gap: list?.gap ?? ' ',
          eol: crlf ? '\r\n' : '\n',
        },
        content: inlineContent(list?.text ?? text),
      };
    }),
  };
}

export function serializeMarkdown(doc: JSONContent): string {
  return (doc.content ?? [])
    .map((line, index, lines) => {
      const text = (line.content ?? []).map((part) => part.text ?? '').join('');
      const prefix = line.attrs?.marker
        ? `${line.attrs.indent}${line.attrs.marker}${line.attrs.gap}`
        : '';
      const eol = index < lines.length - 1 ? (line.attrs?.eol ?? '\n') : '';
      return prefix + text + eol;
    })
    .join('');
}
