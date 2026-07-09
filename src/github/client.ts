export async function getPullRequestDiff(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  fetchFn: typeof fetch = fetch
): Promise<string> {
  const res = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3.diff',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch PR diff: ${res.status} ${await res.text()}`);
  }

  return res.text();
}

export interface PostCommentParams {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
  commitSha: string;
  filePath: string;
  position: number;
  body: string;
}

export async function postReviewComment(
  params: PostCommentParams,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const { token, owner, repo, prNumber, commitSha, filePath, position, body } = params;

  const res = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ commit_id: commitSha, path: filePath, position, body }),
  });

  if (!res.ok) {
    throw new Error(`Failed to post review comment: ${res.status} ${await res.text()}`);
  }
}
