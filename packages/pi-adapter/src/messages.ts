import {
  composerAttachmentPromptText,
  serializeComposerAttachmentTextSignature,
  type ComposerAttachment,
  type RuntimeSubmittedMessage,
  type SentSnippetProvenance,
} from "@svvy/core";

interface SvvyPiUserMessageMetadata {
  snippetProvenance?: SentSnippetProvenance[];
}

interface SvvyPiTextContent {
  readonly type: "text";
  readonly text: string;
  readonly textSignature?: string;
}

interface SvvyPiImageContent {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

type SvvyPiUserMessageContent = string | Array<SvvyPiTextContent | SvvyPiImageContent>;

interface SvvyPiUserMessage {
  readonly role: "user";
  readonly timestamp: number;
  readonly content: SvvyPiUserMessageContent;
  svvyMetadata?: SvvyPiUserMessageMetadata;
}

type RuntimeSubmittedMessagePiOptions = {
  timestamp: number;
};

function runtimeAttachmentAsComposerAttachment(
  attachment: NonNullable<RuntimeSubmittedMessage["attachments"]>[number],
  index: number,
): ComposerAttachment | null {
  if (!attachment.path) {
    return null;
  }
  return {
    id: attachment.id ?? `submitted-${index}`,
    kind: attachment.kind,
    name: attachment.name ?? attachment.path.split(/[\\/]/).at(-1) ?? attachment.path,
    path: attachment.path,
    ...(attachment.workspaceRelativePath !== undefined
      ? { workspaceRelativePath: attachment.workspaceRelativePath }
      : {}),
    ...(attachment.mimeType !== undefined ? { mimeType: attachment.mimeType } : {}),
    ...(attachment.sizeBytes !== undefined ? { sizeBytes: attachment.sizeBytes } : {}),
  };
}

function runtimeMessageComposerAttachments(
  message: RuntimeSubmittedMessage,
): readonly ComposerAttachment[] {
  return (message.attachments ?? []).flatMap((attachment, index) => {
    const composerAttachment = runtimeAttachmentAsComposerAttachment(attachment, index);
    return composerAttachment ? [composerAttachment] : [];
  });
}

export function buildPiUserMessageFromRuntimeSubmittedMessage(
  message: RuntimeSubmittedMessage,
  options: RuntimeSubmittedMessagePiOptions,
): SvvyPiUserMessage {
  const piMessage: SvvyPiUserMessage = {
    role: "user",
    timestamp: options.timestamp,
    content: buildPiUserMessageContentFromRuntimeSubmittedMessage(message),
  };
  if (message.snippetProvenance?.length) {
    piMessage.svvyMetadata = {
      snippetProvenance: message.snippetProvenance.map((item) => ({
        ...item,
        arguments: [...item.arguments],
      })),
    };
  }
  return piMessage;
}

function buildPiUserMessageContentFromRuntimeSubmittedMessage(
  message: RuntimeSubmittedMessage,
): SvvyPiUserMessage["content"] {
  const content: Array<SvvyPiTextContent | SvvyPiImageContent> = [];
  const text = message.text.trim();
  if (text) {
    content.push({ type: "text", text });
  }

  const composerAttachments = runtimeMessageComposerAttachments(message);
  const attachmentText = composerAttachmentPromptText(composerAttachments);
  if (attachmentText) {
    content.push({
      type: "text",
      text: attachmentText,
      textSignature: serializeComposerAttachmentTextSignature(composerAttachments),
    });
  }

  for (const attachment of message.attachments ?? []) {
    if (attachment.kind !== "image" || !attachment.dataBase64 || !attachment.mimeType) {
      continue;
    }
    content.push({
      type: "image",
      data: attachment.dataBase64,
      mimeType: attachment.mimeType,
    });
  }

  return content.length > 0 ? content : [{ type: "text", text: "" }];
}

export function runtimeSubmittedMessagePromptText(message: RuntimeSubmittedMessage): string {
  const content = buildPiUserMessageContentFromRuntimeSubmittedMessage(message);
  if (typeof content === "string") {
    return content;
  }
  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      if (block.type === "image") {
        return "[image]";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
