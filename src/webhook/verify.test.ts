import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifySignature } from './verify.js';

function sign(secret: string, payload: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('verifySignature', () => {
  it('returns true for a valid signature', () => {
    const secret = 'test-secret';
    const payload = '{"hello":"world"}';
    const signature = sign(secret, payload);
    expect(verifySignature(payload, signature, secret)).toBe(true);
  });

  it('returns false for a tampered payload', () => {
    const secret = 'test-secret';
    const signature = sign(secret, '{"hello":"world"}');
    expect(verifySignature('{"hello":"tampered"}', signature, secret)).toBe(false);
  });

  it('returns false when the signature header is missing', () => {
    expect(verifySignature('payload', undefined, 'test-secret')).toBe(false);
  });

  it('returns false for a malformed signature of different length', () => {
    expect(verifySignature('payload', 'sha256=short', 'test-secret')).toBe(false);
  });
});
