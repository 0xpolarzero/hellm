import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

describe("Bun app-log entrypoints", () => {
  it("emits targeted logs for provider auth, sessions, surfaces, prompts, and external editor handoff", async () => {
    const indexSource = await readFile(new URL("./index.ts", import.meta.url), "utf8");

    expect(indexSource).toContain('"auth.provider"');
    expect(indexSource).toContain('"Configured provider is not connected for prompt."');
    expect(indexSource).toContain('"Configured provider is not connected for prompt steering."');
    expect(indexSource).toContain('"auth.provider", "Provider auth updated."');
    expect(indexSource).toContain('"auth.provider", "Provider OAuth started."');
    expect(indexSource).toContain('"auth.provider", "Provider OAuth failed."');
    expect(indexSource).toContain('"auth.provider", "Provider auth removed."');
    expect(indexSource).toContain('"session", "Workspace session created."');
    expect(indexSource).toContain('"session", "Workspace session opened."');
    expect(indexSource).toContain('"session", "Workspace session renamed."');
    expect(indexSource).toContain('"session", "Workspace session deleted."');
    expect(indexSource).toContain('"session", "Workspace session archived."');
    expect(indexSource).toContain('"surface", "Surface opened."');
    expect(indexSource).toContain('"surface", "Surface closed."');
    expect(indexSource).toContain('"surface", "Surface model changed."');
    expect(indexSource).toContain('"surface", "Surface reasoning changed."');
    expect(indexSource).toContain('"prompt", "Prompt requested."');
    expect(indexSource).toContain('"prompt", "Prompt started."');
    expect(indexSource).toContain('"prompt", "Prompt finished."');
    expect(indexSource).toContain('"Prompt queued for active surface."');
    expect(indexSource).toContain('"Prompt dispatched to pi runtime."');
    expect(indexSource).toContain(
      '"external-editor", "Workspace source opened in external editor."',
    );
    expect(indexSource).toContain('"external-editor", "Workspace source file does not exist."');
    expect(indexSource).toContain('"external-editor", "Custom external editor command is empty."');
    expect(indexSource).toContain('"external-editor", "Custom external editor command failed."');
  });

  it("wires title generation and renderer bridge issue logs through runtime app logs", async () => {
    const registrySource = await readFile(
      new URL("./workspace-runtime-registry.ts", import.meta.url),
      "utf8",
    );
    const indexSource = await readFile(new URL("./index.ts", import.meta.url), "utf8");

    expect(registrySource).toContain("recordTitleGenerationLog(appLog, event)");
    expect(registrySource).toContain('appLog.warning("session.title"');
    expect(registrySource).toContain('appLog.info("session.title"');
    expect(indexSource).toContain('"svvy dev browser tools bridge mounted."');
    expect(indexSource).toContain('"svvy dev browser tools bridge failed to mount."');
    expect(indexSource).toContain('mapAppRuntimeLogSource(source, kind === "rpc" ? "rpc" : "app")');
  });
});
