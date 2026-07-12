import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import type {
  DesktopImportComposerAttachmentInput,
  DesktopWorkspaceAttachmentResult,
  DesktopWorkspacePathTarget,
} from "@svvy/desktop";
import type { ComposerAttachment } from "@svvy/core";

type WorkspacePathKind = "file" | "folder" | "missing";

function workspacePathKind(absolutePath: string): WorkspacePathKind {
  try {
    return statSync(absolutePath).isDirectory() ? "folder" : "file";
  } catch {
    return "missing";
  }
}

function sanitizeAttachmentName(name: string): string {
  const sanitized = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "attachment";
}

function imageMimeTypeFromPath(path: string): string | null {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  return null;
}

function importedAttachmentPath(
  cwd: string,
  name: string,
): { absolutePath: string; workspaceRelativePath: string } {
  const relativePath = join(
    ".svvy",
    "attachments",
    "user-input",
    `${randomUUID()}-${sanitizeAttachmentName(name)}`,
  );
  const absolutePath = resolve(cwd, relativePath);
  mkdirSync(join(cwd, ".svvy", "attachments", "user-input"), { recursive: true });
  return { absolutePath, workspaceRelativePath: relativePath.split(sep).join("/") };
}

function materializeSelectedAttachment(
  cwd: string,
  selectedPath: string,
): ComposerAttachment | null {
  const absolutePath = resolve(selectedPath);
  const kind = workspacePathKind(absolutePath);
  if (kind === "missing") return null;

  const workspaceRelativePath = relative(cwd, absolutePath);
  const isWorkspacePath =
    workspaceRelativePath !== "" &&
    !workspaceRelativePath.startsWith("..") &&
    !workspaceRelativePath.includes(`..${sep}`) &&
    resolve(cwd, workspaceRelativePath) === absolutePath;
  const normalizedPath = (isWorkspacePath ? workspaceRelativePath : absolutePath)
    .split(sep)
    .join("/");
  const stats = statSync(absolutePath);
  const mimeType = kind === "file" ? imageMimeTypeFromPath(absolutePath) : null;

  if (kind === "file" && !isWorkspacePath) {
    const imported = importedAttachmentPath(cwd, basename(absolutePath));
    copyFileSync(absolutePath, imported.absolutePath);
    const importedMimeType = mimeType ?? imageMimeTypeFromPath(imported.absolutePath);
    return {
      id: `attachment:${imported.workspaceRelativePath}`,
      kind: importedMimeType?.startsWith("image/") ? "image" : "file",
      name: basename(absolutePath),
      path: imported.workspaceRelativePath,
      workspaceRelativePath: imported.workspaceRelativePath,
      mimeType: importedMimeType ?? undefined,
      sizeBytes: stats.size,
      dataBase64: importedMimeType?.startsWith("image/")
        ? readFileSync(imported.absolutePath).toString("base64")
        : undefined,
    };
  }

  return {
    id: `${kind}:${normalizedPath}`,
    kind: mimeType?.startsWith("image/") ? "image" : kind,
    name: basename(absolutePath),
    path: normalizedPath,
    workspaceRelativePath: isWorkspacePath ? workspaceRelativePath.split(sep).join("/") : undefined,
    mimeType: mimeType ?? undefined,
    sizeBytes: kind === "file" ? stats.size : undefined,
    dataBase64: mimeType?.startsWith("image/")
      ? readFileSync(absolutePath).toString("base64")
      : undefined,
  };
}

export function materializeSelectedWorkspaceAttachments(input: {
  readonly cwd: string;
  readonly selectedPaths: readonly string[];
}): DesktopWorkspaceAttachmentResult {
  const attachments: ComposerAttachment[] = [];
  const skippedPaths: string[] = [];
  for (const selectedPath of input.selectedPaths) {
    if (!selectedPath) continue;
    const attachment = materializeSelectedAttachment(input.cwd, selectedPath);
    if (!attachment) {
      skippedPaths.push(selectedPath);
      continue;
    }
    attachments.push(attachment);
  }
  return { attachments, skippedPaths };
}

export function importWorkspaceComposerAttachments(input: {
  readonly cwd: string;
  readonly attachments: readonly DesktopImportComposerAttachmentInput[];
}): DesktopWorkspaceAttachmentResult {
  const attachments: ComposerAttachment[] = [];
  const skippedPaths: string[] = [];
  for (const attachment of input.attachments) {
    try {
      const name = sanitizeAttachmentName(attachment.name || "attachment");
      const imported = importedAttachmentPath(input.cwd, name);
      const bytes = Buffer.from(attachment.dataBase64, "base64");
      writeFileSync(imported.absolutePath, bytes);
      const mimeType =
        attachment.mimeType || imageMimeTypeFromPath(name) || "application/octet-stream";
      attachments.push({
        id: `attachment:${imported.workspaceRelativePath}`,
        kind: mimeType.startsWith("image/") ? "image" : "file",
        name,
        path: imported.workspaceRelativePath,
        workspaceRelativePath: imported.workspaceRelativePath,
        mimeType,
        sizeBytes: bytes.byteLength,
        dataBase64: mimeType.startsWith("image/") ? attachment.dataBase64 : undefined,
      });
    } catch {
      skippedPaths.push(attachment.name);
    }
  }
  return { attachments, skippedPaths };
}

export function resolveWorkspacePathTarget(input: {
  readonly cwd: string;
  readonly workspaceRelativePath: string;
}): DesktopWorkspacePathTarget {
  const normalizedRelativePath = input.workspaceRelativePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^@/, "");
  if (
    !normalizedRelativePath ||
    normalizedRelativePath.startsWith("/") ||
    normalizedRelativePath.includes("\0") ||
    normalizedRelativePath.split("/").includes("..")
  ) {
    return { kind: "missing" };
  }

  const absolutePath = resolve(input.cwd, normalizedRelativePath);
  const root = resolve(input.cwd);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) {
    return { kind: "missing" };
  }
  const kind = workspacePathKind(absolutePath);
  return kind === "missing" ? { kind } : { kind, absolutePath };
}
