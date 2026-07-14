import { describe, it, expect, beforeAll, vi } from 'vitest';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createAppJWT, createInstallationTokenProvider } from './auth.js';

describe('createAppJWT', () => {
  let privateKey: string;
  let publicKey: string;

  beforeAll(() => {
    const keyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = keyPair.privateKey;
    publicKey = keyPair.publicKey;
  });

  it('signs a JWT with the app id as issuer and a max-10-minute expiry', () => {
    const token = createAppJWT('12345', privateKey);
    const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as jwt.JwtPayload;
    expect(decoded.iss).toBe('12345');
    expect(decoded.exp! - decoded.iat!).toBeLessThanOrEqual(600);
  });
});

describe('createInstallationTokenProvider', () => {
  it('fetches once and caches the token for subsequent calls', async () => {
    const fetchToken = vi.fn().mockResolvedValue({
      token: 'installation-token-1',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const provider = createInstallationTokenProvider('12345', 'fake-key', '999', {
      fetchToken,
      createJwt: () => 'fake-jwt',
    });

    const token1 = await provider.getToken();
    const token2 = await provider.getToken();

    expect(token1).toBe('installation-token-1');
    expect(token2).toBe('installation-token-1');
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it('refetches when the cached token is close to expiry', async () => {
    const fetchToken = vi
      .fn()
      .mockResolvedValueOnce({ token: 'token-1', expiresAt: new Date(Date.now() + 30_000) })
      .mockResolvedValueOnce({ token: 'token-2', expiresAt: new Date(Date.now() + 3600_000) });
    const provider = createInstallationTokenProvider('12345', 'fake-key', '999', {
      fetchToken,
      createJwt: () => 'fake-jwt',
    });

    const token1 = await provider.getToken();
    const token2 = await provider.getToken();

    expect(token1).toBe('token-1');
    expect(token2).toBe('token-2');
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });
});
