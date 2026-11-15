import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { isNoteToken, MAX_NOTE_BYTES } from '../../packages/core/src/note';
import { MAX_NOTE_SEARCH_QUERY_LENGTH } from '../../packages/core/src/note-search';
import { Auth, SESSION_SECONDS } from './auth';
import { Notes, AppError } from './notes';
import { hash, TokenVault } from './crypto';
import { Conflict, nowSeconds, type Repository } from './repository';
import { mcpRequest } from './mcp';
import { OAuth } from './oauth';
import { oauthRoutes } from './oauth-routes';
import { accountMcpRequest } from './account-mcp';
import { consumeRate } from './rate-limit';
const tokenSchema = z.string().refine(isNoteToken);
const mutation = z
  .object({
    content: z.string(),
    expectedVersion: z.number().int().positive(),
    operationId: z.string().uuid(),
  })
  .strict();
export interface AppConfig {
  origin: string;
  vaultKey: string;
  clientIp?: (request: Request) => string;
}
export function createApp(repo: Repository, config: AppConfig) {
  const app = new Hono<{ Variables: { account: string | undefined } }>();
  const notes = new Notes(repo, new TokenVault(config.vaultKey));
  const auth = new Auth(repo, config.origin);
  const oauth = new OAuth(repo, config.origin);
  const secure = new URL(config.origin).protocol === 'https:';
  const cookie = secure ? '__Host-memo' : 'memo_local';
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    const origin = c.req.header('origin');
    const protocol =
      /^\/api\/oauth\/(register|token|revoke)$/.test(c.req.path) ||
      c.req.path.startsWith('/.well-known/');
    const navigation =
      c.req.path === '/api/oauth/authorize' && c.req.method === 'GET';
    if (protocol) {
      c.header('Access-Control-Allow-Origin', '*');
      c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (c.req.method === 'OPTIONS') return c.body(null, 204);
      await next();
      return;
    }
    if (
      !navigation &&
      ((origin && origin !== config.origin) ||
        c.req.header('sec-fetch-site') === 'cross-site')
    )
      return c.json({ error: 'invalid_origin' }, 403);
    if (
      c.req.path.startsWith('/api/') &&
      !['GET', 'HEAD'].includes(c.req.method) &&
      origin !== config.origin
    )
      return c.json({ error: 'invalid_origin' }, 403);
    await next();
  });
  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_NOTE_BYTES * 6 + 16384,
      onError: (c) => c.json({ error: 'request_too_large' }, 413),
    }),
  );
  app.use('*', async (c, next) => {
    // Short-lived hashed buckets enforce limits across Lambda instances without access logs.
    const group =
      c.req.method === 'GET'
        ? 'read'
        : c.req.path === '/api/oauth/register'
          ? 'oauth-register'
          : c.req.path === '/api/oauth/token'
            ? 'oauth-token'
            : c.req.path.startsWith('/api/auth/')
              ? 'auth'
              : c.req.path === '/api/list/search'
                ? 'search'
                : c.req.method === 'PUT'
                  ? 'create'
                  : 'write';
    const period = group === 'create' ? 3600 : 60,
      limit =
        group === 'create'
          ? 30
          : group === 'auth' || group === 'oauth-register' || group === 'search'
            ? 20
            : group === 'read'
              ? 300
              : 180;
    const ip = config.clientIp?.(c.req.raw) ?? 'local';
    const key = {
      pk: `rate#${hash(`${ip}:${group}:${Math.floor(nowSeconds() / period)}`)}`,
      sk: 'rate',
    };
    try {
      await consumeRate(repo, key, limit, period);
    } catch (error) {
      if (error instanceof AppError && [429, 503].includes(error.status)) {
        c.header('Retry-After', String(error.status === 429 ? period : 1));
        return c.json({ error: error.code }, error.status as 429 | 503);
      }
      throw error;
    }
    await next();
  });
  app.use('/api/*', async (c, next) => {
    c.set('account', await auth.account(getCookie(c, cookie)));
    await next();
  });
  app.get('/api/session', (c) =>
    c.json({ signedIn: !!c.get('account'), account: c.get('account') }),
  );
  app.use('/api/auth/credentials*', async (c, next) => {
    if (!c.get('account')) return c.json({ error: 'unauthorized' }, 401);
    await next();
  });
  app.get('/api/auth/credentials', async (c) =>
    c.json(await auth.credentials(c.get('account')!)),
  );
  app.delete('/api/auth/credentials/:id', async (c) => {
    const id = z.string().min(1).max(2048).parse(c.req.param('id'));
    await auth.revoke(c.get('account')!, id);
    return c.json({ ok: true });
  });
  app.post('/api/auth/begin', async (c) => {
    const body = z
      .object({
        kind: z.enum(['register', 'login']),
        name: z.string().max(80).optional(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(await auth.begin(body.kind, c.get('account'), body.name));
  });
  app.post('/api/auth/finish', async (c) => {
    const body = z
      .object({
        challengeId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        response: z.object({ id: z.string().max(2048) }).passthrough(),
      })
      .strict()
      .parse(await c.req.json());
    const result = await auth.finish(
      body.challengeId,
      body.response as unknown as Parameters<Auth['finish']>[1],
      c.get('account'),
    );
    const previous = getCookie(c, cookie);
    if (previous) await auth.logout(previous);
    setCookie(c, cookie, result.token, {
      httpOnly: true,
      secure,
      sameSite: 'Strict',
      path: '/',
      maxAge: SESSION_SECONDS,
    });
    return c.json({ signedIn: true });
  });
  app.post('/api/auth/logout', async (c) => {
    await auth.logout(getCookie(c, cookie));
    deleteCookie(c, cookie, { path: '/', secure });
    return c.json({ signedIn: false });
  });
  app.get('/api/notes/:token', async (c) => {
    const token = tokenSchema.parse(c.req.param('token'));
    const note = await notes.read(token);
    return c.json(note);
  });
  app.get('/api/notes/:token/version', async (c) => {
    return c.json(await notes.version(tokenSchema.parse(c.req.param('token'))));
  });
  app.put('/api/notes/:token', async (c) => {
    const token = tokenSchema.parse(c.req.param('token'));
    const body = z
      .object({ content: z.string() })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await notes.create(token, body.content, c.get('account')),
      201,
    );
  });
  app.post('/api/notes/:token', async (c) => {
    const token = tokenSchema.parse(c.req.param('token')),
      body = mutation.parse(await c.req.json());
    return c.json(
      await notes.mutate(
        token,
        body.operationId,
        'write',
        body.content,
        body.expectedVersion,
      ),
    );
  });
  app.use('/api/list*', async (c, next) => {
    if (!c.get('account')) return c.json({ error: 'unauthorized' }, 401);
    await next();
  });
  app.get('/api/list', async (c) =>
    c.json(await notes.list(c.get('account')!)),
  );
  app.post('/api/list/search', async (c) => {
    const { query } = z
      .object({
        query: z.string().trim().min(1).max(MAX_NOTE_SEARCH_QUERY_LENGTH),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(await notes.searchList(c.get('account')!, query));
  });
  app.post('/api/list/order', async (c) => {
    const { token, before } = z
      .object({ token: tokenSchema, before: tokenSchema.nullable() })
      .strict()
      .parse(await c.req.json());
    await notes.moveInList(c.get('account')!, token, before);
    return c.json({ ok: true });
  });
  app.post('/api/list', async (c) => {
    const { token } = z
      .object({ token: tokenSchema })
      .strict()
      .parse(await c.req.json());
    await notes.add(c.get('account')!, token);
    return c.json({ ok: true });
  });
  app.delete('/api/list/:token', async (c) => {
    await notes.remove(
      c.get('account')!,
      tokenSchema.parse(c.req.param('token')),
    );
    return c.json({ ok: true });
  });
  app.route('/', oauthRoutes(oauth));
  app.all('/mcp/account', (c) => accountMcpRequest(c.req.raw, oauth, notes));
  app.all('/mcp/:token', async (c) => {
    const token = c.req.param('token');
    if (!isNoteToken(token)) return c.json({ error: 'not_found' }, 404);
    if (c.req.method !== 'POST') {
      c.header('Allow', 'POST');
      return c.json({ error: 'method_not_allowed' }, 405);
    }
    return mcpRequest(c.req.raw, token, notes);
  });
  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((error, c) => {
    if (error instanceof AppError)
      return c.json({ error: error.code }, error.status as 400);
    if (error instanceof Conflict) return c.json({ error: 'conflict' }, 409);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return c.json({ error: 'invalid_input' }, 400);
    if (error.message === 'note_too_large')
      return c.json({ error: 'note_too_large' }, 413);
    // Do not log request URLs, credential payloads, database items or exception messages.
    console.error('memo_request_failed');
    return c.json({ error: 'request_failed' }, 500);
  });
  return app;
}
