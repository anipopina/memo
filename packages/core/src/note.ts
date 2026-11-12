export const MAX_NOTE_BYTES = 256 * 1024;

/** Reject noncanonical Base64URL aliases as well as invalid lengths. */
export function isNoteToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{21}[AQgw]$/.test(token);
}

export function assertNoteSize(content: string): void {
  if (new TextEncoder().encode(content).byteLength > MAX_NOTE_BYTES)
    throw new Error('note_too_large');
}
