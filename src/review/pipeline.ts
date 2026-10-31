import type { Config } from "../config";
import { parseUnifiedDiff } from "../diff/parse";
import { selectDiff } from "../diff/select";
import { buildSystemPrompt, buildUserPrompt } from "../llm/prompt";
import type { StructuredReviewer } from "../llm/review";
import type { DraftComment, LlmReview, Logger, PullRef } from "../types";
import { collectFingerprints, hasSummaryMarker, summaryMarker } from "./fingerprint";
import { formatFindingComment, formatSummary } from "./format";
import { selectFindings } from "./select";

export interface PipelineResult {
  action: "skip" | "post";
  reason: string;
  body?: string;
  comments: DraftComment[];
  reviewedFiles: number;
  findingsCount: number;
}

export async function reviewPullRequest(input: {
  config: Pick<
    Config,
    | "provider"
    | "model"
    | "maxFiles"
    | "include"
    | "exclude"
    | "severityThreshold"
    | "maxInputTokens"
    | "maxComments"
  >;
  pullRequest: PullRef;
  diffText: string;
  guidelines?: string;
  existingCommentBodies: string[];
  existingReviewBodies: string[];
  reviewer: StructuredReviewer;
  logger: Logger;
}): Promise<PipelineResult> {
  if (hasSummaryMarker(input.existingReviewBodies, input.pullRequest.headSha)) {
    return {
      action: "skip",
      reason: "This commit already has a review summary. Push a new commit to review again.",
      comments: [],
      reviewedFiles: 0,
      findingsCount: 0,
    };
  }

  const files = parseUnifiedDiff(input.diffText);
  const packed = selectDiff(files, {
    include: input.config.include,
    exclude: input.config.exclude,
    maxFiles: input.config.maxFiles,
    maxInputTokens: input.config.maxInputTokens,
  });

  input.logger.info(
    `Reviewing ${packed.reviewedPaths.length} file(s), about ${packed.estimatedTokens} tokens, ${packed.chunks.length} request(s).`,
  );
  for (const skipped of packed.skipped) {
    input.logger.debug(`Skipped ${skipped.path} (${skipped.reason})`);
  }

  const reviews: LlmReview[] = [];
  if (packed.chunks.length === 0) {
    input.logger.info("No reviewable diff content. Skipping the model.");
  } else {
    const system = buildSystemPrompt();
    for (const chunk of packed.chunks) {
      const user = buildUserPrompt({
        guidelines: input.guidelines,
        diffText: chunk.text,
        severityThreshold: input.config.severityThreshold,
        maxFindings: input.config.maxComments,
      });
      input.logger.debug(`Prompt bytes for ${chunk.paths.join(", ")}: ${user.length}`);
      reviews.push(await input.reviewer.review({ system, user }));
    }
  }

  const reviewedFiles = files.filter((file) => packed.reviewedPaths.includes(file.path));
  const selection = selectFindings({
    files: reviewedFiles,
    findings: reviews.flatMap((review) => review.findings),
    threshold: input.config.severityThreshold,
    maxComments: input.config.maxComments,
    existingFingerprints: collectFingerprints(input.existingCommentBodies),
  });

  for (const drop of selection.dropped) {
    input.logger.info(`Dropped finding on ${drop.file}: ${drop.reason}`);
  }

  const marker = summaryMarker(input.pullRequest.headSha);
  const modelSummary =
    reviews
      .map((review) => review.summary.trim())
      .filter(Boolean)
      .join("\n\n") || "No reviewable changes were left after filters and the token budget.";

  const comments = selection.accepted.map((finding) => ({
    path: finding.file,
    line: finding.line,
    side: finding.side,
    body: formatFindingComment(finding, finding.fingerprint),
  }));

  const body = formatSummary({
    modelSummary,
    reviewedPaths: packed.reviewedPaths,
    skipped: packed.skipped,
    posted: selection.accepted,
    provider: input.config.provider,
    model: input.config.model,
    threshold: input.config.severityThreshold,
    truncated: packed.chunks.some((chunk) => chunk.truncated),
    marker,
  });

  return {
    action: "post",
    reason: comments.length > 0 ? "Posting new inline comments." : "Posting a summary.",
    body,
    comments,
    reviewedFiles: packed.reviewedPaths.length,
    findingsCount: comments.length,
  };
}
