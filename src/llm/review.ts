import { ReviewError } from "../errors";
import type { LlmReview } from "../types";
import { parseModelPayload } from "./schema";
import type { LlmClient } from "./providers";

export interface StructuredReviewer {
  review(input: { system: string; user: string }): Promise<LlmReview>;
}

const MAX_ATTEMPTS = 2;

export function createStructuredReviewer(client: LlmClient): StructuredReviewer {
  return {
    async review(input) {
      let user = input.user;
      let lastError = "Model output did not match the review schema";
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const output = await client.generate({ system: input.system, user });
        const parsed = parseModelPayload(output);
        if (parsed.ok) return parsed.review;
        lastError = parsed.error;
        user = `${input.user}\n\nYour previous response was invalid: ${lastError.slice(0, 1_000)}\nReturn only the JSON object.`;
      }
      throw new ReviewError(`The model did not return a valid review: ${lastError}`);
    },
  };
}
