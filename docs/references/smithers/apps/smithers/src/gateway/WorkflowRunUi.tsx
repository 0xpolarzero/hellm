import { getGatewayBaseUrl } from "../auth/authClient";

function normalizeWorkflowUiPath(uiPath: string): string {
  const value = uiPath.trim() || "/";
  try {
    const parsed = new URL(value, "http://smithers.local");
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
  } catch {
    return "/";
  }
}

export function workflowUiSrc(
  uiPath: string,
  runId: string,
  gatewayBaseUrl = getGatewayBaseUrl(),
): string {
  const base = gatewayBaseUrl || "http://smithers.local";
  const url = new URL(normalizeWorkflowUiPath(uiPath), base);
  url.searchParams.set("runId", runId);
  return gatewayBaseUrl ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Embeds a workflow's own custom UI for a gateway run. Workflows register a UI
 * with the gateway (served at `uiPath`, e.g. `/workflows/<key>`); when a run
 * belongs to such a workflow the inspector defaults to showing that UI here.
 *
 * The UI is a standalone bundle the gateway serves and boots with its own RPC /
 * websocket clients, so it lives behind an iframe — its own document, its own
 * React, its own styles. Same-origin deployments keep `/workflows/*` relative
 * so the Worker/Vite gateway proxy can authenticate the frame's requests. A
 * directly configured remote gateway instead uses its absolute remote origin.
 * `?runId=<id>` lets a UI scope to one run by reading `location.search`.
 */
export function WorkflowRunUi({
  uiPath,
  runId,
}: {
  uiPath: string;
  runId: string;
}) {
  const src = workflowUiSrc(uiPath, runId);
  return (
    <div className="gw-ui-frame-wrap" data-testid="gateway-workflow-ui">
      <iframe
        key={src}
        className="gw-ui-frame"
        src={src}
        title="Workflow UI"
        data-testid="gateway-workflow-ui-frame"
      />
    </div>
  );
}
