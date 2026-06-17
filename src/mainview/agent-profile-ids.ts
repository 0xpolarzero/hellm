import { isValidWorkflowExportName } from "../shared/workflows-export-name";

export function createWorkflowAgentId(baseName: string, existingIds: Iterable<string>): string {
  const words = baseName.match(/[A-Za-z0-9]+/g) ?? [];
  const camelName = words
    .map((word, index) => {
      const normalized = word.toLowerCase();
      return index === 0
        ? normalized
        : `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
    })
    .join("");
  const exportName = /^[A-Za-z_$]/.test(camelName) ? camelName : `workflowAgent${camelName}`;
  const prefix = (exportName || "workflowAgent").slice(0, 36);
  const existing = new Set(existingIds);
  let index = 1;
  let id = prefix;
  while (existing.has(id)) {
    index += 1;
    id = `${prefix}${index}`;
  }
  if (!isValidWorkflowExportName(id)) {
    return createWorkflowAgentId("workflow agent", existing);
  }
  return id;
}
