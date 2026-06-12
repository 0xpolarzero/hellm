export const FILE_BACKED_EDIT_CONFLICT_CODE = "file_backed_edit_conflict" as const;

export type FileBackedSaveMode = "compare-and-swap" | "overwrite";

export interface FileBackedEditConflict<T> {
  code: typeof FILE_BACKED_EDIT_CONFLICT_CODE;
  current: T;
  currentVersion: string;
  baseVersion: string;
}

export class FileBackedEditConflictError<T> extends Error {
  readonly code = FILE_BACKED_EDIT_CONFLICT_CODE;
  readonly conflict: FileBackedEditConflict<T>;

  constructor(conflict: FileBackedEditConflict<T>, message = "File changed outside svvy.") {
    super(message);
    this.name = "FileBackedEditConflictError";
    this.conflict = conflict;
  }
}

export function isFileBackedEditConflictError<T = unknown>(
  error: unknown,
): error is FileBackedEditConflictError<T> {
  return (
    error instanceof FileBackedEditConflictError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === FILE_BACKED_EDIT_CONFLICT_CODE &&
      typeof (error as { conflict?: unknown }).conflict === "object")
  );
}
