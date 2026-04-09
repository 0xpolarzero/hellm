import { Electroview } from "electrobun/view";
import type { ChatRPCSchema } from "./chat-rpc";

const DEFAULT_RPC_TIMEOUT_MS = 120000;
const envTimeout = Number(import.meta.env.VITE_ELECTROBUN_RPC_TIMEOUT_MS ?? `${DEFAULT_RPC_TIMEOUT_MS}`);
const rpcRequestTimeoutMs = Number.isFinite(envTimeout) && envTimeout > 0 ? Math.trunc(envTimeout) : DEFAULT_RPC_TIMEOUT_MS;

export const rpc = Electroview.defineRPC<ChatRPCSchema>({
	handlers: {},
	maxRequestTime: rpcRequestTimeoutMs,
});

new Electroview({ rpc });
