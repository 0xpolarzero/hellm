import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static } from "@sinclair/typebox";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import type { StructuredSessionStateStore } from "./structured-session-state";

export const VERIFY_RUN_TOOL_NAME = "verification.run";

const verificationKindSchema = Type.Union([
  Type.Literal("typecheck"),
  Type.Literal("lint"),
  Type.Literal("build"),
  Type.Literal("integration"),
  Type.Literal("test"),
]);

export const verifyRunParamsSchema = Type.Object(
  {
    kind: verificationKindSchema,
    target: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type VerifyRunParams = Static<typeof verifyRunParamsSchema>;

const VERIFY_RUN_DEPRECATION_MESSAGE =
  "verification.run is deprecated. Start or resume a verification workflow template or preset instead.";

const VERIFY_RUN_TOOL_DESCRIPTION = [
  "Deprecated compatibility stub.",
  "Verification is workflow-shaped execution in svvy and should run through workflow.start or workflow.resume using a verification workflow template or preset.",
].join(" ");

export function createVerifyRunTool(options: {
  cwd: string;
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
}): AgentTool<typeof verifyRunParamsSchema, Record<string, unknown>> {
  void options.cwd;
  void options.store;

  return {
    label: "Verification",
    name: VERIFY_RUN_TOOL_NAME,
    description: VERIFY_RUN_TOOL_DESCRIPTION,
    parameters: verifyRunParamsSchema,
    execute: async () => {
      if (!options.runtime.current) {
        throw new Error(`${VERIFY_RUN_TOOL_NAME} can only run during an active prompt.`);
      }

      throw new Error(VERIFY_RUN_DEPRECATION_MESSAGE);
    },
  };
}
