import { afterEach, describe, expect, it } from "vitest";
import {
  createReviewQueue,
  createReviewWorker,
  REVIEW_QUEUE_NAME,
} from "@b3-review/queue";
import { prisma } from "@b3-review/db";
import { computeDedupHash } from "@b3-review/github/review/dedup";
import { processReviewJob } from "./processJob.js";
import { filterNewFindings } from "./dedupFilter.js";

describe("worker (real Redis + real Postgres)", () => {
  let queue: ReturnType<typeof createReviewQueue> | undefined;
  let worker: ReturnType<typeof createReviewWorker> | undefined;

  afterEach(async () => {
    await worker?.close();
    await queue?.obliterate({ force: true });
    await queue?.close();
    await prisma.finding.deleteMany({
      where: { repo: "acme/integration-test" },
    });
  });

  it("picks up an enqueued job and writes exactly one Finding row", async () => {
    queue = createReviewQueue();
    const posted = [
      {
        file: "src/x.ts",
        line: 5,
        severity: "medium" as const,
        message: "msg",
        suggestion: "sugg",
      },
    ];
    const runPipeline = async () => ({ posted });

    worker = createReviewWorker((job) =>
      processReviewJob(job, {
        runPipeline,
        pipelineDeps: {
          getToken: async () => "tok",
          openrouterApiKey: "k",
          filterNewFindings: async (_repo, _prNumber, findings) => findings,
        },
      }),
    );

    const completed = new Promise<void>((resolve) => {
      worker!.on("completed", () => resolve());
    });

    await queue.add(REVIEW_QUEUE_NAME, {
      owner: "acme",
      repo: "integration-test",
      prNumber: 1,
      headSha: "sha1",
    });
    await completed;

    const rows = await prisma.finding.findMany({
      where: { repo: "acme/integration-test" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      filePath: "src/x.ts",
      line: 5,
      errorType: "medium",
      message: "msg",
    });
  });

  it("does not crash on a redelivered job reporting the same finding twice, and leaves exactly one row", async () => {
    queue = createReviewQueue();
    const posted = [
      {
        file: "src/x.ts",
        line: 5,
        severity: "medium" as const,
        message: "msg",
        suggestion: "sugg",
      },
    ];
    const runPipeline = async () => ({ posted });

    worker = createReviewWorker((job) =>
      processReviewJob(job, {
        runPipeline,
        pipelineDeps: {
          getToken: async () => "tok",
          openrouterApiKey: "k",
          filterNewFindings: async (_repo, _prNumber, findings) => findings,
        },
      }),
    );

    let completedCount = 0;
    const bothCompleted = new Promise<void>((resolve) => {
      worker!.on("completed", () => {
        completedCount += 1;
        if (completedCount === 2) resolve();
      });
    });

    const payload = {
      owner: "acme",
      repo: "integration-test",
      prNumber: 1,
      headSha: "sha1",
    };
    await queue.add(REVIEW_QUEUE_NAME, payload);
    await queue.add(REVIEW_QUEUE_NAME, payload);
    await bothCompleted;

    const rows = await prisma.finding.findMany({
      where: { repo: "acme/integration-test" },
    });
    expect(rows).toHaveLength(1);
  });
});

describe("filterNewFindings (real Postgres)", () => {
  afterEach(async () => {
    await prisma.finding.deleteMany({
      where: { repo: "acme/dedup-integration-test" },
    });
  });

  it("bumps lastSeenAt on the real row when the same finding is seen again", async () => {
    const repo = "acme/dedup-integration-test";
    const prNumber = 1;
    const finding = {
      file: "src/x.ts",
      line: 5,
      severity: "medium" as const,
      message: "msg",
      suggestion: "sugg",
      codeSnippet: "const x = 1;",
    };
    const dedupHash = computeDedupHash(
      repo,
      prNumber,
      finding.file,
      finding.line,
      finding.codeSnippet,
    );

    const seeded = await prisma.finding.create({
      data: {
        repo,
        prNumber,
        filePath: finding.file,
        line: finding.line,
        errorType: finding.severity,
        message: finding.message,
        dedupHash,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const result = await filterNewFindings(repo, prNumber, [finding]);

    expect(result).toEqual([]);
    const updated = await prisma.finding.findUniqueOrThrow({
      where: { dedupHash },
    });
    expect(updated.lastSeenAt.getTime()).toBeGreaterThan(
      seeded.lastSeenAt.getTime(),
    );
  });
});
