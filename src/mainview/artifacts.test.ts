import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { ArtifactsController, type ArtifactCommand } from "./artifacts";

const SEEDED_HTML_CONTENT =
  '<!doctype html><html><body><script>console.log("seeded");</script>Seeded</body></html>';
const REPORT_HTML_CONTENT =
  '<!doctype html><html><body><script>console.log("report");</script>Report</body></html>';
const CHART_HTML_CONTENT =
  '<!doctype html><html><body><script>console.log("chart");</script>Chart</body></html>';

async function captureFilenameLog(filename: string) {
  return `[log] ${filename}`;
}

async function captureEmptyLog() {
  return "";
}

type ArtifactOperation = {
  id: string;
  command: ArtifactCommand;
  filename: string;
  content?: string;
  old_str?: string;
  new_str?: string;
};

function createArtifactMessages(operations: ArtifactOperation[]): AgentMessage[] {
  const messages: AgentMessage[] = [];
  let timestamp = 1;

  for (const operation of operations) {
    messages.push({
      role: "assistant",
      timestamp,
      content: [
        {
          type: "toolCall",
          id: operation.id,
          name: "artifacts",
          arguments: {
            command: operation.command,
            filename: operation.filename,
            content: operation.content,
            old_str: operation.old_str,
            new_str: operation.new_str,
          },
        },
      ],
    } as unknown as AgentMessage);
    timestamp += 1;
    messages.push({
      role: "toolResult",
      timestamp,
      toolCallId: operation.id,
      toolName: "artifacts",
      isError: false,
      content: [{ type: "text", text: `${operation.command} ${operation.filename}` }],
    } as unknown as AgentMessage);
    timestamp += 1;
  }

  return messages;
}

function createSeededHtmlMessages(): AgentMessage[] {
  return createArtifactMessages([
    {
      id: "tool-call-1",
      command: "create",
      filename: "report.html",
      content: SEEDED_HTML_CONTENT,
    },
  ]);
}

function createTwoHtmlMessages(): AgentMessage[] {
  return createArtifactMessages([
    {
      id: "tool-call-1",
      command: "create",
      filename: "report.html",
      content: REPORT_HTML_CONTENT,
    },
    {
      id: "tool-call-2",
      command: "create",
      filename: "chart.html",
      content: CHART_HTML_CONTENT,
    },
  ]);
}

function createRewriteOperation(filename: string, content: string): ArtifactOperation {
  return {
    id: `${filename}-rewrite`,
    command: "rewrite",
    filename,
    content,
  };
}

describe("ArtifactsController", () => {
  test("syncFromMessages repopulates missing html logs", async () => {
    const controller = new ArtifactsController();
    let captureCount = 0;
    const captureHtmlLogs = async () => {
      captureCount += 1;
      return "[log] preview ready";
    };
    (controller as unknown as { captureHtmlLogs: typeof captureHtmlLogs }).captureHtmlLogs =
      captureHtmlLogs;

    await controller.syncFromMessages(createSeededHtmlMessages(), { replace: true });

    expect(captureCount).toBe(1);
    expect(controller.getSnapshot().logsByFilename["report.html"]).toBe("[log] preview ready");
  });

  test("syncFromMessages preserves existing html logs when appending unchanged html content", async () => {
    const controller = new ArtifactsController();
    let captureCount = 0;
    const captureHtmlLogs = async () => {
      captureCount += 1;
      return `[log-${captureCount}] preview ready`;
    };
    (controller as unknown as { captureHtmlLogs: typeof captureHtmlLogs }).captureHtmlLogs =
      captureHtmlLogs;

    const initialMessages = createSeededHtmlMessages();
    const appendedMessages = createArtifactMessages([
      createRewriteOperation("report.html", SEEDED_HTML_CONTENT),
    ]);

    await controller.syncFromMessages(initialMessages, { replace: true });
    await controller.syncFromMessages([...initialMessages, ...appendedMessages]);

    expect(captureCount).toBe(1);
    expect(controller.getSnapshot().logsByFilename["report.html"]).toBe("[log-1] preview ready");
  });

  test("syncFromMessages skips html log replay for non-html appends", async () => {
    const controller = new ArtifactsController();
    let captureCount = 0;
    const captureHtmlLogs = async () => {
      captureCount += 1;
      return `[log-${captureCount}] preview ready`;
    };
    (controller as unknown as { captureHtmlLogs: typeof captureHtmlLogs }).captureHtmlLogs =
      captureHtmlLogs;

    const initialMessages = createSeededHtmlMessages();
    const appendedMessages = createArtifactMessages([
      {
        id: "tool-call-2",
        command: "create",
        filename: "notes.md",
        content: "# Notes",
      },
    ]);

    await controller.syncFromMessages(initialMessages, { replace: true });
    await controller.syncFromMessages([...initialMessages, ...appendedMessages]);

    expect(captureCount).toBe(1);
    expect(controller.getSnapshot().artifacts.map((artifact) => artifact.filename)).toEqual([
      "report.html",
      "notes.md",
    ]);
  });

  test("syncFromMessages refreshes every html log when any html artifact changes", async () => {
    const controller = new ArtifactsController();
    let captureCount = 0;
    const captureHtmlLogs = async () => {
      captureCount += 1;
      return `[log-${captureCount}] preview ready`;
    };
    (controller as unknown as { captureHtmlLogs: typeof captureHtmlLogs }).captureHtmlLogs =
      captureHtmlLogs;

    const initialMessages = createTwoHtmlMessages();
    const appendedMessages = createArtifactMessages([
      createRewriteOperation(
        "report.html",
        '<!doctype html><html><body><script>console.log("report-updated");</script>Report updated</body></html>',
      ),
    ]);

    await controller.syncFromMessages(initialMessages, { replace: true });
    await controller.syncFromMessages([...initialMessages, ...appendedMessages]);

    expect(captureCount).toBe(4);
    expect(controller.getSnapshot().logsByFilename["report.html"]).toBe("[log-3] preview ready");
    expect(controller.getSnapshot().logsByFilename["chart.html"]).toBe("[log-4] preview ready");
  });

  test("syncFromMessages matches full replay for mixed artifact operations", async () => {
    const fullReplayController = new ArtifactsController();
    const incrementalController = new ArtifactsController();
    (
      fullReplayController as unknown as { captureHtmlLogs: typeof captureFilenameLog }
    ).captureHtmlLogs = captureFilenameLog;
    (
      incrementalController as unknown as { captureHtmlLogs: typeof captureFilenameLog }
    ).captureHtmlLogs = captureFilenameLog;

    const operations: ArtifactOperation[] = [
      {
        id: "tool-call-1",
        command: "create",
        filename: "report.html",
        content: REPORT_HTML_CONTENT,
      },
      {
        id: "tool-call-2",
        command: "create",
        filename: "notes.md",
        content: "# Notes",
      },
      {
        id: "tool-call-3",
        command: "update",
        filename: "notes.md",
        old_str: "# Notes",
        new_str: "# Updated Notes",
      },
      {
        id: "tool-call-4",
        command: "create",
        filename: "chart.html",
        content: CHART_HTML_CONTENT,
      },
      {
        id: "tool-call-5",
        command: "delete",
        filename: "chart.html",
      },
    ];
    const allMessages = createArtifactMessages(operations);
    const initialBatch = createArtifactMessages(operations.slice(0, 2));

    await fullReplayController.syncFromMessages(allMessages, { replace: true });
    await incrementalController.syncFromMessages(initialBatch, { replace: true });
    await incrementalController.syncFromMessages(allMessages);

    expect(incrementalController.getSnapshot()).toEqual(fullReplayController.getSnapshot());
  });

  test("syncFromMessages is idempotent for an unchanged committed prefix", async () => {
    const controller = new ArtifactsController();
    let captureCount = 0;
    const captureHtmlLogs = async () => {
      captureCount += 1;
      return `[log-${captureCount}] preview ready`;
    };
    (controller as unknown as { captureHtmlLogs: typeof captureHtmlLogs }).captureHtmlLogs =
      captureHtmlLogs;

    const messages = createArtifactMessages([
      {
        id: "tool-call-1",
        command: "create",
        filename: "report.html",
        content: REPORT_HTML_CONTENT,
      },
      {
        id: "tool-call-2",
        command: "create",
        filename: "notes.md",
        content: "# Notes",
      },
    ]);

    await controller.syncFromMessages(messages, { replace: true });
    const firstSnapshot = controller.getSnapshot();
    await controller.syncFromMessages(messages);

    expect(captureCount).toBe(1);
    expect(controller.getSnapshot()).toEqual(firstSnapshot);
  });

  test("getPreviewDocument escapes embedded script markers in the snapshot", async () => {
    const controller = new ArtifactsController();
    (controller as unknown as { captureHtmlLogs: typeof captureEmptyLog }).captureHtmlLogs =
      captureEmptyLog;

    await controller.syncFromMessages(createSeededHtmlMessages(), { replace: true });

    expect(controller.getPreviewDocument("report.html")).toContain("\\u003c/script>");
  });
});
