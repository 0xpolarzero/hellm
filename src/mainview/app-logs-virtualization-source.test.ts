import { describe, expect, it } from "bun:test";

const paneSource = await Bun.file(`${import.meta.dir}/AppLogsPane.svelte`).text();

describe("AppLogsPane virtualized log list contract", () => {
  it("uses TanStack Virtual with stable log sequence keys and variable-height measurement", () => {
    expect(paneSource).toContain('import { createVirtualizer } from "@tanstack/svelte-virtual";');
    expect(paneSource).toContain(
      "const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({",
    );
    expect(paneSource).toContain("getItemKey: (index) => visibleEntries[index]?.seq ?? index");
    expect(paneSource).toContain("instance.measureElement(node)");
    expect(paneSource).toContain("const observer = new ResizeObserver(measure)");
  });

  it("anchors explicit latest jumps through the virtualizer with reduced-motion fallback", () => {
    expect(paneSource).toContain('anchorTo: "end"');
    expect(paneSource).toContain("get(virtualizer).scrollToEnd({ behavior })");
    expect(paneSource).toContain('smooth && !prefersReducedMotion() ? "smooth" : "auto"');
  });

  it("keeps older-page loading and live update tail state wired to TanStack helpers", () => {
    expect(paneSource).toContain("beforeSeq: firstSeq");
    expect(paneSource).toContain("bottomPinned = instance.isAtEnd(APP_LOG_TAIL_THRESHOLD_PX)");
    expect(paneSource).toContain("instance.getDistanceFromEnd()");
    expect(paneSource).toContain("instance.scrollToOffset(");
    expect(paneSource).toContain(
      'followOnAppend: liveMode === "live" && bottomPinned ? "auto" : false',
    );
    expect(paneSource).not.toContain("scrollHeight");
    expect(paneSource).not.toContain("previousTotalSize");
  });
});
