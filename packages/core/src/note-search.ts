export const MAX_NOTE_SEARCH_QUERY_LENGTH = 200;

export function noteSearchPattern(query: string): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
}

export interface NoteSearchResult {
  token: string;
  title: string;
  snippet?: {
    text: string;
    truncatedBefore: boolean;
    truncatedAfter: boolean;
  };
}

export interface NoteSearchResponse {
  results: NoteSearchResult[];
  truncatedAt: number | null;
}
