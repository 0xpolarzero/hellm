import { create } from "zustand";
import { useChatStore } from "../chat/chatStore";
import { useNotificationsStore } from "../notifications/notificationsStore";
import {
  normalizeRunId,
  resolveActiveRunId,
  runLabel,
  SCORES_RUNS,
  shortRunId,
  type ScoresRun,
} from "./scoreReport";

/** The three Summary/Metrics/Recent tabs the canvas toggles between. */
export type ScoreTab = "summary" | "metrics" | "recent";

/**
 * The scores store: the seeded run list plus the selected run and active tab the
 * card and canvas read. `selectedRunId` is null until a run is picked and
 * resolves to the first run via resolveActiveRunId. The derived per-run data
 * (scores, aggregates, token/latency/cost) is NOT held here — the canvas looks it
 * up purely from the seed map keyed by the active run, so all tabs stay in sync.
 *
 * `refresh` re-resolves the selection and echoes a chat line + transient toast,
 * the same gateway-less feedback shape the vcs/issues stores use.
 */
type ScoresState = {
  runs: ScoresRun[];
  selectedRunId: string | null;
  tab: ScoreTab;
  setTab: (tab: ScoreTab) => void;
  selectRun: (runId: string) => void;
  refresh: () => void;
};

export const useScoresStore = create<ScoresState>((set, get) => ({
  runs: SCORES_RUNS,
  selectedRunId: null,
  tab: "summary",

  setTab: (tab) => set({ tab }),

  selectRun: (runId) => {
    const next = normalizeRunId(runId);
    if (next === get().selectedRunId) return;
    set({ selectedRunId: next });
  },

  refresh: () => {
    const { runs, selectedRunId } = get();
    const active = resolveActiveRunId(runs, selectedRunId);
    set({ selectedRunId: active });
    if (active == null) {
      useChatStore.getState().say("No runs available to score.");
      return;
    }
    const run = runs.find((candidate) => candidate.runId === active);
    const label = run ? runLabel(run) : `Run ${shortRunId(active)}`;
    useChatStore.getState().say(`Refreshed scores for ${label}.`);
    useNotificationsStore.getState().notify({
      title: "Scores refreshed",
      detail: label,
      kind: "transient",
      command: "chat",
    });
  },
}));
