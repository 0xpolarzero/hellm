import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { mapAppRuntimeLogSource } from "./app-runtime-log-source";

describe("mapAppRuntimeLogSource", () => {
  it("routes RPC failures to app.rpc before source-name heuristics", () => {
    expect(mapAppRuntimeLogSource("bun.oauth", "rpc")).toBe("app.rpc");
    expect(mapAppRuntimeLogSource("renderer.rpc.request")).toBe("app.rpc");
  });

  it("routes targeted product sources without falling back to lifecycle logs", () => {
    expect(mapAppRuntimeLogSource("bun.oauth")).toBe("auth.provider");
    expect(mapAppRuntimeLogSource("renderer.bridge")).toBe("renderer");
    expect(mapAppRuntimeLogSource("dev-browser-tools")).toBe("app.bridge");
    expect(mapAppRuntimeLogSource("workspace.session.create")).toBe("session");
    expect(mapAppRuntimeLogSource("workspace.surface.open")).toBe("surface");
    expect(mapAppRuntimeLogSource("sendPrompt")).toBe("prompt");
    expect(mapAppRuntimeLogSource("source.graph")).toBe("source.graph");
    expect(mapAppRuntimeLogSource("workflow.library")).toBe("workflow.library");
    expect(mapAppRuntimeLogSource("external-editor")).toBe("external-editor");
  });

  it("wires provider OAuth failures and bridge mount failures into app logs", async () => {
    const indexSource = await readFile(new URL("./index.ts", import.meta.url), "utf8");

    expect(indexSource).toContain('?.appLog.warning("auth.provider", "Provider OAuth failed."');
    expect(indexSource).toContain('recordAppRuntimeError("rpc", message, "bun.oauth"');
    expect(indexSource).toContain(".catch((error) => {");
    expect(indexSource).toContain('"svvy dev browser tools bridge failed to mount."');
    expect(indexSource).toContain('"dev-browser-tools"');
    expect(indexSource).toContain("throw error;");
  });
});
