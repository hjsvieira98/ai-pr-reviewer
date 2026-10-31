import { createHash } from "node:crypto";
import type { Category, Side } from "../types";

const FINDING_MARKER = /<!-- ai-pr-reviewer:v1:([a-f0-9]{16}) -->/g;

export function findingFingerprint(input: {
  path: string;
  side: Side;
  line: number;
  category: Category;
}): string {
  const payload = [input.path, input.side, String(input.line), input.category].join("\n");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function findingMarker(fingerprint: string): string {
  return `<!-- ai-pr-reviewer:v1:${fingerprint} -->`;
}

export function collectFingerprints(bodies: string[]): Set<string> {
  const fingerprints = new Set<string>();
  for (const body of bodies) {
    for (const match of body.matchAll(FINDING_MARKER)) {
      if (match[1]) fingerprints.add(match[1]);
    }
  }
  return fingerprints;
}

export function summaryMarker(headSha: string): string {
  const safe = headSha.replace(/[^a-fA-F0-9]/g, "").slice(0, 64);
  return `<!-- ai-pr-reviewer:summary:${safe} -->`;
}

export function hasSummaryMarker(bodies: string[], headSha: string): boolean {
  const marker = summaryMarker(headSha);
  return bodies.some((body) => body.includes(marker));
}
