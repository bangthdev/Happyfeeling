import { verifySignature } from "@b3-review/github/webhook/verify";
import { parsePullRequestEvent } from "@b3-review/github/webhook/parse";
import { REVIEW_QUEUE_NAME } from "@b3-review/queue";
import { getWebhookSecret } from "../../../lib/config";
import { reviewQueue } from "../../../lib/queue";

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? undefined;

  if (!verifySignature(rawBody, signature, getWebhookSecret())) {
    return new Response("invalid signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const event = parsePullRequestEvent(payload);
  if (!event) {
    return new Response("ignored", { status: 200 });
  }

  const jobId = `${event.owner}/${event.repo}#${event.prNumber}@${event.headSha}`;
  await reviewQueue.add(
    REVIEW_QUEUE_NAME,
    {
      owner: event.owner,
      repo: event.repo,
      prNumber: event.prNumber,
      baseSha: event.baseSha,
      headSha: event.headSha,
    },
    { jobId },
  );

  return new Response("accepted", { status: 202 });
}
