import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { SqliteRepository } from './sqlite';
const directory = process.env.MEMO_DATA_DIR ?? '.memo';
mkdirSync(directory, { recursive: true, mode: 0o700 });
const keyFile = `${directory}/vault-key`;
if (!existsSync(keyFile))
  writeFileSync(keyFile, randomBytes(32).toString('base64'), {
    mode: 0o600,
    flag: 'wx',
  });
const origin = process.env.MEMO_ORIGIN ?? 'http://localhost:5173';
const app = createApp(new SqliteRepository(`${directory}/memo.sqlite`), {
  origin,
  vaultKey: readFileSync(keyFile, 'utf8').trim(),
});
serve(
  {
    fetch: app.fetch,
    hostname: '127.0.0.1',
    port: Number(process.env.MEMO_API_PORT ?? 8788),
  },
  () => console.info('memo local API ready'),
);
