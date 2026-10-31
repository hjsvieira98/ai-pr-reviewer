import path from "node:path";
import { readFile } from "node:fs/promises";
import { ReviewError } from "./errors";

export async function readGuidelinesFile(
  workspace: string,
  relativePath: string,
  read: (file: string) => Promise<string> = (file) => readFile(file, "utf8"),
): Promise<string | undefined> {
  if (!relativePath) return undefined;
  const root = path.resolve(workspace);
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ReviewError("guidelines path must stay inside the workspace");
  }
  try {
    return await read(resolved);
  } catch (error) {
    if (isNotFound(error)) {
      throw new ReviewError(`Guidelines file not found: ${relativePath}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ReviewError(`Unable to read guidelines file: ${message}`);
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
