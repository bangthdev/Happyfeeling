import { describe, it, expect, vi } from 'vitest';
import { postFindings } from './commentPoster.js';
import { GithubApiError } from '../github/client.js';
import type { Finding } from './llmReviewer.js';

describe('postFindings', () => {
  it('posts every finding using line+side and returns the posted findings', async () => {
    const postFn = vi.fn().mockResolvedValue(undefined);
    const findings: Finding[] = [
      { file: 'src/foo.ts', line: 3, severity: 'high', message: 'bug', suggestion: 'fix' },
      { file: 'src/foo.ts', line: 10, severity: 'low', message: 'nit', suggestion: 'n/a' },
    ];

    const result = await postFindings(
      { token: 'tok', owner: 'acme', repo: 'widgets', prNumber: 1, commitSha: 'sha1', findings },
      postFn
    );

    expect(result).toEqual({ posted: findings, skipped: 0, failed: [] });
    expect(postFn).toHaveBeenCalledTimes(2);
    expect(postFn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ filePath: 'src/foo.ts', line: 3, side: 'RIGHT' })
    );
    expect(postFn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ filePath: 'src/foo.ts', line: 10, side: 'RIGHT' })
    );
  });

  it('skips a finding whose line falls outside the diff (422) and keeps posting the rest', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const postFn = vi
      .fn()
      .mockRejectedValueOnce(new GithubApiError('Failed to post review comment: 422 Unprocessable Entity', 422))
      .mockResolvedValueOnce(undefined);
    const findings: Finding[] = [
      { file: 'src/foo.ts', line: 999, severity: 'high', message: 'off-diff line', suggestion: 'n/a' },
      { file: 'src/foo.ts', line: 10, severity: 'low', message: 'nit', suggestion: 'n/a' },
    ];

    const result = await postFindings(
      { token: 'tok', owner: 'acme', repo: 'widgets', prNumber: 1, commitSha: 'sha1', findings },
      postFn
    );

    expect(result).toEqual({ posted: [findings[1]], skipped: 1, failed: [] });
    expect(postFn).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });

  it('collects a non-422 failure without losing findings already posted', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const postFn = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new GithubApiError('Failed to post review comment: 401 Bad credentials', 401));
    const findings: Finding[] = [
      { file: 'src/foo.ts', line: 3, severity: 'high', message: 'bug', suggestion: 'fix' },
      { file: 'src/foo.ts', line: 10, severity: 'low', message: 'nit', suggestion: 'n/a' },
    ];

    const result = await postFindings(
      { token: 'tok', owner: 'acme', repo: 'widgets', prNumber: 1, commitSha: 'sha1', findings },
      postFn
    );

    expect(result).toEqual({ posted: [findings[0]], skipped: 0, failed: [findings[1]] });
    expect(postFn).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });
});
