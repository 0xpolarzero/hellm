import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolveOrbStackMachineArch } from "electrobun-e2e/config";
import {
  assertOrbStackMachineArchMatches,
  normalizeOrbStackGuestArch,
} from "electrobun-e2e/orbstack";

describe("the pinned electrobun-e2e OrbStack architecture contract", () => {
  test("normalizes config, host, and guest architecture spellings", () => {
    expect(resolveOrbStackMachineArch("amd64", "arm64")).toBe("amd64");
    expect(resolveOrbStackMachineArch("x86_64", "arm64")).toBe("amd64");
    expect(resolveOrbStackMachineArch("arm64", "x64")).toBe("arm64");
    expect(resolveOrbStackMachineArch(undefined, "x64")).toBe("amd64");
    expect(resolveOrbStackMachineArch(undefined, "aarch64")).toBe("arm64");
    expect(normalizeOrbStackGuestArch("x86_64\n")).toBe("amd64");
    expect(normalizeOrbStackGuestArch("aarch64\n")).toBe("arm64");
  });

  test("rejects unsupported requested and reported architectures", () => {
    expect(() => resolveOrbStackMachineArch("riscv64", "arm64")).toThrow(
      'Unsupported OrbStack machine architecture "riscv64". Expected "amd64" or "arm64".',
    );
    expect(() => normalizeOrbStackGuestArch("riscv64\n")).toThrow(
      'Unsupported architecture reported by the OrbStack machine: "riscv64".',
    );
  });

  test("fails clearly without replacing an existing machine of the wrong architecture", () => {
    expect(() => assertOrbStackMachineArchMatches("svvy-e2e", "amd64", "arm64")).toThrow(
      'OrbStack machine "svvy-e2e" has architecture "arm64", but this e2e config requires "amd64". ' +
        "Use a different machineName or explicitly delete and recreate this machine before running setup again; " +
        "electrobun-e2e will not replace it automatically.",
    );
    expect(() => assertOrbStackMachineArchMatches("svvy-e2e", "amd64", "amd64")).not.toThrow();
  });

  test("wires the explicit config and environment override through setup and run", async () => {
    const configEntrypoint = import.meta.resolve("electrobun-e2e/config");
    const orbStackEntrypoint = import.meta.resolve("electrobun-e2e/orbstack");
    const [configSource, orbStackSource] = await Promise.all([
      readFile(new URL(configEntrypoint), "utf8"),
      readFile(new URL(orbStackEntrypoint), "utf8"),
    ]);

    expect(configSource).toContain("machineArch?: OrbStackMachineArch");
    expect(configSource).toContain("bunVersion?: string");
    expect(configSource).toContain("machineArch: OrbStackMachineArch");
    expect(configSource).toContain("process.env.ELECTROBUN_E2E_ORB_ARCH?.trim()");
    expect(orbStackSource).toContain('"create",\n      "-a",\n      config.machineArch');
    expect(orbStackSource).toContain('["-m", machineName, "uname", "-m"]');
    expect(orbStackSource.match(/assertOrbStackMachineArch\(config\.machineName/g)).toHaveLength(2);
    expect(orbStackSource).not.toContain('["orb", "delete"');
    expect(orbStackSource).toContain('bun_install_spec="canary"');
    expect(orbStackSource).toContain('"$(bun --revision)" != *-canary.*');
  });
});
