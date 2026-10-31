import { ReviewError } from "../errors";
import { isRecord } from "../types";

export interface LlmClient {
  readonly provider: "openai" | "anthropic";
  readonly model: string;
  generate(input: { system: string; user: string }): Promise<unknown>;
}

export interface ProviderOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

const REQUEST_TIMEOUT_MS = 60_000;

export function createLlmClient(
  provider: "openai" | "anthropic",
  options: ProviderOptions,
): LlmClient {
  if (provider === "openai") return createOpenAiClient(options);
  return createAnthropicClient(options);
}

export function createOpenAiClient(options: ProviderOptions): LlmClient {
  return {
    provider: "openai",
    model: options.model,
    async generate(input) {
      const first = await postOpenAi(options, input, true);
      if (first.ok) return first.output;
      if (first.status !== 400) {
        throw providerError("OpenAI", first.status, first.body);
      }
      const second = await postOpenAi(options, input, false);
      if (!second.ok) throw providerError("OpenAI", second.status, second.body);
      return second.output;
    },
  };
}

export function createAnthropicClient(options: ProviderOptions): LlmClient {
  return {
    provider: "anthropic",
    model: options.model,
    async generate(input) {
      const first = await postAnthropic(options, input, true);
      if (first.ok) return first.output;
      if (first.status !== 400) {
        throw providerError("Anthropic", first.status, first.body);
      }
      const second = await postAnthropic(options, input, false);
      if (!second.ok) throw providerError("Anthropic", second.status, second.body);
      return second.output;
    },
  };
}

interface ProviderSuccess {
  ok: true;
  output: unknown;
}

interface ProviderFailure {
  ok: false;
  status: number;
  body: string;
}

async function postOpenAi(
  options: ProviderOptions,
  input: { system: string; user: string },
  structured: boolean,
): Promise<ProviderSuccess | ProviderFailure> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
  };
  if (structured) {
    body.temperature = 0;
    body.response_format = { type: "json_object" };
  }

  const response = await fetchWithTimeout(options, "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return { ok: false, status: response.status, body: await response.text() };
  }
  const payload: unknown = await response.json();
  return { ok: true, output: readOpenAiContent(payload) };
}

function readOpenAiContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw new ReviewError("OpenAI response did not include choices");
  }
  const choice = payload.choices[0];
  if (
    !isRecord(choice) ||
    !isRecord(choice.message) ||
    typeof choice.message.content !== "string"
  ) {
    throw new ReviewError("OpenAI response did not include message content");
  }
  return choice.message.content;
}

const SUBMIT_REVIEW_TOOL = {
  name: "submit_review",
  description: "Submit the structured pull request review. Call this exactly once.",
  input_schema: {
    type: "object",
    required: ["summary", "findings"],
    properties: {
      summary: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          required: ["file", "line", "severity", "category", "suggestion"],
          properties: {
            file: { type: "string" },
            line: { type: "integer" },
            side: { type: "string", enum: ["LEFT", "RIGHT"] },
            severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
            category: {
              type: "string",
              enum: ["bug", "security", "performance", "readability", "tests"],
            },
            suggestion: { type: "string" },
          },
        },
      },
    },
  },
};

async function postAnthropic(
  options: ProviderOptions,
  input: { system: string; user: string },
  withTool: boolean,
): Promise<ProviderSuccess | ProviderFailure> {
  const body: Record<string, unknown> = {
    model: options.model,
    max_tokens: 4096,
    system: input.system,
    messages: [{ role: "user", content: input.user }],
  };
  if (withTool) {
    body.temperature = 0;
    body.tools = [SUBMIT_REVIEW_TOOL];
    body.tool_choice = { type: "tool", name: "submit_review" };
  }

  const response = await fetchWithTimeout(options, "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": options.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return { ok: false, status: response.status, body: await response.text() };
  }
  const payload: unknown = await response.json();
  return { ok: true, output: readAnthropicOutput(payload) };
}

function readAnthropicOutput(payload: unknown): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.content)) {
    throw new ReviewError("Anthropic response did not include content");
  }
  for (const block of payload.content) {
    if (!isRecord(block)) continue;
    if (block.type === "tool_use" && block.name === "submit_review") {
      return block.input ?? {};
    }
  }
  const text = payload.content
    .filter((block): block is { type: string; text: string } => {
      return isRecord(block) && block.type === "text" && typeof block.text === "string";
    })
    .map((block) => block.text)
    .join("\n");
  if (!text) throw new ReviewError("Anthropic response did not include review content");
  return text;
}

async function fetchWithTimeout(
  options: ProviderOptions,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ReviewError(`LLM request failed: ${message}`);
  }
}

function providerError(provider: string, status: number, body: string): ReviewError {
  return new ReviewError(`${provider} request failed (${status}): ${body.slice(0, 500)}`);
}
