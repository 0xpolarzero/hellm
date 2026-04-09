/** @jsxImportSource smithers-orchestrator */
import { Workflow, createSmithers } from "smithers-orchestrator";
import { z } from "zod";

const inputSchema = z.object({
  workflow: z.object({
    workflowId: z.string(),
    objective: z.string(),
  }),
});

const outputSchema = z.object({
  workflowId: z.string(),
  objective: z.string(),
});

const { smithers } = createSmithers({ result: outputSchema });

export default smithers((ctx) => {
  const input = inputSchema.parse(ctx.input ?? {});

  return (
    <Workflow
      name={`hellm-smoke:${input.workflow.workflowId}`}
      cache={false}
    />
  );
});
