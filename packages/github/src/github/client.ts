export class GithubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

export async function getPullRequestDiff(
  token: string,
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  // Compare API pins the diff to the exact commits captured at webhook time —
  // GET /pulls/{number} always returns the PR's *current* head, which drifts
  // if the author pushes again while this job is still queued/running.
  const res = await fetchFn(
    `https://api.github.com/repos/${owner}/${repo}/compare/${baseSha}...${headSha}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3.diff",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!res.ok) {
    throw new Error(
      `Failed to fetch PR diff: ${res.status} ${await res.text()}`,
    );
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
  line: number;
  side: "LEFT" | "RIGHT";
  body: string;
}

export async function postReviewComment(
  params: PostCommentParams,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const {
    token,
    owner,
    repo,
    prNumber,
    commitSha,
    filePath,
    line,
    side,
    body,
  } = params;

  const res = await fetchFn(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        commit_id: commitSha,
        path: filePath,
        line,
        side,
        body,
      }),
    },
  );

  if (!res.ok) {
    throw new GithubApiError(
      `Failed to post review comment: ${res.status} ${await res.text()}`,
      res.status,
    );
  }
}
