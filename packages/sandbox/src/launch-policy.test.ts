import { describe, expect, it } from "bun:test";
import {
  buildDirectToolLaunchPolicy,
  buildExecuteTypescriptLaunchPolicy,
  buildSvvyxLaunchPolicy,
  resolveSandboxLaunchSettings,
  sandboxLaunchFacts,
} from "./launch-policy";
import { canReadFileSystemPath, canWriteFileSystemPath } from "./filesystem-sandbox-policy";

describe("sandbox launch policy", () => {
  it("resolves full-access as no managed sandbox and unrestricted network", () => {
    expect(
      resolveSandboxLaunchSettings({
        approvalMode: "full-access",
        managedSandbox: true,
        networkAccess: false,
      }),
    ).toEqual({
      fullAccess: true,
      managedSandbox: false,
      networkAccess: true,
    });

    const launch = buildExecuteTypescriptLaunchPolicy({
      approvalMode: "full-access",
      cwd: "/workspace",
      managedSandbox: true,
      networkAccess: false,
    });

    expect(launch.fileSystemPolicy).toEqual({ kind: "unrestricted", entries: [] });
    expect(launch.managedSandbox).toBe(false);
    expect(launch.networkAccess).toBe(true);
  });

  it("builds direct tool workspace policy from explicit caller-owned roots", () => {
    const launch = buildDirectToolLaunchPolicy({
      cwd: "/workspace",
      workflowsSourceRoot: "/app/workflows/sources",
      extensionsSourceRoot: "/app/extensions/sources",
      extensionsPackageRoot: "/app/extensions/package",
      protectedRoots: ["/workspace/.smithers/node_modules/@svvyx/workflows"],
      alwaysProtectedRoots: ["/artifacts/session_01/immutable"],
      allowedRoots: ["/artifacts/session_01"],
      tmpdir: "/var/tmp/svvy",
    });

    expect(launch.managedSandbox).toBe(true);
    expect(launch.networkAccess).toBe(true);
    expect(
      canWriteFileSystemPath(launch.fileSystemPolicy, "/workspace/src/file.ts", "/workspace"),
    ).toBe(true);
    expect(
      canWriteFileSystemPath(
        launch.fileSystemPolicy,
        "/workspace/.smithers/node_modules/@svvyx/workflows/index.ts",
        "/workspace",
      ),
    ).toBe(false);
    expect(
      canWriteFileSystemPath(
        launch.fileSystemPolicy,
        "/app/extensions/sources/user/ext/a.ts",
        "/workspace",
      ),
    ).toBe(true);
    expect(
      canWriteFileSystemPath(launch.fileSystemPolicy, "/artifacts/session_01/a.txt", "/workspace"),
    ).toBe(true);
    expect(
      canWriteFileSystemPath(
        launch.fileSystemPolicy,
        "/artifacts/session_01/immutable/a.txt",
        "/workspace",
      ),
    ).toBe(false);
    expect(
      canWriteFileSystemPath(launch.fileSystemPolicy, "/var/tmp/svvy/a.txt", "/workspace"),
    ).toBe(true);
  });

  it("builds svvyx policy that can read generated package roots and write app extension roots", () => {
    const launch = buildSvvyxLaunchPolicy({
      cwd: "/workspace",
      workflowsSourceRoot: "/app/workflows/sources",
      workflowsGeneratedPackagePath: "/app/workflows/generated/package",
      extensionsGeneratedPackagePath: "/app/extensions/generated/package",
      extensionsRoot: "/app/extensions",
      artifactAllowedRoots: ["/artifacts/session_01"],
      networkAccess: false,
    });

    expect(launch.networkAccess).toBe(false);
    expect(
      canWriteFileSystemPath(
        launch.fileSystemPolicy,
        "/app/workflows/generated/package/index.ts",
        "/workspace",
      ),
    ).toBe(false);
    expect(
      canReadFileSystemPath(
        launch.fileSystemPolicy,
        "/app/workflows/generated/package/index.ts",
        "/workspace",
      ),
    ).toBe(true);
    expect(
      canWriteFileSystemPath(
        launch.fileSystemPolicy,
        "/app/extensions/generated/package/index.ts",
        "/workspace",
      ),
    ).toBe(false);
    expect(
      canReadFileSystemPath(
        launch.fileSystemPolicy,
        "/app/extensions/generated/package/index.ts",
        "/workspace",
      ),
    ).toBe(true);
    expect(
      canWriteFileSystemPath(
        launch.fileSystemPolicy,
        "/app/extensions/builds/ext/a.js",
        "/workspace",
      ),
    ).toBe(true);
    expect(
      canWriteFileSystemPath(launch.fileSystemPolicy, "/artifacts/session_01/a.txt", "/workspace"),
    ).toBe(true);
  });

  it("builds execute_typescript runtime policy with workspace and temp writes only", () => {
    const launch = buildExecuteTypescriptLaunchPolicy({
      cwd: "/workspace",
      managedSandbox: false,
      networkAccess: false,
      tmpdir: "/tmp/svvy",
    });

    expect(launch.managedSandbox).toBe(false);
    expect(launch.networkAccess).toBe(false);
    expect(
      canWriteFileSystemPath(launch.fileSystemPolicy, "/workspace/out.txt", "/workspace"),
    ).toBe(true);
    expect(canWriteFileSystemPath(launch.fileSystemPolicy, "/tmp/svvy/out.txt", "/workspace")).toBe(
      true,
    );
    expect(canReadFileSystemPath(launch.fileSystemPolicy, "/usr/bin/env", "/workspace")).toBe(true);
    expect(canWriteFileSystemPath(launch.fileSystemPolicy, "/usr/bin/env", "/workspace")).toBe(
      false,
    );
  });

  it("summarizes launch facts without exposing full policy entries", () => {
    expect(
      sandboxLaunchFacts(
        buildExecuteTypescriptLaunchPolicy({
          cwd: "/workspace",
          networkAccess: false,
        }),
      ),
    ).toEqual({
      managedSandbox: true,
      networkAccess: false,
      fileSystemPolicyKind: "restricted",
      fileSystemPolicyEntryCount: 3,
    });
  });
});
