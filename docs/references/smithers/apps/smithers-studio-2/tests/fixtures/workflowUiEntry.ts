/**
 * A minimal custom workflow UI for the real-backend e2e suite. Real workflow
 * UIs are full apps the Gateway serves at `/workflows/<key>`; this one exists
 * only to prove the Runs surface (a) defaults a run whose workflow ships a UI
 * into the embedded iframe, and (b) can toggle back to the default view.
 *
 * The Gateway bundles this entry with Bun.build and boots it with
 * `globalThis.__SMITHERS_GATEWAY_UI__`. The Runs surface appends `?runId=<id>`,
 * so we render both the workflow key (from boot) and that run id into a stable
 * test target. Kept dependency-free (plain DOM) so the bundle needs no React.
 */
type Boot = { workflowKey: string | null };

const boot = (globalThis as { __SMITHERS_GATEWAY_UI__?: Boot }).__SMITHERS_GATEWAY_UI__;
const runId = new URLSearchParams(location.search).get("runId") ?? "";
const root = document.getElementById("root");

if (root) {
  const el = document.createElement("div");
  el.setAttribute("data-testid", "fixtureWorkflowUi.root");
  el.setAttribute("data-run-id", runId);
  el.textContent = `Custom UI for ${boot?.workflowKey ?? "?"} — run ${runId}`;
  root.appendChild(el);
}
