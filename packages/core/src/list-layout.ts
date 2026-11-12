import { indentColumns } from './list-lines';

const BULLET_MARKERS = ['•', '◦', '▪'] as const;

export interface ListAttributes {
  marker: string | null;
  indent: string;
}

export interface ListLayout {
  marker: string;
  depth: number;
}

/** Each parent owns its child sequence; indentation width alone is not a list depth. */
export function listLayout(
  lines: readonly ListAttributes[],
): (ListLayout | null)[] {
  const stack: { columns: number; ordered: boolean; count: number }[] = [];
  return lines.map(({ marker, indent }) => {
    if (!marker) {
      stack.length = 0;
      return null;
    }
    const columns = indentColumns(indent);
    const ordered = marker !== '-';
    while (stack.length && stack.at(-1)!.columns > columns) stack.pop();
    if (stack.at(-1)?.columns === columns && stack.at(-1)?.ordered !== ordered)
      stack.pop();
    if (stack.at(-1)?.columns !== columns)
      stack.push({
        columns,
        ordered,
        // Only a root sequence inherits its first source number; children restart at 1.
        count: ordered && !stack.length ? Number.parseInt(marker, 10) - 1 : 0,
      });
    const level = stack.at(-1)!;
    const depth = stack.length - 1;
    return {
      marker: ordered
        ? `${++level.count}.`
        : BULLET_MARKERS[Math.min(depth, BULLET_MARKERS.length - 1)],
      depth,
    };
  });
}
