import * as Schema from "effect/Schema";

import type { AbsolutePath, SnippetId } from "./ids";

export const DiscoveredSnippetSourceSchema = Schema.Literals(["claude", "pi"]);
export type DiscoveredSnippetSource = typeof DiscoveredSnippetSourceSchema.Type;

export const DiscoveredSnippetScopeSchema = Schema.Literals(["user", "workspace"]);
export type DiscoveredSnippetScope = typeof DiscoveredSnippetScopeSchema.Type;

export const SnippetSourceSchema = Schema.Literals(["svvy", "claude", "pi"]);
export type SnippetSource = typeof SnippetSourceSchema.Type;

export const SnippetMetadataSchema = Schema.Struct({
  description: Schema.Union([Schema.String, Schema.Null]),
  argumentHint: Schema.Union([Schema.String, Schema.Null]),
});
export type SnippetMetadata = typeof SnippetMetadataSchema.Type;

export function discoveredHostSnippetId(identity: {
  readonly source: DiscoveredSnippetSource;
  readonly scope: DiscoveredSnippetScope;
  readonly path: AbsolutePath;
}): SnippetId {
  return `${identity.source}:${identity.scope}:${identity.path}` as SnippetId;
}

export function parseSnippetMarkdown(markdown: string): {
  body: string;
  metadata: SnippetMetadata;
} {
  const normalized = markdown.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) {
    return {
      body: normalized,
      metadata: emptySnippetMetadata(),
    };
  }

  const lineBreak = normalized.startsWith("---\r\n") ? "\r\n" : "\n";
  const lines = normalized.split(lineBreak);
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && (line === "---" || line === "..."),
  );
  if (closingIndex < 0) {
    return {
      body: normalized,
      metadata: emptySnippetMetadata(),
    };
  }

  const frontmatter = lines.slice(1, closingIndex).join("\n");
  return {
    body: lines.slice(closingIndex + 1).join(lineBreak),
    metadata: parseSnippetMetadata(frontmatter),
  };
}

function emptySnippetMetadata(): SnippetMetadata {
  return {
    description: null,
    argumentHint: null,
  };
}

function parseSnippetMetadata(frontmatter: string): SnippetMetadata {
  const metadata: { description: string | null; argumentHint: string | null } = {
    description: null,
    argumentHint: null,
  };
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    const value = parseYamlStringScalar(match[2] ?? "");
    if (key === "description") {
      metadata.description = value;
    } else if (key === "argument-hint") {
      metadata.argumentHint = value;
    }
  }
  return metadata;
}

function parseYamlStringScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

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
