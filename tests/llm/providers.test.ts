import { describe, expect, it } from "vitest";
import { createAnthropicClient, createOpenAiClient } from "../../src/llm/providers";

function fetchMock(
  handler: (url: string, init: RequestInit | undefined) => Response,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  }) as typeof fetch;
}

describe("OpenAI client", () => {
  it("asks for a JSON object and reads the message content", async () => {
    const bodies: unknown[] = [];
    const client = createOpenAiClient({
      apiKey: "test-key",
      model: "gpt-test",
      fetchImpl: fetchMock((url, init) => {
        expect(url).toBe("https://api.openai.com/v1/chat/completions");
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-key");
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({
          choices: [{ message: { content: '{"summary":"ok","findings":[]}' } }],
        });
      }),
    });

    await expect(client.generate({ system: "sys", user: "diff" })).resolves.toContain("summary");
    expect(bodies[0]).toMatchObject({
      model: "gpt-test",
      temperature: 0,
      response_format: { type: "json_object" },
    });
  });

  it("retries without response_format when the model rejects it", async () => {
    let calls = 0;
    const client = createOpenAiClient({
      apiKey: "test-key",
      model: "custom-model",
      fetchImpl: fetchMock((_url, init) => {
        calls += 1;
        const body = JSON.parse(String(init?.body)) as { response_format?: unknown };
        if (body.response_format) {
          return new Response("response_format is unsupported", { status: 400 });
        }
        return Response.json({ choices: [{ message: { content: "{}" } }] });
      }),
    });

    await expect(client.generate({ system: "sys", user: "diff" })).resolves.toBe("{}");
    expect(calls).toBe(2);
  });

  it("does not retry a non-400 failure", async () => {
    let calls = 0;
    const client = createOpenAiClient({
      apiKey: "test-key",
      model: "gpt-test",
      fetchImpl: fetchMock(() => {
        calls += 1;
        return new Response("invalid key", { status: 401 });
      }),
    });
    await expect(client.generate({ system: "sys", user: "diff" })).rejects.toThrow(/401/);
    expect(calls).toBe(1);
  });
});

describe("Anthropic client", () => {
  it("returns the submit_review tool input", async () => {
    const client = createAnthropicClient({
      apiKey: "test-key",
      model: "claude-test",
      fetchImpl: fetchMock((url, init) => {
        expect(url).toBe("https://api.anthropic.com/v1/messages");
        expect(new Headers(init?.headers).get("x-api-key")).toBe("test-key");
        const body = JSON.parse(String(init?.body)) as { tool_choice?: { name?: string } };
        expect(body.tool_choice?.name).toBe("submit_review");
        return Response.json({
          content: [
            {
              type: "tool_use",
              name: "submit_review",
              input: { summary: "ok", findings: [] },
            },
          ],
        });
      }),
    });

    await expect(client.generate({ system: "sys", user: "diff" })).resolves.toEqual({
      summary: "ok",
      findings: [],
    });
  });

  it("falls back to text when tool use is rejected", async () => {
    let calls = 0;
    const client = createAnthropicClient({
      apiKey: "test-key",
      model: "claude-test",
      fetchImpl: fetchMock((_url, init) => {
        calls += 1;
        const body = JSON.parse(String(init?.body)) as { tools?: unknown };
        if (body.tools) return new Response("tools unsupported", { status: 400 });
        return Response.json({
          content: [{ type: "text", text: '{"summary":"text","findings":[]}' }],
        });
      }),
    });

    await expect(client.generate({ system: "sys", user: "diff" })).resolves.toContain("text");
    expect(calls).toBe(2);
  });
});
