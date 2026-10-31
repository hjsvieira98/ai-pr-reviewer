import { describe, expect, it } from "vitest";
import { ReviewError } from "../../src/errors";
import { parseUnifiedDiff } from "../../src/diff/parse";
import { listCommentableLines } from "../../src/diff/select";
import { renderFile } from "../../src/diff/render";

const MODIFIED = `diff --git a/src/utils/pagination.ts b/src/utils/pagination.ts
index 1111111..2222222 100644
--- a/src/utils/pagination.ts
+++ b/src/utils/pagination.ts
@@ -1,3 +1,3 @@
 export function lastItem<T>(items: T[]): T | undefined {
-  return items[items.length - 1];
+  return items[items.length];
 }
`;

describe("parseUnifiedDiff", () => {
  it("returns no files for an empty diff", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("\n")).toEqual([]);
  });

  it("tracks added and deleted line numbers", () => {
    const [file] = parseUnifiedDiff(MODIFIED);
    expect(file?.path).toBe("src/utils/pagination.ts");
    expect(file?.status).toBe("modified");
    const lines = file ? listCommentableLines(file) : [];
    expect(lines).toEqual([
      { side: "LEFT", line: 2 },
      { side: "RIGHT", line: 2 },
    ]);
  });

  it("continues line numbers from the second hunk header", () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,3 +10,3 @@
 const first = 1;
-const removed = 2;
+const added = 2;
 const third = 3;
@@ -40,2 +40,3 @@
 const before = 40;
+const inserted = 41;
 const after = 42;
`;
    const [file] = parseUnifiedDiff(diff);
    const added = file?.hunks[1]?.lines.find((line) => line.type === "add");
    expect(added?.newLine).toBe(41);
    expect(added?.text).toBe("const inserted = 41;");
  });

  it("parses a new file, a rename, a delete, and a binary file", () => {
    const diff = `diff --git a/src/fresh.ts b/src/fresh.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/fresh.ts
@@ -0,0 +1,1 @@
+export const ready = true;
diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 90%
rename from src/old-name.ts
rename to src/new-name.ts
index 1111111..2222222 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,1 +1,1 @@
-export const name = "old";
+export const name = "new";
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-export const gone = true;
diff --git a/assets/logo.png b/assets/logo.png
new file mode 100644
index 0000000..5555555
Binary files /dev/null and b/assets/logo.png differ
`;
    const files = parseUnifiedDiff(diff);
    expect(files.map((file) => [file.path, file.status, file.binary])).toEqual([
      ["src/fresh.ts", "added", false],
      ["src/new-name.ts", "renamed", false],
      ["src/gone.ts", "deleted", false],
      ["assets/logo.png", "added", true],
    ]);
    expect(files[1]?.oldPath).toBe("src/old-name.ts");
    expect(files[3]?.hunks).toEqual([]);
  });

  it("parses quoted paths that contain spaces", () => {
    const diff = `diff --git "a/my file.ts" "b/my file.ts"
index 1111111..2222222 100644
--- "a/my file.ts"	
+++ "b/my file.ts"	
@@ -1,1 +1,1 @@
-export const value = 1;
+export const value = 2;
`;
    const [file] = parseUnifiedDiff(diff);
    expect(file?.path).toBe("my file.ts");
    expect(file?.hunks[0]?.lines).toHaveLength(2);
  });

  it("rejects a diff header it cannot split", () => {
    expect(() => parseUnifiedDiff("diff --git not-a-path\n")).toThrow(ReviewError);
  });

  it("renders explicit line numbers for the model", () => {
    const [file] = parseUnifiedDiff(MODIFIED);
    expect(file && renderFile(file)).toContain("+ 2 |   return items[items.length];");
    expect(file && renderFile(file)).toContain("- 2 |   return items[items.length - 1];");
  });
});
