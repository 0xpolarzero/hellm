import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspaceWorkflowSource } from "../workspaceApi";
import type { WorkflowEntry, WorkflowLaunchField } from "./workflowsApi";
import { loadWorkflowSource, loadWorkflowLaunchFields, launchWorkflowRun } from "./workflowsApi";
import {
  buildLaunchInput,
  initialLaunchValues,
  launchValidationErrors,
  parseFreeformInput,
} from "./launchFieldLogic";

export type WorkflowDetailTab = "launch" | "source";

export type WorkflowDetailState = {
  tab: WorkflowDetailTab;
  setTab: (tab: WorkflowDetailTab) => void;
  source: WorkspaceWorkflowSource | null;
  fields: WorkflowLaunchField[];
  loadingDetail: boolean;
  detailError: string | null;
  fieldValues: Record<string, string>;
  setFieldValue: (key: string, value: string) => void;
  freeform: string;
  setFreeform: (value: string) => void;
  fieldErrors: Record<string, string>;
  launching: boolean;
  launchMessage: string | null;
  launchError: boolean;
  launch: () => Promise<{ runId: string; workflowKey: string } | null>;
};

/**
 * Loads source + launch fields for the selected entry and owns the launch form
 * state. Only Local/Remote entries fetch source + graph fields (prompts and
 * schedules expose neither over the workspace API), so for those we degrade to
 * the freeform-JSON launch form without erroring.
 */
export function useWorkflowDetail(entry: WorkflowEntry | null): WorkflowDetailState {
  const [tab, setTab] = useState<WorkflowDetailTab>("launch");
  const [source, setSource] = useState<WorkspaceWorkflowSource | null>(null);
  const [fields, setFields] = useState<WorkflowLaunchField[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [freeform, setFreeform] = useState("{}");
  const [launching, setLaunching] = useState(false);
  const [launchMessage, setLaunchMessage] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState(false);

  const supportsSource = entry?.segment === "local" || entry?.segment === "remote";
  const entryKey = entry?.key ?? null;

  useEffect(() => {
    setTab("launch");
    setSource(null);
    setFields([]);
    setDetailError(null);
    setFieldValues({});
    setFreeform("{}");
    setLaunchMessage(null);
    setLaunchError(false);
    if (!entryKey || !supportsSource) {
      setLoadingDetail(false);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    Promise.allSettled([loadWorkflowSource(entryKey), loadWorkflowLaunchFields(entryKey)])
      .then(([sourceResult, fieldsResult]) => {
        if (cancelled) return;
        if (sourceResult.status === "fulfilled") setSource(sourceResult.value);
        if (fieldsResult.status === "fulfilled") {
          setFields(fieldsResult.value);
          setFieldValues(initialLaunchValues(fieldsResult.value));
        }
        if (sourceResult.status === "rejected" && fieldsResult.status === "rejected") {
          const reason = sourceResult.reason;
          setDetailError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entryKey, supportsSource]);

  const setFieldValue = useCallback((key: string, value: string) => {
    setFieldValues((current) => ({ ...current, [key]: value }));
    setLaunchMessage(null);
    setLaunchError(false);
  }, []);

  const fieldErrors = useMemo(
    () => (fields.length > 0 ? launchValidationErrors(fields, fieldValues) : {}),
    [fields, fieldValues],
  );

  const launch = useCallback(async () => {
    if (!entry) return null;
    let input: Record<string, unknown>;
    try {
      input = fields.length > 0 ? buildLaunchInput(fields, fieldValues) : parseFreeformInput(freeform);
    } catch (error) {
      setLaunchError(true);
      setLaunchMessage(error instanceof Error ? error.message : String(error));
      return null;
    }
    if (fields.length > 0 && Object.keys(fieldErrors).length > 0) {
      setLaunchError(true);
      setLaunchMessage("Fix the highlighted fields before launching.");
      return null;
    }
    setLaunching(true);
    setLaunchError(false);
    setLaunchMessage(`Launching ${entry.name}…`);
    try {
      const result = await launchWorkflowRun(entry.key, input);
      setLaunchMessage(`Launched run ${result.runId}.`);
      return { runId: result.runId, workflowKey: result.workflow };
    } catch (error) {
      setLaunchError(true);
      setLaunchMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setLaunching(false);
    }
  }, [entry, fields, fieldValues, fieldErrors, freeform]);

  return {
    tab,
    setTab,
    source,
    fields,
    loadingDetail,
    detailError,
    fieldValues,
    setFieldValue,
    freeform,
    setFreeform,
    fieldErrors,
    launching,
    launchMessage,
    launchError,
    launch,
  };
}
