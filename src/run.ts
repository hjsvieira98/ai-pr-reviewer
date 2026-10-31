import type { Config } from "./config";
import type { GitHubClient } from "./github/client";
import type { StructuredReviewer } from "./llm/review";
import { reviewPullRequest } from "./review/pipeline";
import type { Logger, PullRef } from "./types";

export interface RunResult {
  action: "skip" | "post";
  findingsCount: number;
  reviewedFiles: number;
}

export async function runReview(input: {
  config: Config;
  pullRequest: PullRef;
  guidelines?: string;
  github: GitHubClient;
  reviewer: StructuredReviewer;
  logger: Logger;
}): Promise<RunResult> {
  const [diffText, commentBodies, reviewBodies] = await Promise.all([
    input.github.fetchPullRequestDiff(input.pullRequest),
    input.github.listReviewCommentBodies(input.pullRequest),
    input.github.listReviewBodies(input.pullRequest),
  ]);

  const result = await reviewPullRequest({
    config: input.config,
    pullRequest: input.pullRequest,
    diffText,
    guidelines: input.guidelines,
    existingCommentBodies: commentBodies,
    existingReviewBodies: reviewBodies,
    reviewer: input.reviewer,
    logger: input.logger,
  });

  if (result.action === "skip" || !result.body) {
    input.logger.info(result.reason);
    return {
      action: "skip",
      findingsCount: 0,
      reviewedFiles: result.reviewedFiles,
    };
  }

  await input.github.createReview(input.pullRequest, {
    body: result.body,
    comments: result.comments,
  });
  input.logger.info(
    `Posted 1 review with ${result.findingsCount} inline comment${result.findingsCount === 1 ? "" : "s"}.`,
  );
  return {
    action: "post",
    findingsCount: result.findingsCount,
    reviewedFiles: result.reviewedFiles,
  };
}
