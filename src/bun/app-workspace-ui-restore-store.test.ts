import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createAppWorkspaceUiRestoreStore } from "./app-workspace-ui-restore-store";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("app workspace UI restore store", () => {
  test("persists durable restore state by workspace id", () => {
    const agentDir = tempAgentDir();
    const workspaceId = "/repo/app#workspace-1";
    const state = {
      version: 5 as const,
      layouts: {
        A: null,
        B: {
          panels: [{ panelId: "primary", binding: { surface: "workflows" } }],
          dockview: null,
          compactSurfaces: [],
          focusedPanelId: "primary",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        C: null,
      },
    };

    createAppWorkspaceUiRestoreStore({ agentDir }).setState(workspaceId, state);

    const reloaded = createAppWorkspaceUiRestoreStore({ agentDir });
    expect(reloaded.getState(workspaceId)).toEqual(state);
  });

  test("shares durable state for the same workspace id", () => {
    const store = createAppWorkspaceUiRestoreStore({ agentDir: tempAgentDir() });
    const workspaceId = "/repo/app";

    store.setState(workspaceId, {
      version: 5,
      layouts: { A: { focusedPanelId: "primary" }, B: null, C: null },
    });
    store.setState(workspaceId, {
      version: 5,
      layouts: { A: null, B: null, C: { focusedPanelId: "logs" } },
    });

    expect(store.getState(workspaceId)?.layouts.A).toBeNull();
    expect(store.getState(workspaceId)?.layouts.C).toEqual({ focusedPanelId: "logs" });
  });

  test("ignores malformed saved data", () => {
    const store = createAppWorkspaceUiRestoreStore({ agentDir: tempAgentDir() });

    expect(
      store.setState("/repo/app#bad", {
        version: 999,
        layouts: { A: null, B: null, C: null },
      } as never),
    ).toEqual({
      version: 5,
      layouts: { A: null, B: null, C: null },
    });
  });
});

function tempAgentDir(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "svvy-ui-restore-")));
  tempDirs.push(dir);
  return dir;
}
