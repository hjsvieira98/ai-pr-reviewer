import type { Finding, Side } from "../types";
import type { SkippedFile } from "../diff/select";
import { findingMarker } from "./fingerprint";

export function formatFindingComment(
  finding: Finding & { side: Side },
  fingerprint: string,
): string {
  const suggestion = finding.suggestion
    .replace(/<!--\s*ai-pr-reviewer:[\s\S]*?(-->|$)/g, "")
    .trim();
  return [
    `**${finding.severity} · ${finding.category}**`,
    "",
    suggestion,
    "",
    findingMarker(fingerprint),
  ].join("\n");
}

export function formatSummary(input: {
  modelSummary: string;
  reviewedPaths: string[];
  skipped: SkippedFile[];
  posted: Array<{ severity: string }>;
  provider: string;
  model: string;
  threshold: string;
  truncated: boolean;
  marker: string;
}): string {
  const counts = countSeverities(input.posted);
  const skippedLine = formatSkipped(input.skipped);
  const reviewed =
    input.reviewedPaths.length === 0
      ? "No files were sent to the model."
      : `Reviewed ${input.reviewedPaths.length} file${input.reviewedPaths.length === 1 ? "" : "s"}: ${input.reviewedPaths.join(", ")}.`;

  return [
    "## AI review",
    "",
    reviewed,
    skippedLine,
    "",
    "| Severity | Count |",
    "| --- | --- |",
    `| critical | ${counts.critical} |`,
    `| high | ${counts.high} |`,
    `| medium | ${counts.medium} |`,
    `| low | ${counts.low} |`,
    "",
    input.posted.length === 0
      ? "No new inline comments at or above the severity threshold."
      : input.modelSummary.trim(),
    ...(input.truncated ? ["", "Some files were truncated to fit the token budget."] : []),
    "",
    `Provider: ${input.provider} · model: ${input.model} · threshold: ${input.threshold}`,
    "",
    input.marker,
  ].join("\n");
}

function countSeverities(findings: Array<{ severity: string }>): Record<string, number> {
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  }
  return counts;
}

function formatSkipped(skipped: SkippedFile[]): string {
  if (skipped.length === 0) return "Skipped 0 files.";
  const grouped = new Map<string, number>();
  for (const file of skipped) {
    grouped.set(file.reason, (grouped.get(file.reason) ?? 0) + 1);
  }
  const reasons = [...grouped.entries()].map(([reason, count]) => `${count} ${reason}`).join(", ");
  return `Skipped ${skipped.length} file${skipped.length === 1 ? "" : "s"} (${reasons}).`;
}
