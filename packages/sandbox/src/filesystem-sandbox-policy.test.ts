import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  buildMacOsSeatbeltProfile,
  buildManagedWorkspaceWriteFileSystemPolicy,
  canReadFileSystemPath,
  canWriteFileSystemPath,
  resolveFileSystemAccess,
  unrestrictedFileSystemPolicy,
} from "./filesystem-sandbox-policy";

describe("filesystem sandbox policy", () => {
  it("applies Read, Write, and None with most-specific precedence", () => {
    const cwd = "/repo";
    const policy = buildManagedWorkspaceWriteFileSystemPolicy({
      cwd,
      readOnlyRoots: [join(cwd, "readonly")],
      noneRoots: [join(cwd, "readonly", "secret")],
      includeSlashTmp: false,
      tmpdir: null,
    });

    expect(resolveFileSystemAccess(policy, join(cwd, "src", "index.ts"), cwd)).toBe("write");
    expect(resolveFileSystemAccess(policy, join(cwd, "readonly", "notes.md"), cwd)).toBe("read");
    expect(resolveFileSystemAccess(policy, join(cwd, "readonly", "secret", "key"), cwd)).toBe(
      "none",
    );
    expect(canReadFileSystemPath(policy, join(cwd, "readonly", "notes.md"), cwd)).toBe(true);
    expect(canWriteFileSystemPath(policy, join(cwd, "readonly", "notes.md"), cwd)).toBe(false);
  });

  it("uses deny precedence for equally specific entries", () => {
    const cwd = "/repo";
    const target = join(cwd, "config");
    const policy = {
      kind: "restricted" as const,
      entries: [
        { path: "/", access: "read" as const },
        { path: target, access: "read" as const },
        { path: target, access: "write" as const },
        { path: target, access: "none" as const },
      ],
    };

    expect(resolveFileSystemAccess(policy, target, cwd)).toBe("none");
  });

  it("protects workspace metadata under writable roots unless explicitly re-enabled", () => {
    const cwd = "/repo";
    const policy = buildManagedWorkspaceWriteFileSystemPolicy({
      cwd,
      includeSlashTmp: false,
      tmpdir: null,
    });

    expect(canWriteFileSystemPath(policy, join(cwd, "src", "index.ts"), cwd)).toBe(true);
    expect(canWriteFileSystemPath(policy, join(cwd, ".git", "config"), cwd)).toBe(false);
    expect(canWriteFileSystemPath(policy, join(cwd, ".agents", "notes.md"), cwd)).toBe(false);
    expect(canWriteFileSystemPath(policy, join(cwd, ".codex", "settings.toml"), cwd)).toBe(false);

    const explicit = {
      kind: "restricted" as const,
      entries: [...policy.entries, { path: join(cwd, ".codex"), access: "write" as const }],
    };
    expect(canWriteFileSystemPath(explicit, join(cwd, ".codex", "settings.toml"), cwd)).toBe(true);
  });

  it("treats unrestricted policy as full write access", () => {
    const policy = unrestrictedFileSystemPolicy();

    expect(canWriteFileSystemPath(policy, "/etc/hosts", "/repo")).toBe(true);
    expect(resolveFileSystemAccess(policy, "/repo/.git/config", "/repo")).toBe("write");
  });

  it("generates a macOS Seatbelt profile from writable roots and read-only carveouts", () => {
    const cwd = "/repo";
    const policy = buildManagedWorkspaceWriteFileSystemPolicy({
      cwd,
      readOnlyRoots: [join(cwd, "readonly")],
      noneRoots: [join(cwd, "readonly", "secret")],
      includeSlashTmp: false,
      tmpdir: null,
    });
    const profile = buildMacOsSeatbeltProfile(policy, cwd, { networkAccess: false });

    expect(profile.profile).toContain("(version 1)");
    expect(profile.profile).toContain("(allow default)");
    expect(profile.profile).toContain("(deny file-read*");
    expect(profile.profile).toContain('(literal (param "UNREADABLE_ROOT_0"))');
    expect(profile.profile).toContain('(subpath (param "UNREADABLE_ROOT_0"))');
    expect(profile.profile).toContain("(deny file-write*)");
    expect(profile.profile).toContain("(allow file-write*");
    expect(profile.profile).toContain('(subpath (param "WRITABLE_ROOT_0"))');
    expect(profile.profile).toContain(
      '(require-not (literal (param "WRITABLE_ROOT_0_EXCLUDED_0")))',
    );
    expect(profile.profile).toContain(
      '(require-not (subpath (param "WRITABLE_ROOT_0_EXCLUDED_0")))',
    );
    expect(profile.profile).toContain('(require-not (regex #"^/repo/\\.git(/.*)?$"))');
    expect(profile.profile).toContain('(require-not (regex #"^/repo/\\.agents(/.*)?$"))');
    expect(profile.profile).toContain('(require-not (regex #"^/repo/\\.codex(/.*)?$"))');
    expect(profile.profile).toContain("(deny network*)");
    expect(profile.parameters).toMatchObject({
      UNREADABLE_ROOT_0: join(cwd, "readonly", "secret"),
      WRITABLE_ROOT_0: cwd,
      WRITABLE_ROOT_0_EXCLUDED_0: join(cwd, "readonly"),
    });
  });

  it("reopens readable child roots inside unreadable Seatbelt roots", () => {
    const cwd = "/repo";
    const readableChild = join(cwd, "sealed", "public");
    const writableChild = join(cwd, "sealed", "cache");
    const policy = {
      kind: "restricted" as const,
      entries: [
        { path: cwd, access: "read" as const },
        { path: join(cwd, "sealed"), access: "none" as const },
        { path: readableChild, access: "read" as const },
        { path: writableChild, access: "write" as const },
      ],
    };
    const profile = buildMacOsSeatbeltProfile(policy, cwd, { networkAccess: false });

    expect(canReadFileSystemPath(policy, join(cwd, "sealed", "secret.txt"), cwd)).toBe(false);
    expect(canReadFileSystemPath(policy, join(readableChild, "notes.md"), cwd)).toBe(true);
    expect(canReadFileSystemPath(policy, join(writableChild, "state.json"), cwd)).toBe(true);
    expect(profile.profile).toContain('(param "UNREADABLE_ROOT_0_EXCLUDED_0")');
    expect(profile.profile).toContain('(param "UNREADABLE_ROOT_0_EXCLUDED_1")');
    expect(profile.parameters).toMatchObject({
      UNREADABLE_ROOT_0: join(cwd, "sealed"),
      UNREADABLE_ROOT_0_EXCLUDED_0: writableChild,
      UNREADABLE_ROOT_0_EXCLUDED_1: readableChild,
    });
  });

  it("omits managed write and network restrictions for unrestricted network-enabled profiles", () => {
    const profile = buildMacOsSeatbeltProfile(unrestrictedFileSystemPolicy(), "/repo", {
      networkAccess: true,
    });

    expect(profile.profile).toContain("(version 1)");
    expect(profile.profile).toContain("(allow default)");
    expect(profile.profile).not.toContain("file-write");
    expect(profile.profile).not.toContain("network");
    expect(profile.parameters).toEqual({});
  });

  it("generates a network-only restriction for unrestricted network-disabled profiles", () => {
    const profile = buildMacOsSeatbeltProfile(unrestrictedFileSystemPolicy(), "/repo", {
      networkAccess: false,
    });

    expect(profile.profile).toContain("(version 1)");
    expect(profile.profile).toContain("(allow default)");
    expect(profile.profile).toContain("(deny network*)");
    expect(profile.profile).not.toContain("file-write");
    expect(profile.parameters).toEqual({});
  });
});
