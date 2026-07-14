import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  SandboxPolicyError,
  SandboxPolicySource,
  type AbsolutePath,
  type CommandId,
  type GeneratedPackageBuildId,
  type WorkspaceId,
} from "@svvy/core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { runTestEffect } from "./effect.test-support";
import {
  layerSandboxPolicySource,
  layerSandboxPolicySourceWithConfig,
  type SandboxPolicySourceConfig,
} from "./sandbox-policy-source";
import { StructuredSessionState, layerStructuredSessionState } from "./structured-session-state";

const workspaceId = "workspace_sandbox_policy_source" as WorkspaceId;
const commandId = "cmd_sandbox_policy_source" as CommandId;
const workspaceCwd = "/tmp/svvy-policy-source/workspace" as AbsolutePath;
const artifactDir = "/tmp/svvy-policy-source/artifacts" as AbsolutePath;
const resolvedAt = "2026-04-18T09:00:00.000Z";
const absolutePath = (value: string): AbsolutePath => value as AbsolutePath;
const testDigest = {
  sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
};

function stateLayer() {
  return layerStructuredSessionState({
    digest: testDigest,
    workspace: {
      id: workspaceId,
      label: "Sandbox policy source",
      cwd: workspaceCwd,
      artifactDir,
    },
    now: () => resolvedAt,
  });
}

function testLayer() {
  const state = stateLayer();
  return Layer.mergeAll(state, layerSandboxPolicySource.pipe(Layer.provide(state)));
}

function testLayerWithConfig(config: SandboxPolicySourceConfig) {
  const state = stateLayer();
  return Layer.mergeAll(
    state,
    layerSandboxPolicySourceWithConfig(config).pipe(Layer.provide(state)),
  );
}

describe("sandbox policy source", () => {
  it("builds immutable workspace policy snapshots from structured session state", async () => {
    await runTestEffect(
      Effect.gen(function* () {
        const source = yield* SandboxPolicySource;
        const snapshot = yield* source.snapshot({
          scope: { kind: "workspace", workspaceId },
          commandId,
          launchKind: "direct_shell",
          cwd: workspaceCwd,
        });

        expect(snapshot.resolvedAt as string).toBe(resolvedAt);
        expect(snapshot.scope).toEqual({ kind: "workspace", workspaceId });
        expect(snapshot.commandId).toBe(commandId);
        expect(snapshot.launchKind).toBe("direct_shell");
        expect(snapshot.cwd).toBe(workspaceCwd);
        expect(snapshot.sandboxMode).toBe("managed");
        expect(snapshot.networkPolicy).toBe("allow");
        expect(snapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(snapshot.profileDigest).toBeUndefined();
        expect(snapshot.filesystemPolicy).toEqual({
          defaultAccess: "read",
          entries: [
            {
              access: "write",
              path: artifactDir,
              recursive: true,
              source: "artifact",
            },
            {
              access: "write",
              path: workspaceCwd,
              recursive: true,
              source: "workspace",
            },
          ],
        });
      }).pipe(Effect.provide(testLayer())),
    );
  });

  it("denies network access from persisted app preferences", async () => {
    await runTestEffect(
      Effect.gen(function* () {
        const state = yield* StructuredSessionState;
        yield* state.updateAppPreferences({
          networkAccess: false,
          updatedAt: resolvedAt,
        });

        const source = yield* SandboxPolicySource;
        const snapshot = yield* source.snapshot({
          scope: { kind: "workspace", workspaceId },
          commandId,
          launchKind: "direct_shell",
          cwd: workspaceCwd,
        });

        expect(snapshot.sandboxMode).toBe("managed");
        expect(snapshot.networkPolicy).toBe("deny");
      }).pipe(Effect.provide(testLayer())),
    );
  });

  it("omits sandboxing for full-access app preferences", async () => {
    await runTestEffect(
      Effect.gen(function* () {
        const state = yield* StructuredSessionState;
        yield* state.updateAppPreferences({
          approvalMode: "full-access",
          networkAccess: false,
          updatedAt: resolvedAt,
        });

        const source = yield* SandboxPolicySource;
        const snapshot = yield* source.snapshot({
          scope: { kind: "workspace", workspaceId },
          commandId,
          launchKind: "direct_shell",
          cwd: workspaceCwd,
        });

        expect(snapshot.sandboxMode).toBe("omitted_full_access");
        expect(snapshot.networkPolicy).toBe("allow");
        expect(snapshot.filesystemPolicy).toEqual({
          defaultAccess: "read",
          entries: [],
        });
      }).pipe(Effect.provide(testLayer())),
    );
  });

  it("reads current app preferences from explicit policy input without copying workspace state", async () => {
    let currentAppPreferences: {
      approvalMode: "auto-review" | "user" | "full-access";
      networkAccess: boolean;
    } = {
      approvalMode: "full-access",
      networkAccess: false,
    };
    await runTestEffect(
      Effect.gen(function* () {
        const state = yield* StructuredSessionState;
        expect(yield* state.readAppPreferences()).toMatchObject({
          approvalMode: "auto-review",
          networkAccess: true,
        });

        const source = yield* SandboxPolicySource;
        const fullAccess = yield* source.snapshot({
          scope: { kind: "workspace", workspaceId },
          commandId,
          launchKind: "direct_shell",
          cwd: workspaceCwd,
        });
        expect(fullAccess).toMatchObject({
          sandboxMode: "omitted_full_access",
          networkPolicy: "allow",
          filesystemPolicy: { defaultAccess: "read", entries: [] },
        });

        currentAppPreferences = {
          approvalMode: "auto-review",
          networkAccess: false,
        };
        const managed = yield* source.snapshot({
          scope: { kind: "workspace", workspaceId },
          commandId,
          launchKind: "direct_shell",
          cwd: workspaceCwd,
        });
        expect(managed).toMatchObject({
          sandboxMode: "managed",
          networkPolicy: "deny",
        });
      }).pipe(
        Effect.provide(
          testLayerWithConfig({
            currentAppPreferences: () => currentAppPreferences,
          }),
        ),
      ),
    );
  });

  it("builds generated-package link-repair snapshots from committed package facts", async () => {
    await runTestEffect(
      Effect.gen(function* () {
        const state = yield* StructuredSessionState;
        yield* state.recordGeneratedPackageBuild({
          status: {
            packageName: "@svvyx/workflows",
            action: "written",
            refreshScope: "app-global-build",
            buildId: "generated_package_build_policy_source" as GeneratedPackageBuildId,
            manifestPath:
              "/tmp/svvy-policy-source/app-generated/workflows/package.json" as AbsolutePath,
            sourceFingerprint: "source-fingerprint",
            outputFingerprint: "output-fingerprint",
            generatedFiles: [],
            dependencies: [],
            diagnostics: [],
          },
          workflowsExports: [],
        });

        const source = yield* SandboxPolicySource;
        const snapshot = yield* source.snapshot({
          scope: {
            kind: "workspace-generated-package-link",
            workspaceId,
            packageName: "@svvyx/workflows",
          },
          commandId,
          launchKind: "workspace_generated_package_link_repair",
          cwd: workspaceCwd,
        });

        expect({
          scope: snapshot.scope,
          launchKind: snapshot.launchKind,
          networkPolicy: snapshot.networkPolicy,
          sandboxMode: snapshot.sandboxMode,
        }).toEqual({
          scope: {
            kind: "workspace-generated-package-link",
            workspaceId,
            packageName: "@svvyx/workflows",
          },
          launchKind: "workspace_generated_package_link_repair",
          networkPolicy: "allow",
          sandboxMode: "managed",
        });
        expect(snapshot.filesystemPolicy.entries).toEqual([
          {
            access: "read",
            path: absolutePath("/tmp/svvy-policy-source/app-generated/workflows"),
            recursive: true,
            source: "generated-output",
          },
          {
            access: "write",
            path: absolutePath(
              "/tmp/svvy-policy-source/workspace/.smithers/node_modules/@svvyx/workflows",
            ),
            recursive: true,
            source: "generated-output",
          },
        ]);
      }).pipe(Effect.provide(testLayer())),
    );
  });

  it("fails closed when generated package roots are missing from state", async () => {
    await runTestEffect(
      Effect.gen(function* () {
        const source = yield* SandboxPolicySource;
        const error = yield* source
          .snapshot({
            scope: {
              kind: "workspace-generated-package-link",
              workspaceId,
              packageName: "@svvyx/extensions",
            },
            commandId,
            launchKind: "workspace_generated_package_link_repair",
            cwd: workspaceCwd,
          })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(SandboxPolicyError);
      }).pipe(Effect.provide(testLayer())),
    );
  });

  it("adds configured generated-output and temporary roots to workspace snapshots", async () => {
    await runTestEffect(
      Effect.gen(function* () {
        const source = yield* SandboxPolicySource;
        const snapshot = yield* source.snapshot({
          scope: { kind: "workspace", workspaceId },
          commandId,
          launchKind: "direct_shell",
          cwd: workspaceCwd,
        });

        expect(snapshot.filesystemPolicy.entries).toEqual([
          {
            access: "write",
            path: artifactDir,
            recursive: true,
            source: "artifact",
          },
          {
            access: "read",
            path: absolutePath("/tmp/svvy-policy-source/generated/core-type-contract-package"),
            recursive: true,
            source: "generated-output",
          },
          {
            access: "write",
            path: absolutePath("/tmp/svvy-policy-source/tmp"),
            recursive: true,
            source: "temporary",
          },
          {
            access: "write",
            path: workspaceCwd,
            recursive: true,
            source: "workspace",
          },
        ]);
      }).pipe(
        Effect.provide(
          testLayerWithConfig({
            generatedOutputRoots: [
              "/tmp/svvy-policy-source/generated/core-type-contract-package" as AbsolutePath,
            ],
            temporaryRoots: ["/tmp/svvy-policy-source/tmp" as AbsolutePath],
          }),
        ),
      ),
    );
  });

  it("adds configured extension dependency roots to app-global dependency snapshots", async () => {
    await runTestEffect(
      Effect.gen(function* () {
        const source = yield* SandboxPolicySource;
        const snapshot = yield* source.snapshot({
          scope: { kind: "app-global-extension-dependency", originWorkspaceId: workspaceId },
          commandId,
          launchKind: "extension_dependency_action",
          cwd: workspaceCwd,
        });

        expect(snapshot.filesystemPolicy.entries).toEqual([
          {
            access: "write",
            path: absolutePath("/tmp/svvy-policy-source/extensions/dependencies"),
            recursive: true,
            source: "app-runtime",
          },
          {
            access: "write",
            path: absolutePath("/tmp/svvy-policy-source/tmp"),
            recursive: true,
            source: "temporary",
          },
        ]);
      }).pipe(
        Effect.provide(
          testLayerWithConfig({
            extensionDependencyRoots: [
              "/tmp/svvy-policy-source/extensions/dependencies" as AbsolutePath,
            ],
            temporaryRoots: ["/tmp/svvy-policy-source/tmp" as AbsolutePath],
          }),
        ),
      ),
    );
  });

  it("fails closed when a workspace scope targets a different state workspace", async () => {
    await runTestEffect(
      Effect.gen(function* () {
        const source = yield* SandboxPolicySource;
        const error = yield* source
          .snapshot({
            scope: { kind: "workspace", workspaceId: "workspace_other" as WorkspaceId },
            commandId,
            launchKind: "direct_shell",
            cwd: workspaceCwd,
          })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(SandboxPolicyError);
      }).pipe(Effect.provide(testLayer())),
    );
  });
});
