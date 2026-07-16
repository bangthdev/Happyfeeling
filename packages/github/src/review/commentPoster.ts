import { postReviewComment } from '../github/client.js';
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

export async function postFindings(
  params: PostFindingsParams,
  postFn: typeof postReviewComment = postReviewComment
): Promise<PostFindingsResult> {
  const { token, owner, repo, prNumber, commitSha, findings } = params;
  const posted: Finding[] = [];

  for (const finding of findings) {
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
  }

  return { posted, skipped: 0 };
}
