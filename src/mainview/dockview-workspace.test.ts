import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

describe("Dockview workspace chrome", () => {
  it("reconciles Dockview panels from runtime emissions so stale panels cannot remain visible", async () => {
    const dockviewSource = await readFile(
      new URL("./DockviewWorkspace.svelte", import.meta.url),
      "utf8",
    );

    expect(dockviewSource).toContain("function runtimePanels()");
    expect(dockviewSource).toContain("const nextPanels = runtimePanels();");
    expect(dockviewSource).toContain("syncDockviewPanels();");
    expect(dockviewSource).toContain("unsubscribeRuntime = runtime.subscribe(() => {");
    expect(dockviewSource).not.toContain(
      "unsubscribeRuntime = runtime.subscribe(refreshSurfaceTabs)",
    );
  });

  it("keeps Dockview geometry changes instant so pane actions do not flash through transition positions", async () => {
    const dockviewSource = await readFile(
      new URL("./DockviewWorkspace.svelte", import.meta.url),
      "utf8",
    );
    const workspaceSource = await readFile(
      new URL("./ChatWorkspace.svelte", import.meta.url),
      "utf8",
    );

    expect(dockviewSource).toContain(".dockview-workbench .dv-pane-container.dv-animated .dv-view");
    expect(dockviewSource).toContain(".dockview-workbench .dv-tab.dv-tab--shifting");
    expect(dockviewSource).toContain("transition: none !important");
    expect(dockviewSource).toContain("ResizeObserver");
    expect(dockviewSource).toContain("syncDockviewLayoutFromResize");
    expect(dockviewSource).not.toContain("layoutEpoch");
    expect(workspaceSource).not.toContain("dockviewLayoutEpoch");
    expect(workspaceSource).not.toContain("syncDockviewAfterSidebarToggle");
    expect(workspaceSource).not.toContain("scheduleDockviewLayoutPulse");
    expect(workspaceSource).not.toContain("transition: grid-template-columns");
  });

  it("preserves Dockview's supported empty group when the final runtime pane closes", async () => {
    const dockviewSource = await readFile(
      new URL("./DockviewWorkspace.svelte", import.meta.url),
      "utf8",
    );

    expect(dockviewSource).toContain('noPanelsOverlay: "emptyGroup"');
    expect(dockviewSource).toContain(
      "nextPanels.length === 0 && dockview.totalPanels === 1 && dockview.groups.length === 1",
    );
    expect(dockviewSource).toContain(
      "dockview.removePanel(panel, { removeEmptyGroup: !preserveFinalEmptyGroup });",
    );
    expect(dockviewSource).not.toContain("flushSync");
    expect(dockviewSource).not.toContain("runtimeShellEmpty");
  });
});
