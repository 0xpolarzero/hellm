import { Electroview } from "electrobun/view";
import type { ChatRPCSchema } from "../shared/workspace-contract";

const DEFAULT_RPC_TIMEOUT_MS = 120000;

export const rpc = Electroview.defineRPC<ChatRPCSchema>({
  handlers: {},
  maxRequestTime: DEFAULT_RPC_TIMEOUT_MS,
});

const electroview = typeof window === "undefined" ? null : new Electroview({ rpc });

void electroview;
