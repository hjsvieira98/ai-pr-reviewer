import { ReviewError } from "../errors";

export interface DiffLine {
  type: "add" | "delete" | "context";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffFile {
  path: string;
  oldPath: string;
  status: FileStatus;
  binary: boolean;
  hunks: DiffHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse a unified diff into files and hunks.
 * Line numbers follow the hunk headers so later stages can address GitHub review lines.
 */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const normalized = diff.replaceAll("\r\n", "\n");
  const lines = normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n")
    : normalized.split("\n");
  if (lines.length === 1 && lines[0] === "") return [];

  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  let hunk: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  let skippingBinary = false;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      current = startFile(line.slice("diff --git ".length));
      files.push(current);
      hunk = undefined;
      skippingBinary = false;
      continue;
    }

    if (!current || skippingBinary) continue;

    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      current.binary = true;
      current.hunks = [];
      hunk = undefined;
      skippingBinary = true;
      continue;
    }

    if (line.startsWith("new file mode ")) {
      current.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode ")) {
      current.status = "deleted";
      continue;
    }
    if (line.startsWith("rename from ")) {
      current.status = "renamed";
      current.oldPath = line.slice("rename from ".length).trim();
      continue;
    }
    if (line.startsWith("rename to ")) {
      current.status = "renamed";
      current.path = line.slice("rename to ".length).trim();
      continue;
    }

    if (line.startsWith("@@")) {
      const parsed = parseHunkHeader(line);
      if (!parsed) continue;
      hunk = { ...parsed, lines: [] };
      current.hunks.push(hunk);
      oldLine = parsed.oldStart;
      newLine = parsed.newStart;
      continue;
    }

    if (!hunk || line.startsWith("\\")) continue;

    const marker = line[0];
    const text = line.slice(1);
    if (marker === "+") {
      hunk.lines.push({ type: "add", text, newLine });
      newLine += 1;
    } else if (marker === "-") {
      hunk.lines.push({ type: "delete", text, oldLine });
      oldLine += 1;
    } else if (marker === " ") {
      hunk.lines.push({ type: "context", text, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  return files;
}

function startFile(spec: string): DiffFile {
  const { oldPath, newPath } = splitGitPaths(spec);
  const path = newPath === "/dev/null" ? oldPath : newPath;
  const previous = oldPath === "/dev/null" ? newPath : oldPath;
  return {
    path,
    oldPath: previous,
    status: "modified",
    binary: false,
    hunks: [],
  };
}

function splitGitPaths(spec: string): { oldPath: string; newPath: string } {
  const parts = spec.startsWith('"') ? splitQuoted(spec) : splitUnquoted(spec);
  return {
    oldPath: stripGitPrefix(parts[0]),
    newPath: stripGitPrefix(parts[1]),
  };
}

function splitUnquoted(spec: string): [string, string] {
  const index = spec.lastIndexOf(" b/");
  if (index <= 0 || !spec.startsWith("a/")) {
    throw new ReviewError(`Unable to parse diff header: ${spec}`);
  }
  return [spec.slice(0, index), spec.slice(index + 1)];
}

function splitQuoted(spec: string): [string, string] {
  const first = readQuoted(spec, 0);
  let cursor = first.next;
  while (spec[cursor] === " ") cursor += 1;
  const second = readQuoted(spec, cursor);
  return [first.value, second.value];
}

function readQuoted(input: string, start: number): { value: string; next: number } {
  if (input[start] !== '"') {
    throw new ReviewError(`Unable to parse quoted diff path: ${input}`);
  }
  let value = "";
  for (let i = start + 1; i < input.length; i += 1) {
    const char = input[i];
    if (char === "\\" && i + 1 < input.length) {
      value += input[i + 1];
      i += 1;
      continue;
    }
    if (char === '"') {
      return { value, next: i + 1 };
    }
    value += char;
  }
  throw new ReviewError(`Unterminated quoted diff path: ${input}`);
}

function stripGitPrefix(path: string): string {
  if (path.startsWith("a/") || path.startsWith("b/")) return path.slice(2);
  return path;
}

function parseHunkHeader(line: string): Omit<DiffHunk, "lines"> | undefined {
  const match = HUNK_HEADER.exec(line);
  if (!match?.[1] || !match[3]) return undefined;
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4]),
  };
}
