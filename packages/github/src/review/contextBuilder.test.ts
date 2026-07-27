import { describe, it, expect } from 'vitest';
import { buildContext } from './contextBuilder.js';

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

describe('buildContext', () => {
  it('filters out vendor files and keeps normal files', () => {
    const context = buildContext(DIFF_WITH_VENDOR_FILE);
    expect(context.files).toEqual(['src/foo.ts']);
    expect(context.diff).toContain('src/foo.ts');
    expect(context.diff).not.toContain('vendor/lib.go');
  });

  it('filters .pb.go and node_modules paths', () => {
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

  it('filters lockfiles (package-lock.json, pnpm-lock.yaml, yarn.lock)', () => {
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
    expect(context.files).toEqual(['src/foo.ts']);
  });
});
