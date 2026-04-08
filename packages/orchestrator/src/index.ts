import type {
  BeginThreadInput,
  Episode,
  ThreadSnapshot,
} from "@hellm/session-model";

export interface Orchestrator {
  readonly id: string;
  beginThread(input: BeginThreadInput): ThreadSnapshot;
}

export function createOrchestrator(): Orchestrator {
  return {
    id: "main",
    beginThread(input) {
      const bootstrapEpisode: Episode = {
        id: `${input.threadId}:bootstrap`,
        title: "Bootstrap workspace",
        summary: "Establish the initial Bun monorepo scaffold for hellm.",
        artifacts: ["package.json", "tsconfig.json", ".oxlintrc.json"],
        status: "verified",
      };

      return {
        id: input.threadId,
        goal: input.goal,
        activeWorkstream: "main",
        episodes: [bootstrapEpisode],
      };
    },
  };
}
