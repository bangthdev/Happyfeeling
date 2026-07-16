import { postReviewComment, GithubApiError } from '../github/client.js';
import type { Finding } from './llmReviewer.js';

export interface PostFindingsParams {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
  commitSha: string;
  findings: Finding[];
}

export interface PostFindingsResult {
  posted: Finding[];
  skipped: number;
}

const UNPROCESSABLE_ENTITY = 422;

export async function postFindings(
  params: PostFindingsParams,
  postFn: typeof postReviewComment = postReviewComment
): Promise<PostFindingsResult> {
  const { token, owner, repo, prNumber, commitSha, findings } = params;
  const posted: Finding[] = [];
  let skipped = 0;

  for (const finding of findings) {
    try {
      await postFn({
        token,
        owner,
        repo,
        prNumber,
        commitSha,
        filePath: finding.file,
        line: finding.line,
        side: 'RIGHT',
        body: `**[${finding.severity}]** ${finding.message}\n\n${finding.suggestion}`,
      });
      posted.push(finding);
    } catch (err) {
      if (err instanceof GithubApiError && err.status === UNPROCESSABLE_ENTITY) {
        console.error('Skipping finding — line is outside the PR diff:', err);
        skipped += 1;
        continue;
      }
      throw err;
    }
  }

  return { posted, skipped };
}
