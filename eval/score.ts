import type { Category } from "../src/types";

export interface SeededIssue {
  id: string;
  file: string;
  category: Category;
  line: number;
  tolerance?: number;
}

export interface ScoredFinding {
  file: string;
  line: number;
  category: Category;
}

export interface CaseScore {
  caught: SeededIssue[];
  missed: SeededIssue[];
  unmatched: ScoredFinding[];
}

const DEFAULT_TOLERANCE = 2;

/**
 * A finding catches a seed when the file and category match and the line is
 * within the seed's tolerance. Each seed and each finding is used at most once.
 */
export function scoreCase(seeds: SeededIssue[], findings: ScoredFinding[]): CaseScore {
  const remaining = [...findings];
  const caught: SeededIssue[] = [];
  const missed: SeededIssue[] = [];

  for (const seed of seeds) {
    const tolerance = seed.tolerance ?? DEFAULT_TOLERANCE;
    const index = remaining.findIndex((finding) => {
      return (
        finding.file === seed.file &&
        finding.category === seed.category &&
        Math.abs(finding.line - seed.line) <= tolerance
      );
    });
    if (index === -1) {
      missed.push(seed);
      continue;
    }
    caught.push(seed);
    remaining.splice(index, 1);
  }

  return { caught, missed, unmatched: remaining };
}
