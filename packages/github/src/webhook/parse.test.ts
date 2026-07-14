import { describe, it, expect } from 'vitest';
import { parsePullRequestEvent } from './parse.js';

const BASE_PAYLOAD = {
  action: 'opened',
  repository: { name: 'widgets', owner: { login: 'acme' } },
  pull_request: { number: 7, head: { sha: 'sha1' } },
};

describe('parsePullRequestEvent', () => {
  it('parses an opened pull_request event', () => {
    const event = parsePullRequestEvent(BASE_PAYLOAD);
    expect(event).toEqual({
      owner: 'acme',
      repo: 'widgets',
      prNumber: 7,
      headSha: 'sha1',
      action: 'opened',
    });
  });

  it('parses a synchronize pull_request event', () => {
    const event = parsePullRequestEvent({ ...BASE_PAYLOAD, action: 'synchronize' });
    expect(event?.action).toBe('synchronize');
  });

  it('returns null for irrelevant actions', () => {
    expect(parsePullRequestEvent({ ...BASE_PAYLOAD, action: 'closed' })).toBeNull();
  });

  it('returns null for payloads missing pull_request', () => {
    expect(parsePullRequestEvent({ action: 'opened', repository: BASE_PAYLOAD.repository })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parsePullRequestEvent(null)).toBeNull();
    expect(parsePullRequestEvent('string')).toBeNull();
  });
});
