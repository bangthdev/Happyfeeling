import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { POST } from './route';
import { reviewQueue } from '../../../lib/queue';

const SECRET = 'test-webhook-secret';

function sign(body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

function makeRequest(body: string, signature?: string): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature !== undefined) headers.set('x-hub-signature-256', signature);
  return new Request('http://localhost/api/webhook', { method: 'POST', body, headers });
}

const PR_OPENED_PAYLOAD = JSON.stringify({
  action: 'opened',
  repository: { name: 'widgets', owner: { login: 'acme' } },
  pull_request: { number: 7, head: { sha: 'sha1' } },
});

describe('POST /api/webhook', () => {
  beforeEach(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    await reviewQueue.obliterate({ force: true });
  });

  afterAll(async () => {
    await reviewQueue.obliterate({ force: true });
    await reviewQueue.close();
  });

  it('rejects a request with an invalid signature', async () => {
    const res = await POST(makeRequest(PR_OPENED_PAYLOAD, 'sha256=invalid'));
    expect(res.status).toBe(401);
  });

  it('rejects a request with no signature header', async () => {
    const res = await POST(makeRequest(PR_OPENED_PAYLOAD));
    expect(res.status).toBe(401);
  });

  it('returns 200 without enqueueing for an irrelevant event', async () => {
    const body = JSON.stringify({ action: 'closed', repository: { name: 'widgets', owner: { login: 'acme' } }, pull_request: {} });
    const res = await POST(makeRequest(body, sign(body)));
    expect(res.status).toBe(200);
    expect(await reviewQueue.getWaitingCount()).toBe(0);
  });

  it('enqueues the job and returns 202 for a valid pull_request event', async () => {
    const start = Date.now();
    const res = await POST(makeRequest(PR_OPENED_PAYLOAD, sign(PR_OPENED_PAYLOAD)));
    const elapsed = Date.now() - start;

    expect(res.status).toBe(202);
    expect(elapsed).toBeLessThan(300);

    expect(await reviewQueue.getWaitingCount()).toBe(1);
    const jobs = await reviewQueue.getWaiting();
    expect(jobs[0].data).toEqual({ owner: 'acme', repo: 'widgets', prNumber: 7, headSha: 'sha1' });
  });

  it('does not enqueue a duplicate job when the same webhook is redelivered', async () => {
    await POST(makeRequest(PR_OPENED_PAYLOAD, sign(PR_OPENED_PAYLOAD))); // lần 1
    await POST(makeRequest(PR_OPENED_PAYLOAD, sign(PR_OPENED_PAYLOAD))); // lần 2 — GitHub "redeliver"

    expect(await reviewQueue.getWaitingCount()).toBe(1);
  });
});
