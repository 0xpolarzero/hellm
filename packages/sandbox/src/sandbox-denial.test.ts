import { describe, expect, it } from "bun:test";
import {
  isSandboxDenialOutput,
  isSandboxHelperBootstrapFailure,
  sandboxDenialFacts,
} from "./sandbox-denial";

describe("sandbox denial classification", () => {
  it("labels managed macOS seatbelt denials with command facts", () => {
    const input = {
      exitCode: 1,
      managedSandbox: true,
      stderr: "Sandbox: deny(1) file-write-create /repo/.git/config\nOperation not permitted",
      stdout: "",
    };

    expect(isSandboxDenialOutput(input)).toBe(true);
    expect(sandboxDenialFacts(input)).toEqual({
      sandboxDenied: true,
      sandboxEngine: "macos-seatbelt",
    });
  });

  it("requires managed sandbox execution and nonzero non-127 exit status", () => {
    const deniedOutput = {
      stderr: "Sandbox: deny(1) file-write-create /repo/file\nOperation not permitted",
      stdout: "",
    };

    expect(isSandboxDenialOutput({ ...deniedOutput, exitCode: 1, managedSandbox: false })).toBe(
      false,
    );
    expect(isSandboxDenialOutput({ ...deniedOutput, exitCode: 0, managedSandbox: true })).toBe(
      false,
    );
    expect(isSandboxDenialOutput({ ...deniedOutput, exitCode: 127, managedSandbox: true })).toBe(
      false,
    );
  });

  it("does not classify ordinary shell failures as sandbox denials", () => {
    expect(
      isSandboxDenialOutput({
        exitCode: 1,
        managedSandbox: true,
        stderr: "operation not permitted",
        stdout: "",
      }),
    ).toBe(false);
    expect(
      isSandboxDenialOutput({
        exitCode: 1,
        managedSandbox: true,
        stderr: "Sandbox: syntax error near unexpected token",
        stdout: "",
      }),
    ).toBe(false);
    expect(
      isSandboxDenialOutput({
        exitCode: 1,
        managedSandbox: true,
        stderr: "Sandbox: command not found",
        stdout: "",
      }),
    ).toBe(false);
  });

  it("keeps sandbox helper bootstrap failures out of escalation retry policy", () => {
    const input = {
      exitCode: 1,
      managedSandbox: true,
      stderr: "sandbox-exec: sandbox_apply: Operation not permitted",
      stdout: "",
    };

    expect(isSandboxDenialOutput(input)).toBe(true);
    expect(isSandboxHelperBootstrapFailure(`${input.stdout}\n${input.stderr}`)).toBe(true);
  });
});
