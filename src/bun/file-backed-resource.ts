import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  FILE_BACKED_EDIT_CONFLICT_CODE,
  type FileBackedEditConflict,
  type FileBackedSaveMode,
} from "../shared/file-backed-edit";

export function readFileBackedVersion(path: string): string {
  try {
    if (!existsSync(path)) return `missing:${path}`;
    const stat = statSync(path);
    if (!stat.isFile()) return `not_file:${path}`;
    return fileBackedTextVersion(readFileSync(path, "utf8"));
  } catch (error) {
    return `unreadable:${path}:${error instanceof Error ? error.message : "unknown"}`;
  }
}

export function fileBackedTextVersion(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function assertFileBackedSaveAllowed<T>(input: {
  baseVersion?: string;
  current: T;
  currentVersion: string;
  mode?: FileBackedSaveMode;
}): void {
  if (input.mode === "overwrite" || input.baseVersion === undefined) return;
  if (input.currentVersion === input.baseVersion) return;
  const conflict: FileBackedEditConflict<T> = {
    code: FILE_BACKED_EDIT_CONFLICT_CODE,
    current: input.current,
    currentVersion: input.currentVersion,
    baseVersion: input.baseVersion,
  };
  const error = new Error("File changed outside svvy.") as Error & {
    code: typeof FILE_BACKED_EDIT_CONFLICT_CODE;
    conflict: FileBackedEditConflict<T>;
  };
  error.name = "FileBackedEditConflictError";
  error.code = FILE_BACKED_EDIT_CONFLICT_CODE;
  error.conflict = conflict;
  throw error;
}

export function writeTextFileAtomically(path: string, content: string): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const tempPath = join(directory, `.${Date.now()}-${randomUUID()}.tmp`);
  writeFileSync(tempPath, content);
  renameSync(tempPath, path);
}
