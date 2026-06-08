/**
 * A workflow's custom UI entry, the way one ships in real life: a standalone
 * browser bundle the gateway builds on demand and serves at `/workflows/<key>`.
 * Kept dependency-free (plain DOM, no framework) so the e2e exercises the
 * integration that matters — the gateway bundling + serving the bundle, the app
 * embedding it in an iframe, and the `?runId=` deep-link flowing through — without
 * coupling the test to any UI library. A real UI would use
 * `smithers-orchestrator/gateway-react` here instead.
 */
const params = new URLSearchParams(
  typeof location !== "undefined" ? location.search : "",
);
const runId = params.get("runId") ?? "(none)";

const root = typeof document !== "undefined" ? document.getElementById("root") : null;
if (root) {
  const main = document.createElement("main");
  main.dataset.testid = "demo-workflow-ui";
  main.setAttribute("style", "font-family:system-ui;padding:32px;max-width:560px;margin:0 auto");

  const heading = document.createElement("h1");
  heading.textContent = "Demo Workflow UI";
  heading.setAttribute("style", "font-size:20px;margin:0 0 8px");

  const blurb = document.createElement("p");
  blurb.textContent =
    "A workflow's own custom UI, served by the Smithers gateway and embedded in the app.";
  blurb.setAttribute("style", "color:#555;margin:0 0 16px");

  const runLine = document.createElement("p");
  runLine.setAttribute("style", "margin:0");
  const label = document.createTextNode("run ");
  const value = document.createElement("strong");
  value.dataset.testid = "demo-run-id";
  value.textContent = runId;
  value.setAttribute("style", "font-family:ui-monospace,Menlo,monospace");
  runLine.append(label, value);

  main.append(heading, blurb, runLine);
  root.replaceChildren(main);
}
