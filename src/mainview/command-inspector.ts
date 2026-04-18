import type {
  WorkspaceCommandInspector,
  WorkspaceCommandInspectorChild,
  WorkspaceCommandRollup,
  WorkspaceSessionSummary,
} from "./chat-rpc";

export interface WorkspaceCommandStatusPresentation {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger";
}

export interface WorkspaceCommandInspectorSection {
  id: "summary" | "trace";
  title: string;
  description: string;
  children: WorkspaceCommandInspectorChild[];
}

export function getVisibleCommandRollups(
  session: WorkspaceSessionSummary | null | undefined,
): WorkspaceCommandRollup[] {
  return session?.commandRollups ?? [];
}

export function getWorkspaceCommandStatusPresentation(
  status: WorkspaceCommandInspector["status"],
): WorkspaceCommandStatusPresentation {
  switch (status) {
    case "succeeded":
      return { label: "Succeeded", tone: "success" };
    case "failed":
      return { label: "Failed", tone: "danger" };
    case "running":
      return { label: "Running", tone: "warning" };
    case "waiting":
      return { label: "Waiting", tone: "warning" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    default:
      return { label: "Requested", tone: "neutral" };
  }
}

export function getCommandInspectorSections(
  inspector: WorkspaceCommandInspector | null | undefined,
): WorkspaceCommandInspectorSection[] {
  if (!inspector) {
    return [];
  }

  const sections: WorkspaceCommandInspectorSection[] = [];
  if (inspector.summaryChildren.length > 0) {
    sections.push({
      id: "summary",
      title: "Rollup detail",
      description: "Summary-visible child commands that shape the parent rollup.",
      children: inspector.summaryChildren,
    });
  }

  if (inspector.traceChildren.length > 0) {
    sections.push({
      id: "trace",
      title: "Trace detail",
      description: "Nested trace commands available for deeper inspection only.",
      children: inspector.traceChildren,
    });
  }

  return sections;
}
