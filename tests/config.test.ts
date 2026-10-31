import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE, parseConfig, type RawInputs } from "../src/config";
import { readGuidelinesFile } from "../src/guidelines";

function inputs(overrides: Partial<RawInputs> = {}): RawInputs {
  return {
    provider: "OpenAI",
    model: " gpt-test ",
    apiKey: " secret ",
    maxFiles: "",
    include: "",
    exclude: "",
    severityThreshold: "",
    guidelines: "",
    githubToken: " token ",
    maxInputTokens: "",
    maxComments: "",
    ...overrides,
  };
}

describe("parseConfig", () => {
  it("applies defaults and normalizes the provider", () => {
    expect(parseConfig(inputs())).toMatchObject({
      provider: "openai",
      model: "gpt-test",
      apiKey: "secret",
      maxFiles: 20,
      include: [DEFAULT_INCLUDE],
      severityThreshold: "medium",
      maxInputTokens: 12_000,
      maxComments: 15,
      githubToken: "token",
    });
    expect(parseConfig(inputs()).exclude.join(",")).toBe(DEFAULT_EXCLUDE);
  });

  it("rejects an unknown provider, a bad threshold, and out-of-range limits", () => {
    expect(() => parseConfig(inputs({ provider: "google" }))).toThrow(/openai/);
    expect(() => parseConfig(inputs({ severityThreshold: "urgent" }))).toThrow(
      /severity-threshold/,
    );
    expect(() => parseConfig(inputs({ maxFiles: "0" }))).toThrow(/max-files/);
    expect(() => parseConfig(inputs({ maxInputTokens: "10" }))).toThrow(/max-input-tokens/);
    expect(() => parseConfig(inputs({ apiKey: "  " }))).toThrow(/api-key/);
  });
});

describe("action.yml", () => {
  const source = readFileSync(new URL("../action.yml", import.meta.url), "utf8");

  it("declares the public inputs and the committed bundle", () => {
    for (const name of [
      "provider",
      "model",
      "api-key",
      "max-files",
      "include",
      "exclude",
      "severity-threshold",
      "guidelines",
      "github-token",
      "max-input-tokens",
      "max-comments",
    ]) {
      expect(source).toContain(`${name}:`);
    }
    expect(source).toContain("using: node20");
    expect(source).toContain("main: dist/index.js");
    expect(source).toContain(DEFAULT_EXCLUDE);
  });
});

describe("readGuidelinesFile", () => {
  it("rejects paths that leave the workspace", async () => {
    await expect(
      readGuidelinesFile("/work/repo", "../secrets.txt", async () => "nope"),
    ).rejects.toThrow(/inside the workspace/);
  });

  it("reports a missing file", async () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    await expect(
      readGuidelinesFile("/work/repo", "REVIEW.md", async () => Promise.reject(missing)),
    ).rejects.toThrow(/not found/);
  });
});
