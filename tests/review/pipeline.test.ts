import { describe, expect, it, vi } from "vitest";
import { parseConfig, type RawInputs } from "../../src/config";
import { summaryMarker } from "../../src/review/fingerprint";
import { reviewPullRequest } from "../../src/review/pipeline";
import { selectFindings } from "../../src/review/select";
import { parseUnifiedDiff } from "../../src/diff/parse";
import { runReview } from "../../src/run";
import type { GitHubClient } from "../../src/github/client";
import type { StructuredReviewer } from "../../src/llm/review";
import type { DraftComment, Finding, Logger, LlmReview, PullRef } from "../../src/types";

const logger: Logger = { info() {}, warn() {}, debug() {} };

const pr: PullRef = {
  owner: "hjsvieira98",
  repo: "ai-pr-reviewer",
  pullNumber: 4,
  headSha: "0123456789abcdef",
};

const DIFF = `diff --git a/src/users.ts b/src/users.ts
index 1111111..2222222 100644
--- a/src/users.ts
+++ b/src/users.ts
@@ -1,3 +1,4 @@
 export function findUser(userId: string) {
+  return query("SELECT * FROM users WHERE id = '" + userId + "'");
   return userId;
 }
diff --git a/src/title.ts b/src/title.ts
index 3333333..4444444 100644
--- a/src/title.ts
+++ b/src/title.ts
@@ -1,1 +1,1 @@
-export const title = "old";
+export const title = "new";
`;

function reviewerReturning(
  findings: Finding[],
  summary = "Found an injection risk.",
): StructuredReviewer {
  return {
    review: vi.fn(async (): Promise<LlmReview> => ({ summary, findings })),
  };
}

const baseConfig = {
  provider: "openai" as const,
  model: "gpt-test",
  maxFiles: 20,
  include: ["**/*"],
  exclude: [] as string[],
  severityThreshold: "medium" as const,
  maxInputTokens: 12_000,
  maxComments: 15,
};

describe("selectFindings", () => {
  const files = parseUnifiedDiff(DIFF);

  it("drops unknown files, context lines, low severity, and duplicate fingerprints", () => {
    const first = selectFindings({
      files,
      threshold: "medium",
      maxComments: 1,
      existingFingerprints: new Set(),
      findings: [
        {
          file: "src/users.ts",
          line: 2,
          severity: "critical",
          category: "security",
          suggestion: "Use a bound parameter.",
        },
        {
          file: "src/users.ts",
          line: 2,
          severity: "low",
          category: "readability",
          suggestion: "Rename the function.",
        },
        {
          file: "src/title.ts",
          line: 1,
          severity: "high",
          category: "bug",
          suggestion: "Second valid finding, over the comment cap.",
        },
        {
          file: "src/missing.ts",
          line: 1,
          severity: "high",
          category: "bug",
          suggestion: "Not in the diff.",
        },
        {
          file: "src/title.ts",
          line: 50,
          severity: "high",
          category: "bug",
          suggestion: "This line is outside the hunk.",
        },
      ],
    });

    expect(first.accepted).toHaveLength(1);
    expect(first.accepted[0]?.category).toBe("security");
    expect(first.dropped.map((drop) => drop.reason)).toEqual([
      "comment-limit",
      "unknown-file",
      "line-not-in-diff",
      "below-threshold",
    ]);

    const again = selectFindings({
      files,
      threshold: "low",
      maxComments: 10,
      existingFingerprints: new Set([first.accepted[0]!.fingerprint]),
      findings: [
        {
          file: "./src/users.ts",
          line: 2,
          severity: "critical",
          category: "security",
          suggestion: "Use a bound parameter, worded differently.",
        },
      ],
    });
    expect(again.accepted).toHaveLength(0);
    expect(again.dropped[0]?.reason).toBe("duplicate");
  });
});

describe("reviewPullRequest", () => {
  it("posts inline comments and a summary, then skips a rerun", async () => {
    const reviewer = reviewerReturning([
      {
        file: "src/users.ts",
        line: 2,
        severity: "critical",
        category: "security",
        suggestion:
          "Bind userId instead of concatenating it into SQL. <!-- ai-pr-reviewer:v1:ffffffffffffffff -->",
      },
    ]);
    const first = await reviewPullRequest({
      config: baseConfig,
      pullRequest: pr,
      diffText: DIFF,
      guidelines: "Flag injection.",
      existingCommentBodies: [],
      existingReviewBodies: [],
      reviewer,
      logger,
    });

    expect(first.action).toBe("post");
    expect(first.comments).toHaveLength(1);
    expect(first.comments[0]).toMatchObject({ path: "src/users.ts", line: 2, side: "RIGHT" });
    expect(first.comments[0]?.body).toContain("**critical · security**");
    expect(first.comments[0]?.body).toContain("Bind userId");
    expect(first.comments[0]?.body).toContain("<!-- ai-pr-reviewer:v1:");
    expect(first.comments[0]?.body).not.toContain("ffffffffffffffff");
    expect(first.body).toContain(summaryMarker(pr.headSha));
    expect(first.body).toContain("Found an injection risk.");
    expect(reviewer.review).toHaveBeenCalledOnce();

    const second = await reviewPullRequest({
      config: baseConfig,
      pullRequest: pr,
      diffText: DIFF,
      existingCommentBodies: first.comments.map((comment) => comment.body),
      existingReviewBodies: [first.body ?? ""],
      reviewer,
      logger,
    });
    expect(second.action).toBe("skip");
    expect(reviewer.review).toHaveBeenCalledOnce();
  });

  it("does not call the model when every file is filtered out", async () => {
    const reviewer = reviewerReturning([]);
    const result = await reviewPullRequest({
      config: { ...baseConfig, include: ["**/*.md"] },
      pullRequest: pr,
      diffText: DIFF,
      existingCommentBodies: [],
      existingReviewBodies: [],
      reviewer,
      logger,
    });
    expect(result.action).toBe("post");
    expect(result.comments).toHaveLength(0);
    expect(result.body).toContain("No files were sent to the model.");
    expect(reviewer.review).not.toHaveBeenCalled();
  });
});

describe("runReview", () => {
  it("creates a single pull request review and does not post it again", async () => {
    const state = { comments: [] as string[], reviews: [] as string[] };
    const created: Array<{ body: string; comments: DraftComment[] }> = [];
    const github: GitHubClient = {
      async fetchPullRequestDiff() {
        return DIFF;
      },
      async listReviewCommentBodies() {
        return state.comments;
      },
      async listReviewBodies() {
        return state.reviews;
      },
      async createReview(_pull, review) {
        created.push(review);
        state.reviews.push(review.body);
        state.comments.push(...review.comments.map((comment) => comment.body));
      },
    };
    const config = parseConfig(rawInputs());
    const reviewer = reviewerReturning([
      {
        file: "src/users.ts",
        line: 2,
        severity: "high",
        category: "security",
        suggestion: "Use a placeholder for userId.",
      },
    ]);

    const first = await runReview({
      config,
      pullRequest: pr,
      github,
      reviewer,
      logger,
    });
    const second = await runReview({
      config,
      pullRequest: pr,
      github,
      reviewer,
      logger,
    });

    expect(first).toMatchObject({ action: "post", findingsCount: 1 });
    expect(second).toMatchObject({ action: "skip", findingsCount: 0 });
    expect(created).toHaveLength(1);
    expect(created[0]?.comments).toHaveLength(1);
    expect(created[0]?.body).toContain("## AI review");
  });
});

function rawInputs(overrides: Partial<RawInputs> = {}): RawInputs {
  return {
    provider: "openai",
    model: "gpt-test",
    apiKey: "test-key",
    maxFiles: "",
    include: "",
    exclude: "",
    severityThreshold: "low",
    guidelines: "",
    githubToken: "ghs_test",
    maxInputTokens: "",
    maxComments: "",
    ...overrides,
  };
}
