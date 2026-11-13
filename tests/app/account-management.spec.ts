import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
test.use({ baseURL: `http://localhost:${process.env.MEMO_APP_PORT}` });
const textbox = { name: 'メモ本文', exact: true };

test('an empty reserved note has its own URL and survives reload without database creation', async ({
  page,
  request,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', textbox);
  await expect(editor).toBeVisible();
  await expect(page).toHaveURL(/\/[A-Za-z0-9_-]{22}$/);
  const url = page.url();
  const path = new URL(url).pathname;
  expect((await request.get(`/api/notes${path}`)).status()).toBe(404);
  await page.reload();
  await expect(editor).toBeVisible();
  await expect(editor).toHaveText('');
  expect(page.url()).toBe(url);
  expect((await request.get(`/api/notes${path}`)).status()).toBe(404);
  await page.goto('/' + randomBytes(16).toString('base64url'));
  await expect(
    page.getByText('メモが見つかりません', { exact: true }),
  ).toBeVisible();
});

test('named passkeys can be revoked, logout creates a fresh empty URL and login switches URL with the note', async ({
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
  const options = {
    protocol: 'ctap2' as const,
    transport: 'internal' as const,
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  };
  const first = await cdp.send('WebAuthn.addVirtualAuthenticator', { options });
  await page.goto('/');
  const editor = page.getByRole('textbox', textbox);
  await expect(editor).toBeVisible();
  await editor.fill('remember me');
  const original = page.url();
  await page.getByRole('button', { name: 'アカウント', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'アカウントを作る', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('textbox', { name: 'Passkeyの名前', exact: true })
    .fill('PC');
  await page
    .getByRole('button', { name: 'アカウントを作る', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'アカウント', exact: true }),
  ).toHaveText('アカウント');
  await page.getByRole('button', { name: 'アカウント', exact: true }).click();
  const list = page.getByRole('list', { name: 'このアカウントのPasskey' });
  await expect(list.getByText('PC', { exact: true })).toBeVisible();
  await expect(list.locator('time')).toHaveAttribute('datetime', /.+/);
  await expect(
    list.getByRole('button', { name: '無効化', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: 'Passkeyの名前', exact: true }),
  ).toHaveValue('');
  const begin = await page.request.post('/api/auth/begin', {
    headers: { Origin: new URL(page.url()).origin },
    data: { kind: 'login' },
  });
  const challenge = await begin.json();
  // Sign while the first key is still active, then try this assertion after revoking it.
  const assertion = await page.evaluate(async (options) => {
    const decode = (value: string) =>
      Uint8Array.from(
        atob(value.replaceAll('-', '+').replaceAll('_', '/')),
        (character) => character.charCodeAt(0),
      ).buffer;
    const encode = (value: ArrayBuffer) =>
      btoa(String.fromCharCode(...new Uint8Array(value)))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '');
    const credential = (await navigator.credentials.get({
      publicKey: { ...options, challenge: decode(options.challenge) },
    })) as PublicKeyCredential;
    const response = credential.response as AuthenticatorAssertionResponse;
    return {
      id: credential.id,
      rawId: encode(credential.rawId),
      type: credential.type,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: encode(response.clientDataJSON),
        authenticatorData: encode(response.authenticatorData),
        signature: encode(response.signature),
        userHandle: response.userHandle
          ? encode(response.userHandle)
          : undefined,
      },
    };
  }, challenge.options);
  await cdp.send('WebAuthn.removeVirtualAuthenticator', {
    authenticatorId: first.authenticatorId,
  });
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options,
  });
  await page
    .getByRole('textbox', { name: 'Passkeyの名前', exact: true })
    .fill('iPhone');
  await page
    .getByRole('button', { name: 'Passkeyを追加', exact: true })
    .click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(
    page.getByRole('textbox', { name: 'Passkeyの名前', exact: true }),
  ).toHaveValue('');
  const credentials = await (
    await page.request.get('/api/auth/credentials')
  ).json();
  await list
    .getByRole('listitem')
    .filter({ hasText: 'PC' })
    .getByRole('button', { name: '無効化', exact: true })
    .click();
  await page.getByRole('button', { name: '無効化する', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByText('iPhone', { exact: true })).toBeVisible();
  const last = credentials.find(
    (item: { name: string }) => item.name === 'iPhone',
  );
  const refused = await page.request.delete(
    `/api/auth/credentials/${encodeURIComponent(last.id)}`,
    { headers: { Origin: new URL(page.url()).origin } },
  );
  expect(refused.status()).toBe(409);
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(editor).toHaveText('');
  await expect(page).toHaveURL(/\/[A-Za-z0-9_-]{22}$/);
  expect(page.url()).not.toBe(original);
  const fresh = page.url();
  await page.reload();
  await expect(editor).toBeVisible();
  await expect(editor).toHaveText('');
  expect(page.url()).toBe(fresh);
  const revoked = await page.request.post('/api/auth/finish', {
    headers: { Origin: new URL(page.url()).origin },
    data: { challengeId: challenge.challengeId, response: assertion },
  });
  expect(revoked.status()).toBe(401);
  await page.getByRole('button', { name: 'アカウント', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'ログイン', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(editor).toHaveText('remember me');
  expect(page.url()).toBe(original);
});
