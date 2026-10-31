import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../../src/diff/parse";
import { estimateTokens, truncateToTokenBudget } from "../../src/diff/render";
import { selectDiff } from "../../src/diff/select";

function diffFor(path: string, body: string): string {
  return `diff --git a/${path} b/${path}
index 1111111..2222222 100644
--- a/${path}
+++ b/${path}
@@ -1,1 +1,1 @@
-${body}
+${body}!
`;
}

describe("selectDiff", () => {
  const diff = [
    diffFor("src/keep.ts", "export const keep = 1;"),
    diffFor("package-lock.json", "lock"),
    diffFor("dist/index.js", "bundled"),
    `diff --git a/assets/logo.png b/assets/logo.png
new file mode 100644
index 0000000..5555555
Binary files /dev/null and b/assets/logo.png differ
`,
    diffFor("src/also.ts", "export const also = 2;"),
    diffFor("src/extra.ts", "export const extra = 3;"),
  ].join("");

  it("applies include and exclude globs and drops binary files", () => {
    const selected = selectDiff(parseUnifiedDiff(diff), {
      include: ["**/*.ts"],
      exclude: ["**/dist/**"],
      maxFiles: 10,
      maxInputTokens: 12_000,
    });
    expect(selected.reviewedPaths).toEqual(["src/keep.ts", "src/also.ts", "src/extra.ts"]);
    expect(selected.skipped.map((file) => file.reason).sort()).toEqual([
      "binary",
      "excluded",
      "excluded",
    ]);
  });

  it("stops at max files before the token budget", () => {
    const selected = selectDiff(parseUnifiedDiff(diff), {
      include: ["**/*"],
      exclude: ["**/*.json", "**/dist/**", "**/*.png"],
      maxFiles: 1,
      maxInputTokens: 12_000,
    });
    expect(selected.reviewedPaths).toEqual(["src/keep.ts"]);
    expect(selected.skipped.some((file) => file.reason === "file-limit")).toBe(true);
  });

  it("packs files into token chunks and skips the rest at the chunk cap", () => {
    const selected = selectDiff(parseUnifiedDiff(diff), {
      include: ["src/*.ts"],
      exclude: [],
      maxFiles: 10,
      maxInputTokens: 40,
      maxChunks: 1,
    });
    expect(selected.chunks).toHaveLength(1);
    expect(selected.reviewedPaths).toEqual(["src/keep.ts"]);
    expect(
      selected.skipped.some((file) => file.path === "src/also.ts" && file.reason === "budget"),
    ).toBe(true);
    expect(selected.chunks[0]?.truncated).toBe(false);
  });

  it("truncates a single file that is larger than the budget", () => {
    const huge = `diff --git a/src/huge.ts b/src/huge.ts
new file mode 100644
index 0000000..2222222
--- /dev/null
+++ b/src/huge.ts
@@ -0,0 +1,1 @@
+${"const value = 1;\n".repeat(400).replace(/\n/g, "\n+")}
`;
    const files = parseUnifiedDiff(huge);
    const renderedLength = files[0] ? estimateTokens("x".repeat(5000)) : 0;
    expect(renderedLength).toBeGreaterThan(0);
    const selected = selectDiff(files, {
      include: ["**/*"],
      exclude: [],
      maxFiles: 5,
      maxInputTokens: 100,
    });
    expect(selected.chunks[0]?.truncated).toBe(true);
    expect(selected.chunks[0]?.text).toContain("[diff truncated to fit the token budget]");
    expect(estimateTokens(selected.chunks[0]?.text ?? "")).toBeLessThanOrEqual(100);
  });
});

describe("estimateTokens", () => {
  it("uses a four-character heuristic", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    const truncated = truncateToTokenBudget("a".repeat(1000), 10);
    expect(estimateTokens(truncated)).toBeLessThanOrEqual(10);
  });
});
