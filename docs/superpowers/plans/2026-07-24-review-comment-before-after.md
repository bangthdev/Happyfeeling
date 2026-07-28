# Review Comment Before/After Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot review comments show the buggy code ("Before") and an actionable fix (GitHub `suggestion` block) instead of just a text message.

**Architecture:** Groq's tool schema gains a `fixedCode` field alongside the existing `codeSnippet` (AIC-36). `resolveFindings()` stops discarding `codeSnippet` and carries both fields through into the final `Finding`. A new pure function `buildCommentBody()` in `commentPoster.ts` renders the comment body — full before/after format when both fields are present and actually differ, otherwise falls back to the current plain `message`+`suggestion` format.

**Tech Stack:** TypeScript, Vitest, existing Groq tool-calling schema.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-24-review-comment-before-after.md`
- Scope is exactly 2 files: `packages/github/src/review/llmReviewer.groq.ts` and `packages/github/src/review/commentPoster.ts` (plus their test files and a type addition in `llmReviewer.ts`). Do not touch `finder.ts` or the Claude `llmReviewer.ts` review logic.
- No DB migration — `Finding` Prisma model is untouched.
- TDD: write the failing test, watch it fail, write minimal code to pass, watch it pass, then commit — for every step below.
- Commit messages: English, imperative subject ≤72 chars, Problem/Solution body for non-trivial commits (per this repo's convention).

---

### Task 1: Groq returns `fixedCode`, `Finding` carries `codeSnippet`+`fixedCode` through

**Files:**

- Modify: `packages/github/src/review/llmReviewer.ts` (the `Finding` interface, currently lines 4-11)
- Modify: `packages/github/src/review/llmReviewer.groq.ts`
- Test: `packages/github/src/review/llmReviewer.groq.test.ts`

**Interfaces:**

- Produces: `Finding` (in `llmReviewer.ts`) gains two new **optional** fields: `codeSnippet?: string`, `fixedCode?: string`. `reviewDiff()`'s return type is unchanged (`ReviewResult` with `findings: Finding[]`) — later tasks consume `finding.codeSnippet` / `finding.fixedCode`.

- [ ] **Step 1: Add the optional fields to `Finding`**

In `packages/github/src/review/llmReviewer.ts`, change:

```ts
export interface Finding {
  file: string;
  /** Line number in the new (post-diff) version of the file — never a deleted line. commentPoster.ts relies on this to always post comments on the diff's RIGHT side. */
  line: number;
  severity: "high" | "medium" | "low";
  message: string;
  suggestion: string;
}
```

to:

```ts
export interface Finding {
  file: string;
  /** Line number in the new (post-diff) version of the file — never a deleted line. commentPoster.ts relies on this to always post comments on the diff's RIGHT side. */
  line: number;
  severity: "high" | "medium" | "low";
  message: string;
  suggestion: string;
  /** Exact original line the finding refers to (Groq reviewer only — matches resolveLine's anchor text). */
  codeSnippet?: string;
  /** Corrected version of codeSnippet (Groq reviewer only) — may span multiple lines. */
  fixedCode?: string;
}
```

This is a type-only change with no runtime behavior — no test for this step by itself; it's exercised by Step 2's test below.

- [ ] **Step 2: Write the failing test**

In `packages/github/src/review/llmReviewer.groq.test.ts`, add this test (place it right after the `'resolves the finding line by matching codeSnippet against the diff'` test):

```ts
it("carries codeSnippet and fixedCode through into the final Finding", async () => {
  const diff = `diff --git a/src/x.ts b/src/x.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const bug = 1;
 const b = 2;
 const c = 3;
`;
  const fetchFn = fakeFetch(async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: "submit_findings",
                  arguments: JSON.stringify({
                    findings: [
                      {
                        file: "src/x.ts",
                        codeSnippet: "const bug = 1;",
                        fixedCode: "const notBug = 1;",
                        severity: "high",
                        message: "bad name",
                        suggestion: "rename it",
                      },
                    ],
                  }),
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }),
  }));

  const result = await reviewDiff(
    { diff, files: ["src/x.ts"] },
    "fake-key",
    fetchFn,
  );

  expect(result.findings).toEqual([
    {
      file: "src/x.ts",
      line: 2,
      severity: "high",
      message: "bad name",
      suggestion: "rename it",
      codeSnippet: "const bug = 1;",
      fixedCode: "const notBug = 1;",
    },
  ]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @happyfeeling/github test -- review/llmReviewer.groq.test.ts -t "carries codeSnippet and fixedCode"`
Expected: FAIL — actual `result.findings[0]` is missing `codeSnippet` and `fixedCode` (current `resolveFindings` only keeps `file, line, severity, message, suggestion`).

- [ ] **Step 4: Implement — schema, RawFinding, prompt, resolveFindings**

In `packages/github/src/review/llmReviewer.groq.ts`:

Change `FINDINGS_TOOL`'s `properties` and `required` (inside `parameters.properties.findings.items`):

```ts
            properties: {
              file: { type: 'string' },
              codeSnippet: { type: 'string' },
              fixedCode: { type: 'string' },
              severity: { type: 'string', enum: ['high', 'medium', 'low'] },
              message: { type: 'string' },
              suggestion: { type: 'string' },
            },
            required: ['file', 'codeSnippet', 'fixedCode', 'severity', 'message', 'suggestion'],
```

Change `RawFinding`:

```ts
interface RawFinding {
  file: string;
  codeSnippet: string;
  fixedCode: string;
  severity: Finding["severity"];
  message: string;
  suggestion: string;
}
```

Change `buildPrompt` (add the `fixedCode` instruction after the existing `codeSnippet` instruction):

```ts
function buildPrompt(context: ReviewContext): string {
  return `Bạn là một senior engineer đang review Pull Request. Đọc diff dưới đây và chỉ ra các vấn đề thật sự quan trọng (bug, security, logic sai). Bỏ qua nitpick về style/format. Nếu không có vấn đề gì, trả về findings rỗng.\n\nVới mỗi finding, trường "codeSnippet" phải là chép NGUYÊN VĂN (verbatim) đúng 1 dòng code trong diff nơi xảy ra vấn đề — không tự diễn giải, không thêm/bớt khoảng trắng.\n\nTrường "fixedCode" phải là bản đã sửa đúng lỗi mô tả trong "message", giữ nguyên style/indent gốc — 1 dòng nếu fix chỉ cần 1 dòng, nhiều dòng nếu bug thực sự cần sửa nhiều dòng mới hết lỗi.\n\nDiff:\n${context.diff}`;
}
```

Change `resolveFindings` to keep `codeSnippet` and `fixedCode`:

```ts
function resolveFindings(context: ReviewContext, raw: RawFinding[]): Finding[] {
  const findings: Finding[] = [];
  for (const finding of raw) {
    const line = resolveLine(context.diff, finding.codeSnippet);
    if (line === null) continue;
    findings.push({
      file: finding.file,
      line,
      severity: finding.severity,
      message: finding.message,
      suggestion: finding.suggestion,
      codeSnippet: finding.codeSnippet,
      fixedCode: finding.fixedCode,
    });
  }
  return findings;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @happyfeeling/github test -- review/llmReviewer.groq.test.ts -t "carries codeSnippet and fixedCode"`
Expected: PASS

- [ ] **Step 6: Fix the collateral break in the existing "resolves the finding line" test**

`resolveFindings` now includes `codeSnippet` in every returned `Finding`, which breaks the exact-equality (`toEqual`) assertion in the pre-existing test `'resolves the finding line by matching codeSnippet against the diff'`. In `packages/github/src/review/llmReviewer.groq.test.ts`, change:

```ts
expect(result.findings).toEqual([
  {
    file: "src/x.ts",
    line: 2,
    severity: "high",
    message: "bug",
    suggestion: "fix it",
  },
]);
```

to:

```ts
expect(result.findings).toEqual([
  {
    file: "src/x.ts",
    line: 2,
    severity: "high",
    message: "bug",
    suggestion: "fix it",
    codeSnippet: "const bug = 1;",
  },
]);
```

(That test's mock response doesn't set `fixedCode`, so it stays `undefined` on the result — `toEqual` treats an `undefined` property as equivalent to an absent one, so no change needed there.)

- [ ] **Step 7: Run the full file's test suite to verify nothing else broke**

Run: `pnpm --filter @happyfeeling/github test -- review/llmReviewer.groq.test.ts`
Expected: PASS — all tests in the file green (the other tests use `toHaveLength`/`toMatchObject`, which ignore the new extra fields).

- [ ] **Step 8: Commit**

```bash
git add packages/github/src/review/llmReviewer.ts packages/github/src/review/llmReviewer.groq.ts packages/github/src/review/llmReviewer.groq.test.ts
git commit -m "$(cat <<'EOF'
Have Groq return fixedCode and keep it on the Finding

Problem:

- review comments only carry a text message + suggestion, no actual
  before/after code, because resolveFindings discards codeSnippet
  after using it to compute the line number, and there is no fixedCode
  field at all

Solution:

- add fixedCode to the Groq tool schema and prompt: the corrected
  version of codeSnippet, as short or long as the actual fix requires
- keep both codeSnippet and fixedCode on the returned Finding instead
  of dropping codeSnippet after line resolution
EOF
)"
```

---

### Task 2: `commentPoster.ts` renders before/after with a GitHub suggestion block

**Files:**

- Modify: `packages/github/src/review/commentPoster.ts`
- Test: `packages/github/src/review/commentPoster.test.ts`

**Interfaces:**

- Consumes: `Finding` (from Task 1) — `codeSnippet?: string`, `fixedCode?: string`, plus the existing `file, line, severity, message, suggestion`.
- Produces: `buildCommentBody(finding: Finding): string` — exported, pure function. `postFindings` uses it to build the `body` passed to `postFn`.

- [ ] **Step 1: Write the failing test — fallback format (baseline)**

In `packages/github/src/review/commentPoster.test.ts`, add a new `describe` block (after the existing `describe('postFindings', ...)` block, so it's a sibling, not nested):

```ts
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
});
```

Add `buildCommentBody` to the existing import at the top of the file:

```ts
import { postFindings, buildCommentBody } from "./commentPoster.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @happyfeeling/github test -- review/commentPoster.test.ts -t "falls back to the plain message"`
Expected: FAIL — `buildCommentBody` is not exported / does not exist yet (`SyntaxError` or `TypeError: buildCommentBody is not a function`).

- [ ] **Step 3: Implement minimal `buildCommentBody`**

In `packages/github/src/review/commentPoster.ts`, add this function (place it above `postFindings`, after the imports/interfaces):

```ts
export function buildCommentBody(finding: Finding): string {
  return `**[${finding.severity}]** ${finding.message}\n\n${finding.suggestion}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @happyfeeling/github test -- review/commentPoster.test.ts -t "falls back to the plain message"`
Expected: PASS

- [ ] **Step 5: Write the failing test — full before/after case**

Add to the `describe('buildCommentBody', ...)` block:

````ts
it("shows a Before block plus a GitHub suggestion block when codeSnippet and fixedCode differ", () => {
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
      "Before:",
      "```ts",
      "if (score = 100) {",
      "```",
      "",
      "```suggestion",
      "if (score === 100) {",
      "```",
      "",
      "Use === for comparison instead of =.",
    ].join("\n"),
  );
});
````

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @happyfeeling/github test -- review/commentPoster.test.ts -t "shows a Before block"`
Expected: FAIL — current `buildCommentBody` ignores `codeSnippet`/`fixedCode`, returns the plain fallback format instead.

- [ ] **Step 7: Implement the before/after branch**

Replace `buildCommentBody` with:

````ts
export function buildCommentBody(finding: Finding): string {
  const header = `**[${finding.severity}]** ${finding.message}`;

  if (finding.codeSnippet === undefined || finding.fixedCode === undefined) {
    return `${header}\n\n${finding.suggestion}`;
  }

  return [
    header,
    "",
    "Before:",
    "```ts",
    finding.codeSnippet,
    "```",
    "",
    "```suggestion",
    finding.fixedCode,
    "```",
    "",
    finding.suggestion,
  ].join("\n");
}
````

- [ ] **Step 8: Run both tests to verify they pass**

Run: `pnpm --filter @happyfeeling/github test -- review/commentPoster.test.ts -t "buildCommentBody"`
Expected: PASS (both tests in the `describe('buildCommentBody', ...)` block)

- [ ] **Step 9: Write the failing test — no-op fix guard**

Add to the `describe('buildCommentBody', ...)` block:

```ts
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
```

- [ ] **Step 10: Run test to verify it fails**

Run: `pnpm --filter @happyfeeling/github test -- review/commentPoster.test.ts -t "identical to codeSnippet"`
Expected: FAIL — current implementation renders the full Before/suggestion block even though nothing actually changed.

- [ ] **Step 11: Implement the no-op guard**

Replace the `if` condition in `buildCommentBody`:

```ts
if (
  finding.codeSnippet === undefined ||
  finding.fixedCode === undefined ||
  finding.fixedCode.trim() === finding.codeSnippet.trim()
) {
  return `${header}\n\n${finding.suggestion}`;
}
```

- [ ] **Step 12: Run all three `buildCommentBody` tests to verify they pass**

Run: `pnpm --filter @happyfeeling/github test -- review/commentPoster.test.ts -t "buildCommentBody"`
Expected: PASS (all 3 tests)

- [ ] **Step 13: Write the failing test — wire `buildCommentBody` into `postFindings`**

Add to the existing `describe('postFindings', ...)` block (not the new one):

```ts
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
```

- [ ] **Step 14: Run test to verify it fails**

Run: `pnpm --filter @happyfeeling/github test -- review/commentPoster.test.ts -t "uses buildCommentBody"`
Expected: FAIL — `postFindings` still builds `body` with its own inline template, which for this finding produces the old plain format, not `buildCommentBody`'s before/after format.

- [ ] **Step 15: Wire it in**

In `packages/github/src/review/commentPoster.ts`, inside `postFindings`, change:

```ts
        body: `**[${finding.severity}]** ${finding.message}\n\n${finding.suggestion}`,
```

to:

```ts
        body: buildCommentBody(finding),
```

- [ ] **Step 16: Run the full file's test suite to verify everything passes**

Run: `pnpm --filter @happyfeeling/github test -- review/commentPoster.test.ts`
Expected: PASS — all tests in the file green (existing `postFindings` tests don't assert on `body` content, so they're unaffected).

- [ ] **Step 17: Commit**

```bash
git add packages/github/src/review/commentPoster.ts packages/github/src/review/commentPoster.test.ts
git commit -m "$(cat <<'EOF'
Show before/after code in review comments

Problem:

- review comments only show a text message + a one-line suggestion,
  no actual code — readers have to imagine the fix or scroll back to
  the diff to compare

Solution:

- add buildCommentBody(): renders a "Before" code block plus a GitHub
  suggestion block (applicable with one click, works for single- or
  multi-line fixes) when codeSnippet/fixedCode are present and
  actually differ
- fall back to the existing plain message+suggestion format when
  either field is missing, or when fixedCode is identical to
  codeSnippet (model produced a no-op "fix")
- wire buildCommentBody into postFindings
EOF
)"
```

---

### Task 3: Full package verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole `@happyfeeling/github` test suite**

Run: `pnpm --filter @happyfeeling/github test`
Expected: PASS for every file except the pre-existing, unrelated `src/config.test.ts` module-resolution failure (documented as out-of-scope in this repo already — not caused by this change).

- [ ] **Step 2: Push the branch**

```bash
git push
```
