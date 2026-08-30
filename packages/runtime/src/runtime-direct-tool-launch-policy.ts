import {
  RuntimeCommandStatePort,
  RuntimeContractError,
  type BuildLaunchPolicyInput,
  type EnvironmentFact,
  type RuntimeCommandRecord,
  type SandboxLaunchKind,
} from "@svvy/core";
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
  const commandState = yield* RuntimeCommandStatePort;
  const command = yield* commandState.findCommandById({ commandId: input.commandId }).pipe(
    Effect.mapError(
      (cause) =>
        new RuntimeContractError({
          operation: "runtime.directToolLaunchPolicy.loadCommand",
          reason: "state-conflict",
          message: "Unable to load the committed direct-tool command.",
          cause,
        }),
    ),
  );
  if (!command) {
    return yield* Effect.fail(
      new RuntimeContractError({
        operation: "runtime.directToolLaunchPolicy.loadCommand",
        reason: "target-not-found",
        message: `Direct-tool command ${input.commandId} does not exist.`,
      }),
    );
  }
  const canonical = canonicalDirectToolLaunch(command, input.toolName);
  if (!canonical || !directToolLaunchInputMatches(input, command, canonical)) {
    return yield* Effect.fail(
      new RuntimeContractError({
        operation: "runtime.directToolLaunchPolicy.bindCommand",
        reason: "state-conflict",
        message: "Direct-tool launch facts do not match the running committed command.",
      }),
    );
  }
  const { toolName, ...launchInput } = input;
  return yield* launchPolicy.build({
    ...launchInput,
    command: canonical.command,
    cwd: canonical.cwd as BuildLaunchPolicyInput["cwd"],
    envFacts: canonical.envFacts,
    launchKind: launchKindByToolName[toolName],
  });
});

type CanonicalDirectToolLaunch = {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly envFacts: readonly EnvironmentFact[];
};

function canonicalDirectToolLaunch(
  command: RuntimeCommandRecord,
  toolName: RuntimeDirectToolLaunchToolName,
): CanonicalDirectToolLaunch | null {
  if (
    command.status !== "running" ||
    command.toolName !== toolName ||
    !command.arguments ||
    typeof command.arguments !== "object" ||
    Array.isArray(command.arguments)
  ) {
    return null;
  }
  const args = command.arguments as Record<string, unknown>;
  if (
    typeof args.cwd !== "string" ||
    !Array.isArray(args.launchCommand) ||
    !args.launchCommand.every((value) => typeof value === "string") ||
    !Array.isArray(args.envFacts)
  ) {
    return null;
  }
  const envFacts = args.envFacts as EnvironmentFact[];
  if (
    envFacts.some(
      (fact) =>
        !fact ||
        typeof fact !== "object" ||
        typeof fact.key !== "string" ||
        typeof fact.valueFingerprint !== "string" ||
        typeof fact.redactionLabel !== "string",
    )
  ) {
    return null;
  }
  const payload =
    toolName === "exec_command"
      ? args.command
      : toolName === "apply_patch"
        ? args.patch
        : args.typescriptCode;
  if (typeof payload !== "string" || payload.length === 0) return null;
  return {
    command: args.launchCommand,
    cwd: args.cwd,
    envFacts,
  };
}

function directToolLaunchInputMatches(
  input: RuntimeDirectToolLaunchPolicyInput,
  command: RuntimeCommandRecord,
  canonical: CanonicalDirectToolLaunch,
): boolean {
  return (
    input.scope.kind === "workspace" &&
    input.commandId === command.id &&
    input.surfacePiSessionId === command.surfacePiSessionId &&
    input.cwd === canonical.cwd &&
    JSON.stringify(input.command) === JSON.stringify(canonical.command) &&
    JSON.stringify(input.envFacts) === JSON.stringify(canonical.envFacts)
  );
}
