import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { ArtifactsController } from "./artifacts";

function createSeededHtmlMessages(): AgentMessage[] {
  return [
    {
      role: "assistant",
      timestamp: 1,
      content: [
        {
          type: "toolCall",
          id: "tool-call-1",
          name: "artifacts",
          arguments: {
            command: "create",
            filename: "report.html",
            content:
              '<!doctype html><html><body><script>console.log("seeded");</script>Seeded</body></html>',
          },
        },
      ],
    },
    {
      role: "toolResult",
      timestamp: 2,
      toolCallId: "tool-call-1",
      toolName: "artifacts",
      isError: false,
      content: [{ type: "text", text: "Created file report.html" }],
    },
  ] as unknown as AgentMessage[];
}

describe("ArtifactsController", () => {
  test("reconstructFromMessages repopulates missing html logs", async () => {
    const controller = new ArtifactsController();
    let captureCount = 0;
    const captureHtmlLogs = async () => {
      captureCount += 1;
      return "[log] preview ready";
    };
    (controller as unknown as { captureHtmlLogs: typeof captureHtmlLogs }).captureHtmlLogs =
      captureHtmlLogs;

    await controller.reconstructFromMessages(createSeededHtmlMessages());

    expect(captureCount).toBe(1);
    expect(controller.getSnapshot().logsByFilename["report.html"]).toBe("[log] preview ready");
  });

  test("reconstructFromMessages preserves existing html logs when content is unchanged", async () => {
    const controller = new ArtifactsController();
    let captureCount = 0;
    const captureHtmlLogs = async () => {
      captureCount += 1;
      return "[log] preview ready";
    };
    (controller as unknown as { captureHtmlLogs: typeof captureHtmlLogs }).captureHtmlLogs =
      captureHtmlLogs;

    await controller.reconstructFromMessages(createSeededHtmlMessages());
    await controller.reconstructFromMessages(createSeededHtmlMessages());

    expect(captureCount).toBe(1);
    expect(controller.getSnapshot().logsByFilename["report.html"]).toBe("[log] preview ready");
  });

  test("getPreviewDocument escapes embedded script markers in the snapshot", async () => {
    const controller = new ArtifactsController();
    const captureHtmlLogs = async () => "";
    (controller as unknown as { captureHtmlLogs: typeof captureHtmlLogs }).captureHtmlLogs =
      captureHtmlLogs;

    await controller.reconstructFromMessages(createSeededHtmlMessages());

    expect(controller.getPreviewDocument("report.html")).toContain("\\u003c/script>");
  });
});
