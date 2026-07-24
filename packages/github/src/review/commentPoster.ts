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
  failed: Finding[];
}

const UNPROCESSABLE_ENTITY = 422;

const FENCE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'md',
  py: 'python',
  go: 'go',
  sh: 'bash',
  sql: 'sql',
  css: 'css',
  html: 'html',
};

function fenceLanguage(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase();
  return (extension && FENCE_LANGUAGE_BY_EXTENSION[extension]) || '';
}

export function buildCommentBody(finding: Finding): string {
  const header = `**[${finding.severity}]** ${finding.message}`;

  if (
    finding.codeSnippet === undefined ||
    finding.fixedCode === undefined ||
    finding.fixedCode.trim() === '' ||
    finding.fixedCode.trim() === finding.codeSnippet.trim() ||
    finding.codeSnippet.includes('```') ||
    finding.fixedCode.includes('```')
  ) {
    return `${header}\n\n${finding.suggestion}`;
  }

  return [
    header,
    '',
    'Before:',
    '```' + fenceLanguage(finding.file),
    finding.codeSnippet,
    '```',
    '',
    '```suggestion',
    finding.fixedCode,
    '```',
    '',
    finding.suggestion,
  ].join('\n');
}

export async function postFindings(
  params: PostFindingsParams,
  postFn: typeof postReviewComment = postReviewComment
): Promise<PostFindingsResult> {
  const { token, owner, repo, prNumber, commitSha, findings } = params;
  const posted: Finding[] = [];
  const failed: Finding[] = [];
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
        body: buildCommentBody(finding),
      });
      posted.push(finding);
    } catch (err) {
      if (err instanceof GithubApiError && err.status === UNPROCESSABLE_ENTITY) {
        console.error('Skipping finding — line is outside the PR diff:', err);
        skipped += 1;
      } else {
        console.error('Failed to post finding comment:', err);
        failed.push(finding);
      }
    }
  }

  return { posted, skipped, failed };
}
