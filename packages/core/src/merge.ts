import { diff3Merge } from 'node-diff3';

export interface MergeResult {
  content: string;
  adjusted: boolean;
}

// LCS on arbitrary full-document character arrays can be quadratic on repeated text.
const MAX_DIFF_TOKENS = 1024;
const MAX_CHARACTER_REFINEMENT = 2048;

function lineTokens(text: string): string[] {
  const raw = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const lines: string[] = [];
  for (let start = 0; start < raw.length;) {
    let end = start + 1;
    while (end < raw.length && raw[end] === raw[start]) end++;
    lines.push(raw[start].repeat(end - start));
    start = end;
  }
  const stride = Math.max(1, Math.ceil(lines.length / MAX_DIFF_TOKENS));
  const tokens: string[] = [];
  for (let index = 0; index < lines.length; index += stride)
    tokens.push(lines.slice(index, index + stride).join(''));
  return tokens;
}

function combine(
  base: string[],
  local: string[],
  remote: string[],
  refine: boolean,
): MergeResult {
  let adjusted = false;
  const content = diff3Merge(remote, base, local)
    .map((region) => {
      if (region.ok) return region.ok.join('');
      const conflict = region.conflict!;
      if (!conflict.o.length) return [...conflict.a, ...conflict.b].join('');
      const original = conflict.o.join('');
      const ours = conflict.b.join('');
      const theirs = conflict.a.join('');
      if (
        refine &&
        original.length + ours.length + theirs.length <=
          MAX_CHARACTER_REFINEMENT
      ) {
        const result = combine(
          Array.from(original),
          Array.from(ours),
          Array.from(theirs),
          false,
        );
        adjusted ||= result.adjusted;
        return result.content;
      }
      adjusted = true;
      return ours;
    })
    .join('');
  return { content, adjusted };
}

/** Remote first at concurrent insertions; the saving side wins overlapping replacements. */
export function mergeMarkdown(
  base: string,
  local: string,
  remote: string,
): MergeResult {
  if (local === base || local === remote)
    return { content: remote, adjusted: false };
  if (remote === base) return { content: local, adjusted: false };
  return combine(lineTokens(base), lineTokens(local), lineTokens(remote), true);
}
