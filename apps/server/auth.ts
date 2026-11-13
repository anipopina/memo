import { randomBytes } from 'node:crypto';
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { hash, secret } from './crypto';
import { AppError } from './notes';
import {
  nowSeconds,
  type Repository,
  type RecordValue,
  type Change,
} from './repository';
export const SESSION_SECONDS = 30 * 86400;
interface Challenge extends RecordValue {
  challenge: string;
  kind: 'register' | 'login';
  account?: string;
  existing: boolean;
}
interface Credential extends RecordValue {
  account: string;
  id: string;
  publicKey: string;
  counter: number;
  transports?: string[];
}
interface CredentialReference extends RecordValue {
  id: string;
}
interface Session extends RecordValue {
  account: string;
}
const credentialKey = (id: string) => ({
  pk: `credential#${hash(id)}`,
  sk: 'credential',
});
const sessionKey = (token: string) => ({
  pk: `session#${hash(token)}`,
  sk: 'session',
});
export class Auth {
  constructor(
    private repo: Repository,
    readonly origin: string,
  ) {}
  async account(token?: string): Promise<string | undefined> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    return (await this.repo.get<Session>(sessionKey(token)))?.value.account;
  }
  async logout(token?: string) {
    if (!token) return;
    const key = sessionKey(token),
      session = await this.repo.get<Session>(key);
    if (session) await this.repo.commit([{ key, expected: session.rev }]);
  }
  async begin(kind: 'register' | 'login', account?: string, name = 'memo') {
    const rpID = new URL(this.origin).hostname;
    const accountId =
      kind === 'register'
        ? (account ?? randomBytes(32).toString('base64url'))
        : undefined;
    const options =
      kind === 'register'
        ? await generateRegistrationOptions({
            rpName: 'memo',
            rpID,
            userName: name.trim() || 'memo',
            userDisplayName: name.trim() || 'memo',
            userID: Buffer.from(accountId!, 'base64url'),
            authenticatorSelection: {
              residentKey: 'required',
              userVerification: 'required',
            },
            attestationType: 'none',
            excludeCredentials: account
              ? (
                  await this.repo.query<CredentialReference>(
                    `account#${account}`,
                    'credential#',
                  )
                ).map(({ value }) => ({ id: value.id }))
              : [],
          })
        : await generateAuthenticationOptions({
            rpID,
            userVerification: 'required',
          });
    const challengeId = secret();
    const challenge: Challenge = {
      challenge: options.challenge,
      kind,
      account: accountId,
      existing: !!account,
      expires: nowSeconds() + 300,
    };
    await this.repo.commit([
      {
        key: { pk: `challenge#${hash(challengeId)}`, sk: 'challenge' },
        expected: null,
        value: challenge,
      },
    ]);
    return { challengeId, options };
  }
  async finish(
    challengeId: string,
    response: RegistrationResponseJSON | AuthenticationResponseJSON,
    account?: string,
  ) {
    const key = { pk: `challenge#${hash(challengeId)}`, sk: 'challenge' };
    const challenge = await this.repo.get<Challenge>(key);
    if (!challenge) throw new AppError('invalid_challenge', 401);
    await this.repo.commit([{ key, expected: challenge.rev }]);
    const { value } = challenge;
    const changes: Change[] = [];
    let accountId: string;
    try {
      if (value.kind === 'register') {
        if (value.existing && value.account !== account)
          throw new AppError('unauthorized', 401);
        const result = await verifyRegistrationResponse({
          response: response as RegistrationResponseJSON,
          expectedChallenge: value.challenge,
          expectedOrigin: this.origin,
          expectedRPID: new URL(this.origin).hostname,
          requireUserVerification: true,
        });
        if (!result.verified || !result.registrationInfo)
          throw new Error('verification_failed');
        accountId = value.account!;
        const credential = result.registrationInfo.credential;
        const stored: Credential = {
          account: accountId,
          id: credential.id,
          publicKey: Buffer.from(credential.publicKey).toString('base64url'),
          counter: credential.counter,
          transports: credential.transports,
        };
        changes.push(
          { key: credentialKey(credential.id), expected: null, value: stored },
          {
            key: {
              pk: `account#${accountId}`,
              sk: `credential#${hash(credential.id)}`,
            },
            expected: null,
            value: { id: credential.id } as CredentialReference,
          },
        );
      } else {
        const authResponse = response as AuthenticationResponseJSON;
        const stored = await this.repo.get<Credential>(
          credentialKey(authResponse.id),
        );
        if (!stored) throw new Error('unknown_credential');
        accountId = stored.value.account;
        if (
          authResponse.response.userHandle &&
          authResponse.response.userHandle !== accountId
        )
          throw new Error('wrong_user');
        const result = await verifyAuthenticationResponse({
          response: authResponse,
          expectedChallenge: value.challenge,
          expectedOrigin: this.origin,
          expectedRPID: new URL(this.origin).hostname,
          credential: {
            id: stored.value.id,
            publicKey: new Uint8Array(
              Buffer.from(stored.value.publicKey, 'base64url'),
            ),
            counter: stored.value.counter,
            transports: stored.value.transports,
          },
          requireUserVerification: true,
        });
        if (!result.verified) throw new Error('verification_failed');
        changes.push({
          key: credentialKey(authResponse.id),
          expected: stored.rev,
          value: {
            ...stored.value,
            counter: result.authenticationInfo.newCounter,
          } as Credential,
        });
      }
    } catch {
      throw new AppError('verification_failed', 401);
    }
    const token = secret();
    changes.push({
      key: sessionKey(token),
      expected: null,
      value: {
        account: accountId,
        expires: nowSeconds() + SESSION_SECONDS,
      } as Session,
    });
    await this.repo.commit(changes);
    return { token, account: accountId };
  }
}
