import type { SmithersEvent } from "@smthrs/observability/SmithersEvent";

export type TimeTravelOptions = {
  runId: string;
  nodeId: string;
  iteration?: number;
  attempt?: number;
  resetDependents?: boolean;
  restoreVcs?: boolean;
  onProgress?: (event: SmithersEvent) => void;
};
