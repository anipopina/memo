import { timingSafeEqual, createHash } from 'node:crypto';
import { z } from 'zod';
import { hash, secret } from './crypto';
import { AppError } from './notes';
import {
  Conflict,
  nowSeconds,
  type Repository,
  type RecordValue,
} from './repository';

export const OAUTH = {
  access: 3600,
  grant: 90 * 86400,
  request: 600,
  code: 60,
  client: 90 * 86400,
};
export const SCOPES = [
  'memo:read',
  'memo:create',
  'memo:write',
  'memo:reorder',
] as const;
export type Scope = (typeof SCOPES)[number];
interface Client extends RecordValue {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method:
    'none' | 'client_secret_post' | 'client_secret_basic';
  secretHash?: string;
}
interface Authorization extends RecordValue {
  clientId: string;
  redirect: string;
  challenge: string;
  scopes: Scope[];
  state?: string;
}
interface Code extends Authorization {
  account: string;
  grantId: string;
}
interface Grant extends RecordValue {
  id: string;
  account: string;
  clientId: string;
  clientName: string;
  redirectOrigin: string;
  scopes: Scope[];
  createdAt: number;
}
interface Token extends RecordValue {
  consumed?: boolean;
  account: string;
  grantId: string;
  clientId: string;
  scopes: Scope[];
}
const key = (kind: string, value: string) => ({
  pk: `oauth-${kind}#${hash(value)}`,
  sk: kind,
});
const grantKey = (account: string, id: string) => ({
  pk: `account#${account}`,
  sk: `oauth-grant#${id}`,
});
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const validRedirect = (value: string) => {
  try {
    const u = new URL(value);
    return (
      !u.hash &&
      !u.username &&
      !u.password &&
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
    );
  } catch {
    return false;
  }
};
const registration = z.object({
  client_name: z.string().trim().min(1).max(100).default('MCP client'),
  redirect_uris: z
    .array(z.string().max(2048).refine(validRedirect))
    .min(1)
    .max(10),
  token_endpoint_auth_method: z
    .enum(['none', 'client_secret_post', 'client_secret_basic'])
    .default('client_secret_basic'),
  grant_types: z
    .array(z.enum(['authorization_code', 'refresh_token']))
    .optional(),
  response_types: z.array(z.literal('code')).optional(),
});
const scopesFrom = (value: string) => {
  const scopes = [...new Set(value.split(' ').filter(Boolean))];
  if (!scopes.length || scopes.some((s) => !SCOPES.includes(s as Scope)))
    throw new AppError('invalid_scope');
  return scopes as Scope[];
};
export class OAuth {
  readonly resource: string;
  constructor(
    private repo: Repository,
    readonly origin: string,
  ) {
    this.resource = `${origin}/mcp/account`;
  }
  metadata() {
    return {
      issuer: this.origin,
      authorization_endpoint: `${this.origin}/api/oauth/authorize`,
      token_endpoint: `${this.origin}/api/oauth/token`,
      registration_endpoint: `${this.origin}/api/oauth/register`,
      revocation_endpoint: `${this.origin}/api/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: [
        'none',
        'client_secret_post',
        'client_secret_basic',
      ],
      revocation_endpoint_auth_methods_supported: [
        'none',
        'client_secret_post',
        'client_secret_basic',
      ],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: SCOPES,
      authorization_response_iss_parameter_supported: true,
    };
  }
  async register(input: unknown) {
    const parsed = registration.safeParse(input);
    if (!parsed.success) throw new AppError('invalid_client_metadata');
    const value = parsed.data,
      id = secret();
    const password =
      value.token_endpoint_auth_method === 'none' ? undefined : secret();
    await this.repo.commit([
      {
        key: key('client', id),
        expected: null,
        value: {
          ...value,
          client_id: id,
          secretHash: password ? hash(password) : undefined,
          expires: nowSeconds() + OAUTH.client,
        } as Client,
      },
    ]);
    return {
      ...value,
      client_id: id,
      client_id_issued_at: nowSeconds(),
      ...(password
        ? {
            client_secret: password,
            client_secret_expires_at: nowSeconds() + OAUTH.client,
          }
        : {}),
    };
  }
  private async client(id: string) {
    const row = await this.repo.get<Client>(key('client', id));
    if (!row) throw new AppError('invalid_client', 401);
    return row.value;
  }
  async authorize(params: URLSearchParams) {
    // Never redirect errors until client and exact redirect URI have been validated.
    if (Array.from(params.keys()).some((k) => params.getAll(k).length > 1))
      throw new AppError('invalid_request');
    const client = await this.client(params.get('client_id') ?? '');
    const redirect = params.get('redirect_uri') ?? '';
    if (!client.redirect_uris.includes(redirect))
      throw new AppError('invalid_redirect_uri');
    if (params.get('response_type') !== 'code')
      throw new AppError('unsupported_response_type');
    if (params.get('resource') !== this.resource)
      throw new AppError('invalid_target');
    const challenge = params.get('code_challenge') ?? '';
    if (
      params.get('code_challenge_method') !== 'S256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge)
    )
      throw new AppError('invalid_request');
    const state = params.get('state') ?? undefined;
    if (state && state.length > 2048) throw new AppError('invalid_request');
    const scopes = scopesFrom(params.get('scope') ?? SCOPES.join(' '));
    const id = secret();
    await this.repo.commit([
      {
        key: key('request', id),
        expected: null,
        value: {
          clientId: client.client_id,
          redirect,
          challenge,
          scopes,
          state,
          expires: nowSeconds() + OAUTH.request,
        } as Authorization,
      },
    ]);
    return `${this.origin}/connect?request=${id}`;
  }
  async request(id: string) {
    const row = await this.repo.get<Authorization>(key('request', id));
    if (!row) throw new AppError('invalid_request');
    const client = await this.client(row.value.clientId);
    return {
      clientName: client.client_name,
      redirectOrigin: new URL(row.value.redirect).origin,
      scopes: row.value.scopes,
    };
  }
  async decide(id: string, account: string, allow: boolean) {
    const row = await this.repo.get<Authorization>(key('request', id));
    if (!row) throw new AppError('invalid_request');
    const client = await this.client(row.value.clientId);
    const callback = new URL(row.value.redirect);
    callback.searchParams.set('iss', this.origin);
    if (row.value.state !== undefined)
      callback.searchParams.set('state', row.value.state);
    const changes = [{ key: key('request', id), expected: row.rev }];
    if (!allow) {
      await this.repo.commit(changes);
      callback.searchParams.set('error', 'access_denied');
      return callback.href;
    }
    const code = secret(),
      grantId = secret(),
      time = nowSeconds();
    await this.repo.commit([
      ...changes,
      {
        key: key('code', code),
        expected: null,
        value: {
          ...row.value,
          account,
          grantId,
          expires: time + OAUTH.code,
        } as Code,
      },
      {
        key: grantKey(account, grantId),
        expected: null,
        value: {
          id: grantId,
          account,
          clientId: client.client_id,
          clientName: client.client_name,
          redirectOrigin: new URL(row.value.redirect).origin,
          scopes: row.value.scopes,
          createdAt: Date.now(),
          expires: time + OAUTH.grant,
        } as Grant,
      },
    ]);
    callback.searchParams.set('code', code);
    return callback.href;
  }
  private async authenticateClient(
    params: URLSearchParams,
    authorization?: string,
  ) {
    let id = params.get('client_id') ?? '',
      password = params.get('client_secret') ?? '';
    let method = password ? 'client_secret_post' : 'none';
    if (authorization) {
      if (!authorization.startsWith('Basic ') || password)
        throw new AppError('invalid_client', 401);
      try {
        const decoded = Buffer.from(authorization.slice(6), 'base64').toString(
          'utf8',
        );
        const split = decoded.indexOf(':');
        if (split < 0) throw new Error();
        const basicId = decodeURIComponent(decoded.slice(0, split));
        if (id && id !== basicId) throw new Error();
        id = basicId;
        password = decodeURIComponent(decoded.slice(split + 1));
        method = 'client_secret_basic';
      } catch {
        throw new AppError('invalid_client', 401);
      }
    }
    const client = await this.client(id);
    if (
      client.token_endpoint_auth_method !== method ||
      (method !== 'none' && !safeEqual(client.secretHash ?? '', hash(password)))
    )
      throw new AppError('invalid_client', 401);
    return client;
  }
  async token(params: URLSearchParams, authorization?: string) {
    const client = await this.authenticateClient(params, authorization);
    if (params.get('resource') !== this.resource)
      throw new AppError('invalid_target');
    const kind = params.get('grant_type');
    if (!['authorization_code', 'refresh_token'].includes(kind ?? ''))
      throw new AppError('unsupported_grant_type');
    const sourceKey = key(
      kind === 'authorization_code' ? 'code' : 'refresh',
      params.get(kind === 'authorization_code' ? 'code' : 'refresh_token') ??
        '',
    );
    const source = await this.repo.get<Code | Token>(sourceKey);
    if (!source || source.value.clientId !== client.client_id)
      throw new AppError('invalid_grant');
    if (kind === 'refresh_token' && (source.value as Token).consumed) {
      await this.revokeGrant(source.value.account, source.value.grantId);
      throw new AppError('invalid_grant');
    }
    if (kind === 'authorization_code') {
      const code = source.value as Code,
        verifier = params.get('code_verifier') ?? '';
      if (
        params.get('redirect_uri') !== code.redirect ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
        !safeEqual(
          createHash('sha256').update(verifier).digest('base64url'),
          code.challenge,
        )
      )
        throw new AppError('invalid_grant');
    }
    const grant = await this.repo.get<Grant>(
      grantKey(source.value.account, source.value.grantId),
    );
    if (!grant) throw new AppError('invalid_grant');
    let scopes = source.value.scopes;
    if (params.has('scope')) {
      const requested = scopesFrom(params.get('scope')!);
      if (requested.some((s) => !scopes.includes(s)))
        throw new AppError('invalid_scope');
      scopes = requested;
    }
    const access = secret(),
      refresh = secret(),
      time = nowSeconds();
    const token = {
      account: source.value.account,
      grantId: source.value.grantId,
      clientId: client.client_id,
      scopes,
    };
    try {
      await this.repo.commit([
        {
          key: sourceKey,
          expected: source.rev,
          ...(kind === 'refresh_token'
            ? { value: { ...source.value, consumed: true } as Token }
            : {}),
        },
        // Serializes refresh/code exchange with revocation without retaining token plaintext.
        {
          key: grantKey(grant.value.account, grant.value.id),
          expected: grant.rev,
          value: grant.value,
        },
        {
          key: key('access', access),
          expected: null,
          value: {
            ...token,
            expires: Math.min(time + OAUTH.access, grant.value.expires!),
          } as Token,
        },
        {
          key: key('refresh', refresh),
          expected: null,
          value: { ...token, expires: grant.value.expires } as Token,
        },
      ]);
    } catch (error) {
      if (error instanceof Conflict) throw new AppError('invalid_grant');
      throw error;
    }
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: Math.min(OAUTH.access, grant.value.expires! - time),
      refresh_token: refresh,
      scope: scopes.join(' '),
    };
  }
  async access(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const row = await this.repo.get<Token>(key('access', token));
    if (!row) return;
    const grant = await this.repo.get<Grant>(
      grantKey(row.value.account, row.value.grantId),
    );
    if (!grant || grant.value.clientId !== row.value.clientId) return;
    return row.value;
  }
  async grants(account: string) {
    return (await this.repo.query<Grant>(`account#${account}`, 'oauth-grant#'))
      .map(({ value }) => ({
        id: value.id,
        clientName: value.clientName,
        redirectOrigin: value.redirectOrigin,
        scopes: value.scopes,
        createdAt: value.createdAt,
        expiresAt: value.expires! * 1000,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  async revokeGrant(account: string, id: string) {
    const k = grantKey(account, id),
      row = await this.repo.get<Grant>(k);
    if (row) await this.repo.commit([{ key: k, expected: row.rev }]);
  }
  async revoke(params: URLSearchParams, authorization?: string) {
    const client = await this.authenticateClient(params, authorization),
      token = params.get('token') ?? '';
    const row =
      (await this.repo.get<Token>(key('refresh', token))) ??
      (await this.repo.get<Token>(key('access', token)));
    if (row?.value.clientId === client.client_id)
      await this.revokeGrant(row.value.account, row.value.grantId);
  }
}
