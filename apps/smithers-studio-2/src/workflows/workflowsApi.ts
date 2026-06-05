import type { WorkspaceWorkflowSource } from "../workspaceApi";
import { getWorkspaceWorkflowSource, getWorkspaceWorkflowGraph } from "../workspaceApi";
import type { WorkflowSegment } from "./WorkflowSegment";

/**
 * A launchable item across all four segments. The list/detail components are
 * segment-agnostic and read this single shape; each loader below maps its raw
 * HTTP payload onto it so the UI stays uniform whether the source is a local
 * workflow, a remote (jjhub) workflow, a prompt, or a schedule.
 */
export type WorkflowEntry = {
  /** Stable id used for selection + as the launch `workflow` key. */
  key: string;
  /** Human label shown in the list. */
  name: string;
  /** One-line summary under the name. */
  description: string | null;
  segment: WorkflowSegment;
  /** Local/remote workflows can carry a UI; prompts/schedules do not. */
  hasUi: boolean;
  /** Schedules carry their cron pattern; everything else is null. */
  schedulePattern: string | null;
  /** Whether a schedule is currently enabled (schedules only). */
  scheduleEnabled: boolean | null;
};

export type WorkflowLaunchField = {
  key: string;
  name: string;
  type: string | null;
  defaultValue: string | null;
  required: boolean;
};

export type WorkflowLaunchResult = {
  runId: string;
  workflow: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/__smithers_studio/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json().catch(() => undefined)) as unknown;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Workflow API failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  if (payload === undefined) {
    throw new Error("Workflow gateway returned an empty response (is the gateway running?)");
  }
  return payload as T;
}

type RawWorkflow = { key: string; readableName?: string | null; name?: string | null; description?: string | null; hasUi?: boolean };
type RawJjhubWorkflow = { id: number; name: string; path?: string | null; isActive?: boolean };
type RawPrompt = { id: string; entryFile?: string | null };
type RawCron = { cronId: string; workflow: string; pattern: string; enabled?: boolean };

function localEntry(raw: RawWorkflow): WorkflowEntry {
  return {
    key: raw.key,
    name: raw.readableName?.trim() || raw.name?.trim() || raw.key,
    description: raw.description?.trim() || null,
    segment: "local",
    hasUi: Boolean(raw.hasUi),
    schedulePattern: null,
    scheduleEnabled: null,
  };
}

function remoteEntry(raw: RawJjhubWorkflow): WorkflowEntry {
  return {
    key: `jjhub:${raw.id}`,
    name: raw.name,
    description: raw.path ?? null,
    segment: "remote",
    hasUi: false,
    schedulePattern: null,
    scheduleEnabled: null,
  };
}

function promptEntry(raw: RawPrompt): WorkflowEntry {
  return {
    key: raw.id,
    name: raw.id,
    description: raw.entryFile ?? null,
    segment: "prompts",
    hasUi: false,
    schedulePattern: null,
    scheduleEnabled: null,
  };
}

function scheduleEntry(raw: RawCron): WorkflowEntry {
  return {
    key: raw.cronId,
    name: raw.workflow,
    description: raw.pattern,
    segment: "schedules",
    hasUi: false,
    schedulePattern: raw.pattern,
    scheduleEnabled: raw.enabled ?? true,
  };
}

export async function listLocalWorkflows(): Promise<WorkflowEntry[]> {
  const payload = await api<{ workflows: RawWorkflow[] }>("/workflows");
  return (payload.workflows ?? []).map(localEntry);
}

export async function listRemoteWorkflows(): Promise<WorkflowEntry[]> {
  const payload = await api<{ workflows: RawJjhubWorkflow[] }>("/jjhub-workflows");
  return (payload.workflows ?? []).map(remoteEntry);
}

export async function listPromptWorkflows(): Promise<WorkflowEntry[]> {
  const payload = await api<{ prompts: RawPrompt[] }>("/prompts");
  return (payload.prompts ?? []).map(promptEntry);
}

export async function listScheduleWorkflows(): Promise<WorkflowEntry[]> {
  const payload = await api<{ crons: RawCron[] }>("/crons");
  return (payload.crons ?? []).map(scheduleEntry);
}

/** Reuse the shared workspace source endpoint for source/summary viewing. */
export async function loadWorkflowSource(key: string): Promise<WorkspaceWorkflowSource> {
  return getWorkspaceWorkflowSource(key);
}

/** Launch fields come from the workflow graph; prompts/schedules have none. */
export async function loadWorkflowLaunchFields(key: string): Promise<WorkflowLaunchField[]> {
  const graph = await getWorkspaceWorkflowGraph(key);
  return graph.fields ?? [];
}

/**
 * Start a run. POSTs to the run-create route and returns the new run id so the
 * caller can hand off to the Runs surface with that run selected.
 */
export async function launchWorkflowRun(workflow: string, input: Record<string, unknown>): Promise<WorkflowLaunchResult> {
  return api<WorkflowLaunchResult>("/runs", {
    method: "POST",
    body: JSON.stringify({ workflow, input }),
  });
}
