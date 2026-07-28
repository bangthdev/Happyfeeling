import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { reviewDiff } from "./llmReviewer.js";

function fakeClient(createImpl: (...args: any[]) => Promise<any>): Anthropic {
  return { messages: { create: vi.fn(createImpl) } } as unknown as Anthropic;
}

describe("reviewDiff", () => {
  it("parses findings from a valid tool_use response", async () => {
    const client = fakeClient(async () => ({
      content: [
        {
          type: "tool_use",
          name: "submit_findings",
          input: {
            findings: [
              {
                file: "src/x.ts",
                line: 10,
                severity: "high",
                message: "bug",
                suggestion: "fix it",
              },
            ],
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    }));

    const result = await reviewDiff(
      { diff: "diff...", files: ["src/x.ts"] },
      client,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toBe("src/x.ts");
    expect(result.tokensUsed).toBe(150);
  });

  it("retries once when the first response has no tool_use block", async () => {
    let callCount = 0;
    const client = fakeClient(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          content: [{ type: "text", text: "oops" }],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      }
      return {
        content: [
          {
            type: "tool_use",
            name: "submit_findings",
            input: { findings: [] },
          },
        ],
        usage: { input_tokens: 20, output_tokens: 10 },
      };
    });

    const result = await reviewDiff({ diff: "diff...", files: [] }, client);

    expect(result.findings).toEqual([]);
    expect(result.tokensUsed).toBe(45);
    expect(callCount).toBe(2);
  });
});
