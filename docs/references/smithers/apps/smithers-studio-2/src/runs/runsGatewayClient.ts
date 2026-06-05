/**
 * A minimal, self-contained Gateway RPC client for the Runs surface.
 *
 * It speaks the exact same wire protocol as @smithers-orchestrator/gateway-client
 * (`POST {origin}/v1/rpc/<method>` with a `{type:"res",ok,payload|error}` frame),
 * but is implemented locally so the surface does not pull that package's raw
 * `.ts` sources into the app's tsc program. The result: the real network path
 * runs in production and is intercepted at the route layer in e2e.
 *
 * Lives in `src/runs/` per the disjointness rule — the shell mounts no Gateway
 * provider, so the surface owns its own client.
 */

const RPC_BASE = "/v1/rpc";

type GatewayResponseFrame =
  | { type: "res"; id?: string; ok: true; payload: unknown }
  | { type: "res"; id?: string; ok: false; error: { code: string; message: string } };

export class RunsGatewayError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RunsGatewayError";
    this.code = code;
  }
}

function rpcUrl(method: string): string {
  const origin = typeof location !== "undefined" ? location.origin : "http://127.0.0.1:7331";
  return `${origin}${RPC_BASE}/${method}`;
}

function isResponseFrame(value: unknown): value is GatewayResponseFrame {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "res" &&
    typeof (value as { ok?: unknown }).ok === "boolean"
  );
}

/** All RPC methods the Runs surface invokes. */
export type RunsRpcMethod =
  | "listRuns"
  | "listWorkflows"
  | "getRun"
  | "getDevToolsSnapshot"
  | "listApprovals"
  | "getNodeOutput"
  | "getNodeDiff"
  | "submitApproval"
  | "cancelRun"
  | "resumeRun"
  | "rewindRun";

export class RunsGatewayClient {
  async rpc(method: RunsRpcMethod, params: Record<string, unknown> = {}): Promise<unknown> {
    const response = await fetch(rpcUrl(method), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    let frame: unknown;
    try {
      frame = await response.json();
    } catch {
      throw new RunsGatewayError("HTTP_ERROR", `Gateway HTTP ${response.status}`);
    }
    if (!isResponseFrame(frame)) {
      throw new RunsGatewayError("INVALID_RESPONSE", "Gateway returned an invalid RPC frame.");
    }
    if (!frame.ok) {
      throw new RunsGatewayError(frame.error.code, frame.error.message);
    }
    return frame.payload;
  }
}

let cached: RunsGatewayClient | undefined;

export function runsGatewayClient(): RunsGatewayClient {
  if (!cached) cached = new RunsGatewayClient();
  return cached;
}
