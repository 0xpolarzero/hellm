import { describe, expect, it } from "bun:test";
import { createMacOsKeychainExtensionEnvSecretStore } from "./extension-env-secret-store";

describe("extension env secret store", () => {
  it("passes keychain secret writes through stdin instead of argv", () => {
    const calls: Array<{ args: string[]; input?: string }> = [];
    const store = createMacOsKeychainExtensionEnvSecretStore({
      runSecurity(args, input) {
        calls.push({ args, input });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    store.set(
      { kind: "extension-env", extensionId: "linear", envName: "LINEAR_TOKEN" },
      "secret-token-value",
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([
      "add-generic-password",
      "-U",
      "-s",
      "svvy-extension-env",
      "-a",
      "linear:LINEAR_TOKEN",
      "-w",
    ]);
    expect(calls[0]?.args.join(" ")).not.toContain("secret-token-value");
    expect(calls[0]?.input).toBe("secret-token-value\n");
  });
});
