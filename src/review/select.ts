import { listCommentableLines } from "../diff/select";
import type { DiffFile } from "../diff/parse";
import { meetsThreshold, type Category, type Finding, type Severity, type Side } from "../types";
import { findingFingerprint } from "./fingerprint";

export interface ResolvedFinding {
  file: string;
  line: number;
  side: Side;
  severity: Severity;
  category: Category;
  suggestion: string;
  fingerprint: string;
}

export interface SelectionResult {
  accepted: ResolvedFinding[];
  dropped: Array<{ file: string; reason: string }>;
}

export function selectFindings(input: {
  files: DiffFile[];
  findings: Finding[];
  threshold: Severity;
  maxComments: number;
  existingFingerprints: Set<string>;
}): SelectionResult {
  const accepted: ResolvedFinding[] = [];
  const dropped: Array<{ file: string; reason: string }> = [];
  const seen = new Set<string>(input.existingFingerprints);

  const ranked = [...input.findings].sort((left, right) => {
    return severityRank(right.severity) - severityRank(left.severity);
  });

  for (const finding of ranked) {
    if (!meetsThreshold(finding.severity, input.threshold)) {
      dropped.push({ file: finding.file, reason: "below-threshold" });
      continue;
    }

    const file = matchFile(input.files, finding.file);
    if (!file) {
      dropped.push({ file: finding.file, reason: "unknown-file" });
      continue;
    }

    const side = resolveSide(file, finding);
    if (!side) {
      dropped.push({ file: finding.file, reason: "line-not-in-diff" });
      continue;
    }

    const fingerprint = findingFingerprint({
      path: file.path,
      side,
      line: finding.line,
      category: finding.category,
    });
    if (seen.has(fingerprint)) {
      dropped.push({ file: file.path, reason: "duplicate" });
      continue;
    }
    seen.add(fingerprint);

    if (accepted.length >= input.maxComments) {
      dropped.push({ file: file.path, reason: "comment-limit" });
      continue;
    }

    accepted.push({
      file: file.path,
      line: finding.line,
      side,
      severity: finding.severity,
      category: finding.category,
      suggestion: finding.suggestion,
      fingerprint,
    });
  }

  return { accepted, dropped };
}

function severityRank(severity: Severity): number {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

export function matchFile(files: DiffFile[], reported: string): DiffFile | undefined {
  const normalized = reported.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const exact = files.find((file) => file.path === normalized || file.oldPath === normalized);
  if (exact) return exact;

  const stripped = normalized.replace(/^[ab]\//, "");
  if (stripped === normalized) return undefined;
  return files.find((file) => file.path === stripped || file.oldPath === stripped);
}

function resolveSide(file: DiffFile, finding: Finding): Side | undefined {
  const targets = listCommentableLines(file);
  if (finding.side) {
    return targets.some((target) => target.side === finding.side && target.line === finding.line)
      ? finding.side
      : undefined;
  }
  if (targets.some((target) => target.side === "RIGHT" && target.line === finding.line)) {
    return "RIGHT";
  }
  if (targets.some((target) => target.side === "LEFT" && target.line === finding.line)) {
    return "LEFT";
  }
  return undefined;
}
