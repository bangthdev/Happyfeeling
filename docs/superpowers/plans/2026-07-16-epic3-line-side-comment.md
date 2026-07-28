# E3-1: Line+Side Comment Poster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đổi `postReviewComment`/`postFindings` từ `position` (diff-relative) sang `line`+`side` (GitHub API field ổn định), và đổi `PostFindingsResult.posted` từ `number` sang `Finding[]` để Track B ghi đúng row vào DB.

**Architecture:** `postReviewComment` (client.ts) nhận `line: number` + `side: 'LEFT' | 'RIGHT'` thay vì `position: number`, gửi thẳng 2 field này lên GitHub REST API. `postFindings` (commentPoster.ts) bỏ tham số `diff`, không còn gọi `mapLineToDiffPosition`, luôn dùng `side: 'RIGHT'` (vì `Finding.line` hiện tại chỉ trỏ tới dòng còn tồn tại ở file mới). `diffPosition.ts` bị xoá vì không còn ai gọi. `pipeline.ts` là call site duy nhất của `postFindings` — phải cập nhật theo interface mới để không vỡ build.

**Tech Stack:** TypeScript, Vitest.

## Global Constraints

- Không sửa logic review hiện có (`buildContext`, `reviewDiff`, cách gọi Groq) — chỉ đổi field gửi comment (`position` → `line`+`side`) và shape trả về (`posted`).
- `side` luôn là `'RIGHT'` cho task này — `Finding.line` hiện tại chỉ bao giờ trỏ tới dòng còn tồn tại ở file mới, không có case `LEFT` cần xử lý ở bước này.
- `skipped: number` giữ nguyên trong `PostFindingsResult`, nhưng vì không còn bước map line→position để phát hiện "unmappable", giá trị này luôn là `0` ở task này — field được giữ lại cho task dedup sau (E4-1) tái dùng, không phải bug.
- Phạm vi file: `packages/github/src/github/client.ts`, `packages/github/src/review/commentPoster.ts`, `packages/github/src/github/client.test.ts`, `packages/github/src/review/commentPoster.test.ts`. Xoá `packages/github/src/github/diffPosition.ts` + `diffPosition.test.ts`.
- **Deviation cần thiết ngoài phạm vi gốc:** `packages/github/src/pipeline.ts` + `pipeline.test.ts` phải sửa theo, vì đây là call site duy nhất của `postFindings` — không sửa thì `tsc` không compile được (xem giải thích ở đầu Task 3).

---

## File Structure

- `packages/github/src/github/client.ts` — sửa `PostCommentParams` + `postReviewComment`: bỏ `position`, thêm `line` + `side`.
- `packages/github/src/github/client.test.ts` — cập nhật test cho interface mới.
- `packages/github/src/review/commentPoster.ts` — sửa `PostFindingsParams` (bỏ `diff`), `PostFindingsResult` (`posted: Finding[]`), bỏ import `mapLineToDiffPosition`.
- `packages/github/src/review/commentPoster.test.ts` — cập nhật test cho interface mới.
- `packages/github/src/github/diffPosition.ts` + `diffPosition.test.ts` — xoá, không còn ai gọi sau khi `commentPoster.ts` đổi.
- `packages/github/src/pipeline.ts` + `pipeline.test.ts` — cập nhật call site: bỏ `diff` khi gọi `postFindings`, đổi `findings_count: posted` → `findings_count: posted.length`.

---

### Task 1: `postReviewComment` dùng `line`+`side` thay vì `position`

**Files:**

- Modify: `packages/github/src/github/client.ts:23-53`
- Test: `packages/github/src/github/client.test.ts:38-84`

**Interfaces:**

- Produces: `PostCommentParams { token, owner, repo, prNumber, commitSha, filePath, line: number, side: 'LEFT' | 'RIGHT', body }`, `postReviewComment(params, fetchFn?): Promise<void>`.

- [ ] **Step 1: Sửa test `postReviewComment` sang `line`+`side` (test sẽ fail vì implementation chưa đổi)**

Thay toàn bộ block `describe('postReviewComment', ...)` trong `packages/github/src/github/client.test.ts` bằng:

```typescript
describe("postReviewComment", () => {
  it("posts a comment with line and side", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, text: () => Promise.resolve("") });

    await postReviewComment(
      {
        token: "tok",
        owner: "acme",
        repo: "widgets",
        prNumber: 42,
        commitSha: "abc123",
        filePath: "src/x.ts",
        line: 4,
        side: "RIGHT",
        body: "nice catch",
      },
      fetchFn as unknown as typeof fetch,
    );

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/widgets/pulls/42/comments",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          commit_id: "abc123",
          path: "src/x.ts",
          line: 4,
          side: "RIGHT",
          body: "nice catch",
        }),
      }),
    );
  });

  it("throws when the response is not ok", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve("rate limited"),
    });

    await expect(
      postReviewComment(
        {
          token: "tok",
          owner: "acme",
          repo: "widgets",
          prNumber: 42,
          commitSha: "abc123",
          filePath: "src/x.ts",
          line: 4,
          side: "RIGHT",
          body: "nice catch",
        },
        fetchFn as unknown as typeof fetch,
      ),
    ).rejects.toThrow("403");
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `pnpm --filter @happyfeeling/github test -- src/github/client.test.ts`
Expected: FAIL — TypeScript báo `position` thiếu hoặc `line`/`side` không khớp `PostCommentParams`, hoặc assertion `body` không khớp field `position` cũ.

- [ ] **Step 3: Sửa `client.ts` — đổi `PostCommentParams` + body gửi API**

Thay `packages/github/src/github/client.ts:23-53` bằng:

```typescript
export interface PostCommentParams {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
  commitSha: string;
  filePath: string;
  line: number;
  side: "LEFT" | "RIGHT";
  body: string;
}

export async function postReviewComment(
  params: PostCommentParams,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const {
    token,
    owner,
    repo,
    prNumber,
    commitSha,
    filePath,
    line,
    side,
    body,
  } = params;

  const res = await fetchFn(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        commit_id: commitSha,
        path: filePath,
        line,
        side,
        body,
      }),
    },
  );

  if (!res.ok) {
    throw new Error(
      `Failed to post review comment: ${res.status} ${await res.text()}`,
    );
  }
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `pnpm --filter @happyfeeling/github test -- src/github/client.test.ts`
Expected: PASS (cả `getPullRequestDiff` và `postReviewComment`)

- [ ] **Step 5: Commit**

```bash
git add packages/github/src/github/client.ts packages/github/src/github/client.test.ts
git commit -m "$(cat <<'EOF'
Use line+side instead of position in postReviewComment

Problem:

- position is diff-relative and recalculated on every diff change,
  so it breaks when a PR gets new commits between reviews.

Solution:

- Send line+side (stable GitHub review-comment fields) instead of
  position in the request body.
EOF
)"
```

---

### Task 2: `postFindings` bỏ tham số `diff`, trả về `Finding[]` đã post

**Files:**

- Modify: `packages/github/src/review/commentPoster.ts`
- Test: `packages/github/src/review/commentPoster.test.ts`
- Delete: `packages/github/src/github/diffPosition.ts`, `packages/github/src/github/diffPosition.test.ts`

**Interfaces:**

- Consumes: `postReviewComment(params: PostCommentParams, fetchFn?): Promise<void>` từ Task 1 (field `line`, `side`).
- Produces: `PostFindingsParams { token, owner, repo, prNumber, commitSha, findings: Finding[] }` (không còn `diff`), `PostFindingsResult { posted: Finding[]; skipped: number }`, `postFindings(params, postFn?): Promise<PostFindingsResult>`.

- [ ] **Step 1: Sửa test `postFindings` sang interface mới (test sẽ fail)**

Thay toàn bộ nội dung `packages/github/src/review/commentPoster.test.ts` bằng:

```typescript
import { describe, it, expect, vi } from "vitest";
import { postFindings } from "./commentPoster.js";
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

    expect(result).toEqual({ posted: findings, skipped: 0 });
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
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `pnpm --filter @happyfeeling/github test -- src/review/commentPoster.test.ts`
Expected: FAIL — TypeScript báo thiếu field `diff` trong `PostFindingsParams` cũ, hoặc assertion `result` không khớp shape cũ `{ posted: number, skipped: number }`.

- [ ] **Step 3: Sửa `commentPoster.ts` — bỏ `diff`, bỏ `mapLineToDiffPosition`, trả `Finding[]`**

Thay toàn bộ nội dung `packages/github/src/review/commentPoster.ts` bằng:

```typescript
import { postReviewComment } from "../github/client.js";
import type { Finding } from "./llmReviewer.js";

export interface PostFindingsParams {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
  commitSha: string;
  findings: Finding[];
}

export interface PostFindingsResult {
  posted: Finding[];
  skipped: number;
}

export async function postFindings(
  params: PostFindingsParams,
  postFn: typeof postReviewComment = postReviewComment,
): Promise<PostFindingsResult> {
  const { token, owner, repo, prNumber, commitSha, findings } = params;
  const posted: Finding[] = [];

  for (const finding of findings) {
    await postFn({
      token,
      owner,
      repo,
      prNumber,
      commitSha,
      filePath: finding.file,
      line: finding.line,
      side: "RIGHT",
      body: `**[${finding.severity}]** ${finding.message}\n\n${finding.suggestion}`,
    });
    posted.push(finding);
  }

  return { posted, skipped: 0 };
}
```

- [ ] **Step 4: Xoá `diffPosition.ts` và test của nó (không còn ai gọi)**

```bash
git rm packages/github/src/github/diffPosition.ts packages/github/src/github/diffPosition.test.ts
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `pnpm --filter @happyfeeling/github test -- src/review/commentPoster.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/github/src/review/commentPoster.ts packages/github/src/review/commentPoster.test.ts
git commit -m "$(cat <<'EOF'
Drop diff param from postFindings, return posted findings

Problem:

- postFindings needed the raw diff only to map a line number to a
  diff-relative position, a step no longer needed now that
  postReviewComment takes line+side directly.
- Callers only got back a posted count, not which findings were
  posted, so the worker (Track B) had no way to know which rows to
  write to the DB.

Solution:

- Remove the diff param and the mapLineToDiffPosition call; every
  finding is posted with side: RIGHT (Finding.line only ever points
  at lines that still exist in the new file).
- Return posted as Finding[] instead of a count. skipped stays 0 in
  this task; the field is kept for the upcoming dedup task (E4-1) to
  reuse when it starts skipping already-posted findings.
EOF
)"
```

---

### Task 3: Cập nhật `pipeline.ts` theo interface mới của `postFindings`

**Files:**

- Modify: `packages/github/src/pipeline.ts:24-32,39-45`
- Test: `packages/github/src/pipeline.test.ts`

**Interfaces:**

- Consumes: `postFindings(params: PostFindingsParams, postFn?): Promise<PostFindingsResult>` từ Task 2 — `PostFindingsParams` không còn `diff`, `PostFindingsResult.posted` là `Finding[]`.

**Vì sao task này bắt buộc dù ngoài phạm vi gốc:** `pipeline.ts` là nơi duy nhất gọi `postFindings` trong codebase (đã grep xác nhận). Nó đang truyền `diff: context.diff` (field không còn tồn tại trong `PostFindingsParams` mới → lỗi excess-property khi build) và dùng `posted` thẳng làm `findings_count: number` (giờ `posted` là mảng → lỗi kiểu). Không sửa thì `pnpm --filter @happyfeeling/github build` sẽ đỏ ngay cả khi Task 1+2 đúng.

- [ ] **Step 1: Sửa mock trong `pipeline.test.ts` sang shape mới (test sẽ fail)**

Trong `packages/github/src/pipeline.test.ts`, thay dòng:

```typescript
vi.mocked(postFindings).mockResolvedValue({ posted: 1, skipped: 0 });
```

bằng:

```typescript
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
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `pnpm --filter @happyfeeling/github test -- src/pipeline.test.ts`
Expected: FAIL — TypeScript báo gán `Finding[]` cho tham số kiểu `number` tại `findings_count: posted` trong `pipeline.ts`.

- [ ] **Step 3: Sửa `pipeline.ts` — bỏ `diff` khi gọi `postFindings`, dùng `posted.length`**

Trong `packages/github/src/pipeline.ts`, thay khối (dòng 24-32):

```typescript
const { posted } = await postFindings({
  token,
  owner: event.owner,
  repo: event.repo,
  prNumber: event.prNumber,
  commitSha: event.headSha,
  diff: context.diff,
  findings,
});
```

bằng:

```typescript
const { posted } = await postFindings({
  token,
  owner: event.owner,
  repo: event.repo,
  prNumber: event.prNumber,
  commitSha: event.headSha,
  findings,
});
```

và thay dòng (trong khối `logMetrics`, khoảng dòng 41):

```typescript
    findings_count: posted,
```

bằng:

```typescript
    findings_count: posted.length,
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `pnpm --filter @happyfeeling/github test -- src/pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/github/src/pipeline.ts packages/github/src/pipeline.test.ts
git commit -m "$(cat <<'EOF'
Update pipeline.ts for postFindings' new line+side interface

Problem:

- postFindings no longer accepts a diff param and now returns
  posted as Finding[] instead of a count, so pipeline.ts (its only
  caller) no longer type-checks.

Solution:

- Drop the diff field from the postFindings call and use
  posted.length for findings_count in logMetrics.
EOF
)"
```

---

### Task 4: Nghiệm thu toàn bộ package

**Files:** Không tạo/sửa file — chỉ verify.

- [ ] **Step 1: Chạy toàn bộ test suite của package**

Run: `pnpm --filter @happyfeeling/github test`
Expected: Tất cả test file pass, không còn file `diffPosition.test.ts` trong output.

- [ ] **Step 2: Build để chắc chắn không còn lỗi kiểu**

Run: `pnpm --filter @happyfeeling/github build`
Expected: exit 0.

- [ ] **Step 3: Grep xác nhận không còn field `position` hay import `diffPosition` sót lại**

Run: `grep -rn "position\|diffPosition" packages/github/src`
Expected: Không có kết quả nào (nếu `getPullRequestDiff` hay chỗ khác vô tình dùng biến tên `position` cho việc khác, đọc kỹ để phân biệt trước khi kết luận có lỗi).
