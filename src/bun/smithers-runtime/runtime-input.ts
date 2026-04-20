import { z } from "zod";

// Smithers stores workflow input in one shared `input` table per runtime DB. Bundled product
// workflows therefore share one permissive runtime input table shape, while svvy validates each
// workflow's concrete launch input before execution and narrows it again when the workflow reads it.
//
// The shared table uses a single `payload` object so Smithers can carry `__smithersContinuation`
// across continue-as-new runs inside the normalized workflow input value.
export const smithersRuntimeInputSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
});

export function readSmithersWorkflowInput<Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: unknown,
): z.infer<Schema> {
  return schema.parse(input);
}
