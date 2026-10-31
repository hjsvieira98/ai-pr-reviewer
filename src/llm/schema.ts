import { z } from "zod";
import { CATEGORIES, SEVERITIES, type Finding, type LlmReview, isRecord } from "../types";

const lineSchema = z.preprocess((value) => {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return value;
}, z.number().int().positive());

const sideSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const normalized = value.trim().toUpperCase();
    return normalized.length === 0 ? undefined : normalized;
  },
  z.enum(["LEFT", "RIGHT"]).optional(),
);

const severitySchema = z.preprocess((value) => {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}, z.enum(SEVERITIES));

const categorySchema = z.preprocess((value) => {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}, z.enum(CATEGORIES));

export const findingSchema = z.object({
  file: z.string().trim().min(1).max(500),
  line: lineSchema,
  side: sideSchema,
  severity: severitySchema,
  category: categorySchema,
  suggestion: z.string().trim().min(1).max(2_000),
});

const responseSchema = z.object({
  summary: z.string().optional(),
  findings: z.array(z.unknown()).optional(),
});

export interface ParseSuccess {
  ok: true;
  review: LlmReview;
  droppedFindings: number;
}

export interface ParseFailure {
  ok: false;
  error: string;
}

export function parseModelPayload(payload: unknown): ParseSuccess | ParseFailure {
  const record = coercePayload(payload);
  if (!record.ok) return record;

  const parsed = responseSchema.safeParse(record.value);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  }

  const findings: Finding[] = [];
  let droppedFindings = 0;
  for (const item of parsed.data.findings ?? []) {
    const finding = findingSchema.safeParse(item);
    if (!finding.success) {
      droppedFindings += 1;
      continue;
    }
    findings.push(finding.data);
  }

  const summary = parsed.data.summary?.trim() || "Review completed.";
  return { ok: true, review: { summary, findings }, droppedFindings };
}

function coercePayload(payload: unknown): { ok: true; value: unknown } | ParseFailure {
  if (typeof payload === "string") {
    try {
      return { ok: true, value: JSON.parse(extractJsonObject(payload)) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  }
  if (isRecord(payload)) return { ok: true, value: payload };
  return { ok: false, error: "Model output was not a JSON object" };
}

export function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("Model response did not contain a JSON object");
  }
  return body.slice(start, end + 1);
}
