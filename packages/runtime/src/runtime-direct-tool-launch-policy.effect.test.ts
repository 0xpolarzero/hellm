import { assert, describe, it } from "@effect/vitest";
import {
  RuntimeContractError,
  type AbsolutePath,
  type BuildLaunchPolicyInput,
  type CommandId,
  type EnvironmentFact,
  type SandboxLaunchFacts,
  type SandboxPolicySnapshot,
  type SurfacePiSessionId,
  type WorkspaceId,
} from "@svvy/core";
import * as Effect from "effect/Effect";
import { RuntimeLaunchPolicyService } from "./runtime-launch-policy-service";
import {
  buildRuntimeDirectToolLaunchFacts,
  type RuntimeDirectToolLaunchPolicyInput,
} from "./runtime-direct-tool-launch-policy";

const workspaceId = "workspace_runtime_direct_tool_launch" as WorkspaceId;
const surfacePiSessionId = "pi_runtime_direct_tool_launch" as SurfacePiSessionId;
const commandId = "command_runtime_direct_tool_launch" as CommandId;
const cwd = "/workspace/runtime-direct-tool-launch" as AbsolutePath;
const envFacts = [
  {
    key: "PATH",
    valueFingerprint: "fingerprint_path",
    redactionLabel: "path",
  },
] satisfies EnvironmentFact[];

describe("runtime direct tool launch policy", () => {
  it.effect("maps exec_command to direct shell launch facts", () => {
    const calls: BuildLaunchPolicyInput[] = [];
    const facts = testLaunchFacts("direct_shell");

    return Effect.gen(function* () {
      const result = yield* buildRuntimeDirectToolLaunchFacts(
        launchInput({
          toolName: "exec_command",
          command: ["/bin/zsh", "-lc", "git status --short"],
        }),
      );

      assert.strictEqual(result, facts);
      assert.deepStrictEqual(calls, [
        {
          scope: { kind: "workspace", workspaceId },
          surfacePiSessionId,
          commandId,
          launchKind: "direct_shell",
          command: ["/bin/zsh", "-lc", "git status --short"],
          cwd,
          envFacts,
        },
      ]);
    }).pipe(Effect.provideService(RuntimeLaunchPolicyService, launchPolicyService(calls, facts)));
  });

  it.effect("maps apply_patch to direct apply-patch launch facts", () => {
    const calls: BuildLaunchPolicyInput[] = [];
    const facts = testLaunchFacts("direct_apply_patch");

    return Effect.gen(function* () {
      const result = yield* buildRuntimeDirectToolLaunchFacts(
        launchInput({
          toolName: "apply_patch",
          command: ["patch", "-p0", "--forward"],
        }),
      );

      assert.strictEqual(result, facts);
      assert.deepStrictEqual(calls, [
        {
          scope: { kind: "workspace", workspaceId },
          surfacePiSessionId,
          commandId,
          launchKind: "direct_apply_patch",
          command: ["patch", "-p0", "--forward"],
          cwd,
          envFacts,
        },
      ]);
    }).pipe(Effect.provideService(RuntimeLaunchPolicyService, launchPolicyService(calls, facts)));
  });

  it.effect("maps execute_typescript to execute_typescript_runtime launch facts", () => {
    const calls: BuildLaunchPolicyInput[] = [];
    const facts = testLaunchFacts("execute_typescript_runtime");

    return Effect.gen(function* () {
      const result = yield* buildRuntimeDirectToolLaunchFacts(
        launchInput({
          toolName: "execute_typescript",
          command: ["/usr/local/bin/bun", "/tmp/svvy/execute-typescript-runtime.js"],
        }),
      );

      assert.strictEqual(result, facts);
      assert.deepStrictEqual(calls, [
        {
          scope: { kind: "workspace", workspaceId },
          surfacePiSessionId,
          commandId,
          launchKind: "execute_typescript_runtime",
          command: ["/usr/local/bin/bun", "/tmp/svvy/execute-typescript-runtime.js"],
          cwd,
          envFacts,
        },
      ]);
    }).pipe(Effect.provideService(RuntimeLaunchPolicyService, launchPolicyService(calls, facts)));
  });

  it.effect("passes runtime launch-policy failures through unchanged", () => {
    const failure = new RuntimeContractError({
      operation: "runtime.launchPolicy.build",
      reason: "target-not-ready",
      message: "sandbox helper missing",
    });

    return Effect.gen(function* () {
      const error = yield* buildRuntimeDirectToolLaunchFacts(
        launchInput({
          toolName: "exec_command",
          command: ["/bin/zsh", "-lc", "pwd"],
        }),
      ).pipe(Effect.flip);

      assert.strictEqual(error, failure);
    }).pipe(
      Effect.provideService(
        RuntimeLaunchPolicyService,
        RuntimeLaunchPolicyService.of({
          build: () => Effect.fail(failure),
        }),
      ),
    );
  });

  it.effect("passes caller-supplied sandbox snapshots through unchanged", () => {
    const calls: BuildLaunchPolicyInput[] = [];
    const snapshot = testPolicySnapshot("direct_shell");
    const facts = testLaunchFacts("direct_shell");

    return Effect.gen(function* () {
      yield* buildRuntimeDirectToolLaunchFacts({
        ...launchInput({
          toolName: "exec_command",
          command: ["/bin/zsh", "-lc", "pwd"],
        }),
        snapshot,
      });

      assert.strictEqual(calls[0]?.snapshot, snapshot);
    }).pipe(Effect.provideService(RuntimeLaunchPolicyService, launchPolicyService(calls, facts)));
  });
});

function launchInput(input: {
  readonly toolName: RuntimeDirectToolLaunchPolicyInput["toolName"];
  readonly command: string[];
}): RuntimeDirectToolLaunchPolicyInput {
  return {
    scope: { kind: "workspace", workspaceId },
    surfacePiSessionId,
    commandId,
    toolName: input.toolName,
    command: input.command,
    cwd,
    envFacts,
  };
}

function launchPolicyService(
  calls: BuildLaunchPolicyInput[],
  facts: SandboxLaunchFacts,
): RuntimeLaunchPolicyService["Service"] {
  return RuntimeLaunchPolicyService.of({
    build: (input) =>
      Effect.sync(() => {
        calls.push(input);
        return facts;
      }),
  });
}

function testLaunchFacts(launchKind: SandboxPolicySnapshot["launchKind"]): SandboxLaunchFacts {
  return {
    mode: "omitted_full_access",
    spawn: {
      executable: "/usr/bin/env" as AbsolutePath,
      args: [],
      cwd,
      envFacts,
    },
    policySnapshot: testPolicySnapshot(launchKind),
  };
}

function testPolicySnapshot(
  launchKind: SandboxPolicySnapshot["launchKind"],
): SandboxPolicySnapshot {
  return {
    snapshotId: `snapshot_${launchKind}`,
    fingerprint: `fingerprint_${launchKind}`,
    resolvedAt: "2026-07-08T00:00:00.000Z" as SandboxPolicySnapshot["resolvedAt"],
    scope: { kind: "workspace", workspaceId },
    surfacePiSessionId,
    commandId,
    launchKind,
    cwd,
    sandboxMode: "omitted_full_access",
    networkPolicy: "deny",
    filesystemPolicy: {
      defaultAccess: "none",
      entries: [],
    },
  };
}
