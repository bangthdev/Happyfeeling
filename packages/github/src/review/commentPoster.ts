import { mapLineToDiffPosition } from '../github/diffPosition.js';
import { postReviewComment } from '../github/client.js';
import type { Finding } from './llmReviewer.js';

export interface PostFindingsParams {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
  commitSha: string;
  diff: string;
  findings: Finding[];
}

export interface PostFindingsResult {
  posted: number;
  skipped: number;
}

export async function postFindings(
  params: PostFindingsParams,
  postFn: typeof postReviewComment = postReviewComment
): Promise<PostFindingsResult> {
  const { token, owner, repo, prNumber, commitSha, diff, findings } = params;
  let posted = 0;
  let skipped = 0;

  for (const finding of findings) {
    const position = mapLineToDiffPosition(diff, finding.file, finding.line);
    if (position === null) {
      skipped += 1;
      continue;
    }

    await postFn({
      token,
      owner,
      repo,
      prNumber,
      commitSha,
      filePath: finding.file,
      position,
      body: `**[${finding.severity}]** ${finding.message}\n\n${finding.suggestion}`,
    });
    posted += 1;
  }

  return { posted, skipped };
}
