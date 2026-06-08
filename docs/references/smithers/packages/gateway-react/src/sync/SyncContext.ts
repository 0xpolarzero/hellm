import { createContext } from "react";
import type { SyncClient } from "@smithers-orchestrator/gateway-client";

/**
 * The React context that hands a `SyncClient` to every hook. The default is
 * `null` so consumers must wrap their tree in a `SyncProvider` — surfacing the
 * missing-provider error eagerly beats a silent no-op.
 */
export const SyncContext = createContext<SyncClient | null>(null);
