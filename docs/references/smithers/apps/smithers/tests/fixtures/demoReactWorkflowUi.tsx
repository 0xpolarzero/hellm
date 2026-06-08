/** @jsxImportSource react */
/**
 * A workflow's custom UI entry built on the real React SDK: the gateway
 * bundles this file, serves it at `/workflows/<key>`, and the bundle boots
 * `createGatewayReactRoot` to mount a React tree that talks live to the
 * gateway over RPC + WebSocket. This is the React counterpart to
 * `demoWorkflowUi.ts` (zero-dep DOM) — the two together cover both shipping
 * shapes for a custom workflow UI.
 *
 * The bundle asserts the high-value end-to-end path: it reads `?runId=` from
 * `location.search`, paints it through `data-testid="demo-react-run-id"`, and
 * drives `useGatewayRun` to read the live run status. It also exposes a
 * "Cancel" button wired to `useGatewayActions().cancelRun` so the e2e can
 * round-trip an action through the real gateway without invasively coupling
 * the test to a UI library or hand-rolling fetch.
 */
import { useMemo } from "react";
import {
  createGatewayReactRoot,
  useGatewayActions,
  useGatewayNodeOutput,
  useGatewayRun,
} from "smithers-orchestrator/gateway-react";

function runIdFromUrl(): string | undefined {
  if (typeof location === "undefined") return undefined;
  return new URLSearchParams(location.search).get("runId") ?? undefined;
}

function App() {
  const runId = useMemo(runIdFromUrl, []);
  const run = useGatewayRun(runId);
  const shipOutput = useGatewayNodeOutput({ runId, nodeId: "ship" });
  const { cancelRun } = useGatewayActions();

  const status = run.data?.status ?? (run.loading ? "loading" : "—");

  return (
    <main
      data-testid="demo-react-workflow-ui"
      style={{
        font: "13px/1.5 system-ui, sans-serif",
        padding: "24px",
        maxWidth: "640px",
        margin: "0 auto",
        color: "#eaeaee",
        background: "#0b0b0e",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>Demo React Workflow UI</h1>
      <p style={{ margin: "0 0 4px", color: "#8a8a92" }}>
        run{" "}
        <strong
          data-testid="demo-react-run-id"
          style={{ fontFamily: "ui-monospace, monospace", color: "#eaeaee" }}
        >
          {runId ?? "(none)"}
        </strong>
      </p>
      <p style={{ margin: "0 0 16px" }}>
        status{" "}
        <strong data-testid="demo-react-run-status">{status}</strong>
      </p>
      <section
        style={{
          background: "#15151a",
          border: "1px solid #26262d",
          borderRadius: 8,
          padding: 16,
          marginBottom: 12,
        }}
      >
        <h2
          style={{
            fontSize: 11,
            color: "#8a8a92",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            margin: "0 0 8px",
          }}
        >
          Ship output
        </h2>
        <pre
          data-testid="demo-react-ship-output"
          style={{
            margin: 0,
            font: "12px/1.5 ui-monospace, monospace",
            whiteSpace: "pre-wrap",
            color: "#c5c5cc",
          }}
        >
          {shipOutput.data?.status === "produced"
            ? JSON.stringify(shipOutput.data.row, null, 2)
            : shipOutput.loading
              ? "loading…"
              : "—"}
        </pre>
      </section>
      <button
        data-testid="demo-react-cancel"
        disabled={!runId}
        onClick={() => {
          if (runId) void cancelRun({ runId });
        }}
        style={{
          background: "#1a1a1f",
          color: "#eaeaee",
          border: "1px solid #2a2a30",
          padding: "8px 16px",
          borderRadius: 6,
          font: "inherit",
          cursor: runId ? "pointer" : "not-allowed",
        }}
      >
        Cancel
      </button>
    </main>
  );
}

createGatewayReactRoot(<App />);
