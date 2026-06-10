import type {
  WorkspaceCommandInspector,
  WorkspaceCommandInspectorChild,
  WorkspaceCommandDiagnosticSnapshot,
  WorkspaceCommandOutputEvent,
  WorkspaceCommandPatchSnapshot,
  WorkspaceCommandProgressEvent,
  WorkspaceCommandRollup,
  WorkspaceSessionSummary,
} from "../shared/workspace-contract";

export interface WorkspaceCommandStatusPresentation {
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
}

export interface WorkspaceCommandInspectorSection {
  id: "summary" | "trace";
  title: string;
  description: string;
  children: WorkspaceCommandInspectorChild[];
}

export interface WorkspaceCommandOutputSection {
  id: WorkspaceCommandOutputEvent["stream"];
  title: string;
  events: WorkspaceCommandOutputEvent[];
}

export interface WorkspaceCommandProgressSection {
  id: "progress";
  title: string;
  events: WorkspaceCommandProgressEvent[];
}

export interface WorkspaceCommandPatchSection {
  id: "patch";
  title: string;
  snapshots: WorkspaceCommandPatchSnapshot[];
}

export interface WorkspaceCommandDiagnosticSection {
  id: "diagnostics";
  title: string;
  snapshots: WorkspaceCommandDiagnosticSnapshot[];
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
      return { label: "Waiting", tone: "info" };
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

export function getCommandOutputSections(
  inspector: WorkspaceCommandInspector | null | undefined,
): WorkspaceCommandOutputSection[] {
  if (!inspector || inspector.outputEvents.length === 0) {
    return [];
  }

  return (["stdout", "stderr"] as const).flatMap((stream) => {
    const events = inspector.outputEvents.filter((event) => event.stream === stream);
    if (events.length === 0) {
      return [];
    }
    return [
      {
        id: stream,
        title: stream === "stdout" ? "Stdout" : "Stderr",
        events,
      },
    ];
  });
}

export function getCommandProgressSections(
  inspector: WorkspaceCommandInspector | null | undefined,
): WorkspaceCommandProgressSection[] {
  const events = inspector?.progressEvents ?? [];
  if (events.length === 0) {
    return [];
  }
  return [
    {
      id: "progress",
      title: "Progress",
      events,
    },
  ];
}

export function getCommandPatchSections(
  inspector: WorkspaceCommandInspector | null | undefined,
): WorkspaceCommandPatchSection[] {
  if (!inspector || inspector.patchSnapshots.length === 0) {
    return [];
  }
  return [
    {
      id: "patch",
      title: "Patch preview",
      snapshots: inspector.patchSnapshots,
    },
  ];
}

export function getCommandDiagnosticSections(
  inspector: WorkspaceCommandInspector | null | undefined,
): WorkspaceCommandDiagnosticSection[] {
  if (!inspector || inspector.diagnostics.length === 0) {
    return [];
  }
  return [
    {
      id: "diagnostics",
      title: "Diagnostics",
      snapshots: inspector.diagnostics,
    },
  ];
}
