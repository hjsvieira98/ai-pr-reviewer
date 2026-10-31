import type { DiffFile } from "./parse";

export function renderFile(file: DiffFile): string {
  const lines = [`### ${file.path}`];
  for (const hunk of file.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
    for (const line of hunk.lines) {
      if (line.type === "add") {
        lines.push(`+ ${line.newLine} | ${line.text}`);
      } else if (line.type === "delete") {
        lines.push(`- ${line.oldLine} | ${line.text}`);
      } else {
        lines.push(`  ${line.newLine} | ${line.text}`);
      }
    }
  }
  return lines.join("\n");
}

/** Rough budget heuristic: about four characters per token. Not a model tokenizer. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = Math.max(0, maxTokens * 4);
  if (text.length <= maxChars) return text;
  const notice = "\n[diff truncated to fit the token budget]";
  const room = Math.max(0, maxChars - notice.length);
  const sliced = text.slice(0, room);
  const lastNewline = sliced.lastIndexOf("\n");
  const body = lastNewline > 0 ? sliced.slice(0, lastNewline) : sliced;
  const combined = `${body}${notice}`;
  return combined.length <= maxChars ? combined : combined.slice(0, maxChars);
}
