import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionCliRequirementProbePlan } from "@svvy/core";
import { probeExtensionCliRequirement } from "./extension-cli-requirement-probe";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("extension CLI requirement probe host", () => {
  it("resolves only against the captured app-edge executable path", async () => {
    const bin = executableBin();
    expect(
      await probeExtensionCliRequirement(plan({ probeKind: "resolve-executable" }), [bin]),
    ).toEqual({ status: "resolved" });
    expect(
      await probeExtensionCliRequirement(plan({ probeKind: "resolve-executable" }), []),
    ).toEqual({ status: "missing" });
    expect(
      await probeExtensionCliRequirement(
        plan({ executable: "probe-node;echo injected", probeKind: "resolve-executable" }),
        [bin],
      ),
    ).toEqual({ status: "missing" });
  });

  it("executes the resolved file directly with only the explicit child env", async () => {
    const evidence = await probeExtensionCliRequirement(
      plan({
        argv: [
          "-e",
          "process.stdout.write(JSON.stringify({allowed:process.env.PROBE_ALLOWED,path:process.env.PATH??null}))",
        ],
        env: { PROBE_ALLOWED: "yes" },
      }),
      [executableBin()],
    );

    expect(evidence).toEqual({
      status: "completed",
      exitCode: 0,
      stdout: '{"allowed":"yes","path":null}',
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
    });
  });

  it("caps captured output without logging or retaining overflow", async () => {
    const evidence = await probeExtensionCliRequirement(
      plan({
        argv: ["-e", 'process.stdout.write("abcdefgh");process.stderr.write("12345678")'],
        maxStdoutBytes: 4,
        maxStderrBytes: 3,
      }),
      [executableBin()],
    );

    expect(evidence).toEqual({
      status: "completed",
      exitCode: 0,
      stdout: "abcd",
      stderr: "123",
      stdoutTruncated: true,
      stderrTruncated: true,
    });
  });

  it("kills probes that exceed their operation timeout", async () => {
    expect(
      await probeExtensionCliRequirement(
        plan({ argv: ["-e", "setInterval(() => {}, 1000)"], timeoutMs: 20 }),
        [executableBin()],
      ),
    ).toEqual({ status: "timed-out" });
  });
});

function executableBin(): string {
  const bin = mkdtempSync(join(tmpdir(), "svvy-cli-probe-"));
  tempDirs.push(bin);
  symlinkSync(process.execPath, join(bin, "probe-node"));
  return bin;
}

function plan(
  overrides: Partial<ExtensionCliRequirementProbePlan> = {},
): ExtensionCliRequirementProbePlan {
  return {
    extensionId: "test-extension",
    requirementId: "test-cli",
    requirementFingerprint: "test-fingerprint",
    probeKind: "execute-version",
    executable: "probe-node",
    argv: ["--version"],
    env: {},
    extendEnv: false,
    timeoutMs: 1_000,
    maxStdoutBytes: 16_384,
    maxStderrBytes: 16_384,
    ...overrides,
  } as ExtensionCliRequirementProbePlan;
}
