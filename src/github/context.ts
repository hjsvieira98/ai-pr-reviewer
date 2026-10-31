import { ReviewError } from "../errors";
import { isRecord, type PullRef } from "../types";

export function readPullRequest(env: NodeJS.ProcessEnv, event: unknown): PullRef {
  const eventName = env.GITHUB_EVENT_NAME;
  if (eventName !== "pull_request" && eventName !== "pull_request_target") {
    throw new ReviewError(
      `This action only supports pull_request events (got ${eventName ?? "none"})`,
    );
  }

  const repository = env.GITHUB_REPOSITORY;
  if (!repository || !repository.includes("/")) {
    throw new ReviewError("GITHUB_REPOSITORY must be owner/repo");
  }
  const [owner, repo] = repository.split("/") as [string, string];
  if (!owner || !repo) {
    throw new ReviewError("GITHUB_REPOSITORY must be owner/repo");
  }

  if (!isRecord(event) || !isRecord(event.pull_request)) {
    throw new ReviewError("Event payload did not include pull_request");
  }
  const pullRequest = event.pull_request;
  const number = pullRequest.number;
  const head = isRecord(pullRequest.head) ? pullRequest.head.sha : undefined;
  if (typeof number !== "number" || typeof head !== "string" || head.length === 0) {
    throw new ReviewError("Pull request payload is missing number or head.sha");
  }

  return { owner, repo, pullNumber: number, headSha: head };
}

export function readEventFile(eventPath: string, readFile: (path: string) => string): unknown {
  if (!eventPath) {
    throw new ReviewError("GITHUB_EVENT_PATH is not set");
  }
  try {
    return JSON.parse(readFile(eventPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ReviewError(`Unable to read the GitHub event payload: ${message}`);
  }
}
