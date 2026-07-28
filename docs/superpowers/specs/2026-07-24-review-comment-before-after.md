# Review comment: hiển thị before/after — Design Spec

> Trạng thái: **Chốt (2026-07-24)**

## Bối cảnh & vấn đề

Comment bot post lên PR hiện chỉ có `**[severity]** message` + 1 câu `suggestion` bằng lời (VD "Use === for comparison instead of ="), không cho thấy code cụ thể trước/sau khi sửa. Người đọc phải tự tưởng tượng ra fix, hoặc tự kéo lên nhìn diff để đối chiếu — mất thời gian, đặc biệt khi đọc qua email/Slack notification hoặc tab Files Changed (không phải lúc nào cũng thấy rõ context xung quanh).

## Phạm vi

Chỉ 2 file:

- `packages/github/src/review/llmReviewer.groq.ts` — đường Groq đang chạy thật (production path)
- `packages/github/src/review/commentPoster.ts` — build nội dung comment

**Không đụng:**

- `packages/ai-pipeline/src/finder.ts` (Epic 5, chưa wire vào pipeline thật — sẽ cần đồng bộ sau, nhưng là follow-up riêng)
- `packages/github/src/review/llmReviewer.ts` (reviewer Claude cũ, đang tắt/không dùng — chỉ thêm field optional để không vỡ type, không sửa logic)

Không cần migration DB — `Finding` Prisma model chỉ lưu `file/line/severity/message`, không lưu `suggestion`/code, nên thay đổi này chỉ ảnh hưởng nội dung comment hiển thị.

## Thiết kế

### 1. Groq trả thêm `fixedCode`

`FINDINGS_TOOL` schema thêm field bắt buộc `fixedCode: string`, song song `codeSnippet` đã có (AIC-36). Prompt dặn thêm: model phải trả `fixedCode` — bản đã sửa đúng lỗi mô tả trong `message`, giữ nguyên style/indent gốc, **không giới hạn số dòng** — bug cần sửa 1 dòng thì trả 1 dòng, cần sửa nhiều dòng thì trả nhiều dòng, miễn đúng là bản fix được bug.

`RawFinding` interface thêm `fixedCode: string`.

### 2. Giữ lại `codeSnippet` + `fixedCode` trong `Finding`

Hiện `resolveFindings()` chỉ dùng `codeSnippet` để tính `line` (qua `resolveLine`) rồi **bỏ nó đi**. Giờ giữ lại cả `codeSnippet` và `fixedCode`, đưa vào `Finding` trả về.

`Finding` type (`llmReviewer.ts`, dùng chung Groq/Claude) thêm 2 field **optional**:

```ts
codeSnippet?: string;
fixedCode?: string;
```

Optional vì chỉ path Groq điền — path Claude (đang tắt) không có 2 field này, không nên coi là bắt buộc ở type dùng chung.

Cơ chế drop-nếu-không-resolve-được của AIC-36 (`resolveLine` trả `null` → drop finding) **không đổi**.

### 3. `commentPoster.ts` — build comment body có before/after

**Case chính** — có đủ `codeSnippet` + `fixedCode`, và `fixedCode` khác `codeSnippet` (sau khi trim):

````
**[severity]** message

Before:
```ts
<codeSnippet>
````

```suggestion
<fixedCode>
```

<suggestion (câu giải thích bằng lời)>

```

- **Before** — code block thường (chỉ đọc), tự chứa ngữ cảnh, không cần kéo lên xem diff.
- **Khối `suggestion`** — cú pháp đặc biệt của GitHub, luôn dùng bất kể `fixedCode` bao nhiêu dòng (GitHub cho phép suggestion thay thế 1 dòng gốc bằng N dòng khác — xác nhận qua tài liệu GitHub, không cần API multi-line range `start_line`). Người xem PR bấm "Commit suggestion" là áp dụng luôn.
- **Suggestion text** — giữ nguyên câu giải thích như hiện tại.

**Case fallback** — thiếu `codeSnippet`/`fixedCode` (path Claude, hoặc dữ liệu cũ), **hoặc** `fixedCode.trim() === codeSnippet.trim()` (model không thực sự đổi gì — coi là output lỗi, không hiển thị 1 suggestion vô nghĩa):

```

**[severity]** message

suggestion

```
(y hệt format hiện tại, không có code block)

## Testing

- `llmReviewer.groq.test.ts`: thêm/sửa test xác nhận `fixedCode` được model trả về và giữ nguyên trong `Finding` cuối cùng (không bị `resolveFindings` bỏ mất như `codeSnippet` trước đây).
- `commentPoster.test.ts`: test mới —
  - có đủ `codeSnippet`+`fixedCode` khác nhau → body chứa đúng 3 phần (Before, suggestion, text)
  - thiếu `codeSnippet` hoặc `fixedCode` → fallback format cũ
  - `fixedCode` trùng `codeSnippet` → fallback format cũ (không hiện suggestion rỗng-ý-nghĩa)

## Ngoài phạm vi (ghi chú, không làm ở đây)

- Đồng bộ `finder.ts` (Epic 5) theo cùng interface `codeSnippet`/`fixedCode` — làm khi Epic 5 thật sự wire vào pipeline (Epic 6).
- GitHub multi-line range comment (`start_line`) — không cần, vì anchor luôn là 1 dòng duy nhất (`codeSnippet` theo thiết kế AIC-36 luôn khớp đúng 1 dòng diff).
```
