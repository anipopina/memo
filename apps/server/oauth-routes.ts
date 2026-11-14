import { Hono } from 'hono';
import { z } from 'zod';
import { OAuth } from './oauth';
import { AppError } from './notes';

export function oauthRoutes(oauth: OAuth) {
  const routes = new Hono<{ Variables: { account: string | undefined } }>();
  routes.get('/.well-known/oauth-authorization-server', (c) =>
    c.json(oauth.metadata()),
  );
  const resource = () => ({
    resource: oauth.resource,
    authorization_servers: [oauth.origin],
    scopes_supported: oauth.metadata().scopes_supported,
    bearer_methods_supported: ['header'],
    resource_name: 'memo',
  });
  routes.get('/.well-known/oauth-protected-resource', (c) =>
    c.json(resource()),
  );
  routes.get('/.well-known/oauth-protected-resource/mcp/account', (c) =>
    c.json(resource()),
  );
  routes.post('/api/oauth/register', async (c) =>
    c.json(await oauth.register(await c.req.json()), 201),
  );
  routes.get('/api/oauth/authorize', async (c) =>
    c.redirect(await oauth.authorize(new URL(c.req.url).searchParams), 302),
  );
  for (const path of ['token', 'revoke'] as const)
    routes.post(`/api/oauth/${path}`, async (c) => {
      if (
        !c.req
          .header('content-type')
          ?.startsWith('application/x-www-form-urlencoded')
      )
        throw new AppError('invalid_request');
      const params = new URLSearchParams(await c.req.text());
      if (Array.from(params.keys()).some((k) => params.getAll(k).length > 1))
        throw new AppError('invalid_request');
      if (path === 'revoke') {
        await oauth.revoke(params, c.req.header('authorization'));
        return c.body(null, 200);
      }
      return c.json(await oauth.token(params, c.req.header('authorization')));
    });
  routes.get('/api/oauth/request/:id', async (c) =>
    c.json(await oauth.request(c.req.param('id'))),
  );
  routes.post('/api/oauth/decision', async (c) => {
    const account = c.get('account');
    if (!account) throw new AppError('unauthorized', 401);
    const body = z
      .object({
        request: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        allow: z.boolean(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json({
      redirect: await oauth.decide(body.request, account, body.allow),
    });
  });
  routes.get('/api/oauth/connections', async (c) => {
    if (!c.get('account')) throw new AppError('unauthorized', 401);
    return c.json(await oauth.grants(c.get('account')!));
  });
  routes.delete('/api/oauth/connections/:id', async (c) => {
    if (!c.get('account')) throw new AppError('unauthorized', 401);
    await oauth.revokeGrant(c.get('account')!, c.req.param('id'));
    return c.json({ ok: true });
  });
  routes.onError((error, c) => {
    if (error instanceof AppError) {
      if (
        error.code === 'invalid_client' &&
        c.req.header('authorization')?.startsWith('Basic ')
      )
        c.header('WWW-Authenticate', 'Basic realm="memo"');
      return c.json({ error: error.code }, error.status as 400);
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return c.json({ error: 'invalid_request' }, 400);
    throw error;
  });
  return routes;
}
