import { create } from "zustand";
import { useChatStore } from "../chat/chatStore";
import { useNotificationsStore } from "../notifications/notificationsStore";
import {
  createCron,
  deleteCron,
  SEEDED_CRONS,
  toggleCron,
  validateCreate,
  type Cron,
} from "./crons";

/**
 * The triggers store: the seeded list plus the selection, the inline create
 * form, the delete-confirm flag, and the dismissable action-error banner the
 * card and canvas read. Mutations post feedback the same way the issues/vcs
 * stores do — a chat line and a transient toast — since this PWA has no gateway
 * yet. The "refresh" action is a deterministic re-seed (no wall-clock).
 */
type CronsState = {
  crons: Cron[];
  selectedId: string | null;
  creating: boolean;
  draftPattern: string;
  draftWorkflowPath: string;
  /** The trigger awaiting delete confirmation; non-null reveals the confirm strip. */
  pendingDeleteId: string | null;
  /** The dismissable action-error banner text (the Swift actionErrorBanner seam). */
  actionError: string | null;
  select: (id: string) => void;
  openCreate: () => void;
  cancelCreate: () => void;
  setDraftPattern: (value: string) => void;
  setDraftWorkflowPath: (value: string) => void;
  submitCreate: () => void;
  toggle: (id: string) => void;
  requestDelete: (id: string) => void;
  cancelDelete: () => void;
  confirmDelete: () => void;
  refresh: () => void;
  dismissActionError: () => void;
};

export const useCronsStore = create<CronsState>((set, get) => ({
  crons: SEEDED_CRONS,
  selectedId: null,
  creating: false,
  draftPattern: "",
  draftWorkflowPath: "",
  pendingDeleteId: null,
  actionError: null,

  select: (id) => set({ selectedId: id }),

  openCreate: () => set({ creating: true, draftPattern: "", draftWorkflowPath: "", actionError: null }),

  cancelCreate: () => set({ creating: false, draftPattern: "", draftWorkflowPath: "" }),

  setDraftPattern: (value) => set({ draftPattern: value }),

  setDraftWorkflowPath: (value) => set({ draftWorkflowPath: value }),

  submitCreate: () => {
    const { crons, draftPattern, draftWorkflowPath } = get();
    // The button is gated on validateCreate already; re-check so the action is
    // safe to call directly (and so a stray Enter never builds an invalid row).
    if (validateCreate(draftPattern, draftWorkflowPath) !== null) return;
    const { crons: next, created } = createCron(crons, {
      pattern: draftPattern,
      workflowPath: draftWorkflowPath,
    });
    set({
      crons: next,
      selectedId: created.id,
      creating: false,
      draftPattern: "",
      draftWorkflowPath: "",
    });
    useChatStore.getState().say(`Created trigger ${created.name} (\`${created.pattern}\`).`);
    useNotificationsStore.getState().notify({
      title: "Trigger created",
      detail: `${created.name} · ${created.nextHint}`,
      kind: "transient",
      command: "chat",
    });
  },

  toggle: (id) => {
    const { crons } = get();
    const target = crons.find((cron) => cron.id === id);
    if (!target) return;
    const willEnable = !target.enabled;
    set({ crons: toggleCron(crons, id) });
    const verb = willEnable ? "Enabled" : "Disabled";
    useChatStore.getState().say(`${verb} trigger ${target.name}.`);
    useNotificationsStore.getState().notify({
      title: willEnable ? "Trigger enabled" : "Trigger disabled",
      detail: `${target.name} · ${target.pattern}`,
      kind: "transient",
      command: "chat",
    });
  },

  requestDelete: (id) => set({ pendingDeleteId: id }),

  cancelDelete: () => set({ pendingDeleteId: null }),

  confirmDelete: () => {
    const { crons, pendingDeleteId, selectedId } = get();
    if (!pendingDeleteId) return;
    const target = crons.find((cron) => cron.id === pendingDeleteId);
    if (!target) {
      set({ pendingDeleteId: null });
      return;
    }
    set({
      crons: deleteCron(crons, pendingDeleteId),
      pendingDeleteId: null,
      selectedId: selectedId === pendingDeleteId ? null : selectedId,
    });
    useChatStore.getState().say(`Deleted trigger ${target.name}.`);
    useNotificationsStore.getState().notify({
      title: "Trigger deleted",
      detail: `${target.name} · ${target.pattern}`,
      kind: "transient",
      command: "chat",
    });
  },

  refresh: () => {
    set({ crons: SEEDED_CRONS, selectedId: null, pendingDeleteId: null, actionError: null });
    useChatStore.getState().say("Reloaded triggers.");
  },

  dismissActionError: () => set({ actionError: null }),
}));
