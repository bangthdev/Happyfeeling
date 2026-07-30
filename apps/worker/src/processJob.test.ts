import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";
import type { ReviewJobPayload } from "@b3-review/queue";

vi.mock("@b3-review/db", () => ({
  prisma: {
    finding: {
      createMany: vi
        .fn()
        .mockImplementation(async ({ data }: { data: unknown[] }) => ({
          count: data.length,
        })),
    },
  },
}));

import { prisma } from "@b3-review/db";
import { PartialPostError } from "@b3-review/github/pipeline";
import { processReviewJob, persistFinding } from "./processJob.js";

function fakeJob(data: ReviewJobPayload): Job<ReviewJobPayload> {
  return { data } as Job<ReviewJobPayload>;
}

describe("persistFinding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists a single finding via a 1-item createMany call, skipping duplicates", async () => {
    const finding = {
      file: "src/x.ts",
      line: 10,
      severity: "high" as const,
      message: "bug here",
      suggestion: "fix it",
    };

    await persistFinding("acme/widgets", 7, finding);

    expect(prisma.finding.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.finding.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          filePath: "src/x.ts",
          line: 10,
          repo: "acme/widgets",
          prNumber: 7,
        }),
      ],
      skipDuplicates: true,
    });
  });

  it("logs a warning when the dedupHash already existed (an unexpected collision, e.g. racing workers)", async () => {
    vi.mocked(prisma.finding.createMany).mockResolvedValueOnce({ count: 0 });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const finding = {
      file: "src/x.ts",
      line: 10,
      severity: "high" as const,
      message: "bug here",
      suggestion: "fix it",
    };

    await persistFinding("acme/widgets", 7, finding);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("dedupHash already existed"),
    );
    consoleErrorSpy.mockRestore();
  });
});

describe("processReviewJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws a clear error instead of calling runPipeline when baseSha is missing (a job enqueued before a deploy that added the field)", async () => {
    const runPipeline = vi.fn().mockResolvedValue({ posted: [] });
    const pipelineDeps = {
      getToken: vi.fn(),
      openrouterApiKey: "fake-key",
      filterNewFindings: vi.fn(),
    };

    await expect(
      processReviewJob(
        {
          data: {
            owner: "acme",
            repo: "widgets",
            prNumber: 7,
            headSha: "sha1",
          },
        } as Job<ReviewJobPayload>,
        { runPipeline, pipelineDeps },
      ),
    ).rejects.toThrow(/baseSha/);

    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("calls runPipeline with an event built from the job payload", async () => {
    const runPipeline = vi.fn().mockResolvedValue({ posted: [] });
    const pipelineDeps = {
      getToken: vi.fn(),
      openrouterApiKey: "fake-key",
      filterNewFindings: vi.fn(),
    };

    await processReviewJob(
      fakeJob({
        owner: "acme",
        repo: "widgets",
        prNumber: 7,
        baseSha: "basesha1",
        headSha: "sha1",
      }),
      { runPipeline, pipelineDeps },
    );

    expect(runPipeline).toHaveBeenCalledWith(
      {
        owner: "acme",
        repo: "widgets",
        prNumber: 7,
        baseSha: "basesha1",
        headSha: "sha1",
        action: "synchronize",
      },
      pipelineDeps,
    );
  });

  it("does not touch the database itself — persistence happens inside the pipeline via pipelineDeps.persistFinding", async () => {
    const posted = [
      {
        file: "src/x.ts",
        line: 10,
        severity: "high" as const,
        message: "bug here",
        suggestion: "fix it",
      },
    ];
    const runPipeline = vi.fn().mockResolvedValue({ posted });
    const pipelineDeps = {
      getToken: vi.fn(),
      openrouterApiKey: "fake-key",
      filterNewFindings: vi.fn(),
    };

    await processReviewJob(
      fakeJob({
        owner: "acme",
        repo: "widgets",
        prNumber: 7,
        baseSha: "basesha1",
        headSha: "sha1",
      }),
      { runPipeline, pipelineDeps },
    );

    expect(prisma.finding.createMany).not.toHaveBeenCalled();
  });

  it("propagates whatever error runPipeline throws, unchanged", async () => {
    const partialPostError = new PartialPostError(
      "Failed to post 1 of 2 finding(s) for PR #7",
      [
        {
          file: "src/x.ts",
          line: 10,
          severity: "high" as const,
          message: "bug",
          suggestion: "fix",
        },
      ],
    );
    const runPipeline = vi.fn().mockRejectedValue(partialPostError);
    const pipelineDeps = {
      getToken: vi.fn(),
      openrouterApiKey: "fake-key",
      filterNewFindings: vi.fn(),
    };

    await expect(
      processReviewJob(
        fakeJob({
          owner: "acme",
          repo: "widgets",
          prNumber: 7,
          baseSha: "basesha1",
          headSha: "sha1",
        }),
        { runPipeline, pipelineDeps },
      ),
    ).rejects.toBe(partialPostError);

    expect(prisma.finding.createMany).not.toHaveBeenCalled();
  });
});
