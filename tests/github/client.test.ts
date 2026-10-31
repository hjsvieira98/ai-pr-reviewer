import { describe, expect, it } from "vitest";
import { createGitHubClient, nextLink } from "../../src/github/client";
import { readPullRequest } from "../../src/github/context";
import type { PullRef } from "../../src/types";

const pr: PullRef = {
  owner: "hjsvieira98",
  repo: "ai-pr-reviewer",
  pullNumber: 7,
  headSha: "abc123def456",
};

describe("nextLink", () => {
  it("reads the rel=next URL from a GitHub Link header", () => {
    expect(
      nextLink(
        '<https://api.github.com/items?page=2>; rel="next", <https://api.github.com/items?page=3>; rel="last"',
      ),
    ).toBe("https://api.github.com/items?page=2");
    expect(nextLink('<https://api.github.com/items?page=2>; rel="last"')).toBeUndefined();
    expect(nextLink(null)).toBeUndefined();
  });
});

describe("createGitHubClient", () => {
  it("fetches the diff, follows comment pagination, and posts one review", async () => {
    const calls: Array<{ url: string; method: string; accept: string | null; body?: unknown }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        method: init?.method ?? "GET",
        accept: headers.get("Accept"),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.endsWith("/pulls/7")) {
        return new Response("diff --git a/src/a.ts b/src/a.ts\n", { status: 200 });
      }
      if (url.includes("/comments") && !url.includes("page=2")) {
        return Response.json([{ body: "first" }], {
          headers: { link: `<${url}&page=2>; rel="next"` },
        });
      }
      if (url.includes("page=2")) return Response.json([{ body: "second" }]);
      if (url.includes("/reviews") && (init?.method ?? "GET") === "GET") {
        return Response.json([{ body: "existing summary" }]);
      }
      if (init?.method === "POST") return Response.json({ id: 1 }, { status: 201 });
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    const client = createGitHubClient({ token: "ghs_test", fetchImpl });
    await expect(client.fetchPullRequestDiff(pr)).resolves.toContain("diff --git");
    await expect(client.listReviewCommentBodies(pr)).resolves.toEqual(["first", "second"]);
    await expect(client.listReviewBodies(pr)).resolves.toEqual(["existing summary"]);
    await client.createReview(pr, {
      body: "summary",
      comments: [{ path: "src/a.ts", line: 2, side: "RIGHT", body: "fix it" }],
    });

    expect(calls[0]).toMatchObject({
      accept: "application/vnd.github.diff",
    });
    const post = calls.find((call) => call.method === "POST");
    expect(post?.body).toEqual({
      commit_id: "abc123def456",
      event: "COMMENT",
      body: "summary",
      comments: [{ path: "src/a.ts", line: 2, side: "RIGHT", body: "fix it" }],
    });
    expect(calls.some((call) => call.url.includes("ghs_test"))).toBe(false);
  });

  it("explains a rejected token", async () => {
    const client = createGitHubClient({
      token: "nope",
      fetchImpl: (async () =>
        new Response("Resource not accessible by integration", { status: 403 })) as typeof fetch,
    });
    await expect(client.fetchPullRequestDiff(pr)).rejects.toThrow(/pull-requests: write/);
  });
});

describe("readPullRequest", () => {
  it("reads owner, number, and head sha from a pull_request event", () => {
    expect(
      readPullRequest(
        { GITHUB_EVENT_NAME: "pull_request", GITHUB_REPOSITORY: "hjsvieira98/ai-pr-reviewer" },
        { pull_request: { number: 7, head: { sha: "abc123" } } },
      ),
    ).toEqual({
      owner: "hjsvieira98",
      repo: "ai-pr-reviewer",
      pullNumber: 7,
      headSha: "abc123",
    });
  });

  it("rejects other events", () => {
    expect(() =>
      readPullRequest(
        { GITHUB_EVENT_NAME: "push", GITHUB_REPOSITORY: "hjsvieira98/ai-pr-reviewer" },
        {},
      ),
    ).toThrow(/pull_request/);
  });
});
