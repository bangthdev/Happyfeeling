import { postReviewComment, GithubApiError } from "../github/client.js";
import type { Finding } from "./llmReviewer.js";

export interface PostFindingsParams {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
  commitSha: string;
  findings: Finding[];
  // Called right after each finding is successfully posted, before moving on
  // to the next one — lets a caller persist it to DB immediately instead of
  // in one bulk write after the whole batch finishes, narrowing the window
  // where a crash could lose track of what's already on GitHub and cause it
  // to get re-posted. A failure here doesn't stop the loop (the remaining
  // findings still get posted), but the finding is reported back via
  // PostFindingsResult.persistFailed — the caller decides what to do next.
  onPosted?: (finding: Finding) => Promise<void>;
}

export interface PostFindingsResult {
  posted: Finding[];
  skipped: number;
  failed: Finding[];
  // Findings posted to GitHub whose onPosted call threw — the caller must
  // treat this as a real failure (e.g. fail the job), not just a log line,
  // since this is the only place these findings get persisted.
  persistFailed: Finding[];
}

const UNPROCESSABLE_ENTITY = 422;

// No separate "Before" block: GitHub's suggestion box already renders the
// current line (red) above the proposed one (green) — repeating it here
// would just duplicate what the box already shows.
export function buildCommentBody(finding: Finding): string {
  const header = `**[${finding.severity}]** ${finding.message}`;

  if (
    finding.codeSnippet === undefined ||
    finding.fixedCode === undefined ||
    finding.fixedCode.trim() === "" ||
    finding.fixedCode.trim() === finding.codeSnippet.trim() ||
    finding.fixedCode.includes("```") ||
    finding.suggestion.includes("```")
  ) {
    return `${header}\n\n${finding.suggestion}`;
  }

  return [
    header,
    "",
    finding.suggestion,
    "",
    "```suggestion",
    finding.fixedCode,
    "```",
  ].join("\n");
}

export async function postFindings(
  params: PostFindingsParams,
  postFn: typeof postReviewComment = postReviewComment,
): Promise<PostFindingsResult> {
  const { token, owner, repo, prNumber, commitSha, findings, onPosted } =
    params;
  const posted: Finding[] = [];
  const failed: Finding[] = [];
  const persistFailed: Finding[] = [];
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
        side: "RIGHT",
        body: buildCommentBody(finding),
      });
      posted.push(finding);
      if (onPosted) {
        try {
          await onPosted(finding);
        } catch (persistErr) {
          console.error(
            "Failed to persist a finding immediately after posting it:",
            persistErr,
          );
          persistFailed.push(finding);
        }
      }
    } catch (err) {
      if (
        err instanceof GithubApiError &&
        err.status === UNPROCESSABLE_ENTITY
      ) {
        console.error("Skipping finding — line is outside the PR diff:", err);
        skipped += 1;
      } else {
        console.error("Failed to post finding comment:", err);
        failed.push(finding);
      }
    }
  }

  return { posted, skipped, failed, persistFailed };
}
