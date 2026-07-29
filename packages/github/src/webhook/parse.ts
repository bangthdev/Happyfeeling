export interface PullRequestEvent {
  owner: string;
  repo: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  action: string;
}

const RELEVANT_ACTIONS = new Set(["opened", "synchronize"]);

export function parsePullRequestEvent(body: unknown): PullRequestEvent | null {
  if (!body || typeof body !== "object") return null;
  const payload = body as Record<string, any>;

  if (!payload.pull_request || !payload.repository) return null;
  if (!RELEVANT_ACTIONS.has(payload.action)) return null;

  const owner = payload.repository.owner?.login;
  const repo = payload.repository.name;
  const prNumber = payload.pull_request.number;
  const baseSha = payload.pull_request.base?.sha;
  const headSha = payload.pull_request.head?.sha;
  if (!owner || !repo || !prNumber || !baseSha || !headSha) {
    console.error(
      "parsePullRequestEvent: malformed payload, missing required field(s)",
      {
        hasOwner: !!owner,
        hasRepo: !!repo,
        hasPrNumber: !!prNumber,
        hasBaseSha: !!baseSha,
        hasHeadSha: !!headSha,
      },
    );
    return null;
  }

  return { owner, repo, prNumber, baseSha, headSha, action: payload.action };
}
