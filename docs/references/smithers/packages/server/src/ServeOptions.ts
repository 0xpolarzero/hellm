import type { SmithersWorkflow } from "@smthrs/components/SmithersWorkflow";
import type { SmithersDb } from "@smthrs/db/adapter";

export type ServeOptions = {
  workflow: SmithersWorkflow<unknown>;
  adapter: SmithersDb;
  runId: string;
  abort: AbortController;
  authToken?: string;
  metrics?: boolean;
};
