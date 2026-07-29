import { describe, it, expect, vi } from "vitest";
import { postFindings, buildCommentBody } from "./commentPoster.js";
import { GithubApiError } from "../github/client.js";
import type { Finding } from "./llmReviewer.js";

describe("postFindings", () => {
  it("posts every finding using line+side and returns the posted findings", async () => {
    const postFn = vi.fn().mockResolvedValue(undefined);
    const findings: Finding[] = [
      {
        file: "src/foo.ts",
        line: 3,
        severity: "high",
        message: "bug",
        suggestion: "fix",
      },
      {
        file: "src/foo.ts",
        line: 10,
        severity: "low",
        message: "nit",
        suggestion: "n/a",
      },
    ];

    const result = await postFindings(
      {
        token: "tok",
        owner: "acme",
        repo: "widgets",
        prNumber: 1,
        commitSha: "sha1",
        findings,
      },
      postFn,
    );

    expect(result).toEqual({
      posted: findings,
      skipped: 0,
      failed: [],
      persistFailed: [],
    });
    expect(postFn).toHaveBeenCalledTimes(2);
    expect(postFn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        filePath: "src/foo.ts",
        line: 3,
        side: "RIGHT",
      }),
    );
    expect(postFn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        filePath: "src/foo.ts",
        line: 10,
        side: "RIGHT",
      }),
    );
  });

  it("skips a finding whose line falls outside the diff (422) and keeps posting the rest", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const postFn = vi
      .fn()
      .mockRejectedValueOnce(
        new GithubApiError(
          "Failed to post review comment: 422 Unprocessable Entity",
          422,
        ),
      )
      .mockResolvedValueOnce(undefined);
    const findings: Finding[] = [
      {
        file: "src/foo.ts",
        line: 999,
        severity: "high",
        message: "off-diff line",
        suggestion: "n/a",
      },
      {
        file: "src/foo.ts",
        line: 10,
        severity: "low",
        message: "nit",
        suggestion: "n/a",
      },
    ];

    const result = await postFindings(
      {
        token: "tok",
        owner: "acme",
        repo: "widgets",
        prNumber: 1,
        commitSha: "sha1",
        findings,
      },
      postFn,
    );

    expect(result).toEqual({
      posted: [findings[1]],
      skipped: 1,
      failed: [],
      persistFailed: [],
    });
    expect(postFn).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });

  it("collects a non-422 failure without losing findings already posted", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const postFn = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new GithubApiError(
          "Failed to post review comment: 401 Bad credentials",
          401,
        ),
      );
    const findings: Finding[] = [
      {
        file: "src/foo.ts",
        line: 3,
        severity: "high",
        message: "bug",
        suggestion: "fix",
      },
      {
        file: "src/foo.ts",
        line: 10,
        severity: "low",
        message: "nit",
        suggestion: "n/a",
      },
    ];

    const result = await postFindings(
      {
        token: "tok",
        owner: "acme",
        repo: "widgets",
        prNumber: 1,
        commitSha: "sha1",
        findings,
      },
      postFn,
    );

    expect(result).toEqual({
      posted: [findings[0]],
      skipped: 0,
      failed: [findings[1]],
      persistFailed: [],
    });
    expect(postFn).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });

  it("calls onPosted right after each successful post, before posting the next finding", async () => {
    const calls: string[] = [];
    const postFn = vi.fn().mockImplementation(async (params) => {
      calls.push(`post:${params.line}`);
    });
    const onPosted = vi.fn().mockImplementation(async (finding: Finding) => {
      calls.push(`persist:${finding.line}`);
    });
    const findings: Finding[] = [
      {
        file: "src/foo.ts",
        line: 3,
        severity: "high",
        message: "bug",
        suggestion: "fix",
      },
      {
        file: "src/foo.ts",
        line: 10,
        severity: "low",
        message: "nit",
        suggestion: "n/a",
      },
    ];

    await postFindings(
      {
        token: "tok",
        owner: "acme",
        repo: "widgets",
        prNumber: 1,
        commitSha: "sha1",
        findings,
        onPosted,
      },
      postFn,
    );

    expect(calls).toEqual(["post:3", "persist:3", "post:10", "persist:10"]);
  });

  it("does not call onPosted for a skipped (422) or failed finding", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const postFn = vi
      .fn()
      .mockRejectedValueOnce(
        new GithubApiError(
          "Failed to post review comment: 422 Unprocessable Entity",
          422,
        ),
      )
      .mockRejectedValueOnce(
        new GithubApiError("Failed to post review comment: 401", 401),
      );
    const onPosted = vi.fn().mockResolvedValue(undefined);
    const findings: Finding[] = [
      {
        file: "src/foo.ts",
        line: 999,
        severity: "high",
        message: "off-diff",
        suggestion: "n/a",
      },
      {
        file: "src/foo.ts",
        line: 10,
        severity: "low",
        message: "nit",
        suggestion: "n/a",
      },
    ];

    await postFindings(
      {
        token: "tok",
        owner: "acme",
        repo: "widgets",
        prNumber: 1,
        commitSha: "sha1",
        findings,
        onPosted,
      },
      postFn,
    );

    expect(onPosted).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("logs and keeps posting the rest when onPosted itself throws", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const postFn = vi.fn().mockResolvedValue(undefined);
    const onPosted = vi
      .fn()
      .mockRejectedValueOnce(new Error("db connection reset"))
      .mockResolvedValueOnce(undefined);
    const findings: Finding[] = [
      {
        file: "src/foo.ts",
        line: 3,
        severity: "high",
        message: "bug",
        suggestion: "fix",
      },
      {
        file: "src/foo.ts",
        line: 10,
        severity: "low",
        message: "nit",
        suggestion: "n/a",
      },
    ];

    const result = await postFindings(
      {
        token: "tok",
        owner: "acme",
        repo: "widgets",
        prNumber: 1,
        commitSha: "sha1",
        findings,
        onPosted,
      },
      postFn,
    );

    expect(result).toEqual({
      posted: findings,
      skipped: 0,
      failed: [],
      // Still posted to GitHub, but onPosted (persisting it) failed — the
      // caller needs this to know the DB write didn't happen, not just a
      // console.error nobody's watching.
      persistFailed: [findings[0]],
    });
    expect(postFn).toHaveBeenCalledTimes(2);
    expect(onPosted).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to persist a finding immediately after posting it:",
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it("uses buildCommentBody to build the posted comment body", async () => {
    const postFn = vi.fn().mockResolvedValue(undefined);
    const findings: Finding[] = [
      {
        file: "src/foo.ts",
        line: 5,
        severity: "high",
        message: "Assignment instead of comparison",
        suggestion: "Use === for comparison instead of =.",
        codeSnippet: "if (score = 100) {",
        fixedCode: "if (score === 100) {",
      },
    ];

    await postFindings(
      {
        token: "tok",
        owner: "acme",
        repo: "widgets",
        prNumber: 1,
        commitSha: "sha1",
        findings,
      },
      postFn,
    );

    expect(postFn).toHaveBeenCalledWith(
      expect.objectContaining({ body: buildCommentBody(findings[0]) }),
    );
  });
});

describe("buildCommentBody", () => {
  it("falls back to the plain message+suggestion format when codeSnippet/fixedCode are missing", () => {
    const finding: Finding = {
      file: "src/foo.ts",
      line: 5,
      severity: "low",
      message: "nit",
      suggestion: "n/a",
    };

    expect(buildCommentBody(finding)).toBe("**[low]** nit\n\nn/a");
  });

  it("shows the explanation followed by a GitHub suggestion block when codeSnippet and fixedCode differ", () => {
    const finding: Finding = {
      file: "src/foo.ts",
      line: 5,
      severity: "high",
      message: "Assignment instead of comparison",
      suggestion: "Use === for comparison instead of =.",
      codeSnippet: "if (score = 100) {",
      fixedCode: "if (score === 100) {",
    };

    expect(buildCommentBody(finding)).toBe(
      [
        "**[high]** Assignment instead of comparison",
        "",
        "Use === for comparison instead of =.",
        "",
        "```suggestion",
        "if (score === 100) {",
        "```",
      ].join("\n"),
    );
  });

  it("falls back to the plain format when fixedCode is identical to codeSnippet", () => {
    const finding: Finding = {
      file: "src/foo.ts",
      line: 5,
      severity: "medium",
      message: "possible issue",
      suggestion: "double check this",
      codeSnippet: "doThing();",
      fixedCode: "doThing();",
    };

    expect(buildCommentBody(finding)).toBe(
      "**[medium]** possible issue\n\ndouble check this",
    );
  });

  it("falls back to the plain format when fixedCode contains a triple-backtick", () => {
    const finding: Finding = {
      file: "docs/example.md",
      line: 2,
      severity: "low",
      message: "nested code fence",
      suggestion: "escape it",
      codeSnippet: "some line",
      fixedCode: "```js\nconsole.log(2)\n```",
    };

    expect(buildCommentBody(finding)).toBe(
      "**[low]** nested code fence\n\nescape it",
    );
  });

  it("falls back to the plain format when suggestion contains a triple-backtick", () => {
    const finding: Finding = {
      file: "docs/example.md",
      line: 2,
      severity: "low",
      message: "nested code fence",
      suggestion: "Example:\n```js\nconsole.log(2)\n```",
      codeSnippet: "some line",
      fixedCode: "some fixed line",
    };

    expect(buildCommentBody(finding)).toBe(
      "**[low]** nested code fence\n\nExample:\n```js\nconsole.log(2)\n```",
    );
  });

  it("falls back to the plain format when fixedCode is empty", () => {
    const finding: Finding = {
      file: "src/foo.ts",
      line: 5,
      severity: "medium",
      message: "model returned nothing",
      suggestion: "n/a",
      codeSnippet: "doThing();",
      fixedCode: "",
    };

    expect(buildCommentBody(finding)).toBe(
      "**[medium]** model returned nothing\n\nn/a",
    );
  });
});
