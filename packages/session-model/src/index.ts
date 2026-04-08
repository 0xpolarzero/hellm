export type EpisodeStatus = "queued" | "running" | "verified" | "blocked";

export interface Episode {
  id: string;
  title: string;
  summary: string;
  artifacts: string[];
  status: EpisodeStatus;
}

export interface ThreadSnapshot {
  id: string;
  goal: string;
  activeWorkstream: string;
  episodes: Episode[];
}

export interface BeginThreadInput {
  threadId: string;
  goal: string;
}
