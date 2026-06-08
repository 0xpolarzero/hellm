import { create } from "zustand";
import { useChatStore } from "../chat/chatStore";
import { useNotificationsStore } from "../notifications/notificationsStore";
import {
  filterPending,
  gateLabel,
  NOW_MS,
  orderHistory,
  SEEDED_DECISIONS,
  SEEDED_GATES,
  shortRunId,
  type ApprovalDecision,
  type ApprovalGate,
} from "./approvals";

/**
 * The approvals store: the seeded pending gates and the decision history, plus
 * the segment, selection, deny-confirmation, and per-gate note state the card
 * and canvas read. Deciding a gate migrates it out of `gates` into `decisions`
 * and echoes feedback the same way the vcs/issues stores do (a chat line and a
 * transient toast), since this PWA has no gateway yet.
 *
 * The clock is the fixed {@link NOW_MS} anchor, so wait-times and resolved
 * timestamps are deterministic.
 */
export type ApprovalsTab = "pending" | "history";

type ApprovalsState = {
  tab: ApprovalsTab;
  gates: ApprovalGate[];
  decisions: ApprovalDecision[];
  selectedId: string | null;
  /** The gate awaiting deny confirmation; non-null reveals the inline confirm row. */
  pendingDenyId: string | null;
  /** The gate currently being approved/denied, for the in-flight row/button state. */
  actingId: string | null;
  /** Per-gate draft decision note, mirroring ApprovalCard's noteByRun. */
  noteById: Record<string, string>;
  nowMs: number;
  setTab: (tab: ApprovalsTab) => void;
  select: (id: string) => void;
  setNote: (id: string, note: string) => void;
  approve: (id: string) => void;
  requestDeny: (id: string) => void;
  cancelDeny: () => void;
  confirmDeny: (id: string) => void;
};

/** The ids visible in a given segment, in their displayed order. */
function visibleIds(state: { tab: ApprovalsTab; gates: ApprovalGate[]; decisions: ApprovalDecision[] }): string[] {
  return state.tab === "pending"
    ? filterPending(state.gates).map((gate) => gate.id)
    : orderHistory(state.decisions).map((decision) => decision.id);
}

/**
 * Reconcile the selection against the now-visible list, porting Swift
 * syncSelection(): keep the current selection when it is still visible; else
 * select the first visible row; clear to null when the list is empty.
 */
function syncSelection(state: {
  tab: ApprovalsTab;
  gates: ApprovalGate[];
  decisions: ApprovalDecision[];
  selectedId: string | null;
}): string | null {
  const ids = visibleIds(state);
  if (state.selectedId && ids.includes(state.selectedId)) return state.selectedId;
  return ids.length > 0 ? ids[0] : null;
}

export const useApprovalsStore = create<ApprovalsState>((set, get) => ({
  tab: "pending",
  gates: SEEDED_GATES,
  decisions: SEEDED_DECISIONS,
  // Auto-select the first pending gate so the detail pane is populated on load.
  selectedId: syncSelection({
    tab: "pending",
    gates: SEEDED_GATES,
    decisions: SEEDED_DECISIONS,
    selectedId: null,
  }),
  pendingDenyId: null,
  actingId: null,
  noteById: {},
  nowMs: NOW_MS,

  setTab: (tab) =>
    set((state) => {
      const selectedId = syncSelection({ ...state, tab });
      // Switching segments abandons any in-progress deny confirmation.
      return { tab, selectedId, pendingDenyId: null };
    }),

  select: (id) => set({ selectedId: id }),

  setNote: (id, note) =>
    set((state) => ({ noteById: { ...state.noteById, [id]: note } })),

  approve: (id) => {
    const { gates, decisions, noteById } = get();
    const gate = gates.find((entry) => entry.id === id);
    if (!gate || gate.status !== "pending") return;

    // Flip the in-flight indicator on, then resolve synchronously (mock land).
    set({ actingId: id });

    const note = (noteById[id] ?? "").trim();
    const resolvedAtMs = get().nowMs;
    const decision: ApprovalDecision = {
      id: gate.id,
      runId: gate.runId,
      nodeId: gate.nodeId,
      gate: gate.gate,
      workflowPath: gate.workflowPath,
      iteration: gate.iteration,
      source: gate.source,
      payload: gate.payload,
      action: "approved",
      requestedAtMs: gate.requestedAtMs,
      resolvedAtMs,
      resolvedBy: "you",
      note: note === "" ? undefined : note,
    };
    const nextGates = gates.filter((entry) => entry.id !== id);
    const nextDecisions = [decision, ...decisions];
    const selectedId = syncSelection({
      tab: get().tab,
      gates: nextGates,
      decisions: nextDecisions,
      selectedId: get().selectedId === id ? null : get().selectedId,
    });
    set({ gates: nextGates, decisions: nextDecisions, selectedId, actingId: null });

    const label = gateLabel(gate);
    useChatStore.getState().say(
      `Approved gate \`${label}\` on run \`${shortRunId(gate.runId)}\`. The waiting node will resume.` +
        (note === "" ? "" : `\n\n> ${note}`),
    );
    useNotificationsStore.getState().notify({
      title: "Approval granted",
      detail: `${label} · ${shortRunId(gate.runId)}`,
      kind: "transient",
      command: "chat",
    });
  },

  requestDeny: (id) => set({ pendingDenyId: id }),

  cancelDeny: () => set({ pendingDenyId: null }),

  confirmDeny: (id) => {
    const { gates, decisions, noteById } = get();
    const gate = gates.find((entry) => entry.id === id);
    if (!gate || gate.status !== "pending") {
      set({ pendingDenyId: null });
      return;
    }

    set({ actingId: id });

    const note = (noteById[id] ?? "").trim();
    const resolvedAtMs = get().nowMs;
    const decision: ApprovalDecision = {
      id: gate.id,
      runId: gate.runId,
      nodeId: gate.nodeId,
      gate: gate.gate,
      workflowPath: gate.workflowPath,
      iteration: gate.iteration,
      source: gate.source,
      payload: gate.payload,
      action: "denied",
      requestedAtMs: gate.requestedAtMs,
      resolvedAtMs,
      resolvedBy: "you",
      note: note === "" ? undefined : note,
      reason: note === "" ? "Denied at the approval gate." : note,
    };
    const nextGates = gates.filter((entry) => entry.id !== id);
    const nextDecisions = [decision, ...decisions];
    const selectedId = syncSelection({
      tab: get().tab,
      gates: nextGates,
      decisions: nextDecisions,
      selectedId: get().selectedId === id ? null : get().selectedId,
    });
    set({
      gates: nextGates,
      decisions: nextDecisions,
      selectedId,
      actingId: null,
      pendingDenyId: null,
    });

    const label = gateLabel(gate);
    useChatStore.getState().say(
      `Denied gate \`${label}\` on run \`${shortRunId(gate.runId)}\`. The waiting gate was failed.` +
        (note === "" ? "" : `\n\n> ${note}`),
    );
    useNotificationsStore.getState().notify({
      title: "Approval denied",
      detail: `${label} · ${shortRunId(gate.runId)}`,
      kind: "transient",
      command: "chat",
    });
  },
}));
