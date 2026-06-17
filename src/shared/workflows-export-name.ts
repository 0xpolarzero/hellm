export function isValidWorkflowExportName(exportName: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(exportName);
}
