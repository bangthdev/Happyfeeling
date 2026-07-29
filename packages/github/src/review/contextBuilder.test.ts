import { describe, it, expect } from "vitest";
import { buildContext, filePathOf } from "./contextBuilder.js";

const DIFF_WITH_VENDOR_FILE = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,1 @@
-old
+new
diff --git a/vendor/lib.go b/vendor/lib.go
index 111..222 100644
--- a/vendor/lib.go
+++ b/vendor/lib.go
@@ -1,1 +1,1 @@
-old
+new
`;

describe("buildContext", () => {
  it("filters out vendor files and keeps normal files", () => {
    const context = buildContext(DIFF_WITH_VENDOR_FILE);
    expect(context.files).toEqual(["src/foo.ts"]);
    expect(context.diff).toContain("src/foo.ts");
    expect(context.diff).not.toContain("vendor/lib.go");
  });

  it("filters .pb.go and node_modules paths", () => {
    const diff = `diff --git a/api.pb.go b/api.pb.go
--- a/api.pb.go
+++ b/api.pb.go
@@ -1,1 +1,1 @@
-old
+new
diff --git a/node_modules/pkg/index.js b/node_modules/pkg/index.js
--- a/node_modules/pkg/index.js
+++ b/node_modules/pkg/index.js
@@ -1,1 +1,1 @@
-old
+new
`;
    const context = buildContext(diff);
    expect(context.files).toEqual([]);
  });

  it("filters lockfiles (package-lock.json, pnpm-lock.yaml, yarn.lock)", () => {
    const diff = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,1 @@
-old
+new
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,1 +1,1 @@
-old
+new
diff --git a/backend/pnpm-lock.yaml b/backend/pnpm-lock.yaml
--- a/backend/pnpm-lock.yaml
+++ b/backend/pnpm-lock.yaml
@@ -1,1 +1,1 @@
-old
+new
diff --git a/yarn.lock b/yarn.lock
--- a/yarn.lock
+++ b/yarn.lock
@@ -1,1 +1,1 @@
-old
+new
`;
    const context = buildContext(diff);
    expect(context.files).toEqual(["src/foo.ts"]);
  });

  it("keeps a file whose name has non-ASCII characters, which git wraps in quotes and octal-escapes", () => {
    const diff = `diff --git "a/f\\303\\251o.ts" "b/f\\303\\251o.ts"
--- "a/f\\303\\251o.ts"
+++ "b/f\\303\\251o.ts"
@@ -1,1 +1,1 @@
-old
+new
`;
    const context = buildContext(diff);
    expect(context.files).toEqual(["féo.ts"]);
    expect(context.diff).toContain('diff --git "a/f\\303\\251o.ts"');
  });
});

describe("filePathOf", () => {
  it("parses a plain, unquoted diff header", () => {
    const block = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
`;
    expect(filePathOf(block)).toBe("src/foo.ts");
  });

  it("decodes a quoted, octal-escaped diff header (non-ASCII filename)", () => {
    const block = `diff --git "a/f\\303\\251o.ts" "b/f\\303\\251o.ts"
--- "a/f\\303\\251o.ts"
+++ "b/f\\303\\251o.ts"
`;
    expect(filePathOf(block)).toBe("féo.ts");
  });

  it("parses a rename where only the new path needs quoting", () => {
    const block = `diff --git a/plain.ts "b/f\\303\\251o.ts"
similarity index 100%
rename from plain.ts
rename to "f\\303\\251o.ts"
`;
    expect(filePathOf(block)).toBe("féo.ts");
  });

  it("parses a rename where only the old path needs quoting", () => {
    const block = `diff --git "a/f\\303\\251o.ts" b/plain.ts
similarity index 100%
rename from "f\\303\\251o.ts"
rename to plain.ts
`;
    expect(filePathOf(block)).toBe("plain.ts");
  });

  it("decodes git's mnemonic control-character escapes, not just octal ones", () => {
    const block = `diff --git "a/f\\tt.ts" "b/f\\tt.ts"
--- "a/f\\tt.ts"
+++ "b/f\\tt.ts"
`;
    expect(filePathOf(block)).toBe("f\tt.ts");
  });

  it("returns empty string when a quoted path decodes to invalid UTF-8", () => {
    const block = `diff --git "a/\\377.ts" "b/\\377.ts"
--- "a/\\377.ts"
+++ "b/\\377.ts"
`;
    expect(filePathOf(block)).toBe("");
  });

  it("returns empty string when the header doesn't match either format", () => {
    expect(filePathOf("not a diff header\n")).toBe("");
  });
});
