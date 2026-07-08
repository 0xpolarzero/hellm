import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import {
  ExtensionStatePort,
  RuntimeActorExtensionBindingStatePort,
  RuntimeCommandStatePort,
  type AbsolutePath,
  type CommandId,
  type ExtensionId,
  type RuntimeActorExtensionBindingRecord,
  type RuntimeActorExtensionBindingStatePortService,
  type RuntimeCommandStatePortService,
  type StateInvalidationDescriptor,
  type SurfacePiSessionId,
  type ToolCallId,
  type ToolItemId,
  type TurnId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import {
  Extensions,
  layerExtensionSourceRootsPort,
  layerGeneratedPackageRootPort,
  layerPackagedExtensionTemplatesPort,
  layerWorkspaceSourceLinkPort,
  makeExtensions,
} from "@svvy/extensions";
import { runAcceptedLoadExtensionToolCall } from "./load-extension-operation";
import type { Runtime } from "./index";
import { RuntimeEventBus } from "./runtime-event-bus";

type RuntimeSourceInvalidationService = Runtime["Service"]["sourceInvalidation"];

const target = {
  workspaceSessionId: "wsess_load_extension_runtime_01" as WorkspaceSessionId,
  surface: "orchestrator" as const,
  surfacePiSessionId: "pi_load_extension_runtime_01" as SurfacePiSessionId,
};
const turnId = "turn_load_extension_runtime_01" as TurnId;
const commandId = "command_load_extension_runtime_01" as CommandId;
const surfaceInvalidation = {
  scope: "workspace",
  workspaceId: "workspace_load_extension_runtime_01" as WorkspaceId,
  invalidation: { model: "surface", ids: [target.surfacePiSessionId] },
} satisfies StateInvalidationDescriptor;

function stateMutation<T>(value: T, afterCommit: readonly StateInvalidationDescriptor[] = []) {
  return { value, afterCommit };
}

function eventBus(calls: string[]) {
  return RuntimeEventBus.of({
    publishLive: () => Effect.die("Unexpected live event publication."),
    publishStateInvalidations: (input) =>
      Effect.sync(() => {
        calls.push(`publish:${input.afterCommit.length}`);
        return [];
      }),
    subscribe: () => Effect.die("Unexpected runtime event subscription."),
  });
}

describe("load_extension runtime operation", () => {
  it.effect(
    "invokes the package handler, applies actor binding update, refreshes generated context, and finishes the command",
    () =>
      Effect.gen(function* () {
        const updateCalls: Parameters<
          RuntimeActorExtensionBindingStatePortService["updateActorExtensionBinding"]
        >[0][] = [];
        const finishCalls: Parameters<RuntimeCommandStatePortService["finishCommand"]>[0][] = [];
        const refreshCalls: Parameters<
          RuntimeSourceInvalidationService["refreshGeneratedContext"]
        >[0][] = [];
        const eventCalls: string[] = [];
        const bindingStatePort = {
          readRuntimePromptBinding: () => Effect.die("Unexpected runtime prompt binding read."),
          updateActorExtensionBinding: (input) => {
            updateCalls.push(input);
            return Effect.succeed(
              stateMutation(
                {
                  target: input.target,
                  loadedExtensionIds: ["shell" as ExtensionId, input.extensionId],
                  availableExtensionIds: [],
                  generatedAgentContextFingerprint: "fingerprint_after_load_extension",
                  updateExtensionContextBeforeNextTurn: true,
                } satisfies RuntimeActorExtensionBindingRecord,
                [surfaceInvalidation],
              ),
            );
          },
          setActorExtensionBinding: () => Effect.die("Unexpected binding set."),
        } satisfies RuntimeActorExtensionBindingStatePortService;
        const commandStatePort = {
          createCommand: () => Effect.die("Unexpected command create."),
          createOrReuseStreamingCommand: () => Effect.die("Unexpected streaming command create."),
          findCommandByToolCallId: () => Effect.die("Unexpected command lookup by tool call."),
          findCommandById: () => Effect.die("Unexpected command lookup by id."),
          updateCommandArguments: () => Effect.die("Unexpected command argument update."),
          startCommand: () => Effect.die("Unexpected command start."),
          finishCommand: (input) => {
            finishCalls.push(input);
            return Effect.succeed(
              stateMutation({
                id: input.commandId,
                sessionId: target.workspaceSessionId,
                turnId,
                workflowTaskAttemptId: null,
                surfacePiSessionId: target.surfacePiSessionId,
                threadId: null,
                workflowRunId: null,
                parentCommandId: null,
                toolName: "load_extension",
                executor: "orchestrator",
                visibility: "surface",
                status: input.status,
                attempts: 1,
                title: "Load extension",
                summary: input.summary ?? "",
                arguments: null,
                facts: input.facts ?? null,
                error: input.error ?? null,
                startedAt: "2026-04-18T09:00:00.000Z",
                updatedAt: "2026-04-18T09:00:00.000Z",
                finishedAt: "2026-04-18T09:00:01.000Z",
              }),
            );
          },
          recordCommandEvent: () => Effect.die("Unexpected command event."),
          recordStdinWrite: () => Effect.die("Unexpected stdin write."),
          hasCommandOutputEvent: () => Effect.die("Unexpected command output check."),
        } satisfies RuntimeCommandStatePortService;
        const sourceInvalidation = {
          refreshGeneratedContext: (input) => {
            refreshCalls.push(input);
            return Effect.void;
          },
          refreshGeneratedPackages: () => Effect.die("Unexpected generated package refresh."),
        } satisfies Pick<
          RuntimeSourceInvalidationService,
          "refreshGeneratedContext" | "refreshGeneratedPackages"
        >;
        const extensions = yield* makeExtensions().pipe(Effect.provide(testExtensionsPlatform()));

        const result = yield* runAcceptedLoadExtensionToolCall({
          toolCallId: "tool_call_load_extension_runtime_01" as ToolCallId,
          toolItemId: "tool_call_load_extension_runtime_01" as ToolItemId,
          arguments: { extensionId: "smithers" },
          context: {
            workspaceSessionId: target.workspaceSessionId,
            turnId,
            surfacePiSessionId: target.surfacePiSessionId,
            surfaceKind: "orchestrator",
            defaultEpisodeKind: "analysis",
            rootThreadId: null,
            rootEpisodeKind: "analysis",
            sessionWaitApplied: false,
            threadWasTerminalAtStart: false,
            loadedExtensionIds: ["shell"],
            availableExtensionIds: ["smithers"],
            generatedAgentContextFingerprint: "fingerprint",
            generatedAgentContextRevision: "revision",
          },
          actorBinding: {
            loadedExtensionIds: ["shell"],
            availableExtensionIds: ["smithers"],
          },
          command: {
            commandId,
            target,
            turnId,
            approvalMode: "auto-review",
            sandbox: { snapshot: {} },
            cwd: "/tmp/svvy-load-extension-runtime",
            baseEnv: {},
          },
          sourceInvalidation,
        }).pipe(
          Effect.provideService(RuntimeActorExtensionBindingStatePort, bindingStatePort),
          Effect.provideService(RuntimeCommandStatePort, commandStatePort),
          Effect.provideService(Extensions, extensions),
          Effect.provideService(RuntimeEventBus, eventBus(eventCalls)),
        );

        assert.deepStrictEqual(result.toolResult.content, [
          { type: "text", text: "Loaded extension `smithers`." },
        ]);
        assert.deepStrictEqual(updateCalls as unknown, [
          {
            target,
            extensionId: "smithers",
            usage: "loaded",
            reason: "load_extension",
            sourceCommandId: commandId,
          },
        ]);
        assert.deepStrictEqual(refreshCalls as unknown, [
          {
            scope: "target",
            target,
            actorKind: "orchestrator",
            reason: "load-extension",
            sourceCommandId: commandId,
            refreshBoundSurfaceBeforeNextTurn: true,
          },
        ]);
        assert.deepStrictEqual(eventCalls, ["publish:1"]);
        assert.deepStrictEqual(finishCalls, [
          {
            commandId,
            status: "succeeded",
            summary: "Loaded extension smithers for the current actor.",
            facts: {
              type: "load_extension.finished",
              status: "succeeded",
              commandId,
              turnId,
              extensionId: "smithers",
              usage: "loaded",
            },
          },
        ]);
      }),
  );
});

function testExtensionsPlatform() {
  return Layer.mergeAll(
    testEffectPlatformLayer(),
    Layer.succeed(ExtensionStatePort, {
      records: {
        readSourceFingerprint: () => Effect.succeed(null),
      },
      dependencies: {
        isApproved: () => Effect.succeed(false),
        readReadiness: () => Effect.succeed(null),
      },
    }),
    layerExtensionSourceRootsPort({
      extensionsRoot: "/tmp/svvy-load-extension-runtime/extensions" as AbsolutePath,
      workflowsSourceRoot: "/tmp/svvy-load-extension-runtime/workflows" as AbsolutePath,
    }),
    layerPackagedExtensionTemplatesPort({
      builtinExtensionsRoot: "/tmp/svvy-load-extension-runtime/packaged-extensions" as AbsolutePath,
    }),
    layerGeneratedPackageRootPort({
      extensionsPackageRoot:
        "/tmp/svvy-load-extension-runtime/generated/extensions" as AbsolutePath,
      workflowsPackageRoot: "/tmp/svvy-load-extension-runtime/generated/workflows" as AbsolutePath,
      coreTypeContractPackageRoot:
        "/tmp/svvy-load-extension-runtime/generated/core-type-contract" as AbsolutePath,
    }),
    layerWorkspaceSourceLinkPort({
      generatedPackageLinkPath: ({ workspaceId, packageName }) =>
        Effect.succeed(
          `/tmp/svvy-load-extension-runtime/workspaces/${workspaceId}/node_modules/${packageName}` as AbsolutePath,
        ),
    }),
  );
}

function testEffectPlatformLayer() {
  return Layer.mergeAll(
    Layer.succeed(FileSystem.FileSystem, {} as unknown as FileSystem.FileSystem),
    Layer.succeed(Path.Path, {
      basename: (path: string) => path.split("/").at(-1) ?? path,
      dirname: (path: string) => {
        const parts = path.split("/");
        parts.pop();
        return parts.join("/") || "/";
      },
      join: (...segments: readonly string[]) => segments.join("/").replaceAll(/\/+/g, "/"),
    } as unknown as Path.Path),
    Layer.succeed(
      Crypto.Crypto,
      Crypto.make({
        digest: (_algorithm, data) => Effect.succeed(data),
        randomBytes: (size) => new Uint8Array(size).fill(1),
      }),
    ),
  );
}
