import { describe, it, expect, vi } from 'vitest';
import { getPullRequestDiff, postReviewComment, GithubApiError } from './client.js';

describe('getPullRequestDiff', () => {
  it('requests the diff with the correct headers and returns the text', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('diff --git a/x b/x\n...'),
    });

    const diff = await getPullRequestDiff('tok', 'acme', 'widgets', 42, fetchFn as unknown as typeof fetch);

    expect(diff).toBe('diff --git a/x b/x\n...');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/widgets/pulls/42',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer tok',
          Accept: 'application/vnd.github.v3.diff',
        }),
      })
    );
  });

  it('throws when the response is not ok', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found'),
    });

    await expect(
      getPullRequestDiff('tok', 'acme', 'widgets', 42, fetchFn as unknown as typeof fetch)
    ).rejects.toThrow('404');
  });
});

describe('postReviewComment', () => {
  it('posts a comment with line and side', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });

    await postReviewComment(
      {
        token: 'tok',
        owner: 'acme',
        repo: 'widgets',
        prNumber: 42,
        commitSha: 'abc123',
        filePath: 'src/x.ts',
        line: 4,
        side: 'RIGHT',
        body: 'nice catch',
      },
      fetchFn as unknown as typeof fetch
    );

    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/widgets/pulls/42/comments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ commit_id: 'abc123', path: 'src/x.ts', line: 4, side: 'RIGHT', body: 'nice catch' }),
      })
    );
  });

  it('throws a GithubApiError carrying the response status when the response is not ok', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve('rate limited') });

    const promise = postReviewComment(
      {
        token: 'tok',
        owner: 'acme',
        repo: 'widgets',
        prNumber: 42,
        commitSha: 'abc123',
        filePath: 'src/x.ts',
        line: 4,
        side: 'RIGHT',
        body: 'nice catch',
      },
      fetchFn as unknown as typeof fetch
    );

    await expect(promise).rejects.toBeInstanceOf(GithubApiError);
    await expect(promise).rejects.toMatchObject({ status: 403 });
  });
});
