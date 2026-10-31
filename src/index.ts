import * as core from "@actions/core";
import { parseConfig, type RawInputs } from "./config";
import { readEventFile, readPullRequest } from "./github/context";
import { createGitHubClient } from "./github/client";
import { readGuidelinesFile } from "./guidelines";
import { createLlmClient } from "./llm/providers";
import { createStructuredReviewer } from "./llm/review";
import { runReview } from "./run";
import type { Logger } from "./types";
import { readFileSync } from "node:fs";

async function main(): Promise<void> {
  const config = parseConfig(readInputs());
  const event = readEventFile(process.env.GITHUB_EVENT_PATH ?? "", (file) =>
    readFileSync(file, "utf8"),
  );
  const pullRequest = readPullRequest(process.env, event);
  const guidelines = await readGuidelinesFile(
    process.env.GITHUB_WORKSPACE ?? process.cwd(),
    config.guidelinesPath,
  );
  const logger = coreLogger();
  const result = await runReview({
    config,
    pullRequest,
    guidelines,
    github: createGitHubClient({
      token: config.githubToken,
      apiBase: process.env.GITHUB_API_URL,
    }),
    reviewer: createStructuredReviewer(
      createLlmClient(config.provider, {
        apiKey: config.apiKey,
        model: config.model,
      }),
    ),
    logger,
  });

  core.setOutput("findings-count", String(result.findingsCount));
  core.setOutput("reviewed-file-count", String(result.reviewedFiles));
}

function readInputs(): RawInputs {
  return {
    provider: core.getInput("provider"),
    model: core.getInput("model"),
    apiKey: core.getInput("api-key"),
    maxFiles: core.getInput("max-files"),
    include: core.getInput("include"),
    exclude: core.getInput("exclude"),
    severityThreshold: core.getInput("severity-threshold"),
    guidelines: core.getInput("guidelines"),
    githubToken: core.getInput("github-token"),
    maxInputTokens: core.getInput("max-input-tokens"),
    maxComments: core.getInput("max-comments"),
  };
}

function coreLogger(): Logger {
  return {
    info: (message) => core.info(message),
    warn: (message) => core.warning(message),
    debug: (message) => core.debug(message),
  };
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  core.setFailed(message);
});
