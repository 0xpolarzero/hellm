import { afterEach, describe, expect, it } from "bun:test";
import { resolveWorkspaceCwd } from "./workspace-context";

const ORIGINAL_SVVY_WORKSPACE_CWD = process.env.SVVY_WORKSPACE_CWD;
const ORIGINAL_INIT_CWD = process.env.INIT_CWD;
const ORIGINAL_PWD = process.env.PWD;

afterEach(() => {
  restoreEnv("SVVY_WORKSPACE_CWD", ORIGINAL_SVVY_WORKSPACE_CWD);
  restoreEnv("INIT_CWD", ORIGINAL_INIT_CWD);
  restoreEnv("PWD", ORIGINAL_PWD);
});

function restoreEnv(name: "SVVY_WORKSPACE_CWD" | "INIT_CWD" | "PWD", value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

describe("resolveWorkspaceCwd", () => {
  it("prefers the explicit svvy workspace override", () => {
    process.env.SVVY_WORKSPACE_CWD = "/tmp/svvy-workspace";
    process.env.INIT_CWD = "/tmp/init-cwd";
    process.env.PWD = "/tmp/pwd-cwd";

    expect(resolveWorkspaceCwd()).toBe("/tmp/svvy-workspace");
  });

  it("falls back to INIT_CWD and PWD before process.cwd()", () => {
    delete process.env.SVVY_WORKSPACE_CWD;
    process.env.INIT_CWD = "/tmp/init-cwd";
    process.env.PWD = "/tmp/pwd-cwd";

    expect(resolveWorkspaceCwd()).toBe("/tmp/init-cwd");

    delete process.env.INIT_CWD;
    expect(resolveWorkspaceCwd()).toBe("/tmp/pwd-cwd");
  });
});
