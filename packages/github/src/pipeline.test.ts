import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PullRequestEvent } from "./webhook/parse.js";

vi.mock("./github/client.js", () => ({ getPullRequestDiff: vi.fn() }));
vi.mock("./review/commentPoster.js", () => ({ postFindings: vi.fn() }));
vi.mock("./review/llmReviewer.openrouter.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./review/llmReviewer.openrouter.js")>();
  return { ...actual, reviewDiff: vi.fn() };
});
vi.mock("./logger.js", () => ({ logMetrics: vi.fn() }));

import { getPullRequestDiff } from "./github/client.js";
import { postFindings } from "./review/commentPoster.js";
import {
  reviewDiff,
  PartialReviewError,
} from "./review/llmReviewer.openrouter.js";
import { logMetrics } from "./logger.js";
import { runReviewPipeline, passthroughFilterNewFindings } from "./pipeline.js";

describe("passthroughFilterNewFindings", () => {
  it("returns the given findings unchanged", async () => {
    const findings = [
      {
        file: "a.ts",
        line: 1,
        severity: "low" as const,
        message: "m",
        suggestion: "s",
      },
    ];

    await expect(
      passthroughFilterNewFindings("acme/widgets", 7, findings),
    ).resolves.toBe(findings);
  });
});

describe("runReviewPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("orchestrates diff fetch, review, comment posting, and metrics logging", async () => {
    const event: PullRequestEvent = {
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      baseSha: "basesha1",
      headSha: "sha1",
      action: "opened",
    };

    vi.mocked(getPullRequestDiff).mockResolvedValue(
      "diff --git a/src/x.ts b/src/x.ts\n...",
    );
    vi.mocked(reviewDiff).mockResolvedValue({
      findings: [
        {
          file: "src/x.ts",
          line: 1,
          severity: "high",
          message: "m",
          suggestion: "s",
        },
      ],
      tokensUsed: 300,
      chunksSkipped: 0,
    });
    vi.mocked(postFindings).mockResolvedValue({
      posted: [
        {
          file: "src/x.ts",
          line: 1,
          severity: "high",
          message: "m",
          suggestion: "s",
        },
      ],
      skipped: 0,
      failed: [],
      persistFailed: [],
    });

    const getToken = vi.fn().mockResolvedValue("tok");
    const filterNewFindings = vi
      .fn()
      .mockImplementation(async (_repo, _prNumber, findings) => findings);

    const result = await runReviewPipeline(event, {
      getToken,
      openrouterApiKey: "fake-openrouter-key",
      filterNewFindings,
    });

    expect(result).toEqual({
      posted: [
        {
          file: "src/x.ts",
          line: 1,
          severity: "high",
          message: "m",
          suggestion: "s",
        },
      ],
    });
    expect(getPullRequestDiff).toHaveBeenCalledWith(
      "tok",
      "acme",
      "widgets",
      "basesha1",
      "sha1",
    );
    expect(postFindings).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        prNumber: 7,
        commitSha: "sha1",
      }),
    );
    expect(logMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        pr_number: 7,
        findings_count: 1,
        tokens_used: 300,
        severity_breakdown: { high: 1 },
      }),
    );
  });

  it("wires deps.persistFinding into postFindings' onPosted, so each finding persists right after it's posted", async () => {
    const event: PullRequestEvent = {
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      baseSha: "basesha1",
      headSha: "sha1",
      action: "opened",
    };
    const finding = {
      file: "src/x.ts",
      line: 1,
      severity: "high" as const,
      message: "m",
      suggestion: "s",
    };

    vi.mocked(getPullRequestDiff).mockResolvedValue(
      "diff --git a/src/x.ts b/src/x.ts\n...",
    );
    vi.mocked(reviewDiff).mockResolvedValue({
      findings: [finding],
      tokensUsed: 300,
      chunksSkipped: 0,
    });
    vi.mocked(postFindings).mockResolvedValue({
      posted: [finding],
      skipped: 0,
      failed: [],
      persistFailed: [],
    });

    const getToken = vi.fn().mockResolvedValue("tok");
    const filterNewFindings = vi
      .fn()
      .mockImplementation(async (_repo, _prNumber, findings) => findings);
    const persistFinding = vi.fn().mockResolvedValue(undefined);

    await runReviewPipeline(event, {
      getToken,
      openrouterApiKey: "fake-openrouter-key",
      filterNewFindings,
      persistFinding,
    });

    const onPosted = vi.mocked(postFindings).mock.calls[0][0].onPosted;
    expect(onPosted).toBeInstanceOf(Function);

    await onPosted!(finding);
    expect(persistFinding).toHaveBeenCalledWith("acme/widgets", 7, finding);
  });

  it("does not pass onPosted to postFindings when deps.persistFinding is not provided", async () => {
    const event: PullRequestEvent = {
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      baseSha: "basesha1",
      headSha: "sha1",
      action: "opened",
    };

    vi.mocked(getPullRequestDiff).mockResolvedValue(
      "diff --git a/src/x.ts b/src/x.ts\n...",
    );
    vi.mocked(reviewDiff).mockResolvedValue({
      findings: [],
      tokensUsed: 0,
      chunksSkipped: 0,
    });
    vi.mocked(postFindings).mockResolvedValue({
      posted: [],
      skipped: 0,
      failed: [],
      persistFailed: [],
    });

    const getToken = vi.fn().mockResolvedValue("tok");
    const filterNewFindings = vi
      .fn()
      .mockImplementation(async (_repo, _prNumber, findings) => findings);

    await runReviewPipeline(event, {
      getToken,
      openrouterApiKey: "fake-openrouter-key",
      filterNewFindings,
    });

    expect(vi.mocked(postFindings).mock.calls[0][0].onPosted).toBeUndefined();
  });

  it("includes skipped_count in metrics when postFindings reports findings GitHub rejected", async () => {
    const event: PullRequestEvent = {
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      baseSha: "basesha1",
      headSha: "sha1",
      action: "opened",
    };

    vi.mocked(getPullRequestDiff).mockResolvedValue(
      "diff --git a/src/x.ts b/src/x.ts\n...",
    );
    vi.mocked(reviewDiff).mockResolvedValue({
      findings: [
        {
          file: "src/x.ts",
          line: 1,
          severity: "high",
          message: "m",
          suggestion: "s",
        },
      ],
      tokensUsed: 300,
      chunksSkipped: 0,
    });
    vi.mocked(postFindings).mockResolvedValue({
      posted: [],
      skipped: 2,
      failed: [],
      persistFailed: [],
    });

    const getToken = vi.fn().mockResolvedValue("tok");
    const filterNewFindings = vi
      .fn()
      .mockImplementation(async (_repo, _prNumber, findings) => findings);

    await runReviewPipeline(event, {
      getToken,
      openrouterApiKey: "fake-openrouter-key",
      filterNewFindings,
    });

    expect(logMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ skipped_count: 2 }),
    );
  });

  it("includes chunks_skipped in metrics when reviewDiff caps a very large diff", async () => {
    const event: PullRequestEvent = {
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      baseSha: "basesha1",
      headSha: "sha1",
      action: "opened",
    };

    vi.mocked(getPullRequestDiff).mockResolvedValue(
      "diff --git a/src/x.ts b/src/x.ts\n...",
    );
    vi.mocked(reviewDiff).mockResolvedValue({
      findings: [],
      tokensUsed: 300,
      chunksSkipped: 3,
    });
    vi.mocked(postFindings).mockResolvedValue({
      posted: [],
      skipped: 0,
      failed: [],
      persistFailed: [],
    });

    const getToken = vi.fn().mockResolvedValue("tok");
    const filterNewFindings = vi
      .fn()
      .mockImplementation(async (_repo, _prNumber, findings) => findings);

    await runReviewPipeline(event, {
      getToken,
      openrouterApiKey: "fake-openrouter-key",
      filterNewFindings,
    });

    expect(logMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ chunks_skipped: 3 }),
    );
  });

  it("only posts findings that filterNewFindings has not already marked as seen", async () => {
    const event: PullRequestEvent = {
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      baseSha: "basesha1",
      headSha: "sha1",
      action: "opened",
    };
    const seen = {
      file: "src/seen.ts",
      line: 1,
      severity: "low" as const,
      message: "old",
      suggestion: "s1",
    };
    const fresh = {
      file: "src/fresh.ts",
      line: 2,
      severity: "high" as const,
      message: "new",
      suggestion: "s2",
    };

    vi.mocked(getPullRequestDiff).mockResolvedValue(
      "diff --git a/src/x.ts b/src/x.ts\n...",
    );
    vi.mocked(reviewDiff).mockResolvedValue({
      findings: [seen, fresh],
      tokensUsed: 300,
      chunksSkipped: 0,
    });
    vi.mocked(postFindings).mockResolvedValue({
      posted: [fresh],
      skipped: 0,
      failed: [],
      persistFailed: [],
    });
    const filterNewFindings = vi.fn().mockResolvedValue([fresh]);

    const getToken = vi.fn().mockResolvedValue("tok");

    await runReviewPipeline(event, {
      getToken,
      openrouterApiKey: "fake-openrouter-key",
      filterNewFindings,
    });

    expect(filterNewFindings).toHaveBeenCalledWith("acme/widgets", 7, [
      seen,
      fresh,
    ]);
    expect(postFindings).toHaveBeenCalledWith(
      expect.objectContaining({ findings: [fresh] }),
    );
    expect(logMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        findings_count: 1,
        severity_breakdown: { high: 1 },
      }),
    );
  });

  it("logs metrics for findings actually posted, then throws a PartialPostError carrying them, when some posts fail", async () => {
    const event: PullRequestEvent = {
      owner: "acme",
      repo: "widgets",
      prNumber: 9,
      baseSha: "basesha1",
      headSha: "sha2",
      action: "opened",
    };

    vi.mocked(getPullRequestDiff).mockResolvedValue(
      "diff --git a/src/y.ts b/src/y.ts\n...",
    );
    vi.mocked(reviewDiff).mockResolvedValue({
      findings: [
        {
          file: "src/y.ts",
          line: 1,
          severity: "high",
          message: "m1",
          suggestion: "s1",
        },
        {
          file: "src/y.ts",
          line: 2,
          severity: "low",
          message: "m2",
          suggestion: "s2",
        },
      ],
      tokensUsed: 500,
      chunksSkipped: 0,
    });
    const posted = [
      {
        file: "src/y.ts",
        line: 1,
        severity: "high" as const,
        message: "m1",
        suggestion: "s1",
      },
    ];
    vi.mocked(postFindings).mockResolvedValue({
      posted,
      skipped: 0,
      failed: [
        {
          file: "src/y.ts",
          line: 2,
          severity: "low",
          message: "m2",
          suggestion: "s2",
        },
      ],
      persistFailed: [],
    });

    const getToken = vi.fn().mockResolvedValue("tok");
    const filterNewFindings = vi
      .fn()
      .mockImplementation(async (_repo, _prNumber, findings) => findings);

    await expect(
      runReviewPipeline(event, {
        getToken,
        openrouterApiKey: "fake-openrouter-key",
        filterNewFindings,
      }),
    ).rejects.toMatchObject({
      name: "PartialPostError",
      message: expect.stringContaining("Failed to post 1 of 2 finding(s)"),
      posted,
    });

    expect(logMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        pr_number: 9,
        findings_count: 1,
        tokens_used: 500,
      }),
    );
  });

  it("throws PersistFailedError when a posted finding failed to persist, instead of completing silently", async () => {
    const event: PullRequestEvent = {
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      baseSha: "basesha1",
      headSha: "sha1",
      action: "opened",
    };
    const posted = [
      {
        file: "src/x.ts",
        line: 1,
        severity: "high" as const,
        message: "m",
        suggestion: "s",
      },
    ];

    vi.mocked(getPullRequestDiff).mockResolvedValue(
      "diff --git a/src/x.ts b/src/x.ts\n...",
    );
    vi.mocked(reviewDiff).mockResolvedValue({
      findings: posted,
      tokensUsed: 100,
      chunksSkipped: 0,
    });
    vi.mocked(postFindings).mockResolvedValue({
      posted,
      skipped: 0,
      failed: [],
      persistFailed: posted,
    });

    const getToken = vi.fn().mockResolvedValue("tok");
    const filterNewFindings = vi
      .fn()
      .mockImplementation(async (_repo, _prNumber, findings) => findings);

    await expect(
      runReviewPipeline(event, {
        getToken,
        openrouterApiKey: "fake-openrouter-key",
        filterNewFindings,
        persistFinding: vi.fn(),
      }),
    ).rejects.toMatchObject({
      name: "PersistFailedError",
      posted,
    });
  });

  it("still posts and logs the findings collected before a partial review failure", async () => {
    const event: PullRequestEvent = {
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      baseSha: "basesha1",
      headSha: "sha1",
      action: "opened",
    };
    const partialFindings = [
      {
        file: "src/x.ts",
        line: 1,
        severity: "high" as const,
        message: "m",
        suggestion: "s",
      },
    ];

    vi.mocked(getPullRequestDiff).mockResolvedValue(
      "diff --git a/src/x.ts b/src/x.ts\n...",
    );
    vi.mocked(reviewDiff).mockRejectedValue(
      new PartialReviewError(
        "OpenRouter review failed on chunk 2/3",
        { findings: partialFindings, tokensUsed: 150, chunksSkipped: 4 },
        new Error("401"),
      ),
    );
    vi.mocked(postFindings).mockResolvedValue({
      posted: partialFindings,
      skipped: 0,
      failed: [],
      persistFailed: [],
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const getToken = vi.fn().mockResolvedValue("tok");
    const filterNewFindings = vi
      .fn()
      .mockImplementation(async (_repo, _prNumber, findings) => findings);

    const result = await runReviewPipeline(event, {
      getToken,
      openrouterApiKey: "fake-openrouter-key",
      filterNewFindings,
    });

    expect(result).toEqual({ posted: partialFindings });
    expect(postFindings).toHaveBeenCalledWith(
      expect.objectContaining({ findings: partialFindings }),
    );
    expect(logMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        pr_number: 7,
        findings_count: 1,
        tokens_used: 150,
        chunks_skipped: 4,
      }),
    );
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });

  it("re-throws non-PartialReviewError failures from reviewDiff without posting anything", async () => {
    const event: PullRequestEvent = {
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      baseSha: "basesha1",
      headSha: "sha1",
      action: "opened",
    };

    vi.mocked(getPullRequestDiff).mockResolvedValue(
      "diff --git a/src/x.ts b/src/x.ts\n...",
    );
    vi.mocked(reviewDiff).mockRejectedValue(new Error("network down"));

    const getToken = vi.fn().mockResolvedValue("tok");
    const filterNewFindings = vi
      .fn()
      .mockImplementation(async (_repo, _prNumber, findings) => findings);

    await expect(
      runReviewPipeline(event, {
        getToken,
        openrouterApiKey: "fake-openrouter-key",
        filterNewFindings,
      }),
    ).rejects.toThrow("network down");
    expect(postFindings).not.toHaveBeenCalled();
    expect(filterNewFindings).not.toHaveBeenCalled();
  });
});
