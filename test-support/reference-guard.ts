import { existsSync, readdirSync, type Dirent } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");

const REQUIRED_REFERENCES = [
  { name: "pi-mono", path: "docs/references/pi-mono" },
  { name: "smithers", path: "docs/references/smithers" },
] as const;

export interface ReferenceStatus {
  name: string;
  path: string;
  populated: boolean;
  fileCount: number;
}

function hasReferencePayloadEntries(entries: Dirent[]): boolean {
  return entries.some((entry) => entry.name !== ".git");
}

export function checkReferences(): {
  allPopulated: boolean;
  references: ReferenceStatus[];
} {
  const references = REQUIRED_REFERENCES.map((ref) => {
    const fullPath = resolve(REPO_ROOT, ref.path);
    let populated = false;
    let fileCount = 0;

    if (existsSync(fullPath)) {
      try {
        const entries = readdirSync(fullPath, { withFileTypes: true });
        fileCount = entries.length;
        populated = fileCount > 0 && hasReferencePayloadEntries(entries);
      } catch {
        populated = false;
      }
    }

    return { name: ref.name, path: ref.path, populated, fileCount };
  });

  return {
    allPopulated: references.every((ref) => ref.populated),
    references,
  };
}

export function warnIfReferencesMissing(): void {
  const { allPopulated, references } = checkReferences();
  if (allPopulated) return;

  const missing = references.filter((ref) => !ref.populated);
  console.warn(
    `[hellm:references] Warning: local references not populated: ${missing.map((r) => r.name).join(", ")}. ` +
    `Run 'git submodule update --init --recursive' to populate. ` +
    `Reference-first validation against pi/smithers cannot be performed until these are available.`,
  );
}

export function assertReferencesPopulated(): void {
  const { allPopulated, references } = checkReferences();
  if (allPopulated) {
    return;
  }

  const missing = references
    .filter((reference) => !reference.populated)
    .map((reference) => `${reference.name} (${reference.path})`)
    .join(", ");
  throw new Error(
    `[hellm:references] Missing local references: ${missing}. ` +
    `Initialize with 'git submodule update --init --recursive' before implementation-review validation.`,
  );
}
