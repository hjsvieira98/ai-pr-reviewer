import { ReviewError } from "../errors";
import { isRecord, type DraftComment, type PullRef } from "../types";

export interface GitHubClient {
  fetchPullRequestDiff(pr: PullRef): Promise<string>;
  listReviewCommentBodies(pr: PullRef): Promise<string[]>;
  listReviewBodies(pr: PullRef): Promise<string[]>;
  createReview(pr: PullRef, review: { body: string; comments: DraftComment[] }): Promise<void>;
}

export interface GitHubClientOptions {
  token: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const apiBase = (options.apiBase ?? "https://api.github.com").replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async fetchPullRequestDiff(pr) {
      const response = await githubFetch(
        fetchImpl,
        options.token,
        `${apiBase}/repos/${pr.owner}/${pr.repo}/pulls/${pr.pullNumber}`,
        { headers: { Accept: "application/vnd.github.diff" } },
      );
      return response.text();
    },

    async listReviewCommentBodies(pr) {
      const items = await paginate(
        fetchImpl,
        options.token,
        `${apiBase}/repos/${pr.owner}/${pr.repo}/pulls/${pr.pullNumber}/comments?per_page=100`,
      );
      return items.map(readBody);
    },

    async listReviewBodies(pr) {
      const items = await paginate(
        fetchImpl,
        options.token,
        `${apiBase}/repos/${pr.owner}/${pr.repo}/pulls/${pr.pullNumber}/reviews?per_page=100`,
      );
      return items.map(readBody);
    },

    async createReview(pr, review) {
      const payload: Record<string, unknown> = {
        commit_id: pr.headSha,
        event: "COMMENT",
        body: review.body,
      };
      if (review.comments.length > 0) {
        payload.comments = review.comments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          side: comment.side,
          body: comment.body,
        }));
      }
      await githubFetch(
        fetchImpl,
        options.token,
        `${apiBase}/repos/${pr.owner}/${pr.repo}/pulls/${pr.pullNumber}/reviews`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
    },
  };
}

function readBody(item: unknown): string {
  if (isRecord(item) && typeof item.body === "string") return item.body;
  return "";
}

const MAX_PAGES = 20;

async function paginate(
  fetchImpl: typeof fetch,
  token: string,
  firstUrl: string,
): Promise<unknown[]> {
  const items: unknown[] = [];
  let next: string | undefined = firstUrl;
  let pages = 0;
  while (next && pages < MAX_PAGES) {
    pages += 1;
    const response = await githubFetch(fetchImpl, token, next);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new ReviewError("Expected a JSON array from GitHub");
    }
    items.push(...payload);
    next = nextLink(response.headers.get("link"));
  }
  return items;
}

export function nextLink(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

async function githubFetch(
  fetchImpl: typeof fetch,
  token: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", headers.get("Accept") ?? "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  headers.set("User-Agent", "ai-pr-reviewer");
  if (init.body) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ReviewError(`GitHub request failed: ${message}`);
  }

  if (response.ok) return response;
  const detail = (await response.text()).slice(0, 500);
  if (response.status === 403 || response.status === 401) {
    throw new ReviewError(
      `GitHub rejected the token (${response.status}). The workflow needs contents: read and pull-requests: write. ${detail}`,
    );
  }
  throw new ReviewError(`GitHub request failed (${response.status}): ${detail}`);
}
