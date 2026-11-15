import { expect, test, type Page } from '@playwright/test';
import { randomBytes, createHash } from 'node:crypto';

test.use({ baseURL: `http://localhost:${process.env.MEMO_APP_PORT}` });
async function authorization(
  page: Page,
  scope = 'memo:read memo:create memo:write',
) {
  const origin = new URL(page.url()).origin;
  const redirect = `${origin}/oauth-test-callback`;
  const registered = await page.request.post('/api/oauth/register', {
    data: {
      client_name: 'Test AI',
      redirect_uris: [redirect],
      token_endpoint_auth_method: 'none',
    },
  });
  expect(registered.status()).toBe(201);
  const client = await registered.json();
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirect,
    resource: `${origin}/mcp/account`,
    scope,
    state: 'browser-test',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  });
  const response = await page.request.get(`/api/oauth/authorize?${params}`, {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  return {
    location: response.headers().location,
    client,
    verifier,
    redirect,
    origin,
  };
}

test('consent is readable without login and invalid requests cannot be approved', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const auth = await authorization(page, 'memo:read');
  await page.goto(auth.location);
  await expect(
    page.getByRole('heading', { name: 'AI連携の確認' }),
  ).toBeVisible();
  await expect(
    page.getByText('メモの一覧・検索・本文の取得', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('新しいメモの作成とリストへの追加', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Passkeyでログイン' }),
  ).toBeEnabled();
  await expect(page.getByRole('button', { name: '連携を許可' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('oauth-consent.png') });
  await page.goto('/connect?request=invalid');
  await expect(page.getByRole('alert')).toContainText('無効か期限切れ');
  await expect(page.getByRole('button', { name: '連携を許可' })).toHaveCount(0);
});

test('Passkey consent, token exchange, connection revocation and denial work end to end', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Virtual authenticators require Chromium CDP.',
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto('/');
  await expect(
    page.getByRole('textbox', { name: 'メモ本文', exact: true }),
  ).toBeVisible();
  const auth = await authorization(
    page,
    'memo:read memo:create memo:write memo:reorder',
  );
  await page.route('**/oauth-test-callback?**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>callback</p>' }),
  );
  await page.goto(auth.location);
  await expect(
    page.getByText('メモリストの並び替え', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Passkeyでログイン' }).click();
  await page
    .getByRole('textbox', { name: 'Passkeyの名前', exact: true })
    .fill('PC');
  await page
    .getByRole('button', { name: 'アカウントを作る', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: '連携を許可' })).toBeEnabled();
  await page.getByRole('button', { name: '連携を許可' }).click();
  await expect(page).toHaveURL(/oauth-test-callback\?/);
  const callback = new URL(page.url());
  expect(callback.searchParams.get('state')).toBe('browser-test');
  expect(callback.searchParams.get('iss')).toBe(auth.origin);
  const exchanged = await page.request.post('/api/oauth/token', {
    form: {
      client_id: auth.client.client_id,
      code: callback.searchParams.get('code')!,
      code_verifier: auth.verifier,
      redirect_uri: auth.redirect,
      resource: `${auth.origin}/mcp/account`,
      grant_type: 'authorization_code',
    },
  });
  expect(exchanged.status()).toBe(200);
  const token = await exchanged.json();
  expect(token.scope.split(' ')).toContain('memo:reorder');
  await page.goto('/');
  await expect(
    page.getByRole('textbox', { name: 'メモ本文', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'アカウント', exact: true }).click();
  const connections = page.getByRole('list', {
    name: '連携中のAIクライアント',
  });
  await expect(connections).toContainText('Test AI');
  await expect(connections).toContainText('並び替え');
  await expect(
    page.getByRole('textbox', { name: 'MCP URL', exact: true }),
  ).toHaveValue(`${auth.origin}/mcp/account`);
  await connections
    .getByRole('button', { name: '連携を解除', exact: true })
    .click();
  await expect(
    page.getByText('連携中のAIクライアントはありません。'),
  ).toBeVisible();
  const result = await page.request.post('/mcp/account', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  expect(result.status()).toBe(401);
  const denied = await authorization(page);
  await page.goto(denied.location);
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(page).toHaveURL(/error=access_denied/);
  expect(new URL(page.url()).searchParams.get('code')).toBeNull();
});
