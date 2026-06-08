// smithers-source: user
// smithers-display-name: Review Codex Gemini
/** @jsxImportSource smithers-orchestrator */
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";
import { providers } from "../agents";
import { Review, reviewOutputSchema } from "../components/Review";

const inputSchema = z.object({
  prompt: z.string().default("Review the current repository changes."),
});

const { Workflow, smithers } = createSmithers({
  input: inputSchema,
  review: reviewOutputSchema,
});

const codexGeminiReviewers = [providers.codex, providers.codex1, providers.gemini1];

export default smithers((ctx) => (
  <Workflow name="review-codex-gemini">
    <Review
      idPrefix="review"
      prompt={ctx.input.prompt}
      agents={codexGeminiReviewers}
    />
  </Workflow>
));
