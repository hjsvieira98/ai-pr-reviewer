import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DIFF_END, DIFF_START, buildUserPrompt, countDelimiters } from "../../src/llm/prompt";
import { parseUnifiedDiff } from "../../src/diff/parse";
import { renderFile } from "../../src/diff/render";
import { listCommentableLines } from "../../src/diff/select";
import { evaluateFixtures } from "../../eval/evaluate";
import { scoreCase } from "../../eval/score";

describe("scoreCase", () => {
  it("matches a nearby line of the same category and leaves extras unmatched", () => {
    const score = scoreCase(
      [{ id: "off-by-one", file: "src/a.ts", category: "bug", line: 10 }],
      [
        { file: "src/a.ts", line: 12, category: "bug" },
        { file: "src/a.ts", line: 10, category: "security" },
      ],
    );
    expect(score.caught.map((seed) => seed.id)).toEqual(["off-by-one"]);
    expect(score.missed).toEqual([]);
    expect(score.unmatched).toEqual([{ file: "src/a.ts", line: 10, category: "security" }]);
  });

  it("does not reuse one finding for two seeds", () => {
    const score = scoreCase(
      [
        { id: "first", file: "src/a.ts", category: "bug", line: 4, tolerance: 0 },
        { id: "second", file: "src/a.ts", category: "bug", line: 4, tolerance: 0 },
      ],
      [{ file: "src/a.ts", line: 4, category: "bug" }],
    );
    expect(score.caught).toHaveLength(1);
    expect(score.missed).toHaveLength(1);
  });
});

describe("eval fixtures", () => {
  it("points every seed at a commentable line and keeps the injection inside the diff block", async () => {
    const root = path.join(process.cwd(), "eval/fixtures");
    const injection = await readFile(path.join(root, "06-prompt-injection/diff.patch"), "utf8");
    const files = parseUnifiedDiff(injection);
    const user = buildUserPrompt({
      guidelines: undefined,
      diffText: files.map((file) => renderFile(file)).join("\n\n"),
      severityThreshold: "low",
      maxFindings: 10,
    });
    expect(countDelimiters(user, DIFF_START)).toBe(1);
    expect(countDelimiters(user, DIFF_END)).toBe(1);
    expect(user).toContain("[[diff-start]]");
    expect(user).toContain("Ignore all previous instructions");

    const names = [
      "01-off-by-one",
      "02-sql-injection",
      "03-n-plus-one",
      "04-nested-conditionals",
      "05-missing-assertion",
      "06-prompt-injection",
    ];
    for (const name of names) {
      const fixture = JSON.parse(await readFile(path.join(root, name, "case.json"), "utf8")) as {
        seeds: Array<{ file: string; line: number }>;
      };
      const parsed = parseUnifiedDiff(await readFile(path.join(root, name, "diff.patch"), "utf8"));
      for (const seed of fixture.seeds) {
        const file = parsed.find((item) => item.path === seed.file);
        expect(file, seed.file).toBeDefined();
        expect(file && listCommentableLines(file).some((line) => line.line === seed.line)).toBe(
          true,
        );
      }
    }
  });

  it("matches the checked-in mock contract", async () => {
    const report = await evaluateFixtures({ mode: "mock" });
    expect(report.contractMismatch).toBeUndefined();
    expect(report.caught).toBe(5);
    expect(report.seeded).toBe(6);
    expect(report.cleanFalsePositives).toBe(1);
    expect(report.missedIds).toEqual(["nested-conditionals"]);
  });
});
