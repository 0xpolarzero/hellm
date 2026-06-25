import { describe, expect, it } from "bun:test";
import { serializeComposerAttachmentTextSignature, type RuntimeSubmittedMessage } from "@svvy/core";
import {
  buildPiUserMessageFromRuntimeSubmittedMessage,
  runtimeSubmittedMessagePromptText,
} from "./messages";

describe("pi submitted message adapter", () => {
  it("builds pi user messages from runtime submitted messages", () => {
    const message = {
      text: "Inspect this runtime submission.",
      attachments: [
        {
          id: "attachment_file_01",
          kind: "file",
          name: "app.ts",
          path: "/repo/src/app.ts",
          workspaceRelativePath: "src/app.ts",
          mimeType: "text/typescript",
          sizeBytes: 1234,
        },
        {
          id: "attachment_image_01",
          kind: "image",
          name: "screenshot.png",
          path: "/repo/screenshots/screenshot.png",
          workspaceRelativePath: "screenshots/screenshot.png",
          dataBase64: "ZmFrZS1pbWFnZQ==",
          mimeType: "image/png",
          sizeBytes: 4321,
        },
      ],
      snippetProvenance: [
        {
          mentionId: "mention_01",
          snippetId: "snippet_01",
          source: "svvy",
          title: "Review checklist",
          path: "/repo/.svvy/snippets/review.md",
          contentHash: "hash_review",
          arguments: ["strict"],
          resolvedText: "Use the strict checklist.",
        },
      ],
    } satisfies RuntimeSubmittedMessage;

    const piMessage = buildPiUserMessageFromRuntimeSubmittedMessage(message, {
      timestamp: 1_775_000_000_000,
    });

    expect(piMessage.role).toBe("user");
    expect(piMessage.timestamp).toBe(1_775_000_000_000);
    expect(piMessage.content).toHaveLength(3);
    expect(piMessage.content[0]).toEqual({
      type: "text",
      text: "Inspect this runtime submission.",
    });
    expect(piMessage.content[1]).toEqual({
      type: "text",
      text: [
        "Attached files are available at these workspace-relative paths:",
        "- file path: src/app.ts (name: app.ts)",
        "- image path: screenshots/screenshot.png (name: screenshot.png)",
      ].join("\n"),
      textSignature: serializeComposerAttachmentTextSignature([
        {
          id: "attachment_file_01",
          kind: "file",
          name: "app.ts",
          path: "/repo/src/app.ts",
          workspaceRelativePath: "src/app.ts",
          mimeType: "text/typescript",
          sizeBytes: 1234,
        },
        {
          id: "attachment_image_01",
          kind: "image",
          name: "screenshot.png",
          path: "/repo/screenshots/screenshot.png",
          workspaceRelativePath: "screenshots/screenshot.png",
          mimeType: "image/png",
          sizeBytes: 4321,
        },
      ]),
    });
    expect(piMessage.content[2]).toEqual({
      type: "image",
      data: "ZmFrZS1pbWFnZQ==",
      mimeType: "image/png",
    });
    expect(piMessage.svvyMetadata?.snippetProvenance).toEqual(message.snippetProvenance);
    expect(piMessage.svvyMetadata?.snippetProvenance?.[0]?.arguments).not.toBe(
      message.snippetProvenance?.[0]?.arguments,
    );
  });

  it("projects the prompt text pi receives for queue comparisons", () => {
    expect(
      runtimeSubmittedMessagePromptText({
        text: "Review it.",
        attachments: [
          {
            kind: "file",
            name: "app.ts",
            path: "/repo/src/app.ts",
            workspaceRelativePath: "src/app.ts",
          },
        ],
      }),
    ).toBe(
      [
        "Review it.",
        "Attached files are available at these workspace-relative paths:",
        "- file path: src/app.ts (name: app.ts)",
      ].join("\n"),
    );
  });
});
