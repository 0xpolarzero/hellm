import { type BuildLaunchPolicyInput, type SandboxLaunchKind } from "@svvy/core";
import * as Effect from "effect/Effect";
import { RuntimeLaunchPolicyService } from "./runtime-launch-policy-service";

export type RuntimeDirectToolLaunchToolName = "exec_command" | "apply_patch" | "execute_typescript";

export type RuntimeDirectToolLaunchPolicyInput = Omit<BuildLaunchPolicyInput, "launchKind"> & {
  readonly toolName: RuntimeDirectToolLaunchToolName;
};

const launchKindByToolName = {
  exec_command: "direct_shell",
  apply_patch: "direct_apply_patch",
  execute_typescript: "execute_typescript_runtime",
} as const satisfies Record<RuntimeDirectToolLaunchToolName, SandboxLaunchKind>;

export const buildRuntimeDirectToolLaunchFacts = Effect.fn(
  "@svvy/runtime/directToolLaunchPolicy.build",
)(function* (input: RuntimeDirectToolLaunchPolicyInput) {
  const launchPolicy = yield* RuntimeLaunchPolicyService;
  const { toolName, ...launchInput } = input;
  return yield* launchPolicy.build({
    ...launchInput,
    launchKind: launchKindByToolName[toolName],
  });
});
