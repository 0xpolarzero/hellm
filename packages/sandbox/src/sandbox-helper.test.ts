import { describe, expect, it } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type FileSystemSandboxPolicy,
  buildManagedWorkspaceWriteFileSystemPolicy,
  unrestrictedFileSystemPolicy,
} from "./filesystem-sandbox-policy";
import { buildSandboxHelperArgs, resolveSandboxHelperPath } from "./sandbox-helper";

const MACOS_SEATBELT_EXECUTABLE = "/usr/bin/sandbox-exec";

function testSandboxHelperResolutionInput(configuredPath = process.env.SVVY_SANDBOX_HELPER_PATH) {
  return {
    ...(configuredPath === undefined ? {} : { configuredPath }),
    executablePath: process.execPath,
    candidatePaths: [
      join(import.meta.dir, "..", "..", "..", "build", "native", "svvy-sandbox-helper"),
    ],
  };
}

function resolveTestSandboxHelperPath(): string {
  return resolveSandboxHelperPath(testSandboxHelperResolutionInput());
}

describe("sandbox helper", () => {
  it("fails closed when an explicit helper path is missing", () => {
    const configuredPath = join(tmpdir(), `missing-svvy-sandbox-helper-${randomUUID()}`);
    expect(() =>
      resolveSandboxHelperPath(testSandboxHelperResolutionInput(configuredPath)),
    ).toThrow("Managed sandboxing requires executable svvy-sandbox-helper");
  });

  it("does not search source-checkout-relative helper fallbacks implicitly", () => {
    expect(() =>
      resolveSandboxHelperPath({
        executablePath: process.execPath,
      }),
    ).toThrow("Managed sandboxing requires packaged svvy-sandbox-helper");
  });

  it("applies workspace-write policy and protected metadata in the packaged helper seam", () => {
    const cwd = mkdtempSync(join(tmpdir(), "svvy-helper-policy-"));
    const helper = resolveTestSandboxHelperPath();
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
    const helper = resolveTestSandboxHelperPath();
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

  it("passes exact-path recursive flags to the packaged helper seam", () => {
    const cwd = mkdtempSync(join(tmpdir(), "svvy-helper-exact-"));
    const helper = resolveTestSandboxHelperPath();
    const exactFile = join(cwd, "generated", "manifest.json");
    mkdirSync(join(cwd, "generated"), { recursive: true });
    const policy: FileSystemSandboxPolicy = {
      kind: "restricted",
      entries: [
        { path: cwd, access: "read" },
        { path: exactFile, access: "write", recursive: false },
      ],
    };
    const args = buildSandboxHelperArgs({
      command: ["/usr/bin/true"],
      cwd,
      fileSystemPolicy: policy,
      networkAccess: false,
    });

    expect(args).toContain("false");
    expect(checkAccess(helper, policy, cwd, "write", exactFile).ok).toBe(true);
    expect(checkAccess(helper, policy, cwd, "write", join(exactFile, "child")).ok).toBe(false);
    expect(checkAccess(helper, policy, cwd, "write", join(cwd, "generated", "other.json")).ok).toBe(
      false,
    );
  });

  it("keeps exact read-only exclusions from blocking descendants in helper checks", () => {
    const cwd = mkdtempSync(join(tmpdir(), "svvy-helper-exact-none-"));
    const helper = resolveTestSandboxHelperPath();
    const blockedFile = join(cwd, "src", "blocked.ts");
    mkdirSync(join(cwd, "src"), { recursive: true });
    const policy: FileSystemSandboxPolicy = {
      kind: "restricted",
      entries: [
        { path: cwd, access: "write" },
        { path: blockedFile, access: "none", recursive: false },
      ],
    };

    expect(checkAccess(helper, policy, cwd, "write", blockedFile).ok).toBe(false);
    expect(checkAccess(helper, policy, cwd, "write", join(blockedFile, "child")).ok).toBe(true);
  });

  it("denies protected metadata writes through raw symlink paths", () => {
    const cwd = mkdtempSync(join(tmpdir(), "svvy-helper-metadata-symlink-"));
    const helper = resolveTestSandboxHelperPath();
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
    const helper = resolveTestSandboxHelperPath();
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

  it("denies loopback networking through the packaged helper under the restricted network policy", async () => {
    if (!existsSync(MACOS_SEATBELT_EXECUTABLE)) {
      expect(existsSync(MACOS_SEATBELT_EXECUTABLE)).toBe(false);
      return;
    }
    const server = startLoopbackTextServer();
    if (!server) {
      expect(server).toBeNull();
      return;
    }
    const helper = resolveTestSandboxHelperPath();
    try {
      const result = await runHelperLoopbackFetch(helper, server.url, false);
      expect(result.stdout).not.toContain("network-ok");
      expect(result.exitCode).not.toBe(0);
    } finally {
      server.stop();
    }
  }, 20000);

  it("allows loopback networking through the packaged helper under the enabled network policy", async () => {
    if (!existsSync(MACOS_SEATBELT_EXECUTABLE)) {
      expect(existsSync(MACOS_SEATBELT_EXECUTABLE)).toBe(false);
      return;
    }
    const server = startLoopbackTextServer();
    if (!server) {
      expect(server).toBeNull();
      return;
    }
    const helper = resolveTestSandboxHelperPath();
    try {
      const result = await runHelperLoopbackFetch(helper, server.url, true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("network-ok");
    } finally {
      server.stop();
    }
  }, 20000);

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
    const helper = resolveTestSandboxHelperPath();
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
    const helper = resolveTestSandboxHelperPath();
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
  fileSystemPolicy: FileSystemSandboxPolicy,
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

async function runHelperLoopbackFetch(
  helper: string,
  url: string,
  networkAccess: boolean,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const cwd = mkdtempSync(join(tmpdir(), "svvy-helper-network-real-"));
  const policy = buildManagedWorkspaceWriteFileSystemPolicy({ cwd, tmpdir: tmpdir() });
  const program = `try { const response = await fetch(${JSON.stringify(url)}, { signal: AbortSignal.timeout(8000) }); process.stdout.write(await response.text()); } catch (error) { process.stderr.write(error instanceof Error ? error.message : String(error)); process.exit(37); }`;
  const args = buildSandboxHelperArgs({
    command: [process.execPath, "-e", program],
    cwd,
    fileSystemPolicy: policy,
    networkAccess,
  });
  return spawnHelperAsync(helper, args);
}

function spawnHelperAsync(
  helper: string,
  args: readonly string[],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(helper, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", rejectPromise);
    child.on("close", (exitCode) => {
      resolvePromise({ exitCode, stdout, stderr });
    });
  });
}

function startLoopbackTextServer(): { url: string; stop: () => void } | null {
  try {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("network-ok\n"),
    });
    return {
      url: `http://127.0.0.1:${server.port}/`,
      stop: () => {
        server.stop(true);
      },
    };
  } catch {
    return null;
  }
}
