import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildManagedWorkspaceWriteFileSystemPolicy,
  unrestrictedFileSystemPolicy,
} from "./filesystem-sandbox-policy";
import { buildSandboxHelperArgs, resolveSandboxHelperPath } from "./sandbox-helper";

describe("sandbox helper", () => {
  it("fails closed when an explicit helper path is missing", () => {
    const previous = process.env.SVVY_SANDBOX_HELPER_PATH;
    process.env.SVVY_SANDBOX_HELPER_PATH = join(
      tmpdir(),
      `missing-svvy-sandbox-helper-${randomUUID()}`,
    );
    try {
      expect(() => resolveSandboxHelperPath()).toThrow(
        "Managed sandboxing requires existing svvy-sandbox-helper",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.SVVY_SANDBOX_HELPER_PATH;
      } else {
        process.env.SVVY_SANDBOX_HELPER_PATH = previous;
      }
    }
  });

  it("applies workspace-write policy and protected metadata in the packaged helper seam", () => {
    const cwd = mkdtempSync(join(tmpdir(), "svvy-helper-policy-"));
    const helper = resolveSandboxHelperPath();
    const policy = buildManagedWorkspaceWriteFileSystemPolicy({
      cwd,
      includeSlashTmp: true,
      readOnlyRoots: [join(cwd, "generated")],
      tmpdir: tmpdir(),
    });

    expect(checkAccess(helper, policy, cwd, "write", join(cwd, "src", "file.ts"))).toEqual({
      ok: true,
      stderr: "",
      stdout: "allowed",
    });
    expect(checkAccess(helper, policy, cwd, "write", join(cwd, ".git", "config")).ok).toBe(false);
    expect(checkAccess(helper, policy, cwd, "write", join(cwd, "generated", "out.ts")).ok).toBe(
      false,
    );
    expect(checkAccess(helper, policy, cwd, "write", "/private/etc/hosts").ok).toBe(false);
    expect(checkAccess(helper, policy, cwd, "read", "/private/etc/hosts")).toEqual({
      ok: true,
      stderr: "",
      stdout: "allowed",
    });
  });

  it("honors explicit writable subpaths inside protected metadata", () => {
    const cwd = mkdtempSync(join(tmpdir(), "svvy-helper-protected-"));
    const helper = resolveSandboxHelperPath();
    const allowedMetadataChild = join(cwd, ".git", "allowed");
    mkdirSync(allowedMetadataChild, { recursive: true });
    const policy = buildManagedWorkspaceWriteFileSystemPolicy({
      cwd,
      writableRoots: [allowedMetadataChild],
      tmpdir: tmpdir(),
    });

    expect(checkAccess(helper, policy, cwd, "write", join(cwd, ".git", "config")).ok).toBe(false);
    expect(checkAccess(helper, policy, cwd, "write", join(allowedMetadataChild, "note")).ok).toBe(
      true,
    );
  });

  it("denies protected metadata writes through raw symlink paths", () => {
    const cwd = mkdtempSync(join(tmpdir(), "svvy-helper-metadata-symlink-"));
    const helper = resolveSandboxHelperPath();
    const safeTarget = join(cwd, "safe-target");
    mkdirSync(safeTarget, { recursive: true });
    symlinkSync(safeTarget, join(cwd, ".codex"));
    const policy = buildManagedWorkspaceWriteFileSystemPolicy({
      cwd,
      tmpdir: tmpdir(),
    });

    expect(checkAccess(helper, policy, cwd, "write", join(cwd, ".codex", "config")).ok).toBe(false);
    expect(checkAccess(helper, policy, cwd, "write", join(safeTarget, "config")).ok).toBe(true);
  });

  it("passes adversarial path spelling as helper parameters", () => {
    const cwd = mkdtempSync(join(tmpdir(), "svvy-helper-quoted-"));
    const helper = resolveSandboxHelperPath();
    const quoted = join(cwd, 'path "with" quotes');
    mkdirSync(quoted, { recursive: true });
    const policy = buildManagedWorkspaceWriteFileSystemPolicy({
      cwd,
      writableRoots: [quoted],
      tmpdir: tmpdir(),
    });

    expect(checkAccess(helper, policy, cwd, "write", join(quoted, "file.txt")).ok).toBe(true);
  });

  it("passes network allow and deny policy to the helper explicitly", () => {
    const cwd = mkdtempSync(join(tmpdir(), "svvy-helper-network-"));
    const policy = buildManagedWorkspaceWriteFileSystemPolicy({ cwd, tmpdir: tmpdir() });

    const restrictedArgs = buildSandboxHelperArgs({
      command: ["/usr/bin/true"],
      cwd,
      fileSystemPolicy: policy,
      networkAccess: false,
    });
    const enabledArgs = buildSandboxHelperArgs({
      command: ["/usr/bin/true"],
      cwd,
      fileSystemPolicy: policy,
      networkAccess: true,
    });

    expect(restrictedArgs).toContain("--network");
    expect(restrictedArgs).toContain("restricted");
    expect(enabledArgs).toContain("--network");
    expect(enabledArgs).toContain("enabled");
  });

  it("passes platform defaults only when explicitly requested", () => {
    const cwd = mkdtempSync(join(tmpdir(), "svvy-helper-platform-defaults-"));
    const policy = buildManagedWorkspaceWriteFileSystemPolicy({ cwd, tmpdir: tmpdir() });

    expect(
      buildSandboxHelperArgs({
        command: ["/usr/bin/true"],
        cwd,
        fileSystemPolicy: policy,
        networkAccess: false,
      }),
    ).not.toContain("--include-platform-defaults");
    expect(
      buildSandboxHelperArgs({
        command: ["/usr/bin/true"],
        cwd,
        fileSystemPolicy: policy,
        includePlatformDefaults: true,
        networkAccess: false,
      }),
    ).toContain("--include-platform-defaults");
  });

  it("keeps platform default writes denied in the strict helper seam", () => {
    const cwd = mkdtempSync(join(tmpdir(), "svvy-helper-strict-platform-"));
    const helper = resolveSandboxHelperPath();
    const policy = buildManagedWorkspaceWriteFileSystemPolicy({
      cwd,
      includeSlashTmp: false,
      tmpdir: null,
    });

    expect(checkAccess(helper, policy, cwd, "write", join(tmpdir(), "outside.txt")).ok).toBe(false);
  });

  it("represents full-access bypass as unrestricted filesystem and enabled network", () => {
    const cwd = mkdtempSync(join(tmpdir(), "svvy-helper-full-access-"));

    expect(
      buildSandboxHelperArgs({
        command: ["/usr/bin/true"],
        cwd,
        fileSystemPolicy: unrestrictedFileSystemPolicy(),
        networkAccess: true,
      }),
    ).toEqual([
      "--cwd",
      cwd,
      "--fs-kind",
      "unrestricted",
      "--network",
      "enabled",
      "--",
      "/usr/bin/true",
    ]);
  });

  it("fails closed on invalid sandbox setup before command execution", () => {
    const helper = resolveSandboxHelperPath();
    const result = spawnSync(
      helper,
      [
        "--cwd",
        "relative-cwd",
        "--fs-kind",
        "restricted",
        "--network",
        "restricted",
        "--",
        "/usr/bin/true",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(125);
    expect(result.stderr).toContain("sandbox paths must be absolute");
  });
});

function checkAccess(
  helper: string,
  fileSystemPolicy: ReturnType<typeof buildManagedWorkspaceWriteFileSystemPolicy>,
  cwd: string,
  access: "read" | "write",
  path: string,
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(
    helper,
    [
      ...buildSandboxHelperArgs({
        command: ["/usr/bin/true"],
        cwd,
        fileSystemPolicy,
        networkAccess: false,
      }).slice(0, -2),
      "--check-access",
      access,
      path,
      "--",
      "/usr/bin/true",
    ],
    { encoding: "utf8" },
  );
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}
