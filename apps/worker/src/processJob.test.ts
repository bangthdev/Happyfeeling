import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";
import type { ReviewJobPayload } from "@happyfeeling/queue";

vi.mock("@happyfeeling/db", () => ({
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

import { prisma } from "@happyfeeling/db";
import { PartialPostError } from "@happyfeeling/github/pipeline";
import { processReviewJob } from "./processJob.js";

function fakeJob(data: ReviewJobPayload): Job<ReviewJobPayload> {
  return { data } as Job<ReviewJobPayload>;
}

describe("processReviewJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls runPipeline with an event built from the job payload", async () => {
    const runPipeline = vi.fn().mockResolvedValue({ posted: [] });
    const pipelineDeps = {
      getToken: vi.fn(),
      openrouterApiKey: "fake-key",
      filterNewFindings: vi.fn(),
    };

    await processReviewJob(
      fakeJob({ owner: "acme", repo: "widgets", prNumber: 7, headSha: "sha1" }),
      { runPipeline, pipelineDeps },
    );

    expect(runPipeline).toHaveBeenCalledWith(
      {
        owner: "acme",
        repo: "widgets",
        prNumber: 7,
        headSha: "sha1",
        action: "synchronize",
      },
      pipelineDeps,
    );
  });

  it("persists all posted findings in a single createMany call, skipping duplicates", async () => {
    const posted = [
      {
        file: "src/x.ts",
        line: 10,
        severity: "high" as const,
        message: "bug here",
        suggestion: "fix it",
      },
      {
        file: "src/y.ts",
        line: 20,
        severity: "low" as const,
        message: "another",
        suggestion: "fix2",
      },
    ];
    const runPipeline = vi.fn().mockResolvedValue({ posted });
    const pipelineDeps = {
      getToken: vi.fn(),
      openrouterApiKey: "fake-key",
      filterNewFindings: vi.fn(),
    };

    await processReviewJob(
      fakeJob({ owner: "acme", repo: "widgets", prNumber: 7, headSha: "sha1" }),
      { runPipeline, pipelineDeps },
    );

    expect(prisma.finding.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.finding.createMany).toHaveBeenCalledWith({
      data: [
        {
          repo: "acme/widgets",
          prNumber: 7,
          filePath: "src/x.ts",
          line: 10,
          errorType: "high",
          message: "bug here",
          dedupHash: expect.any(String),
        },
        {
          repo: "acme/widgets",
          prNumber: 7,
          filePath: "src/y.ts",
          line: 20,
          errorType: "low",
          message: "another",
          dedupHash: expect.any(String),
        },
      ],
      skipDuplicates: true,
    });
  });

  it("writes no rows when nothing was posted", async () => {
    const runPipeline = vi.fn().mockResolvedValue({ posted: [] });
    const pipelineDeps = {
      getToken: vi.fn(),
      openrouterApiKey: "fake-key",
      filterNewFindings: vi.fn(),
    };

    await processReviewJob(
      fakeJob({ owner: "acme", repo: "widgets", prNumber: 7, headSha: "sha1" }),
      { runPipeline, pipelineDeps },
    );

    expect(prisma.finding.createMany).not.toHaveBeenCalled();
  });

  it("persists findings already posted before a PartialPostError, then rethrows it", async () => {
    const posted = [
      {
        file: "src/x.ts",
        line: 10,
        severity: "high" as const,
        message: "bug",
        suggestion: "fix",
      },
    ];
    const partialPostError = new PartialPostError(
      "Failed to post 1 of 2 finding(s) for PR #7",
      posted,
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
          headSha: "sha1",
        }),
        {
          runPipeline,
          pipelineDeps,
        },
      ),
    ).rejects.toBe(partialPostError);

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

  it("re-throws non-PartialPostError failures from runPipeline without persisting anything", async () => {
    const runPipeline = vi.fn().mockRejectedValue(new Error("network down"));
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
          headSha: "sha1",
        }),
        {
          runPipeline,
          pipelineDeps,
        },
      ),
    ).rejects.toThrow("network down");

    expect(prisma.finding.createMany).not.toHaveBeenCalled();
  });

  it("logs a warning when fewer rows are persisted than posted (an unexpected dedupHash collision)", async () => {
    const posted = [
      {
        file: "src/x.ts",
        line: 10,
        severity: "high" as const,
        message: "m1",
        suggestion: "s1",
      },
      {
        file: "src/y.ts",
        line: 20,
        severity: "low" as const,
        message: "m2",
        suggestion: "s2",
      },
    ];
    const runPipeline = vi.fn().mockResolvedValue({ posted });
    const pipelineDeps = {
      getToken: vi.fn(),
      openrouterApiKey: "fake-key",
      filterNewFindings: vi.fn(),
    };
    vi.mocked(prisma.finding.createMany).mockResolvedValueOnce({ count: 1 });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await processReviewJob(
      fakeJob({ owner: "acme", repo: "widgets", prNumber: 7, headSha: "sha1" }),
      { runPipeline, pipelineDeps },
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("persisted 1 of 2"),
    );
    consoleErrorSpy.mockRestore();
  });

  it("still rethrows the original PartialPostError even if persisting its findings also fails", async () => {
    const posted = [
      {
        file: "src/x.ts",
        line: 10,
        severity: "high" as const,
        message: "bug",
        suggestion: "fix",
      },
    ];
    const partialPostError = new PartialPostError(
      "Failed to post 1 of 2 finding(s) for PR #7",
      posted,
    );
    const runPipeline = vi.fn().mockRejectedValue(partialPostError);
    const pipelineDeps = {
      getToken: vi.fn(),
      openrouterApiKey: "fake-key",
      filterNewFindings: vi.fn(),
    };
    vi.mocked(prisma.finding.createMany).mockRejectedValueOnce(
      new Error("connection reset"),
    );
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      processReviewJob(
        fakeJob({
          owner: "acme",
          repo: "widgets",
          prNumber: 7,
          headSha: "sha1",
        }),
        {
          runPipeline,
          pipelineDeps,
        },
      ),
    ).rejects.toBe(partialPostError);

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
