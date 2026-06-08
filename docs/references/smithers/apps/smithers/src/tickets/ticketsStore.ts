import { create } from "zustand";
import { useChatStore } from "../chat/chatStore";
import { useNotificationsStore } from "../notifications/notificationsStore";
import {
  createTicket,
  deleteTicket,
  SEEDED_TICKETS,
  updateTicket,
  type Ticket,
} from "./tickets";

/**
 * Tickets feature state: the seeded list plus the editor's selection, search,
 * draft buffer, and create form. The PWA has no gateway, so saves and creates
 * replay as a chat line plus a toast, the same shape the vcs store uses.
 */
type TicketsState = {
  tickets: Ticket[];
  selectedId: string | null;
  query: string;
  /** The editor buffer for the selected ticket. */
  draftContent: string;
  createOpen: boolean;
  newId: string;
  newContent: string;
  select: (id: string) => void;
  setQuery: (value: string) => void;
  setDraft: (value: string) => void;
  save: () => void;
  remove: (id: string) => void;
  openCreate: () => void;
  cancelCreate: () => void;
  setNewId: (value: string) => void;
  setNewContent: (value: string) => void;
  submitCreate: () => void;
};

const first = SEEDED_TICKETS[0];

export const useTicketsStore = create<TicketsState>((set, get) => ({
  tickets: SEEDED_TICKETS,
  selectedId: first ? first.id : null,
  query: "",
  draftContent: first ? first.content : "",
  createOpen: false,
  newId: "",
  newContent: "",

  select: (id) => {
    const ticket = get().tickets.find((t) => t.id === id);
    set({ selectedId: id, draftContent: ticket ? ticket.content : "" });
  },

  setQuery: (value) => set({ query: value }),

  setDraft: (value) => set({ draftContent: value }),

  save: () => {
    const { selectedId, draftContent, tickets } = get();
    if (!selectedId) return;
    set({ tickets: updateTicket(tickets, selectedId, draftContent) });
    useChatStore.getState().say(`Saved ticket \`${selectedId}\`.`);
    useNotificationsStore.getState().notify({
      title: "Ticket saved",
      detail: selectedId,
      kind: "transient",
      command: "chat",
    });
  },

  remove: (id) => {
    const { tickets, selectedId } = get();
    const next = deleteTicket(tickets, id);
    const patch: Partial<TicketsState> = { tickets: next };
    if (selectedId === id) {
      const fallback = next[0] ?? null;
      patch.selectedId = fallback ? fallback.id : null;
      patch.draftContent = fallback ? fallback.content : "";
    }
    set(patch);
    useChatStore.getState().say(`Deleted ticket \`${id}\`.`);
    useNotificationsStore.getState().notify({
      title: "Ticket deleted",
      detail: id,
      kind: "transient",
      command: "chat",
    });
  },

  openCreate: () => set({ createOpen: true, newId: "", newContent: "" }),

  cancelCreate: () => set({ createOpen: false }),

  setNewId: (value) => set({ newId: value }),

  setNewContent: (value) => set({ newContent: value }),

  submitCreate: () => {
    const { newId, newContent, tickets } = get();
    const id = newId.trim();
    if (id.length === 0) return;
    const { tickets: next, created } = createTicket(tickets, { id, content: newContent });
    set({
      tickets: next,
      selectedId: created.id,
      draftContent: created.content,
      createOpen: false,
      newId: "",
      newContent: "",
    });
    useChatStore.getState().say(`Created ticket \`${created.id}\`.`);
    useNotificationsStore.getState().notify({
      title: "Ticket created",
      detail: created.id,
      kind: "transient",
      command: "chat",
    });
  },
}));
