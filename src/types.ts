export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = ["bug", "security", "performance", "readability", "tests"] as const;
export type Category = (typeof CATEGORIES)[number];

export type Side = "LEFT" | "RIGHT";

export const SEVERITY_RANK: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function meetsThreshold(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];
}

export interface Finding {
  file: string;
  line: number;
  side?: Side;
  severity: Severity;
  category: Category;
  suggestion: string;
}

export interface LlmReview {
  summary: string;
  findings: Finding[];
}

export interface PullRef {
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
}

export interface DraftComment {
  path: string;
  line: number;
  side: Side;
  body: string;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
