import { minimatch } from "minimatch";
import { MAX_CHUNKS } from "../config";
import { estimateTokens, renderFile, truncateToTokenBudget } from "./render";
import type { DiffFile } from "./parse";

const MATCH_OPTIONS = { dot: true };

export type SkipReason = "binary" | "empty" | "excluded" | "file-limit" | "budget";

export interface SkippedFile {
  path: string;
  reason: SkipReason;
}

export interface PackedChunk {
  paths: string[];
  text: string;
  truncated: boolean;
}

export interface PackResult {
  chunks: PackedChunk[];
  skipped: SkippedFile[];
  estimatedTokens: number;
  reviewedPaths: string[];
}

export function selectDiff(
  files: DiffFile[],
  options: {
    include: string[];
    exclude: string[];
    maxFiles: number;
    maxInputTokens: number;
    maxChunks?: number;
  },
): PackResult {
  const skipped: SkippedFile[] = [];
  const reviewable: DiffFile[] = [];

  for (const file of files) {
    if (file.binary) {
      skipped.push({ path: file.path, reason: "binary" });
      continue;
    }
    if (file.hunks.length === 0) {
      skipped.push({ path: file.path, reason: "empty" });
      continue;
    }
    if (!matchesGlobs(file.path, options.include, options.exclude)) {
      skipped.push({ path: file.path, reason: "excluded" });
      continue;
    }
    reviewable.push(file);
  }

  const limited = reviewable.slice(0, options.maxFiles);
  for (const file of reviewable.slice(options.maxFiles)) {
    skipped.push({ path: file.path, reason: "file-limit" });
  }

  const maxChunks = options.maxChunks ?? MAX_CHUNKS;
  const chunks: PackedChunk[] = [];
  let currentPaths: string[] = [];
  let currentParts: string[] = [];
  let currentTokens = 0;
  let currentTruncated = false;
  let estimatedTokens = 0;

  const flush = (): void => {
    if (currentParts.length === 0) return;
    chunks.push({
      paths: currentPaths,
      text: currentParts.join("\n\n"),
      truncated: currentTruncated,
    });
    currentPaths = [];
    currentParts = [];
    currentTokens = 0;
    currentTruncated = false;
  };

  for (let index = 0; index < limited.length; index += 1) {
    const file = limited[index];
    if (!file) continue;
    const rendered = renderFile(file);
    const truncated = estimateTokens(rendered) > options.maxInputTokens;
    const text = truncated ? truncateToTokenBudget(rendered, options.maxInputTokens) : rendered;
    const tokens = estimateTokens(text);

    const wouldOverflow =
      currentParts.length > 0 && currentTokens + tokens > options.maxInputTokens;
    if (wouldOverflow) {
      const openingAnotherChunk = chunks.length + 1 >= maxChunks;
      if (openingAnotherChunk) {
        for (const rest of limited.slice(index)) {
          skipped.push({ path: rest.path, reason: "budget" });
        }
        break;
      }
      flush();
    }

    currentPaths.push(file.path);
    currentParts.push(text);
    currentTokens += tokens;
    currentTruncated = currentTruncated || truncated;
    estimatedTokens += tokens;
  }
  flush();

  return {
    chunks,
    skipped,
    estimatedTokens,
    reviewedPaths: chunks.flatMap((chunk) => chunk.paths),
  };
}

export function listCommentableLines(
  file: DiffFile,
): Array<{ side: "LEFT" | "RIGHT"; line: number }> {
  const targets: Array<{ side: "LEFT" | "RIGHT"; line: number }> = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add" && line.newLine !== undefined) {
        targets.push({ side: "RIGHT", line: line.newLine });
      } else if (line.type === "delete" && line.oldLine !== undefined) {
        targets.push({ side: "LEFT", line: line.oldLine });
      }
    }
  }
  return targets;
}

export function matchesGlobs(path: string, include: string[], exclude: string[]): boolean {
  const included =
    include.length === 0 || include.some((pattern) => minimatch(path, pattern, MATCH_OPTIONS));
  if (!included) return false;
  return !exclude.some((pattern) => minimatch(path, pattern, MATCH_OPTIONS));
}
