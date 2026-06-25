import * as Schema from "effect/Schema";

export const SnippetSourceSchema = Schema.Literals(["svvy", "claude", "pi"]);
export type SnippetSource = typeof SnippetSourceSchema.Type;

export const SnippetMetadataSchema = Schema.Struct({
  description: Schema.Union([Schema.String, Schema.Null]),
  argumentHint: Schema.Union([Schema.String, Schema.Null]),
});
export type SnippetMetadata = typeof SnippetMetadataSchema.Type;

export const ComposerSnippetMentionSchema = Schema.Struct({
  id: Schema.String,
  snippetId: Schema.String,
  source: SnippetSourceSchema,
  title: Schema.String,
  token: Schema.String,
  body: Schema.String,
  path: Schema.optionalKey(Schema.String),
  contentHash: Schema.String,
  arguments: Schema.Array(Schema.String),
  metadata: SnippetMetadataSchema,
});
export type ComposerSnippetMention = typeof ComposerSnippetMentionSchema.Type;

export const ComposerAttachmentKindSchema = Schema.Literals(["file", "folder", "image"]);
export type ComposerAttachmentKind = typeof ComposerAttachmentKindSchema.Type;

export const ComposerAttachmentSchema = Schema.Struct({
  id: Schema.String,
  kind: ComposerAttachmentKindSchema,
  name: Schema.String,
  path: Schema.String,
  workspaceRelativePath: Schema.optionalKey(Schema.String),
  mimeType: Schema.optionalKey(Schema.String),
  sizeBytes: Schema.optionalKey(Schema.Number),
  dataBase64: Schema.optionalKey(Schema.String),
});
export type ComposerAttachment = typeof ComposerAttachmentSchema.Type;

export const COMPOSER_ATTACHMENT_TEXT_SIGNATURE_PREFIX = "svvy:composer-attachments:v1:";

export function composerAttachmentPromptText(attachments: readonly ComposerAttachment[]): string {
  if (attachments.length === 0) return "";
  const lines = attachments.map((attachment) => {
    const path = attachment.workspaceRelativePath ?? attachment.path;
    return `- ${attachment.kind} path: ${path} (name: ${attachment.name})`;
  });
  return `Attached files are available at these workspace-relative paths:\n${lines.join("\n")}`;
}

export function serializeComposerAttachmentTextSignature(
  attachments: readonly ComposerAttachment[],
): string {
  return `${COMPOSER_ATTACHMENT_TEXT_SIGNATURE_PREFIX}${JSON.stringify(
    attachments.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      name: attachment.name,
      path: attachment.path,
      workspaceRelativePath: attachment.workspaceRelativePath,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    })),
  )}`;
}
