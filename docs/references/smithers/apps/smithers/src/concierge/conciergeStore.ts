import { create } from "zustand";
import {
  type ContextContract,
  emptyContract,
  mergeContract,
} from "./contextContract";

/**
 * The Context Engineering Console's state: the workflow `script` the console is
 * editing, the {@link ContextContract} being negotiated, and which node (if any)
 * is currently selected in the graph view. This is pure state — no network, no
 * clock — so the console's interactions can be driven and unit-tested without a
 * backend. The contract starts fully shaped via {@link emptyContract}.
 */
export type ConciergeState = {
  script: string;
  contract: ContextContract;
  selectedNode: string | null;
  setScript: (script: string) => void;
  setContract: (contract: ContextContract) => void;
  /** Merge a sparse patch onto the current contract (see {@link mergeContract}). */
  patchContract: (patch: Partial<ContextContract>) => void;
  selectNode: (id: string | null) => void;
  /** Drop all console state back to its initial, freshly-shaped values. */
  reset: () => void;
};

export const useConciergeStore = create<ConciergeState>((set) => ({
  script: "",
  contract: emptyContract(),
  selectedNode: null,
  setScript: (script) => set({ script }),
  setContract: (contract) => set({ contract }),
  patchContract: (patch) =>
    set((state) => ({ contract: mergeContract(state.contract, patch) })),
  selectNode: (id) => set({ selectedNode: id }),
  reset: () =>
    set({ script: "", contract: emptyContract(), selectedNode: null }),
}));
