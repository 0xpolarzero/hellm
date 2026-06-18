export type TranscriptStatus =
  | "running"
  | "active"
  | "done"
  | "verified"
  | "passed"
  | "waiting"
  | "blocked"
  | "failed"
  | "cancelled"
  | "idle";

export type TranscriptToolArtifact = {
  id: string;
  name: string;
  path?: string;
};

export type TranscriptToolLifecycleItem = {
  label: string;
  value: string;
  tone?: TranscriptStatus;
};

export type TranscriptToolMetric = {
  label: string;
  value: string;
  tone?: TranscriptStatus;
};

export type TranscriptToolSection = {
  id: string;
  title: string;
  content: string;
  tone?: TranscriptStatus;
  defaultOpen?: boolean;
};

export type TranscriptToolChild = {
  id: string;
  title: string;
  summary?: string | null;
  status: TranscriptStatus;
  duration?: string | null;
};

export type TranscriptToolCall = {
  id: string;
  name: string;
  title?: string;
  target?: string | null;
  commandId?: string;
  status: TranscriptStatus;
  summary?: string | null;
  outcome?: string | null;
  duration?: string | null;
  body?: string | null;
  result?: string | null;
  isError?: boolean;
  attempt?: number;
  totalAttempts?: number;
  lifecycle?: TranscriptToolLifecycleItem[];
  metrics?: TranscriptToolMetric[];
  sections?: TranscriptToolSection[];
  children?: TranscriptToolChild[];
  artifacts?: TranscriptToolArtifact[];
};
