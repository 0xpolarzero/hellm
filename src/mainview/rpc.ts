import { Electroview } from "electrobun/view";
import type { ChatRPCSchema } from "../shared/workspace-contract";

const DEFAULT_RPC_TIMEOUT_MS = 120000;
const envTimeout = Number(
  import.meta.env.VITE_ELECTROBUN_RPC_TIMEOUT_MS ?? `${DEFAULT_RPC_TIMEOUT_MS}`,
);
const rpcRequestTimeoutMs =
  Number.isFinite(envTimeout) && envTimeout > 0 ? Math.trunc(envTimeout) : DEFAULT_RPC_TIMEOUT_MS;

export const rpc = Electroview.defineRPC<ChatRPCSchema>({
  handlers: {},
  maxRequestTime: rpcRequestTimeoutMs,
});

const isFixturePreview =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("ui-fixture");
const electroview =
  typeof window === "undefined" || isFixturePreview ? null : new Electroview({ rpc });

void electroview;
