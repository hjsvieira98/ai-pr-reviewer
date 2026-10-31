import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseUnifiedDiff } from "../src/diff/parse";
import { renderFile } from "../src/diff/render";
import { buildSystemPrompt, buildUserPrompt } from "../src/llm/prompt";
import { createLlmClient, type LlmClient } from "../src/llm/providers";
import { createStructuredReviewer } from "../src/llm/review";
import { selectFindings } from "../src/review/select";
import { CATEGORIES, type LlmReview } from "../src/types";
import { scoreCase, type SeededIssue } from "./score";

const caseSchema = z.object({
  id: z.string(),
  title: z.string(),
  seeds: z.array(
    z.object({
      id: z.string(),
      file: z.string(),
      category: z.enum(CATEGORIES),
      line: z.number().int().positive(),
      tolerance: z.number().int().nonnegative().optional(),
    }),
  ),
});

const contractSchema = z.object({
  seeded: z.number(),
  caught: z.number(),
  missedIds: z.array(z.string()),
  cleanFalsePositives: z.number(),
});

export interface CaseReport {
  id: string;
  title: string;
  seeded: number;
  caught: number;
  missedIds: string[];
  unmatched: number;
  cleanFalsePositives: number;
}

export interface EvalReport {
  mode: "mock" | "live";
  provider?: string;
  model?: string;
  seeded: number;
  caught: number;
  missedIds: string[];
  cleanFalsePositives: number;
  cases: CaseReport[];
  contractMismatch: string | undefined;
}

export interface EvalOptions {
  mode: "mock" | "live";
  provider?: "openai" | "anthropic";
  model?: string;
  apiKey?: string;
  fixturesDir?: string;
  client?: LlmClient;
}

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export async function evaluateFixtures(options: EvalOptions): Promise<EvalReport> {
  const root = options.fixturesDir ?? fixturesDir;
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const system = buildSystemPrompt();
  const cases: CaseReport[] = [];

  for (const entry of entries) {
    const directory = path.join(root, entry);
    const fixture = caseSchema.parse(
      JSON.parse(await readFile(path.join(directory, "case.json"), "utf8")),
    );
    const diffText = await readFile(path.join(directory, "diff.patch"), "utf8");
    const files = parseUnifiedDiff(diffText);
    const rendered = files.map((file) => renderFile(file)).join("\n\n");
    const user = buildUserPrompt({
      guidelines: undefined,
      diffText: rendered,
      severityThreshold: "low",
      maxFindings: 10,
    });

    const parsed = await reviewFixture(options, directory, system, user);
    const selected = selectFindings({
      files,
      findings: parsed.findings,
      threshold: "low",
      maxComments: 50,
      existingFingerprints: new Set(),
    });
    const scored = scoreCase(fixture.seeds, selected.accepted);
    cases.push({
      id: fixture.id,
      title: fixture.title,
      seeded: fixture.seeds.length,
      caught: scored.caught.length,
      missedIds: scored.missed.map((seed) => seed.id),
      unmatched: scored.unmatched.length,
      cleanFalsePositives: fixture.seeds.length === 0 ? scored.unmatched.length : 0,
    });
  }

  const report: EvalReport = {
    mode: options.mode,
    provider: options.provider,
    model: options.model,
    seeded: cases.reduce((sum, item) => sum + item.seeded, 0),
    caught: cases.reduce((sum, item) => sum + item.caught, 0),
    missedIds: cases.flatMap((item) => item.missedIds).sort(),
    cleanFalsePositives: cases.reduce((sum, item) => sum + item.cleanFalsePositives, 0),
    cases,
    contractMismatch: undefined,
  };

  if (options.mode === "mock") {
    const contract = contractSchema.parse(
      JSON.parse(await readFile(path.join(root, "mock-contract.json"), "utf8")),
    );
    const actual = {
      seeded: report.seeded,
      caught: report.caught,
      missedIds: report.missedIds,
      cleanFalsePositives: report.cleanFalsePositives,
    };
    if (JSON.stringify(actual) !== JSON.stringify(contract)) {
      report.contractMismatch = `Mock contract mismatch.\nExpected: ${JSON.stringify(contract)}\nActual: ${JSON.stringify(actual)}`;
    }
  }

  return report;
}

async function reviewFixture(
  options: EvalOptions,
  directory: string,
  system: string,
  user: string,
): Promise<LlmReview> {
  if (options.mode === "mock") {
    const scripted: unknown = JSON.parse(
      await readFile(path.join(directory, "mock-response.json"), "utf8"),
    );
    return createStructuredReviewer({
      provider: "openai",
      model: "mock",
      async generate() {
        return scripted;
      },
    }).review({ system, user });
  }

  const client =
    options.client ??
    createLlmClient(requiredProvider(options), {
      apiKey: requiredApiKey(options),
      model: requiredModel(options),
    });
  return createStructuredReviewer(client).review({ system, user });
}

function requiredProvider(options: EvalOptions): "openai" | "anthropic" {
  if (options.provider !== "openai" && options.provider !== "anthropic") {
    throw new Error("Live eval requires a provider.");
  }
  return options.provider;
}

function requiredModel(options: EvalOptions): string {
  if (!options.model) throw new Error("Live eval requires a model.");
  return options.model;
}

function requiredApiKey(options: EvalOptions): string {
  if (!options.apiKey) throw new Error("Live eval requires an API key.");
  return options.apiKey;
}

export function formatReport(report: EvalReport): string {
  const lines = [
    report.mode === "mock"
      ? "Mode: mock (scripted responses; this does not measure a live model)"
      : `Mode: live (${report.provider} / ${report.model})`,
    "",
    "Case                      Seeded  Caught  Unmatched",
  ];
  for (const item of report.cases) {
    lines.push(
      `${item.id.padEnd(24)}  ${String(item.seeded).padStart(6)}  ${String(item.caught).padStart(6)}  ${String(item.unmatched).padStart(9)}`,
    );
  }
  lines.push("");
  lines.push(`Seeded issues caught: ${report.caught}/${report.seeded}`);
  if (report.missedIds.length > 0) lines.push(`Missed: ${report.missedIds.join(", ")}`);
  lines.push(`False positives on clean diffs: ${report.cleanFalsePositives}`);
  lines.push("");
  if (report.mode === "mock") {
    lines.push("The mock numbers are a harness check. They are not a model score.");
  } else {
    lines.push("One live run. Line match tolerance is 2. This is not a published benchmark.");
  }
  if (report.contractMismatch) {
    lines.push("");
    lines.push(report.contractMismatch);
  }
  return lines.join("\n");
}

export type { SeededIssue };
