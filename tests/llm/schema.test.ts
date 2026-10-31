import { describe, expect, it } from "vitest";
import { extractJsonObject, parseModelPayload } from "../../src/llm/schema";
import { createStructuredReviewer, type StructuredReviewer } from "../../src/llm/review";
import type { LlmClient } from "../../src/llm/providers";

describe("parseModelPayload", () => {
  it("parses fenced JSON and coerces numeric strings", () => {
    const text = [
      "Here is the review:",
      "```json",
      JSON.stringify({
        summary: "One bug.",
        findings: [
          {
            file: "src/a.ts",
            line: "12",
            side: "right",
            severity: "High",
            category: "Bug",
            suggestion: "Check the index.",
          },
        ],
      }),
      "```",
    ].join("\n");

    const parsed = parseModelPayload(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.review.findings[0]).toMatchObject({
      line: 12,
      side: "RIGHT",
      severity: "high",
      category: "bug",
    });
  });

  it("keeps valid findings when one item does not match the schema", () => {
    const parsed = parseModelPayload({
      summary: "Mixed.",
      findings: [
        {
          file: "src/a.ts",
          line: 1,
          severity: "low",
          category: "tests",
          suggestion: "Assert the result.",
        },
        { file: "src/a.ts", line: 0, severity: "nope", category: "bug", suggestion: "" },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.review.findings).toHaveLength(1);
    expect(parsed.droppedFindings).toBe(1);
  });

  it("rejects prose that has no JSON object", () => {
    expect(parseModelPayload("no issues found").ok).toBe(false);
    expect(() => extractJsonObject("still no object")).toThrow(/JSON object/);
  });
});

describe("createStructuredReviewer", () => {
  it("retries once when the first response is not valid JSON", async () => {
    const calls: string[] = [];
    const client: LlmClient = {
      provider: "openai",
      model: "test",
      async generate(input) {
        calls.push(input.user);
        if (calls.length === 1) return "not json";
        return { summary: "Fixed.", findings: [] };
      },
    };
    const reviewer: StructuredReviewer = createStructuredReviewer(client);
    const review = await reviewer.review({ system: "system", user: "diff" });
    expect(review.summary).toBe("Fixed.");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("previous response was invalid");
  });

  it("fails after the second invalid response", async () => {
    const client: LlmClient = {
      provider: "anthropic",
      model: "test",
      async generate() {
        return "still not json";
      },
    };
    await expect(
      createStructuredReviewer(client).review({ system: "system", user: "diff" }),
    ).rejects.toThrow(/valid review/);
  });
});
