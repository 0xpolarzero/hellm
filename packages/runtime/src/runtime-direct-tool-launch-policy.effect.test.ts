import { assert, describe, it } from "@effect/vitest";
import {
  RuntimeCommandStatePort,
  RuntimeContractError,
  type AbsolutePath,
  type BuildLaunchPolicyInput,
  type CommandId,
  type EnvironmentFact,
  type RuntimeCommandRecord,
  type RuntimeCommandStatePortService,
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
    }).pipe(
      Effect.provideService(
        RuntimeCommandStatePort,
        commandStateService(
          committedCommand("exec_command", ["/bin/zsh", "-lc", "git status --short"]),
        ),
      ),
      Effect.provideService(RuntimeLaunchPolicyService, launchPolicyService(calls, facts)),
    );
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
    }).pipe(
      Effect.provideService(
        RuntimeCommandStatePort,
        commandStateService(committedCommand("apply_patch", ["patch", "-p0", "--forward"])),
      ),
      Effect.provideService(RuntimeLaunchPolicyService, launchPolicyService(calls, facts)),
    );
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
    }).pipe(
      Effect.provideService(
        RuntimeCommandStatePort,
        commandStateService(
          committedCommand("execute_typescript", [
            "/usr/local/bin/bun",
            "/tmp/svvy/execute-typescript-runtime.js",
          ]),
        ),
      ),
      Effect.provideService(RuntimeLaunchPolicyService, launchPolicyService(calls, facts)),
    );
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
        RuntimeCommandStatePort,
        commandStateService(committedCommand("exec_command", ["/bin/zsh", "-lc", "pwd"])),
      ),
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
    }).pipe(
      Effect.provideService(
        RuntimeCommandStatePort,
        commandStateService(committedCommand("exec_command", ["/bin/zsh", "-lc", "pwd"])),
      ),
      Effect.provideService(RuntimeLaunchPolicyService, launchPolicyService(calls, facts)),
    );
  });

  it.effect("rejects forged argv, cwd, stale commands, and foreign surfaces", () => {
    const canonicalLaunchCommand = ["/bin/zsh", "-lc", "pwd"];
    const canonical = committedCommand("exec_command", canonicalLaunchCommand);
    const attempts = [
      {
        name: "argv",
        input: { ...launchInput({ toolName: "exec_command", command: ["/bin/sh", "-lc", "id"] }) },
        command: canonical,
      },
      {
        name: "cwd",
        input: {
          ...launchInput({ toolName: "exec_command", command: canonicalLaunchCommand }),
          cwd: "/tmp/forged" as AbsolutePath,
        },
        command: canonical,
      },
      {
        name: "stale",
        input: launchInput({
          toolName: "exec_command",
          command: canonicalLaunchCommand,
        }),
        command: { ...canonical, status: "succeeded" as const },
      },
      {
        name: "surface",
        input: launchInput({
          toolName: "exec_command",
          command: canonicalLaunchCommand,
        }),
        command: {
          ...canonical,
          surfacePiSessionId: "pi_foreign_runtime_direct_tool_launch" as SurfacePiSessionId,
        },
      },
    ];

    return Effect.forEach(attempts, (attempt) =>
      buildRuntimeDirectToolLaunchFacts(attempt.input).pipe(
        Effect.flip,
        Effect.tap((error) =>
          Effect.sync(() => {
            assert.strictEqual(error.reason, "state-conflict", attempt.name);
          }),
        ),
        Effect.provideService(RuntimeCommandStatePort, commandStateService(attempt.command)),
        Effect.provideService(
          RuntimeLaunchPolicyService,
          RuntimeLaunchPolicyService.of({
            build: () => Effect.die(`Forged ${attempt.name} launch reached the sandbox policy.`),
          }),
        ),
      ),
    ).pipe(Effect.asVoid);
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

function committedCommand(
  toolName: "exec_command" | "apply_patch" | "execute_typescript",
  launchCommand: readonly string[],
): RuntimeCommandRecord {
  const payload =
    toolName === "exec_command"
      ? { command: launchCommand.at(-1) }
      : toolName === "apply_patch"
        ? { patch: "--- a\n+++ b" }
        : { typescriptCode: "return 42;" };
  return {
    id: commandId,
    sessionId: "wsess_runtime_direct_tool_launch" as RuntimeCommandRecord["sessionId"],
    turnId: "turn_runtime_direct_tool_launch" as RuntimeCommandRecord["turnId"],
    workflowTaskAttemptId: null,
    surfacePiSessionId,
    threadId: null,
    workflowRunId: null,
    parentCommandId: null,
    toolName,
    executor: "orchestrator",
    visibility: "surface",
    status: "running",
    attempts: 1,
    title: toolName,
    summary: toolName,
    arguments: { ...payload, cwd, launchCommand: [...launchCommand], envFacts } as never,
    facts: null,
    error: null,
    startedAt: "2026-07-08T00:00:00.000Z" as RuntimeCommandRecord["startedAt"],
    updatedAt: "2026-07-08T00:00:00.000Z" as RuntimeCommandRecord["updatedAt"],
    finishedAt: null,
  };
}

function commandStateService(command: RuntimeCommandRecord): RuntimeCommandStatePortService {
  const unused = () => Effect.die("Unexpected command-state operation.");
  return {
    createCommand: unused,
    createOrReuseStreamingCommand: unused,
    findCommandByToolCallId: unused,
    findCommandById: () => Effect.succeed(command),
    updateCommandArguments: unused,
    startCommand: unused,
    finishCommand: unused,
    recordCommandEvent: unused,
    recordStdinWrite: unused,
    hasCommandOutputEvent: unused,
  };
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
