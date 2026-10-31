import { ReviewError } from "./errors";
import { SEVERITIES, type Severity } from "./types";

export interface RawInputs {
  provider: string;
  model: string;
  apiKey: string;
  maxFiles: string;
  include: string;
  exclude: string;
  severityThreshold: string;
  guidelines: string;
  githubToken: string;
  maxInputTokens: string;
  maxComments: string;
}

export interface Config {
  provider: "openai" | "anthropic";
  model: string;
  apiKey: string;
  maxFiles: number;
  include: string[];
  exclude: string[];
  severityThreshold: Severity;
  guidelinesPath: string;
  githubToken: string;
  maxInputTokens: number;
  maxComments: number;
}

export const DEFAULT_INCLUDE = "**/*";
export const DEFAULT_EXCLUDE = [
  "**/*.lock",
  "**/package-lock.json",
  "**/*.min.js",
  "**/*.min.css",
  "**/dist/**",
  "**/node_modules/**",
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.gif",
  "**/*.webp",
  "**/*.ico",
  "**/*.pdf",
].join(",");

export const DEFAULTS = {
  maxFiles: 20,
  include: DEFAULT_INCLUDE,
  exclude: DEFAULT_EXCLUDE,
  severityThreshold: "medium" as const,
  maxInputTokens: 12_000,
  maxComments: 15,
};

const MAX_CHUNKS = 4;
export { MAX_CHUNKS };

export function parseConfig(raw: RawInputs): Config {
  const provider = raw.provider.trim().toLowerCase();
  if (provider !== "openai" && provider !== "anthropic") {
    throw new ReviewError('provider must be "openai" or "anthropic"');
  }

  const model = raw.model.trim();
  if (!model) {
    throw new ReviewError("model is required");
  }

  const apiKey = raw.apiKey.trim();
  if (!apiKey) {
    throw new ReviewError("api-key is required");
  }

  const githubToken = raw.githubToken.trim();
  if (!githubToken) {
    throw new ReviewError("github-token is required");
  }

  const severityInput = raw.severityThreshold.trim().toLowerCase();
  const severityThreshold = severityInput || DEFAULTS.severityThreshold;
  if (!isSeverity(severityThreshold)) {
    throw new ReviewError(`severity-threshold must be one of: ${SEVERITIES.join(", ")}`);
  }

  return {
    provider,
    model,
    apiKey,
    maxFiles: parseBoundedInt(raw.maxFiles, "max-files", 1, 100, DEFAULTS.maxFiles),
    include: parseGlobs(raw.include, [DEFAULTS.include]),
    exclude: parseGlobs(raw.exclude, DEFAULTS.exclude.split(",")),
    severityThreshold,
    guidelinesPath: raw.guidelines.trim(),
    githubToken,
    maxInputTokens: parseBoundedInt(
      raw.maxInputTokens,
      "max-input-tokens",
      256,
      200_000,
      DEFAULTS.maxInputTokens,
    ),
    maxComments: parseBoundedInt(raw.maxComments, "max-comments", 1, 50, DEFAULTS.maxComments),
  };
}

function parseGlobs(value: string, fallback: string[]): string[] {
  const patterns = value
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
  return patterns.length > 0 ? patterns : fallback;
}

function parseBoundedInt(
  value: string,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (!/^\d+$/.test(trimmed)) {
    throw new ReviewError(`${name} must be an integer`);
  }
  const parsed = Number(trimmed);
  if (parsed < min || parsed > max) {
    throw new ReviewError(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

function isSeverity(value: string): value is Severity {
  return (SEVERITIES as readonly string[]).includes(value);
}
