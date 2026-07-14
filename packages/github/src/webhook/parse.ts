export interface PullRequestEvent {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  action: string;
}

const RELEVANT_ACTIONS = new Set(['opened', 'synchronize']);

export function parsePullRequestEvent(body: unknown): PullRequestEvent | null {
  if (!body || typeof body !== 'object') return null;
  const payload = body as Record<string, any>;

  if (!payload.pull_request || !payload.repository) return null;
  if (!RELEVANT_ACTIONS.has(payload.action)) return null;

  return {
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    prNumber: payload.pull_request.number,
    headSha: payload.pull_request.head.sha,
    action: payload.action,
  };
}
