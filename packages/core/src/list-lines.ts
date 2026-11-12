export const LIST_INDENT_COLUMNS = 4;
const MAX_ORDERED_NUMBER = 999_999_999;
const prefixPattern = '^([ \\t]*)(-|[0-9]{1,9}\\.)([ \\t]+)';
const listPrefix = new RegExp(prefixPattern);
export const LIST_INPUT_PATTERN = new RegExp(`${prefixPattern}$`);

export interface ListLine {
  indent: string;
  marker: string;
  gap: string;
  text: string;
}

export function parseListLine(text: string): ListLine | null {
  const match = listPrefix.exec(text);
  if (!match) return null;
  return {
    indent: match[1],
    marker: match[2],
    gap: match[3],
    text: text.slice(match[0].length),
  };
}

export function indentColumns(indent: string): number {
  let columns = 0;
  for (const character of indent) {
    columns +=
      character === '\t'
        ? LIST_INDENT_COLUMNS - (columns % LIST_INDENT_COLUMNS)
        : 1;
  }
  return columns;
}

export function nextListMarker(marker: string): string {
  if (marker === '-') return marker;
  // CommonMark ordered markers have at most nine digits.
  return `${Math.min(Number.parseInt(marker, 10) + 1, MAX_ORDERED_NUMBER)}.`;
}
