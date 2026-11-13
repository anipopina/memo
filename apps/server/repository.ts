export interface Key {
  pk: string;
  sk: string;
}
export interface RecordValue {
  expires?: number;
}
export interface Stored<T> {
  value: T;
  rev: number;
}
export interface Change {
  key: Key;
  expected: number | null;
  value?: RecordValue;
}
export class Conflict extends Error {
  constructor() {
    super('conflict');
  }
}
export interface Repository {
  get<T extends RecordValue>(key: Key): Promise<Stored<T> | undefined>;
  query<T extends RecordValue>(
    pk: string,
    prefix: string,
  ): Promise<Stored<T>[]>;
  commit(changes: Change[]): Promise<void>;
}
export const nowSeconds = () => Math.floor(Date.now() / 1000);
