import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Which backend the UI is bound to. `gateway` is local smithers (run-context:
 * the workflow runtime at /v1/rpc, via gateway/gatewayClient.ts); `platform` is
 * cloud jjhub (repo-context: the REST API behind jjhub/platformFetch). One UI
 * serves both, so this is the seam that flips the default home view between the
 * run grid and the repo dashboard. See docs/jjhub-backend-seam.md.
 */
export type BackendMode = "gateway" | "platform";

type BackendState = {
  mode: BackendMode;
  setMode: (mode: BackendMode) => void;
  toggle: () => void;
};

/**
 * The active backend on the `local` medium: persisted to localStorage so a
 * reload keeps the choice. Defaults to `gateway`, the UI's original behavior, so
 * nothing changes until the jjhub platform surfaces land.
 */
export const useBackendStore = create<BackendState>()(
  persist(
    (set) => ({
      mode: "gateway",
      setMode: (mode) => set({ mode }),
      toggle: () =>
        set((state) => ({ mode: state.mode === "gateway" ? "platform" : "gateway" })),
    }),
    { name: "smithers.backend" },
  ),
);
