import { describe, expect, it } from "bun:test";
import {
  SandboxPolicyError,
  SandboxPolicySource,
  type AbsolutePath,
  type CommandId,
  type WorkspaceId,
} from "@svvy/core";
import * as Effect from "effect/Effect";
import { runTestEffect } from "./effect.test-support";
import { layerSandboxPolicySource, sandboxPolicySourceFromSettings } from "./sandbox-policy-source";

const workspaceId = "workspace_sandbox_policy_source" as WorkspaceId;
const commandId = "cmd_sandbox_policy_source" as CommandId;
const absolutePath = (value: string): AbsolutePath => value as AbsolutePath;

describe("sandbox policy source", () => {
  it("builds immutable workspace policy snapshots from state-owned settings", async () => {
    const source = sandboxPolicySourceFromSettings({
      workspace: {
        id: workspaceId,
        cwd: "/tmp/svvy-policy-source/workspace" as AbsolutePath,
        artifactDir: "/tmp/svvy-policy-source/artifacts" as AbsolutePath,
      },
      appPreferences: {
        approvalMode: "auto-review",
        networkAccess: false,
      },
      generatedOutputRoots: ["/tmp/svvy-policy-source/generated" as AbsolutePath],
      temporaryRoots: ["/tmp/svvy-policy-source/tmp" as AbsolutePath],
      now: () => "2026-04-18T09:00:00.000Z",
    });

    const snapshot = await runTestEffect(
      source.snapshot({
        scope: { kind: "workspace", workspaceId },
        commandId,
        launchKind: "direct_shell",
        cwd: "/tmp/svvy-policy-source/workspace" as AbsolutePath,
      }),
    );

    expect(snapshot).toMatchObject({
      resolvedAt: "2026-04-18T09:00:00.000Z",
      scope: { kind: "workspace", workspaceId },
      commandId,
      launchKind: "direct_shell",
      cwd: "/tmp/svvy-policy-source/workspace",
      sandboxMode: "managed",
      networkPolicy: "deny",
    });
    expect(snapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.filesystemPolicy).toEqual({
      defaultAccess: "read",
      entries: [
        {
          access: "write",
          path: absolutePath("/tmp/svvy-policy-source/artifacts"),
          recursive: true,
          source: "artifact",
        },
        {
          access: "read",
          path: absolutePath("/tmp/svvy-policy-source/generated"),
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
          path: absolutePath("/tmp/svvy-policy-source/workspace"),
          recursive: true,
          source: "workspace",
        },
      ],
    });
  });

  it("builds workspace generated-package link-repair snapshots through the Effect layer", async () => {
    const snapshot = await runTestEffect(
      Effect.gen(function* () {
        const source = yield* SandboxPolicySource;
        return yield* source.snapshot({
          scope: {
            kind: "workspace-generated-package-link",
            workspaceId,
            packageName: "@svvyx/workflows",
          },
          commandId,
          launchKind: "workspace_generated_package_link_repair",
          cwd: "/tmp/svvy-policy-source/workspace" as AbsolutePath,
        });
      }).pipe(
        Effect.provide(
          layerSandboxPolicySource({
            workspace: {
              id: workspaceId,
              cwd: "/tmp/svvy-policy-source/workspace" as AbsolutePath,
            },
            appPreferences: {
              approvalMode: "user",
              networkAccess: true,
            },
            generatedPackageRoots: {
              "@svvyx/workflows": "/tmp/svvy-policy-source/app-generated/workflows" as AbsolutePath,
            },
            now: () => "2026-04-18T09:00:00.000Z",
          }),
        ),
      ),
    );

    expect(snapshot).toMatchObject({
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
  });

  it("fails closed when generated package roots are missing", async () => {
    const source = sandboxPolicySourceFromSettings({
      workspace: {
        id: workspaceId,
        cwd: "/tmp/svvy-policy-source/workspace" as AbsolutePath,
      },
      appPreferences: {},
    });

    await expect(
      runTestEffect(
        source.snapshot({
          scope: {
            kind: "workspace-generated-package-link",
            workspaceId,
            packageName: "@svvyx/extensions",
          },
          commandId,
          launchKind: "workspace_generated_package_link_repair",
          cwd: "/tmp/svvy-policy-source/workspace" as AbsolutePath,
        }),
      ),
    ).rejects.toBeInstanceOf(SandboxPolicyError);
  });
});
